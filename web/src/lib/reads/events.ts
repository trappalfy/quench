import { getAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { ADDRESSES } from "../chain";
import { LaunchpadAbi, BlockHookAbi, BondingCurveAbi, PoolManagerAbi } from "../abi";
import type { Launch } from "./launches";

/**
 * The activity feed, assembled from logs at read time.
 *
 * There is no indexer here. Robinhood Chain answers a filtered `eth_getLogs`
 * over a day's worth of blocks (~860,000 at ~0.1s each) in well under a second
 * and imposes no range limit, only a 10,000-log cap per response. Five queries
 * cover every venue: the hook, the launchpad, every curve at once, and the pool
 * manager for graduated pools.
 *
 * Nothing here is inferred. If a venue answers with nothing, the feed is
 * shorter — it is never padded to look busy.
 */

/// Taken from the generated ABIs rather than written out by hand. An event's
/// topic is the hash of its exact signature, so a single wrong type silently
/// matches nothing — `blueprintId` is a uint64, and typing it as uint256 here
/// meant no launch ever appeared in the feed, with no error to show for it.
const POT_PAID = getAbiItem({ abi: BlockHookAbi, name: "PotPaid" });
const AUTO_BURNED = getAbiItem({ abi: BlockHookAbi, name: "AutoBurned" });
const LAUNCHED = getAbiItem({ abi: LaunchpadAbi, name: "Launched" });
const CURVE_BOUGHT = getAbiItem({ abi: BondingCurveAbi, name: "Bought" });
const CURVE_SOLD = getAbiItem({ abi: BondingCurveAbi, name: "Sold" });
const GRADUATED = getAbiItem({ abi: BondingCurveAbi, name: "Graduated" });
const SWAP = getAbiItem({ abi: PoolManagerAbi, name: "Swap" });

export type EventKind =
  | "launch"
  | "buy"
  | "sell"
  | "graduate"
  | "pot"
  | "burn";

export type FeedEvent = {
  kind: EventKind;
  block: bigint;
  logIndex: number;
  token: Address;
  symbol: string;
  /** ETH in wei where the event has an ETH leg. */
  eth?: bigint;
  /** Token amount where the event has a token leg. */
  tokens?: bigint;
  actor?: Address;
  /** Whether this is the molten venue (curve) or the quenched one (pool). */
  venue: "curve" | "pool" | "launchpad";
};

export async function readFeed(
  client: PublicClient,
  launches: Launch[],
  head: bigint,
  windowBlocks = 900_000n,
): Promise<FeedEvent[]> {
  if (launches.length === 0) return [];

  const fromBlock = head > windowBlocks ? head - windowBlocks : 0n;
  const byToken = new Map(launches.map((l) => [l.record.token.toLowerCase(), l]));
  const byPoolId = new Map(launches.map((l) => [l.poolId.toLowerCase(), l]));
  const byCurve = new Map(
    launches
      .filter((l) => l.curve)
      .map((l) => [l.record.curve.toLowerCase(), l]),
  );

  const curveAddresses = [...byCurve.keys()] as Address[];
  const poolIds = launches.filter((l) => l.record.graduated).map((l) => l.poolId);

  const settled = await Promise.allSettled([
    client.getLogs({ address: ADDRESSES.blockHook, event: POT_PAID, fromBlock, toBlock: head }),
    client.getLogs({ address: ADDRESSES.blockHook, event: AUTO_BURNED, fromBlock, toBlock: head }),
    client.getLogs({ address: ADDRESSES.launchpad, event: LAUNCHED, fromBlock, toBlock: head }),
    curveAddresses.length
      ? client.getLogs({ address: curveAddresses, event: CURVE_BOUGHT, fromBlock, toBlock: head })
      : Promise.resolve([]),
    curveAddresses.length
      ? client.getLogs({ address: curveAddresses, event: CURVE_SOLD, fromBlock, toBlock: head })
      : Promise.resolve([]),
    curveAddresses.length
      ? client.getLogs({ address: curveAddresses, event: GRADUATED, fromBlock, toBlock: head })
      : Promise.resolve([]),
    poolIds.length
      ? client.getLogs({
          address: ADDRESSES.poolManager,
          event: SWAP,
          args: { id: poolIds },
          fromBlock,
          toBlock: head,
        })
      : Promise.resolve([]),
  ]);

  // A venue that fails to answer drops out of the feed rather than taking the
  // whole page down with it.
  const [pot, burn, launched, bought, sold, graduated, swaps] = settled.map((r) =>
    r.status === "fulfilled" ? r.value : [],
  ) as never[];

  const out: FeedEvent[] = [];
  const push = (e: FeedEvent | null) => {
    if (e) out.push(e);
  };

  const fromPoolId = (id: unknown) => byPoolId.get(String(id).toLowerCase());
  const fromCurve = (addr: unknown) => byCurve.get(String(addr).toLowerCase());

  for (const log of pot as { args: { id: Hex; winner: Address; amount: bigint }; blockNumber: bigint; logIndex: number }[]) {
    const l = fromPoolId(log.args.id);
    if (!l) continue;
    push({
      kind: "pot",
      block: log.blockNumber,
      logIndex: log.logIndex,
      token: l.record.token,
      symbol: l.symbol,
      eth: log.args.amount,
      actor: log.args.winner,
      venue: "pool",
    });
  }

  for (const log of burn as { args: { id: Hex; amount: bigint }; blockNumber: bigint; logIndex: number }[]) {
    const l = fromPoolId(log.args.id);
    if (!l) continue;
    push({
      kind: "burn",
      block: log.blockNumber,
      logIndex: log.logIndex,
      token: l.record.token,
      symbol: l.symbol,
      tokens: log.args.amount,
      venue: "pool",
    });
  }

  for (const log of launched as { args: { token: Address; creator: Address }; blockNumber: bigint; logIndex: number }[]) {
    const l = byToken.get(log.args.token.toLowerCase());
    if (!l) continue;
    push({
      kind: "launch",
      block: log.blockNumber,
      logIndex: log.logIndex,
      token: l.record.token,
      symbol: l.symbol,
      actor: log.args.creator,
      venue: "launchpad",
    });
  }

  for (const log of bought as { address: Address; args: { recipient: Address; ethIn: bigint; tokensOut: bigint }; blockNumber: bigint; logIndex: number }[]) {
    const l = fromCurve(log.address);
    if (!l) continue;
    push({
      kind: "buy",
      block: log.blockNumber,
      logIndex: log.logIndex,
      token: l.record.token,
      symbol: l.symbol,
      eth: log.args.ethIn,
      tokens: log.args.tokensOut,
      actor: log.args.recipient,
      venue: "curve",
    });
  }

  for (const log of sold as { address: Address; args: { seller: Address; tokensIn: bigint; ethOut: bigint }; blockNumber: bigint; logIndex: number }[]) {
    const l = fromCurve(log.address);
    if (!l) continue;
    push({
      kind: "sell",
      block: log.blockNumber,
      logIndex: log.logIndex,
      token: l.record.token,
      symbol: l.symbol,
      eth: log.args.ethOut,
      tokens: log.args.tokensIn,
      actor: log.args.seller,
      venue: "curve",
    });
  }

  for (const log of graduated as { address: Address; args: { ethToPool: bigint }; blockNumber: bigint; logIndex: number }[]) {
    const l = fromCurve(log.address);
    if (!l) continue;
    push({
      kind: "graduate",
      block: log.blockNumber,
      logIndex: log.logIndex,
      token: l.record.token,
      symbol: l.symbol,
      eth: log.args.ethToPool,
      venue: "curve",
    });
  }

  for (const log of swaps as { args: { id: Hex; sender: Address; amount0: bigint; amount1: bigint }; blockNumber: bigint; logIndex: number }[]) {
    const l = fromPoolId(log.args.id);
    if (!l) continue;
    // v4 emits the *swapper's* delta, not the pool's: it is what the caller
    // owes or is owed. currency0 is ETH, so a buy shows amount0 negative —
    // the caller is paying it in. Reading this the other way round labelled
    // every buy a sell.
    const eth = log.args.amount0 < 0n ? -log.args.amount0 : log.args.amount0;
    const tokens = log.args.amount1 < 0n ? -log.args.amount1 : log.args.amount1;
    push({
      kind: log.args.amount0 < 0n ? "buy" : "sell",
      block: log.blockNumber,
      logIndex: log.logIndex,
      token: l.record.token,
      symbol: l.symbol,
      eth,
      tokens,
      actor: log.args.sender,
      venue: "pool",
    });
  }

  return out.sort((a, b) =>
    a.block === b.block ? b.logIndex - a.logIndex : Number(b.block - a.block),
  );
}

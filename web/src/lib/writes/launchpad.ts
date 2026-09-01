import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { LaunchpadAbi } from "../abi";
import { ADDRESSES } from "../chain";
import type { BlockConfig } from "../hookConfig";

/**
 * The three writes that are not trades: publishing a blueprint, launching a
 * token, and claiming the fees a pool has collected.
 *
 * Each one simulates first and signs second. The simulation costs a round trip
 * and buys the thing this project keeps insisting on — a refusal arrives with
 * the contract's own error name, before a wallet has opened, instead of as a
 * failed transaction the user has already paid for.
 */

/// The struct order the launchpad's ABI expects. Written out rather than spread
/// from an object, because a field order that drifts encodes silently: every
/// value is a number and the call would succeed with the wrong meanings.
function cfgTuple(c: BlockConfig) {
  return {
    guardBlocks: c.guardBlocks,
    maxBuyBps: c.maxBuyBps,
    snipeTaxPips: c.snipeTaxPips,
    baseFeePips: c.baseFeePips,
    maxFeePips: c.maxFeePips,
    surgeSens: c.surgeSens,
    burnBps: c.burnBps,
    burnTriggerWei: c.burnTriggerWei,
    lpBps: c.lpBps,
    potBps: c.potBps,
    potEveryN: c.potEveryN,
    potMinBuyWei: c.potMinBuyWei,
  } as const;
}

export async function publishBlueprint(
  client: PublicClient,
  wallet: WalletClient,
  account: Address,
  cfg: BlockConfig,
  royaltyBps: number,
): Promise<Hex> {
  const { request } = await client.simulateContract({
    address: ADDRESSES.launchpad,
    abi: LaunchpadAbi,
    functionName: "publishBlueprint",
    args: [cfgTuple(cfg), royaltyBps],
    account,
  });
  return wallet.writeContract(request);
}

/// The id the launchpad assigned, read back from the receipt rather than
/// guessed from the count — a second publish in the same block would make that
/// guess wrong.
export function blueprintIdFromReceipt(logs: { topics: readonly Hex[] }[]): bigint | null {
  // BlueprintPublished(uint256 indexed id, address indexed author, uint16)
  for (const log of logs) {
    if (log.topics.length >= 2 && log.topics[1]) {
      try {
        return BigInt(log.topics[1]);
      } catch {
        continue;
      }
    }
  }
  return null;
}

export type InstantParams = {
  name: string;
  symbol: string;
  cfg: BlockConfig;
  creatorFeeBps: number;
  blueprintId: bigint;
  sqrtPriceX96: bigint;
};

export async function launchInstant(
  client: PublicClient,
  wallet: WalletClient,
  account: Address,
  p: InstantParams,
  ethIn: bigint,
): Promise<Hex> {
  const { request } = await client.simulateContract({
    address: ADDRESSES.launchpad,
    abi: LaunchpadAbi,
    functionName: "launchInstant",
    args: [
      {
        name: p.name,
        symbol: p.symbol,
        cfg: cfgTuple(p.cfg),
        creatorFeeBps: p.creatorFeeBps,
        blueprintId: p.blueprintId,
        sqrtPriceX96: p.sqrtPriceX96,
      },
    ],
    value: ethIn,
    account,
  });
  return wallet.writeContract(request);
}

export type CurveParams = {
  name: string;
  symbol: string;
  cfg: BlockConfig;
  creatorFeeBps: number;
  blueprintId: bigint;
  p0: bigint;
};

export async function launchCurve(
  client: PublicClient,
  wallet: WalletClient,
  account: Address,
  p: CurveParams,
): Promise<Hex> {
  const { request } = await client.simulateContract({
    address: ADDRESSES.launchpad,
    abi: LaunchpadAbi,
    functionName: "launchCurve",
    args: [
      {
        name: p.name,
        symbol: p.symbol,
        cfg: cfgTuple(p.cfg),
        creatorFeeBps: p.creatorFeeBps,
        blueprintId: p.blueprintId,
        p0: p.p0,
      },
    ],
    account,
  });
  return wallet.writeContract(request);
}

/// The token the launchpad created, from the Launched event's first indexed
/// topic. A launch returns the address, but a receipt does not carry return
/// values — only logs.
export function launchedTokenFromReceipt(
  logs: { address: string; topics: readonly Hex[] }[],
): Address | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== ADDRESSES.launchpad.toLowerCase()) continue;
    const topic = log.topics[1];
    if (!topic) continue;
    return `0x${topic.slice(-40)}` as Address;
  }
  return null;
}

/**
 * Claim a pool's collected fees.
 *
 * Callable by anyone, which is not an oversight: the split is fixed at launch
 * and the ETH goes to the creator and the protocol wherever the call came from.
 * So the button is offered to whoever is looking, not only to the creator.
 */
export async function claimFees(
  client: PublicClient,
  wallet: WalletClient,
  account: Address,
  token: Address,
): Promise<Hex> {
  const { request } = await client.simulateContract({
    address: ADDRESSES.launchpad,
    abi: LaunchpadAbi,
    functionName: "claimFees",
    args: [token],
    account,
  });
  return wallet.writeContract(request);
}

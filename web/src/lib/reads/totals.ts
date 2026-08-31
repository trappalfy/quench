import { getAbiItem, type PublicClient } from "viem";
import { BlockHookAbi, PoolManagerAbi } from "../abi";
import { ADDRESSES, DEPLOY_BLOCK } from "../chain";

/**
 * What the five blocks have done across every pool, since the launchpad was
 * deployed.
 *
 * Each of these is a single unfiltered `eth_getLogs` over the launchpad's whole
 * life, or one balance read. That is affordable here — Robinhood Chain answers
 * an 860,000-block filtered query in under half a second and caps a response at
 * 10,000 logs, not at a block range — and it will stop being affordable long
 * before it stops being correct. The failure mode is a cap error, which is loud;
 * see `readAutoBurned` for the halving strategy when it comes to that.
 *
 * A total that cannot be read is null, never zero. "Nothing has been burned" and
 * "we could not find out" are different claims, and only one of them is a
 * compliment to the protocol.
 */

const AUTO_BURNED = getAbiItem({ abi: BlockHookAbi, name: "AutoBurned" });
const POT_PAID = getAbiItem({ abi: BlockHookAbi, name: "PotPaid" });
const DONATE = getAbiItem({ abi: PoolManagerAbi, name: "Donate" });

export type Totals = {
  /// Tokens destroyed by the Auto Burn block. Not what sits at 0x…dEaD: that
  /// also holds supply the launchpad burned at launch, which is not a rule
  /// doing anything.
  burnedByHooks: bigint | null;
  /// ETH sitting in the vault right now, across every pool's pot.
  potHeld: bigint | null;
  /// ETH the pots have already paid out.
  potPaid: bigint | null;
  /// ETH the LP Rewards block has donated into pools. Every donate on a Quench
  /// pool comes from the hook — nothing else has a reason to call it — so the
  /// sender filter is what makes this a figure about the rule rather than about
  /// the pool.
  lpDonated: bigint | null;
};

export async function readTotals(client: PublicClient): Promise<Totals> {
  const settled = await Promise.allSettled([
    client.getLogs({
      address: ADDRESSES.blockHook,
      event: AUTO_BURNED,
      fromBlock: DEPLOY_BLOCK,
      toBlock: "latest",
    }),
    client.getBalance({ address: ADDRESSES.potVault }),
    client.getLogs({
      address: ADDRESSES.blockHook,
      event: POT_PAID,
      fromBlock: DEPLOY_BLOCK,
      toBlock: "latest",
    }),
    client.getLogs({
      address: ADDRESSES.poolManager,
      event: DONATE,
      args: { sender: ADDRESSES.blockHook },
      fromBlock: DEPLOY_BLOCK,
      toBlock: "latest",
    }),
  ]);

  const [burned, held, paid, donated] = settled;

  return {
    burnedByHooks:
      burned.status === "fulfilled"
        ? burned.value.reduce((sum, l) => sum + (l.args.amount ?? 0n), 0n)
        : null,
    potHeld: held.status === "fulfilled" ? held.value : null,
    potPaid:
      paid.status === "fulfilled"
        ? paid.value.reduce((sum, l) => sum + (l.args.amount ?? 0n), 0n)
        : null,
    lpDonated:
      donated.status === "fulfilled"
        ? donated.value.reduce((sum, l) => sum + (l.args.amount0 ?? 0n), 0n)
        : null,
  };
}

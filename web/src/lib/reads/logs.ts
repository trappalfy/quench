import { getAbiItem, type Hex, type PublicClient } from "viem";
import { ADDRESSES } from "../chain";
import { BlockHookAbi } from "../abi";

/**
 * Reads that come from event logs rather than storage.
 *
 * There is no indexer behind this site. Robinhood Chain answers a filtered
 * `eth_getLogs` over a 24-hour span (~860,000 blocks at ~0.1s each) in well
 * under a second, and imposes no range limit — only a cap of 10,000 logs in a
 * single response, which `splitOnCap` handles by halving the window.
 */

/// From the generated ABI, not hand-written: a topic is the hash of an exact
/// signature, and one wrong type matches nothing without erroring.
const AUTO_BURNED = getAbiItem({ abi: BlockHookAbi, name: "AutoBurned" });

const LOG_CAP_MESSAGE = /exceeds limit/i;

/**
 * How much of a token the Auto Burn block has actually destroyed.
 *
 * This is deliberately not `balanceOf(0x…dEaD)`. An instant launch burns
 * whatever supply does not fit its opening position, and that burn belongs to
 * the launchpad, not to the hook. Crediting it to the Auto Burn rule would
 * claim the rule did something it did not — on a page whose whole argument is
 * that the rules can be checked.
 */
export async function readAutoBurned(
  client: PublicClient,
  poolId: Hex,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<bigint> {
  const logs = await getLogsSplitting(client, poolId, fromBlock, toBlock);
  return logs.reduce((sum, amount) => sum + amount, 0n);
}

async function getLogsSplitting(
  client: PublicClient,
  poolId: Hex,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<bigint[]> {
  try {
    const logs = await client.getLogs({
      address: ADDRESSES.blockHook,
      event: AUTO_BURNED,
      args: { id: poolId },
      fromBlock,
      toBlock,
    });
    return logs.map((l) => l.args.amount ?? 0n);
  } catch (error) {
    // The node caps a response at 10,000 logs. A window that trips the cap is
    // halved until each half fits; a busy token costs a few more round trips
    // rather than returning a wrong total or nothing at all.
    const message = error instanceof Error ? error.message : String(error);
    if (!LOG_CAP_MESSAGE.test(message) || toBlock - fromBlock < 2n) throw error;

    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    const [left, right] = await Promise.all([
      getLogsSplitting(client, poolId, fromBlock, mid),
      getLogsSplitting(client, poolId, mid + 1n, toBlock),
    ]);
    return [...left, ...right];
  }
}

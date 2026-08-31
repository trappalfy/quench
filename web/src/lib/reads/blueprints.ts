import { getAbiItem, type Address, type PublicClient } from "viem";
import { LaunchpadAbi } from "../abi";
import { ADDRESSES, DEPLOY_BLOCK } from "../chain";
import type { BlockConfig } from "./launches";

/**
 * Published hook configs, and how often anyone has launched with one.
 *
 * A blueprint is a saved `BlockConfig` plus the address that published it and
 * the royalty it charges. Launching against one copies its config verbatim —
 * `Launchpad._configFor` ignores whatever the caller passed — so a blueprint is
 * a claim that can be checked rather than a description.
 */

const BLUEPRINT_PUBLISHED = getAbiItem({
  abi: LaunchpadAbi,
  name: "BlueprintPublished",
});
const LAUNCHED = getAbiItem({ abi: LaunchpadAbi, name: "Launched" });

export type Blueprint = {
  id: bigint;
  author: Address;
  royaltyBps: number;
  cfg: BlockConfig;
  /// The block it was published in, from its own event. Null if the log was not
  /// found — the config is still real, only its age is unknown.
  publishedAt: bigint | null;
  /// Launches whose record names this blueprint. Counted from `Launched` logs
  /// over the whole life of the launchpad, not sampled.
  uses: number;
};

export async function readBlueprintCount(client: PublicClient): Promise<bigint> {
  return client.readContract({
    address: ADDRESSES.launchpad,
    abi: LaunchpadAbi,
    functionName: "blueprintCount",
  }) as Promise<bigint>;
}

/**
 * Every blueprint, newest first.
 *
 * Index 0 is a sentinel the constructor pushes so that `blueprintId == 0` can
 * mean "no blueprint". It is not a published config and must never be listed —
 * it would show as an anonymous hook with every block off.
 */
export async function readBlueprints(
  client: PublicClient,
  count?: bigint,
): Promise<Blueprint[]> {
  const total = Number(count ?? (await readBlueprintCount(client)));
  if (total <= 1) return [];

  const ids: bigint[] = [];
  for (let i = total - 1; i >= 1; i--) ids.push(BigInt(i));

  const [entries, published, launched] = await Promise.all([
    Promise.all(
      ids.map(
        (id) =>
          client.readContract({
            address: ADDRESSES.launchpad,
            abi: LaunchpadAbi,
            functionName: "blueprintAt",
            args: [id],
          }) as Promise<{ author: Address; royaltyBps: number; cfg: BlockConfig }>,
      ),
    ),
    client
      .getLogs({
        address: ADDRESSES.launchpad,
        event: BLUEPRINT_PUBLISHED,
        fromBlock: DEPLOY_BLOCK,
        toBlock: "latest",
      })
      .catch(() => []),
    client
      .getLogs({
        address: ADDRESSES.launchpad,
        event: LAUNCHED,
        fromBlock: DEPLOY_BLOCK,
        toBlock: "latest",
      })
      .catch(() => []),
  ]);

  const blockOf = new Map<string, bigint>();
  for (const log of published) {
    if (log.args.id !== undefined) blockOf.set(log.args.id.toString(), log.blockNumber);
  }

  const uses = new Map<string, number>();
  for (const log of launched) {
    const id = log.args.blueprintId;
    // 0 means the launch brought its own config. Counting it would credit the
    // sentinel with every unblueprinted launch on the chain.
    if (id === undefined || id === 0n) continue;
    uses.set(id.toString(), (uses.get(id.toString()) ?? 0) + 1);
  }

  return ids.map((id, i) => ({
    id,
    author: entries[i].author,
    royaltyBps: entries[i].royaltyBps,
    cfg: entries[i].cfg,
    publishedAt: blockOf.get(id.toString()) ?? null,
    uses: uses.get(id.toString()) ?? 0,
  }));
}

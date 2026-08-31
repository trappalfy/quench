import type { Address, Hex, PublicClient } from "viem";
import { LaunchpadAbi, BlockHookAbi, PotVaultAbi, LaunchTokenAbi, BondingCurveAbi } from "../abi";
import { ADDRESSES } from "../chain";
import { poolIdOf, readPoolState, type PoolKey, type PoolState } from "./pool";

export type BlockConfig = {
  guardBlocks: number;
  maxBuyBps: number;
  snipeTaxPips: number;
  baseFeePips: number;
  maxFeePips: number;
  surgeSens: number;
  burnBps: number;
  burnTriggerWei: bigint;
  lpBps: number;
  potBps: number;
  potEveryN: number;
  potMinBuyWei: bigint;
};

export type LaunchRecord = {
  token: Address;
  creator: Address;
  launchBlock: bigint;
  creatorFeeBps: number;
  blueprintId: bigint;
  curve: Address;
  graduated: boolean;
  sqrtPriceX96: bigint;
  cfg: BlockConfig;
};

export type HookState = {
  startBlock: bigint;
  potBalance: bigint;
  potBuyCount: number;
  lastCountedBlock: bigint;
};

export type Launch = {
  record: LaunchRecord;
  name: string;
  symbol: string;
  totalSupply: bigint;
  key: PoolKey;
  poolId: Hex;
  pool: PoolState | null;
  hookState: HookState;
  potBalance: bigint;
  curve: CurveState | null;
};

export type CurveState = {
  sold: bigint;
  raised: bigint;
  graduated: boolean;
  p0: bigint;
  tranche: number;
  tranchePrice: bigint;
};

const ZERO = "0x0000000000000000000000000000000000000000";

/// Which of the five blocks a config actually turns on. A block is off when its
/// parameters are zero — the contract says so, and the UI must agree exactly,
/// or a token will show a badge for a rule that never runs.
export function activeBlocks(cfg: BlockConfig) {
  return {
    antiSnipe: cfg.guardBlocks > 0 && (cfg.maxBuyBps > 0 || cfg.snipeTaxPips > 0),
    surgeFees: cfg.maxFeePips > cfg.baseFeePips && cfg.surgeSens > 0,
    autoBurn: cfg.burnBps > 0,
    lpRewards: cfg.lpBps > 0,
    pot: cfg.potBps > 0 && cfg.potEveryN > 0,
  };
}

export async function readLaunchCount(client: PublicClient): Promise<bigint> {
  return client.readContract({
    address: ADDRESSES.launchpad,
    abi: LaunchpadAbi,
    functionName: "launchCount",
  }) as Promise<bigint>;
}

/// Newest first, because that is the only order a launch feed is ever read in.
export async function readTokenPage(
  client: PublicClient,
  offset: number,
  limit: number,
  total?: bigint,
): Promise<Address[]> {
  const count = Number(total ?? (await readLaunchCount(client)));
  const first = count - 1 - offset;
  if (first < 0) return [];

  const indices: number[] = [];
  for (let i = first; i > first - limit && i >= 0; i--) indices.push(i);

  return Promise.all(
    indices.map(
      (i) =>
        client.readContract({
          address: ADDRESSES.launchpad,
          abi: LaunchpadAbi,
          functionName: "tokenAt",
          args: [BigInt(i)],
        }) as Promise<Address>,
    ),
  );
}

/// One launch, whole. Every call in here folds into the same multicall, so this
/// costs one round trip despite reading six contracts.
export async function readLaunch(
  client: PublicClient,
  token: Address,
): Promise<Launch> {
  const [record, key, name, symbol, totalSupply] = await Promise.all([
    client.readContract({
      address: ADDRESSES.launchpad,
      abi: LaunchpadAbi,
      functionName: "launchRecord",
      args: [token],
    }) as Promise<LaunchRecord>,
    client.readContract({
      address: ADDRESSES.launchpad,
      abi: LaunchpadAbi,
      functionName: "poolKeyOf",
      args: [token],
    }) as Promise<PoolKey>,
    client.readContract({ address: token, abi: LaunchTokenAbi, functionName: "name" }) as Promise<string>,
    client.readContract({ address: token, abi: LaunchTokenAbi, functionName: "symbol" }) as Promise<string>,
    client.readContract({ address: token, abi: LaunchTokenAbi, functionName: "totalSupply" }) as Promise<bigint>,
  ]);

  const poolId = poolIdOf(key);

  const [hookState, potBalance] = await Promise.all([
    client.readContract({
      address: ADDRESSES.blockHook,
      abi: BlockHookAbi,
      functionName: "stateOf",
      args: [poolId],
    }) as Promise<HookState>,
    client.readContract({
      address: ADDRESSES.potVault,
      abi: PotVaultAbi,
      functionName: "balanceOf",
      args: [poolId],
    }) as Promise<bigint>,
  ]);

  // A pool only exists once the token has graduated; before that the curve is
  // the market and reading slot 0 would return zeros that look like a price.
  const pool = record.graduated ? await readPoolState(client, poolId) : null;

  const curve =
    record.curve !== ZERO
      ? await readCurveState(client, record.curve)
      : null;

  return { record, name, symbol, totalSupply, key, poolId, pool, hookState, potBalance, curve };
}

export async function readCurveState(
  client: PublicClient,
  curve: Address,
): Promise<CurveState> {
  const at = { address: curve, abi: BondingCurveAbi } as const;

  const [sold, raised, graduated, p0] = await Promise.all([
    client.readContract({ ...at, functionName: "sold" }),
    client.readContract({ ...at, functionName: "raised" }),
    client.readContract({ ...at, functionName: "graduated" }),
    client.readContract({ ...at, functionName: "p0" }),
  ]);

  // The tranche and its price are asked of the contract rather than recomputed
  // from p0 and 1.7^i here. The curve's table is exact integer arithmetic; a
  // float reimplementation would drift and quote a price the curve refuses.
  const tranche = await client.readContract({ ...at, functionName: "trancheOf", args: [sold] });
  const tranchePrice = await client.readContract({
    ...at,
    functionName: "priceOfTranche",
    args: [tranche],
  });

  return { sold, raised, graduated, p0, tranche, tranchePrice };
}

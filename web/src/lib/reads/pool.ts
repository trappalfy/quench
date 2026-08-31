import {
  encodeAbiParameters,
  keccak256,
  concat,
  pad,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { PoolManagerAbi } from "../abi";
import { ADDRESSES } from "../chain";

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type PoolState = {
  sqrtPriceX96: bigint;
  tick: number;
  protocolFee: number;
  lpFee: number;
  liquidity: bigint;
};

/// v4 keeps pool state behind `extsload` rather than getters, so reading it
/// means computing the storage slot ourselves. The three constants below are
/// taken from v4-core's StateLibrary, not guessed:
///   pools mapping lives at slot 6
///   pools[id] state slot = keccak256(id ++ 6)
///   liquidity sits 3 words into that state
const POOLS_SLOT = pad(toHex(6), { size: 32 });
const LIQUIDITY_OFFSET = 3n;

/// keccak256(abi.encode(key)) — the same five words the Solidity library hashes.
export function poolIdOf(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

function stateSlotOf(poolId: Hex): Hex {
  return keccak256(concat([poolId, POOLS_SLOT]));
}

function addToSlot(slot: Hex, offset: bigint): Hex {
  return pad(toHex(BigInt(slot) + offset), { size: 32 });
}

/// Slot 0 packs four values into one word:
///   bits   0..159  sqrtPriceX96
///   bits 160..183  tick, signed
///   bits 184..207  protocol fee
///   bits 208..231  LP fee
function decodeSlot0(word: bigint): Omit<PoolState, "liquidity"> {
  const sqrtPriceX96 = word & ((1n << 160n) - 1n);
  const rawTick = Number((word >> 160n) & 0xffffffn);
  return {
    sqrtPriceX96,
    tick: rawTick >= 0x800000 ? rawTick - 0x1000000 : rawTick,
    protocolFee: Number((word >> 184n) & 0xffffffn),
    lpFee: Number((word >> 208n) & 0xffffffn),
  };
}

/// Both words come back in one multicall — the client aggregates them.
export async function readPoolState(
  client: PublicClient,
  poolId: Hex,
): Promise<PoolState> {
  const stateSlot = stateSlotOf(poolId);
  const manager = { address: ADDRESSES.poolManager, abi: PoolManagerAbi } as const;

  const [slot0Word, liquidityWord] = await Promise.all([
    client.readContract({
      ...manager,
      functionName: "extsload",
      args: [stateSlot],
    }) as Promise<Hex>,
    client.readContract({
      ...manager,
      functionName: "extsload",
      args: [addToSlot(stateSlot, LIQUIDITY_OFFSET)],
    }) as Promise<Hex>,
  ]);

  return {
    ...decodeSlot0(BigInt(slot0Word)),
    liquidity: BigInt(liquidityWord) & ((1n << 128n) - 1n),
  };
}

/// The ETH sitting in range, which is what every percentage the hook charges is
/// measured against: liquidity * 2^96 / sqrtPriceX96. Mirrors BlockMath.
export function inRangeEthReserve(state: PoolState): bigint {
  if (state.liquidity === 0n || state.sqrtPriceX96 === 0n) return 0n;
  return (state.liquidity * (1n << 96n)) / state.sqrtPriceX96;
}

/// Price of one whole token in wei, from the pool's own sqrt price.
/// currency0 is always native ETH here, so price = (sqrtP/2^96)^2 scaled to 1e18.
export function priceWeiPerToken(sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  return (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) >> 192n;
}

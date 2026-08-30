/**
 * The five blocks' arithmetic, in TypeScript.
 *
 * This file is the interface's only permitted source for the cost of a buy. It
 * mirrors src/lib/BlockMath.sol statement for statement, and a differential test
 * checks both against the same vectors — a divergence of one wei here means the
 * interface eventually lies to a user about what a trade costs.
 *
 * Everything is bigint with truncating division, because that is what the EVM does.
 */

export const BPS = 10_000n;
export const Q96 = 1n << 96n;
export const MAX_UINT256 = (1n << 256n) - 1n;

export interface BlockConfig {
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
}

/**
 * ETH-side virtual reserve of the liquidity active at the current price.
 * ETH is always currency0, so this is amount0 = L * 2^96 / sqrtPriceX96.
 */
export function inRangeEthReserve(liquidity: bigint, sqrtPriceX96: bigint): bigint {
  if (liquidity === 0n || sqrtPriceX96 === 0n) return 0n;
  return (liquidity * Q96) / sqrtPriceX96;
}

/** Block 2 — the fee rises linearly with how deep the trade bites. */
export function surgeFee(
  amountIn: bigint,
  reserve: bigint,
  baseFeePips: number,
  maxFeePips: number,
  surgeSens: number,
): number {
  if (reserve === 0n || surgeSens === 0 || maxFeePips <= baseFeePips) return baseFeePips;

  const depthBps = (amountIn * BPS) / reserve;
  const sens = BigInt(surgeSens);

  // Clamp before multiplying, exactly as the contract does: a trade far larger
  // than the reserve saturates the fee anyway and would otherwise overflow.
  let surgeFactor = BPS;
  if (depthBps < MAX_UINT256 / sens) {
    surgeFactor = (depthBps * sens) / BPS;
    if (surgeFactor > BPS) surgeFactor = BPS;
  }

  const span = BigInt(maxFeePips - baseFeePips);
  return Number(BigInt(baseFeePips) + (span * surgeFactor) / BPS);
}

/** Block 1 — the largest buy allowed inside the guard window. */
export function maxBuy(reserve: bigint, maxBuyBps: number): bigint {
  return (reserve * BigInt(maxBuyBps)) / BPS;
}

/** A basis-point slice, rounded down so the pool never loses to rounding. */
export function bpsCut(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / BPS;
}

export interface BuyQuote {
  /** LP fee applied to this swap, in pips. */
  feePips: number;
  /** ETH taken out of the input for LPs. */
  lpCut: bigint;
  /** ETH taken out of the input for the pot. */
  potCut: bigint;
  /** What actually reaches the swap after the slices. */
  effectiveIn: bigint;
  /** Share of the token output that will be burned, in basis points. */
  burnBps: number;
  /** True when the trade would be refused by the anti-snipe cap. */
  exceedsGuardCap: boolean;
}

/**
 * The full cost of an exact-input buy, as the hook will charge it.
 *
 * @param blocksSinceStart how many blocks have passed since the pool opened;
 *   the guard window and its surcharge apply while this is below guardBlocks.
 */
export function simulateBuy(
  cfg: BlockConfig,
  liquidity: bigint,
  sqrtPriceX96: bigint,
  amountIn: bigint,
  blocksSinceStart: number,
): BuyQuote {
  const reserve = inRangeEthReserve(liquidity, sqrtPriceX96);

  let feePips = surgeFee(amountIn, reserve, cfg.baseFeePips, cfg.maxFeePips, cfg.surgeSens);
  let exceedsGuardCap = false;

  if (cfg.guardBlocks > 0 && blocksSinceStart < cfg.guardBlocks) {
    exceedsGuardCap = amountIn > maxBuy(reserve, cfg.maxBuyBps);
    feePips = Math.min(feePips + cfg.snipeTaxPips, 1_000_000);
  }

  const lpCut = reserve === 0n ? 0n : bpsCut(amountIn, cfg.lpBps);
  const potCut = reserve === 0n ? 0n : bpsCut(amountIn, cfg.potBps);

  const burns = cfg.burnBps > 0 && amountIn >= cfg.burnTriggerWei;

  return {
    feePips,
    lpCut,
    potCut,
    effectiveIn: amountIn - lpCut - potCut,
    burnBps: burns ? cfg.burnBps : 0,
    exceedsGuardCap,
  };
}

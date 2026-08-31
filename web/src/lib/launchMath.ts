import { CONSTANTS } from "./chain";

/**
 * The arithmetic behind a launch, before there is a launch.
 *
 * Two things a person has to decide and cannot check afterwards: the opening
 * price of an instant pool, and the first tranche price of a curve. Both are
 * fixed by the transaction that creates them. Everything here computes what
 * those choices produce, using the same formulas the contracts use — the
 * curve's graduation price is derived in `BondingCurve._graduate` exactly this
 * way, and the tranche table is the contract's own `POW17`.
 */

const ONE = 10n ** 18n;
const Q192 = 1n << 192n;

/// TickMath's bounds. A price outside them cannot initialize a pool at all.
export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

/// Integer square root, Newton's method. The EVM's own sqrt truncates and so
/// does this: an opening price is not a place to round up.
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("isqrt of a negative");
  if (n < 2n) return n;

  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * The sqrtPriceX96 that opens a pool at a given price in wei per whole token.
 *
 * ETH is currency0, so the pool quotes tokens per ETH — the inverse of the
 * price a person thinks in. Getting this backwards is invisible at a price of
 * exactly 1, which is how it once shipped.
 */
export function sqrtPriceForWeiPerToken(weiPerToken: bigint): bigint {
  if (weiPerToken <= 0n) return 0n;
  return isqrt((ONE * Q192) / weiPerToken);
}

/**
 * An instant launch, worked backwards from the float.
 *
 * The launchpad offers the whole billion to a full-range position and keeps
 * whatever binds. Only one side binds: with the entire supply available, it is
 * the ETH. So the tokens the position takes are exactly `ethIn × tokensPerEth`,
 * the float is a choice of price, and every token that does not fit is burned
 * in the same transaction.
 */
export type InstantPlan = {
  sqrtPriceX96: bigint;
  /// Wei per whole token at the moment the pool opens.
  openingPriceWei: bigint;
  tokensInPool: bigint;
  tokensBurned: bigint;
  /// Price times the whole fixed supply. Not a dollar figure.
  fdvWei: bigint;
  /// Why this plan cannot be launched, if it cannot.
  problem: string | null;
};

export function planInstant(ethInWei: bigint, floatBps: number): InstantPlan {
  const supply = CONSTANTS.totalSupply;
  const tokensInPool = (supply * BigInt(floatBps)) / 10_000n;

  const empty: InstantPlan = {
    sqrtPriceX96: 0n,
    openingPriceWei: 0n,
    tokensInPool,
    tokensBurned: supply - tokensInPool,
    fdvWei: 0n,
    problem: null,
  };

  if (ethInWei <= 0n) return { ...empty, problem: "Commit some ETH to open the pool." };
  if (tokensInPool <= 0n) return { ...empty, problem: "A float of zero leaves nothing to trade." };

  const sqrtPriceX96 = isqrt((tokensInPool * Q192) / ethInWei);
  if (sqrtPriceX96 < MIN_SQRT_PRICE || sqrtPriceX96 > MAX_SQRT_PRICE) {
    return {
      ...empty,
      problem:
        "That combination prices the pool outside the range Uniswap can represent. Move the float or the ETH.",
    };
  }

  // Derived back from the price rather than from the float, so the figure shown
  // is the one the pool will hold and not the one that was asked for.
  const openingPriceWei = (ONE * Q192) / (sqrtPriceX96 * sqrtPriceX96);

  return {
    sqrtPriceX96,
    openingPriceWei,
    tokensInPool,
    tokensBurned: supply - tokensInPool,
    fdvWei: (openingPriceWei * supply) / ONE,
    problem: null,
  };
}

/// The contract's own table, not a power computed here. Ten tranches, each
/// priced 1.7× the last, held to the wei.
export const POW17 = [
  1_000000000000000000n,
  1_700000000000000000n,
  2_890000000000000000n,
  4_913000000000000000n,
  8_352100000000000000n,
  14_198570000000000000n,
  24_137569000000000000n,
  41_033867300000000000n,
  69_757574410000000000n,
  118_587876497000000000n,
] as const;

export const POW17_SUM = 286_570557207000000000n;

export type CurvePlan = {
  /// Wei per whole token in each of the ten tranches.
  prices: bigint[];
  /// ETH each tranche raises if it sells out.
  raises: bigint[];
  totalRaise: bigint;
  /// The price the pool opens at when the last tranche sells out.
  graduationPriceWei: bigint;
  graduationSqrtPriceX96: bigint;
  fdvAtGraduationWei: bigint;
  problem: string | null;
};

export function planCurve(p0: bigint, maxPoolEthWei: bigint): CurvePlan {
  const prices = POW17.map((factor) => (p0 * factor) / ONE);
  const raises = prices.map((price) => (price * CONSTANTS.trancheSize) / ONE);
  const totalRaise = (p0 * (80_000_000n * POW17_SUM)) / ONE;
  const graduationPriceWei = prices[9];

  let problem: string | null = null;
  if (p0 <= 0n) {
    problem = "Set a price for the first tranche.";
  } else if (totalRaise > maxPoolEthWei) {
    // The launchpad refuses at launch, not at graduation, so this is worth
    // knowing before signing rather than after ten tranches have sold.
    problem =
      "A full sellout would raise more than the launchpad's pool cap, so this launch would revert with PoolTooLarge.";
  } else if (graduationPriceWei <= 0n) {
    problem = "That first price is too small to survive the tranche table.";
  }

  return {
    prices,
    raises,
    totalRaise,
    graduationPriceWei,
    graduationSqrtPriceX96: sqrtPriceForWeiPerToken(graduationPriceWei),
    fdvAtGraduationWei: (graduationPriceWei * CONSTANTS.totalSupply) / ONE,
    problem,
  };
}

/**
 * The two launch functions, written out for `cast`.
 *
 * A hand-written signature is how the activity feed once matched no launches at
 * all: `blueprintId` is a uint64 and the signature said uint256, so the topic
 * hashed to something that existed nowhere. Here the cost would be a command
 * that reverts on a stranger's machine, so a test hashes both of these against
 * the generated ABI.
 */
export const LAUNCH_SIGNATURES = {
  instant:
    "launchInstant((string,string,(uint32,uint16,uint24,uint24,uint24,uint16,uint16,uint128,uint16,uint16,uint16,uint128),uint16,uint64,uint160))",
  curve:
    "launchCurve((string,string,(uint32,uint16,uint24,uint24,uint24,uint16,uint16,uint128,uint16,uint16,uint16,uint128),uint16,uint64,uint256))",
} as const;

/**
 * Our ticker rule, which is ours and not the chain's.
 *
 * `LaunchToken` accepts any string. Three to five characters is a product
 * decision about what fits a column, and the message says so — a validation
 * that implies the contract would refuse is a lie about the contract.
 */
export function tickerProblem(symbol: string): string | null {
  if (symbol.length === 0) return null;
  if (!/^[A-Z0-9]+$/.test(symbol)) {
    return "Capitals and digits only. A house rule: the chain accepts anything.";
  }
  if (symbol.length < CONSTANTS.tickerMinLength || symbol.length > CONSTANTS.tickerMaxLength) {
    return `Three to five characters. A house rule, not a contract limit — longer tickers break the columns.`;
  }
  return null;
}

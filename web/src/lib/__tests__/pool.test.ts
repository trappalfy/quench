import { describe, expect, it } from "vitest";
import { priceWeiPerToken, inRangeEthReserve, poolIdOf } from "../reads/pool";

const Q96 = 1n << 96n;
const ONE = 10n ** 18n;

/// The curve computes its graduation price the other way round:
///   sqrtPriceX96 = sqrt(1e18 * 2^192 / priceWei)
/// so round-tripping a known price through it is the honest check. A test at a
/// 1:1 price would pass with the formula inverted, which is how the bug
/// survived the first fork run.
function sqrtPriceForPrice(priceWei: bigint): bigint {
  return sqrtBigint((ONE << 192n) / priceWei);
}

function sqrtBigint(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

describe("priceWeiPerToken", () => {
  it("is 1 ETH per token at a 1:1 sqrt price", () => {
    expect(priceWeiPerToken(Q96)).toBe(ONE);
  });

  it("round-trips a cheap token — the case that catches an inverted formula", () => {
    // 5 gwei per whole token: a plausible opening price for a billion supply.
    const price = 5_000_000_000n;
    const got = priceWeiPerToken(sqrtPriceForPrice(price));
    const drift = got > price ? got - price : price - got;
    expect(drift * 1_000_000n < price).toBe(true);
  });

  it("round-trips a graduated curve price", () => {
    // p0 = 4 gwei after nine 1.7x steps.
    const price = 474_030_878_720n;
    const got = priceWeiPerToken(sqrtPriceForPrice(price));
    const drift = got > price ? got - price : price - got;
    expect(drift * 1_000_000n < price).toBe(true);
  });

  it("moves the right way: a higher sqrt price is a cheaper token", () => {
    expect(priceWeiPerToken(Q96 * 2n)).toBeLessThan(priceWeiPerToken(Q96));
  });

  it("is zero only for an uninitialised pool", () => {
    expect(priceWeiPerToken(0n)).toBe(0n);
  });
});

describe("inRangeEthReserve", () => {
  it("is liquidity * 2^96 / sqrtPrice, matching BlockMath", () => {
    const state = { sqrtPriceX96: Q96, tick: 0, protocolFee: 0, lpFee: 0, liquidity: 5n * ONE };
    expect(inRangeEthReserve(state)).toBe(5n * ONE);
  });

  it("is zero when there is no liquidity", () => {
    const state = { sqrtPriceX96: Q96, tick: 0, protocolFee: 0, lpFee: 0, liquidity: 0n };
    expect(inRangeEthReserve(state)).toBe(0n);
  });
});

describe("poolIdOf", () => {
  it("is stable and distinct per key", () => {
    const base = {
      currency0: "0x0000000000000000000000000000000000000000",
      currency1: "0x011a41285314efFE83de63404Aa759a85472E8Cc",
      fee: 8_388_608,
      tickSpacing: 60,
      hooks: "0x011a41285314efFE83de63404Aa759a85472E8Cc",
    } as const;
    expect(poolIdOf(base)).toBe(poolIdOf(base));
    expect(poolIdOf(base)).not.toBe(poolIdOf({ ...base, tickSpacing: 10 }));
  });
});

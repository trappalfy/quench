import { describe, expect, it } from "vitest";
import {
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  POW17,
  POW17_SUM,
  isqrt,
  planCurve,
  planInstant,
  sqrtPriceForWeiPerToken,
  tickerProblem,
  LAUNCH_SIGNATURES,
} from "../launchMath";
import { getAbiItem, toFunctionSelector, toFunctionSignature } from "viem";
import { priceWeiPerToken } from "../reads/pool";
import { LaunchpadAbi } from "../abi";
import { CONSTANTS } from "../chain";

const ETH = 10n ** 18n;

describe("isqrt", () => {
  it("truncates, like the EVM's", () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(8n)).toBe(2n);
    expect(isqrt(9n)).toBe(3n);
    expect(isqrt(10n ** 40n)).toBe(10n ** 20n);
  });
});

describe("the opening price round-trips", () => {
  // The price formula was once inverted, and every check passed because the
  // fixture opened at exactly 1:1 — the one price where the inverse reads the
  // same. These cases are deliberately not 1:1.
  const prices = [
    5_000_000_000n, // 5 gwei per token
    1_000_000n,
    ETH / 1000n,
    ETH,
    123_456_789_012n,
  ];

  for (const wei of prices) {
    it(`survives ${wei} wei per token`, () => {
      const sqrtPriceX96 = sqrtPriceForWeiPerToken(wei);
      const back = priceWeiPerToken(sqrtPriceX96);
      // Truncating twice loses at most the last digit or two of a wei price.
      const drift = back > wei ? back - wei : wei - back;
      expect(drift * 1_000_000n).toBeLessThanOrEqual(wei);
    });
  }
});

describe("planInstant", () => {
  it("puts the float in the pool and burns the rest", () => {
    const plan = planInstant(5n * ETH, 2_000); // 20%
    expect(plan.problem).toBeNull();
    expect(plan.tokensInPool).toBe((CONSTANTS.totalSupply * 2_000n) / 10_000n);
    expect(plan.tokensInPool + plan.tokensBurned).toBe(CONSTANTS.totalSupply);
  });

  it("prices the pool so the committed ETH buys exactly the float", () => {
    const eth = 5n * ETH;
    const plan = planInstant(eth, 2_000);
    // tokens = eth / price. Within a hair, because both sides truncate.
    const implied = (eth * ETH) / plan.openingPriceWei;
    const drift =
      implied > plan.tokensInPool ? implied - plan.tokensInPool : plan.tokensInPool - implied;
    expect(drift * 1_000_000n).toBeLessThanOrEqual(plan.tokensInPool);
  });

  it("agrees with the constant the seed script computed independently", () => {
    // script/Seed.s.sol carries SQRT_PRICE_5_GWEI as a literal, worked out by
    // hand for a pool opening at 5 gwei per whole token. One ETH against a 20%
    // float is that same price, so the two derivations have to land on the same
    // number — and they do, to the digit.
    const plan = planInstant(ETH, 2_000);
    expect(plan.sqrtPriceX96).toBe(1120455419495722798374638764549163n);
    expect(plan.openingPriceWei).toBe(5_000_000_000n);
  });

  it("gives a smaller float a higher price, not a bigger pool", () => {
    const tight = planInstant(5n * ETH, 500);
    const loose = planInstant(5n * ETH, 5_000);
    expect(tight.openingPriceWei).toBeGreaterThan(loose.openingPriceWei);
    expect(tight.tokensInPool).toBeLessThan(loose.tokensInPool);
  });

  it("refuses a price Uniswap cannot represent instead of producing one", () => {
    // Only reachable with an absurd input: the tick range spans about 78 orders
    // of magnitude, and the launchpad's own 100 ETH pool cap keeps every real
    // launch in the middle of it. The guard is here because a price that cannot
    // initialize should be refused by this page rather than by a revert.
    const plan = planInstant(10n ** 70n, 1);
    expect(plan.problem).not.toBeNull();
    expect(plan.sqrtPriceX96).toBe(0n);
  });

  it("stays representable across the whole range the launchpad allows", () => {
    // 100 ETH is maxPoolEthWei. Every float from 0.01% to 100% of it holds.
    for (const eth of [1n, 100n * ETH]) {
      for (const floatBps of [1, 100, 2_000, 10_000]) {
        const plan = planInstant(eth, floatBps);
        expect(plan.problem, `${eth} wei at ${floatBps} bps`).toBeNull();
      }
    }
  });

  it("keeps a workable plan inside the tick range", () => {
    const plan = planInstant(5n * ETH, 2_000);
    expect(plan.sqrtPriceX96).toBeGreaterThan(MIN_SQRT_PRICE);
    expect(plan.sqrtPriceX96).toBeLessThan(MAX_SQRT_PRICE);
  });

  it("says nothing to trade rather than dividing by zero", () => {
    expect(planInstant(5n * ETH, 0).problem).not.toBeNull();
    expect(planInstant(0n, 2_000).problem).not.toBeNull();
  });
});

describe("planCurve", () => {
  const p0 = 4n * 10n ** 9n; // 4 gwei per token

  it("prices ten tranches from the contract's own table", () => {
    const plan = planCurve(p0, 100n * ETH);
    expect(plan.prices).toHaveLength(10);
    expect(plan.prices[0]).toBe(p0);
    expect(plan.prices[9]).toBe((p0 * POW17[9]) / ETH);
  });

  it("sums the tranches to the same total the contract raises", () => {
    const plan = planCurve(p0, 1000n * ETH);
    // The contract computes p0 * 80,000,000 * sum(1.7^i) / 1e18 in one
    // mulDiv rather than adding the tranches, so the two differ by rounding.
    // A per-tranche sum that drifted further than that would mean the table is
    // not the table.
    const summed = plan.raises.reduce((a, b) => a + b, 0n);
    const drift =
      summed > plan.totalRaise ? summed - plan.totalRaise : plan.totalRaise - summed;
    expect(drift).toBeLessThan(10n ** 12n);
    expect(plan.totalRaise).toBe((p0 * (80_000_000n * POW17_SUM)) / ETH);
  });

  it("warns before the launch when a sellout would exceed the pool cap", () => {
    const plan = planCurve(p0, 1n * ETH);
    expect(plan.problem).toMatch(/PoolTooLarge/);
  });

  it("derives the graduation price the way the curve does", () => {
    const plan = planCurve(p0, 1000n * ETH);
    expect(plan.graduationSqrtPriceX96).toBe(
      sqrtPriceForWeiPerToken((p0 * POW17[9]) / ETH),
    );
  });
});

describe("the launch signatures", () => {
  // The page hands a stranger a `cast send` to run against real money. A
  // signature written by hand once cost this project an event filter that
  // matched nothing; here it would cost a revert on someone else's machine.
  it("hash to the selectors the compiled launchpad exposes", () => {
    for (const [mode, signature] of Object.entries(LAUNCH_SIGNATURES)) {
      const item = getAbiItem({
        abi: LaunchpadAbi,
        name: mode === "instant" ? "launchInstant" : "launchCurve",
      });
      expect(toFunctionSignature(item as never), mode).toBe(signature);
    }
  });

  it("are the selectors cast computes", () => {
    expect(toFunctionSelector(LAUNCH_SIGNATURES.instant)).toBe("0x10a9a1a1");
    expect(toFunctionSelector(LAUNCH_SIGNATURES.curve)).toBe("0x329abbf0");
  });
});

describe("tickerProblem", () => {
  it("holds our own rule and says it is ours", () => {
    expect(tickerProblem("QNCH")).toBeNull();
    expect(tickerProblem("QN")).toMatch(/house rule/);
    expect(tickerProblem("TOOLONGTICKER")).toMatch(/house rule/);
    expect(tickerProblem("qnch")).toMatch(/Capitals/);
  });

  it("says nothing about an empty field", () => {
    expect(tickerProblem("")).toBeNull();
  });
});

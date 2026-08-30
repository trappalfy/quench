import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { surgeFee, bpsCut, maxBuy, inRangeEthReserve } from "../dist/simulate.js";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, "vectors.json"), "utf8"));

/**
 * The interface must never disagree with the chain about what a trade costs.
 * Every vector here was computed by BlockMath.sol; the TypeScript must land on
 * the identical value, to the wei.
 */
describe("solidity parity", () => {
  it("has vectors to check", () => {
    assert.ok(vectors.length >= 1000, `expected many vectors, got ${vectors.length}`);
  });

  it("matches every exported vector exactly", () => {
    for (const v of vectors) {
      const amountIn = BigInt(v.amountIn);
      const reserve = BigInt(v.reserve);

      assert.equal(
        surgeFee(amountIn, reserve, v.baseFeePips, v.maxFeePips, v.surgeSens),
        v.expectedFeePips,
        `fee mismatch on ${JSON.stringify(v)}`,
      );

      assert.equal(bpsCut(amountIn, v.lpBps), BigInt(v.expectedLpCut), "lp cut mismatch");
      assert.equal(bpsCut(amountIn, v.potBps), BigInt(v.expectedPotCut), "pot cut mismatch");
      assert.equal(maxBuy(reserve, v.maxBuyBps), BigInt(v.expectedMaxBuy), "guard cap mismatch");
      assert.equal(
        inRangeEthReserve(BigInt(v.liquidity), BigInt(v.sqrtPriceX96)),
        BigInt(v.expectedReserve),
        "reserve mismatch",
      );
    }
  });
});

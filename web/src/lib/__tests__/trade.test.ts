import { describe, expect, it } from "vitest";
import { toFunctionSelector, encodeErrorResult } from "viem";
import { minAfterSlippage, spenderFor } from "../writes/trade";
import { decodeCustomError, explainWriteError } from "../writes/errors";
import { ADDRESSES } from "../chain";
import { BlockHookAbi, BoundedRouterAbi } from "../abi";

const ETH = 10n ** 18n;

describe("minAfterSlippage", () => {
  it("is the quote less the tolerance", () => {
    expect(minAfterSlippage(1000n, 100)).toBe(990n); // 1%
    expect(minAfterSlippage(1000n, 500)).toBe(950n); // 5%
    expect(minAfterSlippage(ETH, 50)).toBe((ETH * 9_950n) / 10_000n);
  });

  it("rounds down, so the bound is never looser than asked for", () => {
    // 999 * 0.99 = 989.01. Rounding up would sign a floor the user did not
    // choose, and the direction of that error is always against them.
    expect(minAfterSlippage(999n, 100)).toBe(989n);
  });

  it("has nothing to protect when there is nothing to receive", () => {
    expect(minAfterSlippage(0n, 100)).toBe(0n);
    expect(minAfterSlippage(-5n, 100)).toBe(0n);
  });

  it("passes the whole quote through at zero tolerance", () => {
    expect(minAfterSlippage(1234n, 0)).toBe(1234n);
  });
});

describe("who has to be approved", () => {
  // Getting this wrong approves the wrong contract and the sell reverts on the
  // transfer, after a signature the user has already paid for.
  it("is the router for a pool and the curve for a curve", () => {
    const curve = "0x1111111111111111111111111111111111111111" as const;
    expect(spenderFor("pool", curve)).toBe(ADDRESSES.boundedRouter);
    expect(spenderFor("curve", curve)).toBe(curve);
  });
});

describe("decoding a revert", () => {
  it("names an error the hook would throw", () => {
    const data = encodeErrorResult({
      abi: BlockHookAbi,
      errorName: "BuyExceedsGuardCap",
    });
    const decoded = decodeCustomError(data);
    expect(decoded?.name).toBe("BuyExceedsGuardCap");
    expect(decoded?.message).toMatch(/anti-snipe/i);
  });

  it("names an error the router would throw", () => {
    const data = encodeErrorResult({
      abi: BoundedRouterAbi,
      errorName: "TooLittleReceived",
    });
    expect(decodeCustomError(data)?.name).toBe("TooLittleReceived");
  });

  it("matches the selector the chain actually returned once", () => {
    // 0xde8a16cb came back from a real `deployHook` call on chain 4663 after
    // the hook was already deployed. If the ABI ever stops carrying that
    // error, this catches it.
    expect(toFunctionSelector("HookAlreadyDeployed()")).toBe("0xde8a16cb");
    expect(decodeCustomError("0xde8a16cb")?.name).toBe("HookAlreadyDeployed");
  });

  it("returns null for bytes that decode to nothing of ours", () => {
    expect(decodeCustomError("0xdeadbeef")).toBeNull();
  });

  it("digs the revert data out of a nested cause chain", () => {
    const data = encodeErrorResult({ abi: BlockHookAbi, errorName: "BuyExceedsGuardCap" });
    // viem nests, wallets nest differently, and a raw node response nests once
    // more. All three have to reach the same answer.
    const nested = { cause: { cause: { data } } };
    expect(explainWriteError(nested).name).toBe("BuyExceedsGuardCap");
    expect(explainWriteError({ data: { data } }).name).toBe("BuyExceedsGuardCap");
  });

  it("treats a rejected signature as a choice, not a failure", () => {
    const rejected = explainWriteError({ code: 4001, message: "User rejected" });
    expect(rejected.name).toBeNull();
    expect(rejected.message).toMatch(/rejected/i);
    expect(rejected.message).not.toMatch(/error|failed/i);
  });
});

import { describe, expect, it } from "vitest";
import {
  formatEthCompact,
  formatEth,
  formatPrice,
  formatCompactTokens,
  formatBps,
  formatPips,
  truncateAddress,
  formatChange,
  blocksToApproxAge,
} from "../format";

const ETH = 10n ** 18n;

describe("formatEth", () => {
  it("keeps four decimals below a thousand", () => {
    expect(formatEth(ETH)).toBe("1.0000");
    expect(formatEth(ETH / 2n)).toBe("0.5000");
    expect(formatEth(5n * 10n ** 14n)).toBe("0.0005");
  });

  it("truncates rather than rounds, so a balance never reads higher than it is", () => {
    expect(formatEth(1_999_999_999_999_999_999n)).toBe("1.9999");
  });

  it("drops decimals and groups thousands once the number is large", () => {
    expect(formatEth(1234n * ETH)).toBe("1,234");
    expect(formatEth(1_000_000n * ETH)).toBe("1,000,000");
  });

  it("carries the sign", () => {
    expect(formatEth(-ETH)).toBe("-1.0000");
  });
});

describe("formatPrice", () => {
  it("shows six decimals for prices near a whole ETH", () => {
    expect(formatPrice(ETH)).toBe("1.000000");
  });

  it("keeps four significant digits under the leading zeros", () => {
    // 4.362 gwei per token — a tranche-0 curve price.
    expect(formatPrice(4_362_000_000n)).toBe("0.000000004362");
  });

  it("never collapses a small price to zero", () => {
    expect(formatPrice(1n)).not.toBe("0");
  });

  it("is zero only when it really is", () => {
    expect(formatPrice(0n)).toBe("0");
  });
});

describe("formatCompactTokens", () => {
  it("scales to the launch supply", () => {
    expect(formatCompactTokens(1_000_000_000n * ETH)).toBe("1.00B");
    expect(formatCompactTokens(200_000_000n * ETH)).toBe("200.00M");
    expect(formatCompactTokens(1_500n * ETH)).toBe("1.50K");
    expect(formatCompactTokens(12n * ETH)).toBe("12");
  });
});

describe("fee units", () => {
  it("reads basis points against 10,000", () => {
    expect(formatBps(10_000)).toBe("100%");
    expect(formatBps(500)).toBe("5%");
    expect(formatBps(100)).toBe("1%");
  });

  it("reads pips against 1,000,000 — a different scale entirely", () => {
    expect(formatPips(3_000)).toBe("0.3%");
    expect(formatPips(1_000_000)).toBe("100%");
    expect(formatPips(50_000)).toBe("5%");
  });

  it("does not confuse the two", () => {
    expect(formatBps(3_000)).not.toBe(formatPips(3_000));
  });
});

describe("truncateAddress", () => {
  it("keeps both ends", () => {
    expect(truncateAddress("0x5eE09DF35b6C3503D8fAc6A2863aFd4edBC73a6c")).toBe("0x5eE0…3a6c");
  });

  it("leaves short strings alone", () => {
    expect(truncateAddress("0x1234")).toBe("0x1234");
  });
});

describe("formatChange", () => {
  it("returns a dash and no glyph when there is nothing to compare", () => {
    expect(formatChange(null)).toEqual({ text: "—", glyph: "" });
  });

  it("marks direction with a glyph, not a colour", () => {
    expect(formatChange(0.1234)).toEqual({ text: "+12.34%", glyph: "▲" });
    expect(formatChange(-0.05)).toEqual({ text: "-5.00%", glyph: "▼" });
  });

  it("treats a hair either side of zero as flat", () => {
    expect(formatChange(0.00001).glyph).toBe("·");
  });
});

describe("blocksToApproxAge", () => {
  it("reads ~0.1s blocks", () => {
    expect(blocksToApproxAge(300n)).toBe("30s");
    expect(blocksToApproxAge(36_000n)).toBe("1h");
    expect(blocksToApproxAge(860_000n)).toBe("1d");
  });
});

describe("blocksToApproxAge boundaries", () => {
  it("never rounds into a unit it has already left", () => {
    expect(blocksToApproxAge(589n)).toBe("59s");
    expect(blocksToApproxAge(599n)).toBe("1m"); // 59.9s rounds up a unit, not to "60s"
    expect(blocksToApproxAge(35_990n)).toBe("1h"); // 59.98m, likewise
    expect(blocksToApproxAge(863_000n)).toBe("1d"); // 23.97h
  });
});

describe("formatEthCompact", () => {
  it("switches to magnitude before the column can blow out", () => {
    expect(formatEthCompact(981_132_571n * ETH)).toBe("981.13M");
    expect(formatEthCompact(2_500_000_000n * ETH)).toBe("2.50B");
    expect(formatEthCompact(45_000n * ETH)).toBe("45.00K");
  });

  it("leaves human-sized amounts exact", () => {
    expect(formatEthCompact(5n * ETH)).toBe("5.0000");
    expect(formatEthCompact(9_999n * ETH)).toBe("9,999");
  });
});

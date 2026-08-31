import { describe, expect, it } from "vitest";
import {
  EMPTY,
  GAS,
  HOOK_FLAGS,
  blocksOn,
  gasFor,
  setBaseFee,
  setBlock,
  toTuple,
  validate,
  type BlockConfig,
} from "../hookConfig";
import { ADDRESSES } from "../chain";

/**
 * The builder tells people what the chain will accept before they pay to find
 * out, so these are the boundary pairs from `test/unit/BlockConfigValidation.t.sol`
 * — the accepted value and the one step past it — asserted against the same
 * numbers. If the contract's bounds ever move, one of these fails here as well
 * as there.
 */

const base: BlockConfig = { ...EMPTY };
const with_ = (patch: Partial<BlockConfig>): BlockConfig => ({ ...base, ...patch });
const errors = (cfg: BlockConfig) => validate(cfg).map((i) => i.error);

describe("validate mirrors BlockHook._validate", () => {
  it("accepts a config with every block off", () => {
    expect(errors(base)).toEqual([]);
  });

  it("takes a max fee of 100,000 pips and refuses 100,001", () => {
    expect(errors(with_({ baseFeePips: 3_000, maxFeePips: 100_000 }))).toEqual([]);
    expect(errors(with_({ maxFeePips: 100_001 }))).toContain("BadFeeBounds");
  });

  it("refuses a base fee above the max fee", () => {
    expect(errors(with_({ baseFeePips: 50_000, maxFeePips: 49_999 }))).toContain(
      "BadFeeBounds",
    );
  });

  it("takes an ETH cut summing to 1,000 bps and refuses 1,001", () => {
    expect(errors(with_({ lpBps: 600, potBps: 400, potEveryN: 5 }))).toEqual([]);
    expect(errors(with_({ lpBps: 600, potBps: 401, potEveryN: 5 }))).toContain(
      "EthCutTooLarge",
    );
  });

  it("takes a snipe surcharge of 50,000 pips and refuses 50,001", () => {
    expect(
      errors(with_({ guardBlocks: 10, maxBuyBps: 100, snipeTaxPips: 50_000 })),
    ).toEqual([]);
    expect(
      errors(with_({ guardBlocks: 10, maxBuyBps: 100, snipeTaxPips: 50_001 })),
    ).toContain("SnipeTaxTooLarge");
  });

  it("takes a burn of 1,000 bps and refuses 1,001", () => {
    expect(errors(with_({ burnBps: 1_000, burnTriggerWei: 1n }))).toEqual([]);
    expect(errors(with_({ burnBps: 1_001, burnTriggerWei: 1n }))).toContain(
      "BurnTooLarge",
    );
  });

  it("takes a guard of 7,200 blocks and refuses 7,201", () => {
    expect(errors(with_({ guardBlocks: 7_200, maxBuyBps: 100 }))).toEqual([]);
    expect(errors(with_({ guardBlocks: 7_201, maxBuyBps: 100 }))).toContain(
      "GuardTooLong",
    );
  });

  it("refuses an N below 2 or above 1,000", () => {
    expect(errors(with_({ potBps: 100, potEveryN: 1 }))).toContain("BadPotEveryN");
    expect(errors(with_({ potBps: 100, potEveryN: 1_001 }))).toContain("BadPotEveryN");
    expect(errors(with_({ potBps: 100, potEveryN: 1_000 }))).toEqual([]);
  });

  it("refuses a pot that collects without an N to pay out on", () => {
    expect(errors(with_({ potBps: 100, potEveryN: 0 }))).toContain("BadPotEveryN");
  });

  it("refuses a guard window with no cap on the buy", () => {
    expect(errors(with_({ guardBlocks: 10, maxBuyBps: 0 }))).toContain("BadMaxBuyBps");
    expect(errors(with_({ guardBlocks: 10, maxBuyBps: 10_001 }))).toContain(
      "BadMaxBuyBps",
    );
  });

  it("refuses a burn with no minimum buy", () => {
    expect(errors(with_({ burnBps: 500, burnTriggerWei: 0n }))).toContain(
      "BurnNeedsTrigger",
    );
  });
});

describe("switching a block off leaves a config the chain would take", () => {
  it("pins the fee ceiling to the floor rather than zeroing it", () => {
    // The obvious "off" — maxFeePips = 0 — puts the ceiling under the floor and
    // reverts with BadFeeBounds. Nothing in the UI would have shown that.
    const armed = setBlock(with_({ baseFeePips: 3_000 }), "surgeFees", true);
    const off = setBlock(armed, "surgeFees", false);

    expect(blocksOn(off).surgeFees).toBe(false);
    expect(off.baseFeePips).toBe(3_000);
    expect(errors(off)).toEqual([]);
  });

  it("leaves every other block valid when switched on then off", () => {
    for (const key of ["antiSnipe", "autoBurn", "lpRewards", "pot"] as const) {
      const armed = setBlock(base, key, true);
      expect(errors(armed), `${key} armed`).toEqual([]);
      expect(blocksOn(armed)[key], `${key} armed`).toBe(true);

      const off = setBlock(armed, key, false);
      expect(errors(off), `${key} off`).toEqual([]);
      expect(blocksOn(off)[key], `${key} off`).toBe(false);
    }
  });

  it("raises the ceiling with the floor so a flat fee can be increased", () => {
    const raised = setBaseFee(with_({ baseFeePips: 3_000, maxFeePips: 3_000 }), 10_000);
    expect(raised.maxFeePips).toBe(10_000);
    expect(errors(raised)).toEqual([]);
  });
});

describe("gas", () => {
  it("charges only for the blocks that are armed", () => {
    expect(gasFor(base)).toBe(GAS.base);
    expect(gasFor(setBlock(base, "lpRewards", true))).toBe(GAS.base + GAS.lpRewards);
  });

  it("quotes a full stack from its own measurement, not the sum of the parts", () => {
    let all = base;
    for (const key of ["antiSnipe", "surgeFees", "autoBurn", "lpRewards", "pot"] as const) {
      all = setBlock(all, key, true);
    }
    expect(gasFor(all)).toBe(GAS.base + GAS.allFive);
    // The blocks share work, so the sum overstates. If that ever stops being
    // true the comment on GAS is wrong and this catches it.
    expect(GAS.allFive).toBeLessThan(
      GAS.antiSnipe + GAS.surgeFees + GAS.autoBurn + GAS.lpRewards + GAS.pot,
    );
  });
});

describe("the hook's flags", () => {
  it("are the low 14 bits of the deployed hook's address", () => {
    const low14 = Number(BigInt(ADDRESSES.blockHook) & 0x3fffn);
    expect(HOOK_FLAGS).toBe(low14);
    expect(HOOK_FLAGS).toBe(0x28cc);
  });
});

describe("the exported config", () => {
  it("writes the twelve fields in the order the ABI encodes them", () => {
    const cfg = with_({
      guardBlocks: 1,
      maxBuyBps: 2,
      snipeTaxPips: 3,
      baseFeePips: 4,
      maxFeePips: 5,
      surgeSens: 6,
      burnBps: 7,
      burnTriggerWei: 8n,
      lpBps: 9,
      potBps: 10,
      potEveryN: 11,
      potMinBuyWei: 12n,
    });
    expect(toTuple(cfg)).toBe("(1,2,3,4,5,6,7,8,9,10,11,12)");
  });
});

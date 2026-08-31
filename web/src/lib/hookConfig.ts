import type { BlockConfig } from "./reads/launches";

/**
 * Everything the builder needs to know about a hook config before it exists on
 * chain: what the contract accepts, what it refuses, and what it costs.
 *
 * The bounds below are not house style — they are `BlockHook._validate`,
 * transcribed check for check. A config this page calls valid is one the chain
 * will take, and a config it refuses names the Solidity error that would come
 * back. Anything looser here would let someone spend gas to learn what this
 * page could have told them.
 */

export type { BlockConfig };

export const LIMITS = {
  /// maxFeePips > 100_000 reverts BadFeeBounds. A pip is a millionth, so this
  /// is a ceiling of 10%.
  maxFeePips: 100_000,
  /// lpBps + potBps > 1_000 reverts EthCutTooLarge: at most 10% of a buy's ETH
  /// can be diverted before the swap.
  ethCutBps: 1_000,
  snipeTaxPips: 50_000,
  burnBps: 1_000,
  /// Blocks, not time. Roughly twelve minutes at this chain's rate, which is
  /// measured and could change.
  guardBlocks: 7_200,
  potEveryNMin: 2,
  potEveryNMax: 1_000,
  maxBuyBps: 10_000,
  /// uint16 in the struct, and nothing in _validate narrows it.
  surgeSens: 65_535,
} as const;

export const EMPTY: BlockConfig = {
  guardBlocks: 0,
  maxBuyBps: 0,
  snipeTaxPips: 0,
  baseFeePips: 3_000,
  maxFeePips: 3_000,
  surgeSens: 0,
  burnBps: 0,
  burnTriggerWei: 0n,
  lpBps: 0,
  potBps: 0,
  potEveryN: 0,
  potMinBuyWei: 0n,
};

/// What each block looks like when it is switched on. Starting points to argue
/// with, not recommendations — the contract accepts a wide range and takes no
/// view on which of it is sensible.
export const BLOCK_DEFAULTS = {
  antiSnipe: { guardBlocks: 300, maxBuyBps: 500, snipeTaxPips: 10_000 },
  surgeFees: { maxFeePips: 50_000, surgeSens: 10_000 },
  autoBurn: { burnBps: 500, burnTriggerWei: 10n ** 16n },
  lpRewards: { lpBps: 200 },
  pot: { potBps: 100, potEveryN: 25, potMinBuyWei: 10n ** 16n },
} as const;

export type BlockKey = keyof typeof BLOCK_DEFAULTS;

/**
 * Switch a block on or off without leaving the config in a state the contract
 * would refuse.
 *
 * Surge is the awkward one. Its off position is not "max fee zero" — that puts
 * the max below the base and reverts with BadFeeBounds. A pool with no surge is
 * one whose ceiling equals its floor, so switching the block off pins the two
 * together and leaves the flat fee alone.
 */
export function setBlock(cfg: BlockConfig, key: BlockKey, on: boolean): BlockConfig {
  if (on) {
    if (key === "surgeFees") {
      const d = BLOCK_DEFAULTS.surgeFees;
      return {
        ...cfg,
        maxFeePips: Math.max(d.maxFeePips, cfg.baseFeePips),
        surgeSens: d.surgeSens,
      };
    }
    return { ...cfg, ...BLOCK_DEFAULTS[key] };
  }

  switch (key) {
    case "antiSnipe":
      return { ...cfg, guardBlocks: 0, maxBuyBps: 0, snipeTaxPips: 0 };
    case "surgeFees":
      return { ...cfg, maxFeePips: cfg.baseFeePips, surgeSens: 0 };
    case "autoBurn":
      return { ...cfg, burnBps: 0, burnTriggerWei: 0n };
    case "lpRewards":
      return { ...cfg, lpBps: 0 };
    case "pot":
      return { ...cfg, potBps: 0, potEveryN: 0, potMinBuyWei: 0n };
  }
}

/// Raising the flat fee above the surge ceiling would revert. When surge is off
/// the two move together; when it is on the ceiling is pushed up to meet it.
export function setBaseFee(cfg: BlockConfig, pips: number): BlockConfig {
  return {
    ...cfg,
    baseFeePips: pips,
    maxFeePips: Math.max(cfg.maxFeePips, pips),
  };
}

/// The order the hook runs them in, which is why they are numbered.
export const BLOCK_ORDER: BlockKey[] = [
  "antiSnipe",
  "surgeFees",
  "autoBurn",
  "lpRewards",
  "pot",
];

export const BLOCK_META: Record<
  BlockKey,
  { n: string; tag: string; name: string; when: string; what: string }
> = {
  antiSnipe: {
    n: "01",
    tag: "SNP",
    name: "Anti-snipe",
    when: "beforeSwap · while the window is open",
    what: "Caps each buy at a share of the in-range reserve and adds a surcharge, for a fixed number of blocks after the pool opens.",
  },
  surgeFees: {
    n: "02",
    tag: "SRG",
    name: "Surge fees",
    when: "beforeSwap · every buy",
    what: "The LP fee rises with how deep the trade bites into liquidity. No oracle, no keeper — it is arithmetic on the reserve.",
  },
  autoBurn: {
    n: "03",
    tag: "BRN",
    name: "Auto burn",
    when: "afterSwap · once the output is known",
    what: "A share of the tokens bought goes to the dead address inside the same swap. The pool's reserves are untouched; only the buyer receives less.",
  },
  lpRewards: {
    n: "04",
    tag: "LP",
    name: "LP rewards",
    when: "beforeSwap · out of the input",
    what: "A share of the ETH is donated to whoever holds in-range liquidity, before the swap sees it.",
  },
  pot: {
    n: "05",
    tag: "POT",
    name: "Nth-buy pot",
    when: "beforeSwap · out of the input",
    what: "A share of each qualifying buy accumulates, and every Nth buy takes it. The counter advances at most once per block and is public.",
  },
};

/**
 * Gas, measured rather than guessed — `test/unit/BlockGas.t.sol`, a 0.1 ETH buy
 * against a 10 ETH pool, second buy so the storage is warm.
 *
 * Adding the marginals overstates a full stack: the blocks share work, and all
 * five together measured 37,529 against a sum of 40,843. So a full stack is
 * quoted from its own measurement instead of from the sum.
 */
export const GAS = {
  base: 83_278,
  antiSnipe: 667,
  surgeFees: 820,
  autoBurn: 8_704,
  lpRewards: 8_581,
  pot: 22_071,
  allFive: 37_529,
} as const;

/// Which blocks a config turns on. Identical to `activeBlocks` in the reading
/// layer, because a hook being designed and a hook being read have to agree on
/// what "on" means.
export function blocksOn(cfg: BlockConfig): Record<BlockKey, boolean> {
  return {
    antiSnipe: cfg.guardBlocks > 0 && (cfg.maxBuyBps > 0 || cfg.snipeTaxPips > 0),
    surgeFees: cfg.maxFeePips > cfg.baseFeePips && cfg.surgeSens > 0,
    autoBurn: cfg.burnBps > 0,
    lpRewards: cfg.lpBps > 0,
    pot: cfg.potBps > 0 && cfg.potEveryN > 0,
  };
}

export function gasFor(cfg: BlockConfig): number {
  const on = blocksOn(cfg);
  const keys = BLOCK_ORDER.filter((k) => on[k]);
  if (keys.length === 5) return GAS.base + GAS.allFive;
  return GAS.base + keys.reduce((sum, k) => sum + GAS[k], 0);
}

export type Issue = {
  /// The Solidity error this config would revert with. Naming it is the point:
  /// it can be checked against the source rather than taken on trust.
  error: string;
  message: string;
  fields: (keyof BlockConfig)[];
};

/**
 * `BlockHook._validate`, check for check and in its order.
 *
 * Do not reorder or condense these. They are written this way so they can be
 * diffed against the contract by eye.
 */
export function validate(c: BlockConfig): Issue[] {
  const issues: Issue[] = [];

  if (c.baseFeePips > c.maxFeePips || c.maxFeePips > LIMITS.maxFeePips) {
    issues.push({
      error: "BadFeeBounds",
      message:
        "The base fee cannot exceed the max fee, and the max fee cannot exceed 100,000 pips (10%).",
      fields: ["baseFeePips", "maxFeePips"],
    });
  }
  if (c.lpBps + c.potBps > LIMITS.ethCutBps) {
    issues.push({
      error: "EthCutTooLarge",
      message:
        "LP rewards and the pot come out of the same ETH. Together they cannot exceed 1,000 bps (10%).",
      fields: ["lpBps", "potBps"],
    });
  }
  if (c.snipeTaxPips > LIMITS.snipeTaxPips) {
    issues.push({
      error: "SnipeTaxTooLarge",
      message: "The snipe surcharge cannot exceed 50,000 pips (5%).",
      fields: ["snipeTaxPips"],
    });
  }
  if (c.burnBps > LIMITS.burnBps) {
    issues.push({
      error: "BurnTooLarge",
      message: "The burn cannot exceed 1,000 bps (10%) of the tokens bought.",
      fields: ["burnBps"],
    });
  }
  if (c.guardBlocks > LIMITS.guardBlocks) {
    issues.push({
      error: "GuardTooLong",
      message: "The guard window cannot exceed 7,200 blocks.",
      fields: ["guardBlocks"],
    });
  }
  if (
    c.potEveryN > 0 &&
    (c.potEveryN < LIMITS.potEveryNMin || c.potEveryN > LIMITS.potEveryNMax)
  ) {
    issues.push({
      error: "BadPotEveryN",
      message:
        "The pot pays out on every 2nd buy at the soonest and every 1,000th at the latest.",
      fields: ["potEveryN"],
    });
  }
  if (c.potBps > 0 && c.potEveryN < LIMITS.potEveryNMin) {
    issues.push({
      error: "BadPotEveryN",
      message: "A pot that collects ETH has to have an N to pay it out on.",
      fields: ["potBps", "potEveryN"],
    });
  }
  if (c.guardBlocks > 0 && (c.maxBuyBps === 0 || c.maxBuyBps > LIMITS.maxBuyBps)) {
    issues.push({
      error: "BadMaxBuyBps",
      message:
        "A guard window has to cap the buy size: 1 to 10,000 bps of the in-range reserve.",
      fields: ["guardBlocks", "maxBuyBps"],
    });
  }
  if (c.burnBps > 0 && c.burnTriggerWei === 0n) {
    issues.push({
      error: "BurnNeedsTrigger",
      message:
        "A burn needs a minimum buy size, or dust trades pay gas to destroy nothing.",
      fields: ["burnBps", "burnTriggerWei"],
    });
  }

  return issues;
}

/**
 * The hook's permission bits — the low 14 of its address.
 *
 * These belong to the deployed contract, not to a config: every pool Quench
 * opens is served by the same hook, so this mask is identical for every hook
 * built here. It is shown because it can be checked against the address, not
 * because it varies.
 */
export const HOOK_FLAG_BITS: { bit: number; name: string }[] = [
  { bit: 13, name: "beforeInitialize" },
  { bit: 11, name: "beforeAddLiquidity" },
  { bit: 7, name: "beforeSwap" },
  { bit: 6, name: "afterSwap" },
  { bit: 3, name: "beforeSwapReturnDelta" },
  { bit: 2, name: "afterSwapReturnDelta" },
];

export const HOOK_FLAGS = HOOK_FLAG_BITS.reduce((m, f) => m | (1 << f.bit), 0);

/// The config as the contract's own struct, ready to paste into a script. Wei
/// is written in full: a config is not a place to round.
export function toSolidity(c: BlockConfig): string {
  return [
    "BlockConfig({",
    "    guardBlocks: " + c.guardBlocks + ",",
    "    maxBuyBps: " + c.maxBuyBps + ",",
    "    snipeTaxPips: " + c.snipeTaxPips + ",",
    "    baseFeePips: " + c.baseFeePips + ",",
    "    maxFeePips: " + c.maxFeePips + ",",
    "    surgeSens: " + c.surgeSens + ",",
    "    burnBps: " + c.burnBps + ",",
    "    burnTriggerWei: " + c.burnTriggerWei + ",",
    "    lpBps: " + c.lpBps + ",",
    "    potBps: " + c.potBps + ",",
    "    potEveryN: " + c.potEveryN + ",",
    "    potMinBuyWei: " + c.potMinBuyWei,
    "})",
  ].join("\n");
}

/// The same twelve values in the order the ABI encodes them, for `cast`.
export function toTuple(c: BlockConfig): string {
  const parts = [
    c.guardBlocks,
    c.maxBuyBps,
    c.snipeTaxPips,
    c.baseFeePips,
    c.maxFeePips,
    c.surgeSens,
    c.burnBps,
    c.burnTriggerWei,
    c.lpBps,
    c.potBps,
    c.potEveryN,
    c.potMinBuyWei,
  ];
  return "(" + parts.join(",") + ")";
}

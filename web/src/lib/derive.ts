import { CONSTANTS } from "./chain";
import { activeBlocks, type Launch } from "./reads/launches";
import { priceWeiPerToken } from "./reads/pool";
import type { Lifecycle } from "@/components/Tile";

/**
 * Figures the UI shows but the chain does not store. Every one is derived from
 * a value that was read, never from an assumption; where a launch cannot answer
 * a question, the answer is null and the cell renders a dash.
 */

export function lifecycleOf(l: Launch): Lifecycle {
  return l.record.graduated ? "set" : "molten";
}

/// Wei per whole token. A graduated token is priced by its pool; one still on
/// its curve is priced by the tranche it is selling from.
export function priceOf(l: Launch): bigint | null {
  if (l.record.graduated) {
    return l.pool ? priceWeiPerToken(l.pool.sqrtPriceX96) : null;
  }
  return l.curve ? l.curve.tranchePrice : null;
}

/// Fully diluted value in wei: price times the whole fixed supply. Not a dollar
/// figure — there is no oracle here and we do not pretend to one.
export function fdvOf(l: Launch): bigint | null {
  const price = priceOf(l);
  if (price === null) return null;
  return (price * l.totalSupply) / 10n ** 18n;
}

/// 0..1 through the ten tranches.
export function curveProgress(l: Launch): number | null {
  if (!l.curve) return null;
  if (l.curve.graduated) return 1;
  return Number((l.curve.sold * 10_000n) / CONSTANTS.curveSupply) / 10_000;
}

/// The ETH a full sellout would raise, so the curve can show a target.
export function curveTarget(l: Launch): bigint | null {
  if (!l.curve) return null;
  // Ten tranches of 80,000,000 tokens, each priced 1.7x the last:
  //   sum = p0 * 80,000,000 * (1.7^0 + ... + 1.7^9)
  // POW17_SUM is that series scaled by 1e18, held exactly by the contract.
  const POW17_SUM = 286_570557207000000000n;
  return (l.curve.p0 * CONSTANTS.trancheSize * POW17_SUM) / (10n ** 18n * 10n ** 18n);
}

/// Whether the anti-snipe window is still open, and how much of it is left.
export function guardRemaining(l: Launch, head: bigint): bigint | null {
  const { guardBlocks } = l.record.cfg;
  if (guardBlocks === 0 || l.hookState.startBlock === 0n) return null;
  const ends = l.hookState.startBlock + BigInt(guardBlocks);
  return head >= ends ? 0n : ends - head;
}

/// How many more qualifying buys until the pot pays out. The counter advances
/// at most once per block, so this is a count of buys, not of blocks.
export function buysUntilPot(l: Launch): number | null {
  const { potBps, potEveryN } = l.record.cfg;
  if (potBps === 0 || potEveryN === 0) return null;
  return potEveryN - (l.hookState.potBuyCount % potEveryN);
}

/// Three states, not two. A rule can be off, armed, or doing something at this
/// very block — and the third is what makes a page worth watching. Amber is
/// reserved for it; a rule that is merely armed stays cyan.
export type Heat = "off" | "armed" | "hot";

export type BlockHeat = {
  antiSnipe: Heat;
  surgeFees: Heat;
  autoBurn: Heat;
  lpRewards: Heat;
  pot: Heat;
};

export function blockHeat(l: Launch, head: bigint): BlockHeat {
  const cfg = l.record.cfg;
  const on = activeBlocks(cfg);
  const guard = guardRemaining(l, head);
  const untilPot = buysUntilPot(l);

  return {
    // Hot while the guard window is still counting down.
    antiSnipe: !on.antiSnipe ? "off" : guard !== null && guard > 0n ? "hot" : "armed",
    // Hot when the pool is charging more than its base fee at this moment.
    surgeFees: !on.surgeFees
      ? "off"
      : l.pool && l.pool.lpFee > cfg.baseFeePips
        ? "hot"
        : "armed",
    autoBurn: on.autoBurn ? "armed" : "off",
    lpRewards: on.lpRewards ? "armed" : "off",
    // Hot on the buy that wins it.
    pot: !on.pot ? "off" : untilPot === 1 ? "hot" : "armed",
  };
}

/// 0 = molten, 1 = fully quenched. A curve cools as it sells; a graduated pool
/// is cold. Drives the token mark's colour, so a wall of them reads as a
/// temperature map rather than a list.
export function temperatureOf(l: Launch): number {
  if (l.record.graduated) return 1;
  const progress = curveProgress(l);
  return progress === null ? 0 : progress;
}

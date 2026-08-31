import type { BlockConfig } from "@/lib/reads/launches";
import { activeBlocks } from "@/lib/reads/launches";
import { formatBps, formatPips } from "@/lib/format";

/**
 * The five rules, shown as they are actually configured rather than as a
 * generic list. A badge is lit only when the contract would run that block —
 * the same zero-means-off test the hook applies — so a lit badge is a promise
 * the chain keeps.
 */
const NAMES = {
  antiSnipe: "ANTI-SNIPE",
  surgeFees: "SURGE",
  autoBurn: "BURN",
  lpRewards: "LP",
  pot: "POT",
} as const;

/// Two letters are unreadable; three are the shortest form that still says
/// which rule is armed without a tooltip.
const SHORT = {
  antiSnipe: "SNP",
  surgeFees: "SRG",
  autoBurn: "BRN",
  lpRewards: "LP",
  pot: "POT",
} as const;

export function BlockBadges({ cfg, compact = false }: { cfg: BlockConfig; compact?: boolean }) {
  const on = activeBlocks(cfg);
  const detail = describe(cfg);

  return (
    <div className="flex flex-wrap gap-1">
      {(Object.keys(NAMES) as (keyof typeof NAMES)[]).map((key) => (
        <span
          key={key}
          title={on[key] ? detail[key] : "not armed on this token"}
          className={`border px-1.5 py-0.5 text-[10px] tracking-widest ${
            on[key]
              ? "border-line-bright text-text"
              : "border-line text-faint line-through decoration-1"
          }`}
        >
          {compact ? SHORT[key] : NAMES[key]}
        </span>
      ))}
    </div>
  );
}

function describe(cfg: BlockConfig): Record<keyof typeof NAMES, string> {
  return {
    antiSnipe: `${cfg.guardBlocks} blocks guarded, buys capped at ${formatBps(cfg.maxBuyBps)} of the reserve, ${formatPips(cfg.snipeTaxPips)} extra fee`,
    surgeFees: `fee climbs from ${formatPips(cfg.baseFeePips)} to ${formatPips(cfg.maxFeePips)} with trade depth`,
    autoBurn: `${formatBps(cfg.burnBps)} of buy output burned`,
    lpRewards: `${formatBps(cfg.lpBps)} of each buy donated to in-range LPs`,
    pot: `${formatBps(cfg.potBps)} of each buy into the pot, every ${cfg.potEveryN}th qualifying buy wins`,
  };
}

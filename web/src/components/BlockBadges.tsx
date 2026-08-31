import type { BlockConfig } from "@/lib/reads/launches";
import type { BlockHeat, Heat } from "@/lib/derive";
import { formatBps, formatPips, ordinal } from "@/lib/format";

/**
 * The five rules, shown as this token actually carries them.
 *
 * A badge has three states, not two. Off is nearly absent — the contract will
 * not run that branch, and the page should not spend contrast implying it
 * might. Armed is cyan: the rule is set and will fire. Hot is amber and glows:
 * the rule is doing something at this block, right now.
 *
 * Showing all five identically, as this did before, contradicted the only thing
 * the site claims — that a token's rules can be read before you trade it.
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

type Key = keyof typeof NAMES;

const TONE: Record<Heat, string> = {
  off: "border-off/40 text-off",
  armed: "border-cyan/50 text-cyan",
  hot: "border-amber text-amber",
};

export function BlockBadges({
  cfg,
  heat,
  compact = false,
}: {
  cfg: BlockConfig;
  heat: BlockHeat;
  compact?: boolean;
}) {
  const detail = describe(cfg);

  return (
    <div className="flex flex-wrap gap-1">
      {(Object.keys(NAMES) as Key[]).map((key) => {
        const state = heat[key];
        return (
          <span
            key={key}
            title={state === "off" ? `${NAMES[key]}: not armed on this token` : detail[key]}
            className={`border px-1.5 py-0.5 text-[10px] tracking-widest ${TONE[state]} ${
              state === "hot" ? "q-hot" : ""
            }`}
          >
            {compact ? SHORT[key] : NAMES[key]}
          </span>
        );
      })}
    </div>
  );
}

function describe(cfg: BlockConfig): Record<Key, string> {
  return {
    antiSnipe: `${cfg.guardBlocks} blocks guarded, buys capped at ${formatBps(cfg.maxBuyBps)} of the reserve, ${formatPips(cfg.snipeTaxPips)} extra fee`,
    surgeFees: `fee climbs from ${formatPips(cfg.baseFeePips)} to ${formatPips(cfg.maxFeePips)} with trade depth`,
    autoBurn: `${formatBps(cfg.burnBps)} of buy output burned`,
    lpRewards: `${formatBps(cfg.lpBps)} of each buy donated to in-range LPs`,
    pot: `${formatBps(cfg.potBps)} of each buy into the pot, every ${ordinal(cfg.potEveryN)} qualifying buy wins`,
  };
}

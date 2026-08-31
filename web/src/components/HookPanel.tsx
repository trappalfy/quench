import { Panel } from "./Panel";
import type { Launch } from "@/lib/reads/launches";
import { activeBlocks } from "@/lib/reads/launches";
import { buysUntilPot, guardRemaining } from "@/lib/derive";
import {
  blocksToApproxAge,
  formatBps,
  formatCompactTokens,
  formatEth,
  formatPips,
  ordinal,
  DASH,
} from "@/lib/format";

/**
 * The five rules as this token actually carries them, with whatever the hook is
 * currently holding underneath each one.
 *
 * This is the page's reason to exist. A launchpad that shows a price and hides
 * the rules is asking to be trusted; showing the rules, with the live counters
 * that prove they are running, asks to be checked instead.
 */
export function HookPanel({ launch, head }: { launch: Launch; head: bigint }) {
  const cfg = launch.record.cfg;
  const on = activeBlocks(cfg);
  const guard = guardRemaining(launch, head);
  const untilPot = buysUntilPot(launch);

  return (
    <Panel title="hook · fixed at launch, never mutable" ticks bodyClassName="divide-y divide-line">
      <Rule
        armed={on.antiSnipe}
        name="Anti-Snipe"
        rule={`For ${cfg.guardBlocks} blocks after the pool opens, a buy may not exceed ${formatBps(cfg.maxBuyBps)} of the in-range ETH reserve, and pays ${formatPips(cfg.snipeTaxPips)} on top.`}
        live={
          guard === null
            ? undefined
            : guard > 0n
              ? { label: "window closes in", value: `${guard} blocks · ~${blocksToApproxAge(guard)}`, hot: true }
              : { label: "window", value: "closed" }
        }
      />
      <Rule
        armed={on.surgeFees}
        name="Surge Fees"
        rule={`The LP fee climbs from ${formatPips(cfg.baseFeePips)} to ${formatPips(cfg.maxFeePips)} as a single buy eats further into the in-range depth. No oracle is consulted.`}
        live={
          launch.pool
            ? { label: "fee right now", value: formatPips(launch.pool.lpFee) }
            : undefined
        }
      />
      <Rule
        armed={on.autoBurn}
        name="Auto Burn"
        rule={`${formatBps(cfg.burnBps)} of the tokens an exact-input buy produces go straight to the dead address${cfg.burnTriggerWei > 0n ? `, on buys of at least ${formatEth(cfg.burnTriggerWei)} ETH` : ""}.`}
        live={{ label: "burned so far", value: `${formatCompactTokens(launch.burned)} ${launch.symbol}` }}
      />
      <Rule
        armed={on.lpRewards}
        name="LP Rewards"
        rule={`${formatBps(cfg.lpBps)} of the ETH on every exact-input buy is donated to whoever holds in-range liquidity during that same swap.`}
      />
      <Rule
        armed={on.pot}
        name="Nth-buy Pot"
        rule={`${formatBps(cfg.potBps)} of each qualifying buy fills a pot; every ${ordinal(cfg.potEveryN)} qualifying buy takes it${cfg.potMinBuyWei > 0n ? `. A buy qualifies from ${formatEth(cfg.potMinBuyWei)} ETH up` : ""}. The counter is public and advances at most once per block.`}
        live={
          on.pot
            ? {
                label: "pot holds",
                value: `${formatEth(launch.potBalance)} ETH · ${untilPot} ${untilPot === 1 ? "buy" : "buys"} to go`,
                hot: true,
              }
            : undefined
        }
      />
    </Panel>
  );
}

function Rule({
  armed,
  name,
  rule,
  live,
}: {
  armed: boolean;
  name: string;
  rule: string;
  live?: { label: string; value: string; hot?: boolean };
}) {
  return (
    <div className={`px-3 py-3 ${armed ? "" : "opacity-45"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="q-display-sm text-sm">{name}</span>
        <span className={`q-label ${armed ? "text-cyan" : "text-faint"}`}>
          {armed ? "armed" : "not armed"}
        </span>
      </div>
      <p className="mt-1 text-dim">{armed ? rule : "This block is off on this token."}</p>
      {armed && live && (
        <div className="mt-2 flex items-baseline gap-2">
          <span className="q-label">{live.label}</span>
          <span className={live.hot ? "text-amber" : "text-text"}>{live.value ?? DASH}</span>
        </div>
      )}
    </div>
  );
}

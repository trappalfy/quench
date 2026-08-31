import { Panel } from "./Panel";
import type { Launch } from "@/lib/reads/launches";
import { buysUntilPot, guardRemaining, type BlockHeat, type Heat } from "@/lib/derive";
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
export function HookPanel({
  launch,
  head,
  heat,
}: {
  launch: Launch;
  head: bigint;
  heat: BlockHeat;
}) {
  const cfg = launch.record.cfg;
  const guard = guardRemaining(launch, head);
  const untilPot = buysUntilPot(launch);

  return (
    <Panel title="hook · fixed at launch, never mutable" ticks bodyClassName="divide-y divide-line">
      <Rule
        heat={heat.antiSnipe}
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
        heat={heat.surgeFees}
        name="Surge Fees"
        rule={`The LP fee climbs from ${formatPips(cfg.baseFeePips)} to ${formatPips(cfg.maxFeePips)} as a single buy eats further into the in-range depth. No oracle is consulted.`}
        live={
          launch.pool
            ? { label: "fee right now", value: formatPips(launch.pool.lpFee) }
            : undefined
        }
      />
      <Rule
        heat={heat.autoBurn}
        name="Auto Burn"
        rule={`${formatBps(cfg.burnBps)} of the tokens an exact-input buy produces go straight to the dead address${cfg.burnTriggerWei > 0n ? `, on buys of at least ${formatEth(cfg.burnTriggerWei)} ETH` : ""}.`}
        live={{
          label: "burned by this rule",
          value: `${formatCompactTokens(launch.burnedByHook)} ${launch.symbol}`,
        }}
      />
      <Rule
        heat={heat.lpRewards}
        name="LP Rewards"
        rule={`${formatBps(cfg.lpBps)} of the ETH on every exact-input buy is donated to whoever holds in-range liquidity during that same swap.`}
      />
      <Rule
        heat={heat.pot}
        name="Nth-buy Pot"
        rule={`${formatBps(cfg.potBps)} of each qualifying buy fills a pot; every ${ordinal(cfg.potEveryN)} qualifying buy takes it${cfg.potMinBuyWei > 0n ? `. A buy qualifies from ${formatEth(cfg.potMinBuyWei)} ETH up` : ""}. The counter is public and advances at most once per block.`}
        live={
          heat.pot !== "off"
            ? {
                label: "pot holds",
                value: `${formatEth(launch.potBalance)} ETH · ${untilPot} ${untilPot === 1 ? "buy" : "buys"} to go`,
                // Glows only on the buy that actually wins it, not for the
                // whole cycle — otherwise the glow means nothing.
                hot: heat.pot === "hot",
              }
            : undefined
        }
      />
    </Panel>
  );
}

const STATE_LABEL: Record<Heat, string> = {
  off: "not armed",
  armed: "armed",
  hot: "running now",
};

const STATE_TONE: Record<Heat, string> = {
  off: "text-off",
  armed: "text-cyan",
  hot: "text-amber q-hot",
};

function Rule({
  heat,
  name,
  rule,
  live,
}: {
  heat: Heat;
  name: string;
  rule: string;
  live?: { label: string; value: string; hot?: boolean };
}) {
  const armed = heat !== "off";
  return (
    <div className={`px-4 py-4 ${armed ? "" : "opacity-50"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="q-display-sm text-base">{name}</span>
        <span className={`q-label ${STATE_TONE[heat]}`}>{STATE_LABEL[heat]}</span>
      </div>
      <p className="mt-1.5 text-dim">
        {armed ? rule : "This block is off on this token. The contract will not run it."}
      </p>
      {armed && live && (
        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="q-label">{live.label}</span>
          <span className={live.hot ? "text-amber q-hot" : "text-text"}>
            {live.value ?? DASH}
          </span>
        </div>
      )}
    </div>
  );
}

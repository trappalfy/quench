"use client";

import { Panel } from "../Panel";
import {
  BLOCK_META,
  blocksOn,
  type BlockConfig,
  type BlockKey,
} from "@/lib/hookConfig";
import type { BuyQuote } from "@/lib/simulate";
import { formatBps, formatEth, formatPips } from "@/lib/format";

/**
 * One buy, from the ETH going in to the tokens coming out.
 *
 * The five blocks are numbered 01–05, and it would be tidy if that were the
 * order they ran in. It is not: four of them run in `beforeSwap`, and Auto Burn
 * runs in `afterSwap`, because it works on an output that does not exist until
 * the swap has happened. The diagram shows the real order and says which stage
 * each step belongs to — a numbering that quietly implied the wrong sequence
 * would be the kind of decoration this page exists to avoid.
 *
 * Every figure comes from the same `simulateBuy` call the panel beside it uses.
 */
export function SwapPath({
  cfg,
  quote,
  amountIn,
}: {
  cfg: BlockConfig;
  quote: BuyQuote;
  amountIn: bigint;
}) {
  const on = blocksOn(cfg);

  const steps: {
    key: BlockKey;
    on: boolean;
    detail: string;
    effect: string;
  }[] = [
    {
      key: "antiSnipe",
      on: on.antiSnipe,
      detail: `cap ${formatBps(cfg.maxBuyBps)} of the reserve, +${formatPips(cfg.snipeTaxPips)} fee`,
      effect: quote.exceedsGuardCap ? "would refuse this buy" : "allowed",
    },
    {
      key: "surgeFees",
      on: on.surgeFees,
      detail: `${formatPips(cfg.baseFeePips)} → ${formatPips(cfg.maxFeePips)} by depth`,
      effect: `fee ${formatPips(quote.feePips)}`,
    },
    {
      key: "lpRewards",
      on: on.lpRewards,
      detail: `${formatBps(cfg.lpBps)} donated to in-range LPs`,
      effect: `−${formatEth(quote.lpCut, 6)} ETH`,
    },
    {
      key: "pot",
      on: on.pot,
      detail: `${formatBps(cfg.potBps)} into the pot`,
      effect: `−${formatEth(quote.potCut, 6)} ETH`,
    },
  ];

  return (
    <Panel title="one buy, end to end" ticks bodyClassName="p-4">
      <Terminal
        label="in"
        value={`${formatEth(amountIn, 6)} ETH`}
        tone={quote.exceedsGuardCap ? "fail" : "amber"}
      />

      <Stage label="beforeSwap" />
      {steps.map((s) => (
        <Step
          key={s.key}
          n={BLOCK_META[s.key].n}
          name={BLOCK_META[s.key].name}
          on={s.on}
          detail={s.detail}
          effect={s.effect}
        />
      ))}

      <Terminal
        label="reaches the swap"
        value={`${formatEth(quote.effectiveIn, 6)} ETH`}
        tone="plain"
      />
      <div className="my-2 border-l border-line py-2 pl-4 text-faint">
        the pool swaps at {formatPips(quote.feePips)}
      </div>

      <Stage label="afterSwap" />
      <Step
        n={BLOCK_META.autoBurn.n}
        name={BLOCK_META.autoBurn.name}
        on={on.autoBurn}
        detail={`${formatBps(cfg.burnBps)} of the tokens out, on buys of ${formatEth(cfg.burnTriggerWei, 6)} ETH or more`}
        effect={
          quote.burnBps === 0
            ? "does not fire on this buy"
            : `−${formatBps(quote.burnBps)} of the output`
        }
      />

      <Terminal label="out" value="tokens, less the burn" tone="cyan" />

      <p className="mt-4 border-t border-line pt-3 text-[11px] text-faint">
        The numbers are names, not a sequence. Auto Burn is block 03 and runs
        last, because it works on an output that does not exist until the swap
        has happened.
      </p>
    </Panel>
  );
}

function Stage({ label }: { label: string }) {
  return <p className="q-label mt-3 mb-1">{label}</p>;
}

function Terminal({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "amber" | "cyan" | "plain" | "fail";
}) {
  const colour =
    tone === "amber"
      ? "border-amber text-amber"
      : tone === "cyan"
        ? "border-cyan text-cyan"
        : tone === "fail"
          ? "border-fail text-fail"
          : "border-line-bright text-text";
  return (
    <div className={`flex items-baseline justify-between gap-3 border-l-2 px-3 py-2 ${colour}`}>
      <span className="q-label">{label}</span>
      <span className="min-w-0 truncate">{value}</span>
    </div>
  );
}

function Step({
  n,
  name,
  on,
  detail,
  effect,
}: {
  n: string;
  name: string;
  on: boolean;
  detail: string;
  effect: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l border-line py-1.5 pl-4 ${
        on ? "text-dim" : "text-off"
      }`}
    >
      <span className="q-label shrink-0" style={on ? undefined : { color: "inherit" }}>
        {n}
      </span>
      <span className={`shrink-0 ${on ? "text-text" : ""}`}>{name}</span>
      {on ? (
        <>
          <span className="min-w-0 text-[11px]">{detail}</span>
          <span className="ml-auto shrink-0 text-text">{effect}</span>
        </>
      ) : (
        <span className="ml-auto shrink-0 text-[11px]">not armed · skipped</span>
      )}
    </div>
  );
}

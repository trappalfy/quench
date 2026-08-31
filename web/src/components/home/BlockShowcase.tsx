"use client";

import { useMemo, useState } from "react";
import { Panel } from "../Panel";
import { Q96, maxBuy, simulateBuy, surgeFee } from "@/lib/simulate";
import { BLOCK_META, type BlockConfig } from "@/lib/hookConfig";
import {
  DASH,
  formatBps,
  formatCount,
  formatEth,
  formatPips,
  ordinal,
} from "@/lib/format";

/**
 * The five blocks, each shown doing the thing it does.
 *
 * Anti-snipe is a window and Surge is a curve; five paragraphs of prose could
 * not say what either of them costs at a given size. One slider drives all five
 * cards, because they all read the same trade — moving five sliders to compare
 * five rules on the same buy would be the reader doing the page's job.
 *
 * The example config is stated, not implied. These are not defaults and not
 * recommendations: the contract accepts a wide range and takes no view.
 */

const RESERVE = 10n * 10n ** 18n;

const EXAMPLE: BlockConfig = {
  guardBlocks: 300,
  maxBuyBps: 500,
  snipeTaxPips: 10_000,
  baseFeePips: 3_000,
  maxFeePips: 50_000,
  surgeSens: 10_000,
  burnBps: 500,
  burnTriggerWei: 10n ** 16n,
  lpBps: 200,
  potBps: 100,
  potEveryN: 25,
  potMinBuyWei: 10n ** 16n,
};

export type PotFacts = {
  symbol: string;
  balance: bigint;
  buysUntil: number | null;
  everyN: number;
  buysSoFar: number;
} | null;

export function BlockShowcase({ pot }: { pot: PotFacts }) {
  /// Depth in basis points of the reserve. The range runs past 100% on purpose:
  /// the fee saturates exactly at a buy the size of the reserve, and a chart
  /// that stops short of that knee shows a straight line and hides the rule.
  const [depthBps, setDepthBps] = useState(100);
  const amountIn = (RESERVE * BigInt(depthBps)) / 10_000n;
  const [sinceOpen, setSinceOpen] = useState(0);

  const quote = useMemo(
    () => simulateBuy(EXAMPLE, RESERVE, Q96, amountIn, sinceOpen),
    [amountIn, sinceOpen],
  );

  const cap = maxBuy(RESERVE, EXAMPLE.maxBuyBps);
  const guardOpen = sinceOpen < EXAMPLE.guardBlocks;

  return (
    <>
      <Panel title="the trade every card below is reading" bodyClassName="p-4">
        <div className="grid gap-6 sm:grid-cols-2">
          <label className="block">
            <span className="q-label">buy size</span>
            <input
              type="range"
              min={1}
              max={12000}
              value={depthBps}
              onChange={(e) => setDepthBps(Number(e.target.value))}
              className="mt-2 w-full accent-amber"
              aria-label="buy size as a share of the reserve"
            />
            <span className="mt-1 block text-dim">
              {formatEth(amountIn, 4)} ETH into 10 ETH ·{" "}
              <span className="text-text">{formatBps(depthBps)}</span> of the reserve
            </span>
          </label>

          <label className="block">
            <span className="q-label">blocks since the pool opened</span>
            <input
              type="range"
              min={0}
              max={600}
              value={sinceOpen}
              onChange={(e) => setSinceOpen(Number(e.target.value))}
              className="mt-2 w-full accent-cyan"
              aria-label="blocks since the pool opened"
            />
            <span className={`mt-1 block ${guardOpen ? "q-hot" : "text-dim"}`}>
              block {formatCount(sinceOpen)} ·{" "}
              {guardOpen ? "inside the guard window" : "the window has closed"}
            </span>
          </label>
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card k="antiSnipe">
          <Window
            guardBlocks={EXAMPLE.guardBlocks}
            sinceOpen={sinceOpen}
            span={600}
          />
          <Facts
            rows={[
              ["cap on a buy", `${formatEth(cap, 4)} ETH`],
              [
                "this buy",
                quote.exceedsGuardCap
                  ? "refused — over the cap"
                  : guardOpen
                    ? "allowed"
                    : "uncapped, the window has closed",
              ],
              [
                "surcharge",
                guardOpen ? `+${formatPips(EXAMPLE.snipeTaxPips)}` : "none any more",
              ],
            ]}
            hot={guardOpen}
          />
        </Card>

        <Card k="surgeFees">
          <FeeCurve cfg={EXAMPLE} depthBps={depthBps} />
          <Facts
            rows={[
              ["at this depth", formatPips(surgeFee(amountIn, RESERVE, EXAMPLE.baseFeePips, EXAMPLE.maxFeePips, EXAMPLE.surgeSens))],
              ["floor", formatPips(EXAMPLE.baseFeePips)],
              ["ceiling", `${formatPips(EXAMPLE.maxFeePips)}, reached at 100% depth`],
            ]}
          />
        </Card>

        <Card k="autoBurn">
          <Split
            parts={[
              { label: "burned", bps: quote.burnBps, tone: "amber" },
              { label: "you keep", bps: 10_000 - quote.burnBps, tone: "line" },
            ]}
          />
          <Facts
            rows={[
              [
                "on this buy",
                quote.burnBps === 0
                  ? `nothing — under the ${formatEth(EXAMPLE.burnTriggerWei, 4)} ETH trigger`
                  : `${formatBps(quote.burnBps)} of the tokens out`,
              ],
              ["where", "0x…dEaD, inside the same swap"],
              ["the pool's reserves", "untouched — only your output shrinks"],
            ]}
          />
        </Card>

        <Card k="lpRewards">
          <Split
            parts={[
              { label: "to LPs", bps: EXAMPLE.lpBps, tone: "cyan" },
              { label: "to the pot", bps: EXAMPLE.potBps, tone: "amber" },
              { label: "to the swap", bps: 10_000 - EXAMPLE.lpBps - EXAMPLE.potBps, tone: "line" },
            ]}
          />
          <Facts
            rows={[
              ["to in-range LPs", `${formatEth(quote.lpCut, 6)} ETH`],
              ["to the pot", `${formatEth(quote.potCut, 6)} ETH`],
              ["reaches the swap", `${formatEth(quote.effectiveIn, 6)} ETH`],
            ]}
          />
        </Card>

        <Card k="pot" className="lg:col-span-2">
          {pot === null ? (
            <p className="text-faint">
              No launched token has the pot armed, so there is no counter to show. This
              card fills itself from the vault when one does — it is not illustrated.
            </p>
          ) : (
            <>
              <Counter buysSoFar={pot.buysSoFar} everyN={pot.everyN} />
              <Facts
                rows={[
                  ["in the pot", `${formatEth(pot.balance)} ETH`],
                  ["qualifying buys", formatCount(pot.buysSoFar)],
                  [
                    "next payout",
                    pot.buysUntil === null
                      ? DASH
                      : `${pot.buysUntil} more · every ${ordinal(pot.everyN)} buy wins`,
                  ],
                ]}
                hot={pot.buysUntil === 1}
              />
              <p className="mt-3 text-[11px] text-faint">
                Real values, read from the pot vault for {`$${pot.symbol}`}. The
                counter advances at most once per block and is public, which means it
                will be raced.
              </p>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

/* -- the frame ------------------------------------------------------------ */

function Card({
  k,
  className = "",
  children,
}: {
  k: keyof typeof BLOCK_META;
  className?: string;
  children: React.ReactNode;
}) {
  const meta = BLOCK_META[k];
  return (
    <Panel
      className={className}
      ticks
      bodyClassName="p-4"
      title={`${meta.n} ${meta.name}`}
      right={<span className="q-label">{meta.when}</span>}
    >
      <p className="mb-4 text-dim">{meta.what}</p>
      {children}
    </Panel>
  );
}

function Facts({ rows, hot = false }: { rows: [string, string][]; hot?: boolean }) {
  return (
    <dl className="mt-4 space-y-1.5 border-t border-line pt-3">
      {rows.map(([k, v], i) => (
        <div key={k} className="flex items-baseline justify-between gap-3">
          <dt className="q-label shrink-0">{k}</dt>
          <dd className={`min-w-0 text-right ${hot && i === 0 ? "q-hot" : "text-text"}`}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -- 01: the window ------------------------------------------------------- */

function Window({
  guardBlocks,
  sinceOpen,
  span,
}: {
  guardBlocks: number;
  sinceOpen: number;
  span: number;
}) {
  const guardPct = Math.min(100, (guardBlocks / span) * 100);
  const nowPct = Math.min(100, (sinceOpen / span) * 100);

  return (
    <div>
      <div className="relative h-10 border border-line">
        {/* The guarded stretch, from the pool opening to the last block the cap
            applies. It does not move; the marker does. */}
        <div
          className="absolute inset-y-0 left-0 bg-amber/20"
          style={{ width: `${guardPct}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-amber"
          style={{ left: `${guardPct}%` }}
        />
        <div
          className="absolute inset-y-[-4px] w-0.5 bg-text"
          style={{ left: `${nowPct}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-faint">
        <span>pool opens</span>
        <span className="text-amber">
          block {formatCount(guardBlocks)} · cap lifts
        </span>
        <span>{formatCount(span)}</span>
      </div>
    </div>
  );
}

/* -- 02: the curve -------------------------------------------------------- */

function FeeCurve({ cfg, depthBps }: { cfg: BlockConfig; depthBps: number }) {
  const W = 100;
  const H = 40;
  const MAX_DEPTH = 12_000;

  // Sampled from the contract's own surgeFee, not from a drawn approximation of
  // it. The kink where the fee saturates is real and worth seeing.
  const points = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i <= 60; i++) {
      const d = (MAX_DEPTH * i) / 60;
      const amount = (10n ** 19n * BigInt(Math.round(d))) / 10_000n;
      const fee = surgeFee(amount, 10n ** 19n, cfg.baseFeePips, cfg.maxFeePips, cfg.surgeSens);
      const x = (d / MAX_DEPTH) * W;
      const y = H - ((fee - cfg.baseFeePips) / (cfg.maxFeePips - cfg.baseFeePips)) * H;
      out.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return out.join(" ");
  }, [cfg]);

  const markX = (Math.min(depthBps, MAX_DEPTH) / MAX_DEPTH) * W;
  const markFee = surgeFee(
    (10n ** 19n * BigInt(depthBps)) / 10_000n,
    10n ** 19n,
    cfg.baseFeePips,
    cfg.maxFeePips,
    cfg.surgeSens,
  );
  const markY = H - ((markFee - cfg.baseFeePips) / (cfg.maxFeePips - cfg.baseFeePips)) * H;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-24 w-full border border-line"
        role="img"
        aria-label="LP fee against trade depth"
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--color-cyan)"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={markX}
          y1="0"
          x2={markX}
          y2={H}
          stroke="var(--color-amber)"
          strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={markX} cy={markY} r="1.2" fill="var(--color-amber)" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-faint">
        <span>{formatPips(cfg.baseFeePips)} at nothing</span>
        <span>flat at {formatPips(cfg.maxFeePips)} past 100%</span>
      </div>
    </div>
  );
}

/* -- 03 and 04: shares ---------------------------------------------------- */

function Split({
  parts,
}: {
  parts: { label: string; bps: number; tone: "amber" | "cyan" | "line" }[];
}) {
  const shown = parts.filter((p) => p.bps > 0);
  const colour = {
    amber: "bg-amber",
    cyan: "bg-cyan",
    line: "bg-line-bright",
  } as const;

  return (
    <div>
      <div className="flex h-8 gap-px border border-line">
        {shown.map((p) => (
          <div
            key={p.label}
            className={colour[p.tone]}
            style={{ width: `${(p.bps / 100).toFixed(4)}%` }}
            title={`${p.label}: ${formatBps(p.bps)}`}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-faint">
        {shown.map((p) => (
          <span key={p.label}>
            {p.label} {formatBps(p.bps)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* -- 05: the counter ------------------------------------------------------ */

function Counter({ buysSoFar, everyN }: { buysSoFar: number; everyN: number }) {
  const done = buysSoFar % everyN;
  // Beyond a couple of dozen the ticks stop being countable and become texture,
  // which is a different thing than a counter. Past that, the figures below say
  // it and the row does not pretend to.
  if (everyN > 40) return null;

  return (
    <div className="flex flex-wrap gap-1" aria-hidden>
      {Array.from({ length: everyN }, (_, i) => (
        <span
          key={i}
          className={`h-6 w-2 ${
            i < done ? "bg-cyan" : i === everyN - 1 ? "bg-amber/40" : "bg-line-bright"
          }`}
        />
      ))}
    </div>
  );
}

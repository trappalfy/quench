"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BLOCK_META,
  BLOCK_ORDER,
  HOOK_FLAGS,
  blocksOn,
  gasFor,
  setBlock,
  toQuery,
  type BlockConfig,
  type BlockKey,
} from "@/lib/hookConfig";
import { Q96, simulateBuy } from "@/lib/simulate";
import { formatBps, formatCount, formatEth, formatPips } from "@/lib/format";

/**
 * The hero's right half: a hook you can actually switch on and off.
 *
 * It computes with the same `simulateBuy` the builder and the contract use, on
 * a fixed reference trade so that the five numbers are comparable as blocks go
 * on and off. It deploys nothing and reads nothing; whatever is composed here
 * travels to the builder through the URL.
 *
 * The reference trade is stated on screen rather than assumed. A cost figure
 * without the trade it was computed on is a number with no meaning attached.
 */

/// 0.1 ETH into a 10 ETH in-range reserve — a 1% bite, deep enough that Surge
/// has something to say and shallow enough that the guard cap does not refuse
/// it. Priced 1:1 so the reserve typed here is the reserve the hook derives.
const REFERENCE_RESERVE = 10n * 10n ** 18n;
const REFERENCE_BUY = 10n ** 17n;

const START: BlockConfig = {
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

export function HeroComposer() {
  const [cfg, setCfg] = useState<BlockConfig>(START);
  const on = blocksOn(cfg);

  // Block 0: inside the guard window, so switching Anti-snipe on changes
  // something visible instead of describing a rule that is already over.
  const quote = useMemo(
    () => simulateBuy(cfg, REFERENCE_RESERVE, Q96, REFERENCE_BUY, 0),
    [cfg],
  );

  const takenBps = cfg.lpBps + cfg.potBps;
  const armed = BLOCK_ORDER.filter((k) => on[k]).length;

  return (
    <div className="border border-line bg-panel">
      <header className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="q-label">/ compose</span>
        <span className="q-label">
          {armed} of 5 armed · 0x{HOOK_FLAGS.toString(16).toUpperCase()}
        </span>
      </header>

      <div className="grid gap-px bg-line sm:grid-cols-2">
        <div className="bg-panel p-4">
          <ul className="space-y-1">
            {BLOCK_ORDER.map((key) => (
              <li key={key}>
                <Toggle
                  blockKey={key}
                  on={on[key]}
                  onClick={() => setCfg((c) => setBlock(c, key, !on[key]))}
                />
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-panel p-4">
          <p className="q-label">on a 0.1 ETH buy into 10 ETH</p>
          <dl className="mt-3 space-y-2">
            <Row
              k="fee"
              v={formatPips(quote.feePips)}
              note={on.antiSnipe ? "guard open" : on.surgeFees ? "by depth" : "flat"}
            />
            <Row
              k="taken out"
              v={takenBps === 0 ? "nothing" : `${formatEth(quote.lpCut + quote.potCut, 6)} ETH`}
              note={takenBps === 0 ? undefined : formatBps(takenBps)}
            />
            <Row
              k="burned"
              v={quote.burnBps === 0 ? "nothing" : formatBps(quote.burnBps)}
              note={quote.burnBps === 0 ? undefined : "of the output"}
            />
            <Row k="gas" v={`~${formatCount(gasFor(cfg))}`} />
          </dl>

          <Link
            href={`/builder?cfg=${toQuery(cfg)}`}
            className="mt-4 block border border-cyan px-3 py-2 text-center text-cyan transition-colors hover:bg-cyan hover:text-ground"
          >
            Open in the builder
          </Link>
        </div>
      </div>

      <p className="border-t border-line px-4 py-2 text-[11px] text-faint">
        Computed here, by the same arithmetic the hook runs. Nothing is deployed and
        nothing is read from the chain.
      </p>
    </div>
  );
}

function Toggle({
  blockKey,
  on,
  onClick,
}: {
  blockKey: BlockKey;
  on: boolean;
  onClick: () => void;
}) {
  const meta = BLOCK_META[blockKey];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`flex w-full items-baseline gap-3 border px-3 py-2 text-left transition-colors ${
        on
          ? "border-cyan/50 text-text hover:border-cyan"
          : "border-line text-off hover:border-line-bright"
      }`}
    >
      <span className="q-label shrink-0" style={on ? undefined : { color: "inherit" }}>
        {meta.n}
      </span>
      <span className="min-w-0 truncate">{meta.name}</span>
      <span
        className={`ml-auto shrink-0 text-[10px] tracking-widest ${on ? "text-cyan" : ""}`}
      >
        {on ? meta.tag : "OFF"}
      </span>
    </button>
  );
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="q-label shrink-0">{k}</dt>
      <dd className="min-w-0 truncate text-right">
        <span className="text-text">{v}</span>
        {note && <span className="ml-2 text-[11px] text-faint">{note}</span>}
      </dd>
    </div>
  );
}

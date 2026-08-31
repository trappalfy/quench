"use client";

import { useMemo, useState } from "react";
import { formatEther } from "viem";
import Link from "next/link";
import { Panel } from "../Panel";
import { EthField, NumberField } from "./Field";
import { CopyButton } from "./CopyButton";
import { SwapPath } from "./SwapPath";
import {
  BLOCK_META,
  BLOCK_ORDER,
  EMPTY,
  GAS,
  HOOK_FLAGS,
  HOOK_FLAG_BITS,
  LIMITS,
  blocksOn,
  gasFor,
  setBaseFee,
  setBlock,
  toSolidity,
  toTuple,
  validate,
  type BlockConfig,
  type BlockKey,
} from "@/lib/hookConfig";
import { Q96, simulateBuy } from "@/lib/simulate";
import { ADDRESSES, explorerAddress } from "@/lib/chain";
import { formatBps, formatCount, formatEth, formatPips, ordinal } from "@/lib/format";

/// The trade being quoted. Held in the page rather than inside the panel that
/// edits it, because the diagram in the left column has to show the same buy —
/// two independent copies of "0.1 ETH" would eventually disagree on screen.
type Sim = {
  reserve: bigint;
  setReserve: (v: bigint) => void;
  amountIn: bigint;
  setAmountIn: (v: bigint) => void;
  sinceOpen: number;
  setSinceOpen: (v: number) => void;
  quote: ReturnType<typeof simulateBuy>;
};

/**
 * The builder.
 *
 * Every number on this page is computed in the browser by `ts/src/simulate.ts`,
 * which mirrors `BlockMath.sol` and is checked against it by a differential
 * test. Nothing here is sent anywhere and nothing is signed: what the page can
 * tell you, it tells you before you spend gas finding out.
 *
 * The one thing it cannot do is publish. That is stated on the button rather
 * than hidden behind one that fails.
 */
export function HookBuilder() {
  const [cfg, setCfg] = useState<BlockConfig>(() => ({
    ...EMPTY,
    ...{ guardBlocks: 300, maxBuyBps: 500, snipeTaxPips: 10_000 },
    maxFeePips: 50_000,
    surgeSens: 10_000,
    lpBps: 200,
  }));

  const [reserve, setReserve] = useState(10n * 10n ** 18n);
  const [amountIn, setAmountIn] = useState(10n ** 17n);
  const [sinceOpen, setSinceOpen] = useState(0);

  const quote = useMemo(
    // simulateBuy derives the ETH reserve as liquidity * 2^96 / sqrtPriceX96.
    // Pricing the pool at 1:1 makes that an identity, so a reserve typed here
    // is the reserve the hook sees — and the real function runs, unmodified.
    // None of the figures it returns depend on the price.
    () => simulateBuy(cfg, reserve, Q96, amountIn, sinceOpen),
    [cfg, reserve, amountIn, sinceOpen],
  );

  const sim: Sim = {
    reserve,
    setReserve,
    amountIn,
    setAmountIn,
    sinceOpen,
    setSinceOpen,
    quote,
  };

  const on = blocksOn(cfg);
  const issues = validate(cfg);
  const badFields = new Set(issues.flatMap((i) => i.fields));
  const set = (patch: Partial<BlockConfig>) => setCfg((c) => ({ ...c, ...patch }));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
      <div className="min-w-0 space-y-4">
        {BLOCK_ORDER.map((key) => (
          <BlockPanel
            key={key}
            blockKey={key}
            cfg={cfg}
            on={on[key]}
            badFields={badFields}
            onToggle={(next) => setCfg((c) => setBlock(c, key, next))}
            set={set}
            setCfg={setCfg}
          />
        ))}

        <SwapPath cfg={cfg} quote={quote} amountIn={amountIn} />
      </div>

      <div className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Cost cfg={cfg} />
        <Simulator cfg={cfg} sim={sim} />
        <Validation issues={issues} />
        <Output cfg={cfg} />
        <Flags />
        <Publish />
      </div>
    </div>
  );
}

/* -- the five blocks ------------------------------------------------------ */

function BlockPanel({
  blockKey,
  cfg,
  on,
  badFields,
  onToggle,
  set,
  setCfg,
}: {
  blockKey: BlockKey;
  cfg: BlockConfig;
  on: boolean;
  badFields: Set<keyof BlockConfig>;
  onToggle: (next: boolean) => void;
  set: (patch: Partial<BlockConfig>) => void;
  setCfg: (fn: (c: BlockConfig) => BlockConfig) => void;
}) {
  const meta = BLOCK_META[blockKey];
  const bad = (f: keyof BlockConfig) => badFields.has(f);

  return (
    <Panel
      className={on ? "" : "opacity-70"}
      bodyClassName="p-4"
      title={`${meta.n} ${meta.name}`}
      right={
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`${meta.name}: ${on ? "armed" : "off"}`}
          onClick={() => onToggle(!on)}
          className={`border px-2 py-0.5 text-[10px] tracking-widest ${
            on ? "border-cyan text-cyan" : "border-off text-off"
          }`}
        >
          {on ? `${meta.tag} ARMED` : `${meta.tag} OFF`}
        </button>
      }
    >
      <p className="text-dim">{meta.what}</p>
      <p className="q-label mt-2">{meta.when}</p>

      {/* The flat fee is not part of block 02 — it applies whether surge is
          armed or not — so it stays visible when the block is switched off. */}
      {blockKey === "surgeFees" && (
        <div className="mt-4">
          <NumberField
            label="flat LP fee"
            unit="pips"
            value={cfg.baseFeePips}
            max={LIMITS.maxFeePips}
            meaning={formatPips(cfg.baseFeePips)}
            invalid={bad("baseFeePips")}
            onChange={(n) => setCfg((c) => setBaseFee(c, n))}
          />
        </div>
      )}

      {on && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {blockKey === "antiSnipe" && (
            <>
              <NumberField
                label="guard window"
                unit="blocks"
                value={cfg.guardBlocks}
                max={LIMITS.guardBlocks}
                meaning={`~${Math.round(cfg.guardBlocks / 10)}s at ~0.1s blocks`}
                invalid={bad("guardBlocks")}
                onChange={(n) => set({ guardBlocks: n })}
              />
              <NumberField
                label="max buy"
                unit="bps"
                value={cfg.maxBuyBps}
                max={LIMITS.maxBuyBps}
                meaning={`${formatBps(cfg.maxBuyBps)} of the in-range reserve`}
                invalid={bad("maxBuyBps")}
                onChange={(n) => set({ maxBuyBps: n })}
              />
              <NumberField
                label="surcharge"
                unit="pips"
                value={cfg.snipeTaxPips}
                max={LIMITS.snipeTaxPips}
                meaning={`${formatPips(cfg.snipeTaxPips)} on top of the fee`}
                invalid={bad("snipeTaxPips")}
                onChange={(n) => set({ snipeTaxPips: n })}
              />
            </>
          )}

          {blockKey === "surgeFees" && (
            <>
              <NumberField
                label="fee ceiling"
                unit="pips"
                value={cfg.maxFeePips}
                max={LIMITS.maxFeePips}
                meaning={formatPips(cfg.maxFeePips)}
                invalid={bad("maxFeePips")}
                onChange={(n) => set({ maxFeePips: n })}
              />
              <NumberField
                label="sensitivity"
                unit=""
                value={cfg.surgeSens}
                max={LIMITS.surgeSens}
                meaning={
                  cfg.surgeSens === 0
                    ? "no surge"
                    : `ceiling reached at ${formatBps(Math.round(100_000_000 / cfg.surgeSens))} depth`
                }
                invalid={bad("surgeSens")}
                onChange={(n) => set({ surgeSens: n })}
              />
            </>
          )}

          {blockKey === "autoBurn" && (
            <>
              <NumberField
                label="burn share"
                unit="bps"
                value={cfg.burnBps}
                max={LIMITS.burnBps}
                meaning={`${formatBps(cfg.burnBps)} of the tokens bought`}
                invalid={bad("burnBps")}
                onChange={(n) => set({ burnBps: n })}
              />
              <EthField
                label="minimum buy to trigger"
                value={cfg.burnTriggerWei}
                invalid={bad("burnTriggerWei")}
                onChange={(wei) => set({ burnTriggerWei: wei })}
              />
            </>
          )}

          {blockKey === "lpRewards" && (
            <NumberField
              label="donated to in-range LPs"
              unit="bps"
              value={cfg.lpBps}
              max={LIMITS.ethCutBps}
              meaning={`${formatBps(cfg.lpBps)} of each buy`}
              invalid={bad("lpBps")}
              onChange={(n) => set({ lpBps: n })}
            />
          )}

          {blockKey === "pot" && (
            <>
              <NumberField
                label="into the pot"
                unit="bps"
                value={cfg.potBps}
                max={LIMITS.ethCutBps}
                meaning={`${formatBps(cfg.potBps)} of each buy`}
                invalid={bad("potBps")}
                onChange={(n) => set({ potBps: n })}
              />
              <NumberField
                label="pays out every"
                unit="buys"
                value={cfg.potEveryN}
                min={LIMITS.potEveryNMin}
                max={LIMITS.potEveryNMax}
                meaning={
                  cfg.potEveryN >= 2 ? `the ${ordinal(cfg.potEveryN)} buy wins` : ""
                }
                invalid={bad("potEveryN")}
                onChange={(n) => set({ potEveryN: n })}
              />
              <EthField
                label="minimum buy to count"
                value={cfg.potMinBuyWei}
                onChange={(wei) => set({ potMinBuyWei: wei })}
              />
              <p className="self-end text-[11px] text-faint">
                The counter moves at most once per block. Without that, N−1 dust buys
                and one real buy in a single block would take the pot every time.
              </p>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

/* -- what the stack costs ------------------------------------------------- */

function Cost({ cfg }: { cfg: BlockConfig }) {
  const on = blocksOn(cfg);
  const armed = BLOCK_ORDER.filter((k) => on[k]);
  const gas = gasFor(cfg);
  // Everything taken out of the buyer's ETH before the swap, plus the surcharge
  // the guard window adds on top of the fee while it is open.
  const ethCutBps = cfg.lpBps + cfg.potBps;

  return (
    <Panel title="what this stack costs" ticks bodyClassName="p-4">
      <dl className="space-y-2">
        <Row
          k="taken from each buy"
          v={ethCutBps === 0 ? "nothing" : formatBps(ethCutBps)}
          note={ethCutBps === 0 ? undefined : "LP rewards plus the pot, out of the ETH in"}
        />
        <Row
          k="LP fee"
          v={
            on.surgeFees
              ? `${formatPips(cfg.baseFeePips)} → ${formatPips(cfg.maxFeePips)}`
              : formatPips(cfg.baseFeePips)
          }
          note={on.surgeFees ? "rises with trade depth" : "flat"}
        />
        <Row
          k="burned from the output"
          v={on.autoBurn ? formatBps(cfg.burnBps) : "nothing"}
          note={
            on.autoBurn
              ? `on buys of ${formatEther(cfg.burnTriggerWei)} ETH or more`
              : undefined
          }
        />
        <Row
          k="gas on a buy"
          v={`~${formatCount(gas)}`}
          note={`${formatCount(GAS.base)} base + ${formatCount(gas - GAS.base)} for ${armed.length} block${armed.length === 1 ? "" : "s"}`}
        />
      </dl>
      <p className="mt-3 border-t border-line pt-3 text-[11px] text-faint">
        Gas is measured, not estimated: a 0.1 ETH buy against a 10 ETH pool in{" "}
        <code>test/unit/BlockGas.t.sol</code>, second buy so the storage is warm. Your
        figure moves with the pool, not with this page.
      </p>
    </Panel>
  );
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="q-label shrink-0">{k}</dt>
      <dd className="min-w-0 text-right">
        <span className="text-text">{v}</span>
        {note && <span className="ml-2 text-[11px] text-faint">{note}</span>}
      </dd>
    </div>
  );
}

/* -- a buy, run through the hook's own arithmetic ------------------------- */

function Simulator({ cfg, sim }: { cfg: BlockConfig; sim: Sim }) {
  const { reserve, setReserve, amountIn, setAmountIn, sinceOpen, setSinceOpen, quote } =
    sim;

  const guardOpen = cfg.guardBlocks > 0 && sinceOpen < cfg.guardBlocks;
  // The pool charges its fee on what actually reaches the swap.
  const feeWei = (quote.effectiveIn * BigInt(quote.feePips)) / 1_000_000n;
  const counts = amountIn >= cfg.potMinBuyWei && cfg.potEveryN >= 2;

  return (
    <Panel title="simulate a buy" bodyClassName="p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <EthField label="in-range reserve" value={reserve} onChange={setReserve} />
        <EthField label="buy size" value={amountIn} onChange={setAmountIn} />
      </div>

      <label className="mt-4 block">
        <span className="q-label">blocks since the pool opened</span>
        <input
          type="range"
          min={0}
          max={Math.max(cfg.guardBlocks * 2, 100)}
          value={sinceOpen}
          onChange={(e) => setSinceOpen(Number(e.target.value))}
          className="mt-2 w-full accent-cyan"
        />
        <span className={`mt-1 block ${guardOpen ? "q-hot" : "text-dim"}`}>
          {formatCount(sinceOpen)}
          {guardOpen
            ? ` · guard open for ${formatCount(cfg.guardBlocks - sinceOpen)} more`
            : cfg.guardBlocks > 0
              ? " · guard closed"
              : " · no guard window"}
        </span>
      </label>

      <dl className="mt-4 space-y-2 border-t border-line pt-4">
        <Row k="fee charged" v={formatPips(quote.feePips)} />
        <Row k="to in-range LPs" v={`${formatEth(quote.lpCut, 6)} ETH`} />
        <Row k="to the pot" v={`${formatEth(quote.potCut, 6)} ETH`} />
        <Row k="reaches the swap" v={`${formatEth(quote.effectiveIn, 6)} ETH`} />
        <Row k="of which the fee" v={`${formatEth(feeWei, 6)} ETH`} />
        <Row
          k="burned from the output"
          v={quote.burnBps === 0 ? "nothing" : formatBps(quote.burnBps)}
        />
        <Row
          k="counts toward the pot"
          v={cfg.potEveryN < 2 ? "no pot" : counts ? "yes" : "below the minimum"}
        />
      </dl>

      {quote.exceedsGuardCap && (
        <p className="mt-4 border border-fail/60 px-3 py-2 text-fail">
          The guard window would refuse this buy: BuyExceedsGuardCap. The cap here is{" "}
          {formatEth((reserve * BigInt(cfg.maxBuyBps)) / 10_000n, 6)} ETH.
        </p>
      )}
    </Panel>
  );
}

/* -- the contract's own validation, ahead of time ------------------------- */

function Validation({ issues }: { issues: ReturnType<typeof validate> }) {
  return (
    <Panel
      title="would the hook accept this"
      bodyClassName="p-4"
      right={
        <span className={`q-label ${issues.length === 0 ? "text-cyan" : "text-fail"}`}>
          {issues.length === 0 ? "accepted" : `${issues.length} refused`}
        </span>
      }
    >
      {issues.length === 0 ? (
        <p className="text-dim">
          Every check in <code>BlockHook._validate</code> passes. The chain would take
          this config as written.
        </p>
      ) : (
        <ul className="space-y-3">
          {issues.map((issue, i) => (
            <li key={i}>
              <span className="text-fail">{issue.error}</span>
              <p className="mt-1 text-dim">{issue.message}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 border-t border-line pt-3 text-[11px] text-faint">
        These are the hook&rsquo;s nine checks, in its order, naming the error it would
        revert with. Read them against{" "}
        <a
          className="text-dim underline decoration-line underline-offset-2 hover:text-text"
          href={explorerAddress(ADDRESSES.blockHook)}
          target="_blank"
          rel="noreferrer"
        >
          the deployed hook
        </a>
        .
      </p>
    </Panel>
  );
}

/* -- the config itself ---------------------------------------------------- */

function Output({ cfg }: { cfg: BlockConfig }) {
  const solidity = toSolidity(cfg);
  const tuple = toTuple(cfg);

  return (
    <Panel
      title="the config"
      bodyClassName="p-0"
      right={<CopyButton text={solidity} label="copy struct" />}
    >
      <pre className="overflow-x-auto px-4 py-3 text-[11px] leading-relaxed text-dim">
        {solidity}
      </pre>
      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
        <code className="min-w-0 truncate text-[11px] text-faint">{tuple}</code>
        <CopyButton text={tuple} label="copy tuple" />
      </div>
    </Panel>
  );
}

function Flags() {
  return (
    <Panel title="hook flags" bodyClassName="p-4">
      <p className="q-display-sm text-2xl text-cyan">
        0x{HOOK_FLAGS.toString(16).toUpperCase()}
      </p>
      <div className="mt-3 flex flex-wrap gap-1">
        {HOOK_FLAG_BITS.map((f) => (
          <span
            key={f.bit}
            className="border border-cyan/50 px-1.5 py-0.5 text-[10px] tracking-widest text-cyan"
          >
            {f.name}
          </span>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-faint">
        The low 14 bits of the hook&rsquo;s address, which is how v4 knows which
        callbacks to make. They belong to the deployed contract, not to your config:
        every pool Quench opens is served by the same hook, so this mask never
        changes. Check it against{" "}
        <code className="text-dim">{ADDRESSES.blockHook.slice(-4)}</code> at the end of
        its address.
      </p>
    </Panel>
  );
}

function Publish() {
  return (
    <Panel title="publish" bodyClassName="p-4">
      <button
        type="button"
        disabled
        className="w-full cursor-not-allowed border border-off px-3 py-2 text-off"
      >
        Publish as a blueprint
      </button>
      <p className="mt-3 text-[11px] text-faint">
        This is the one thing on the page that needs a wallet, and wallet
        connection is not built yet. Everything above is finished: it runs the
        same arithmetic the hook runs and refuses what the hook would refuse.
        Until then, copy the struct and launch with it from a script — see{" "}
        <Link className="text-dim underline decoration-line underline-offset-2 hover:text-text" href="/docs">
          the docs
        </Link>
        .
      </p>
    </Panel>
  );
}


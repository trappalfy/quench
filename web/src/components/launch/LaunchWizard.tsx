"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatEther } from "viem";
import { Panel } from "../Panel";
import { CopyButton } from "../builder/CopyButton";
import { TxButton } from "../wallet/TxButton";
import { EthField, NumberField } from "../builder/Field";
import {
  BLOCK_META,
  BLOCK_ORDER,
  EMPTY,
  blocksOn,
  toTuple,
  validate,
  type BlockConfig,
} from "@/lib/hookConfig";
import {
  LAUNCH_SIGNATURES,
  planCurve,
  planInstant,
  tickerProblem,
} from "@/lib/launchMath";
import { ADDRESSES, CONSTANTS } from "@/lib/chain";
import { useWallet } from "@/lib/wallet/WalletContext";
import { browserClient } from "@/lib/client";
import { launchCurve, launchInstant, launchedTokenFromReceipt } from "@/lib/writes/launchpad";
import { formatBps, formatEth, formatPips, formatPrice } from "@/lib/format";

/**
 * Everything about a launch that can be settled before a wallet is involved.
 *
 * A launch fixes three things forever in one transaction — the rules, the
 * opening price and the creator's share — and none of them can be inspected
 * afterwards by anyone who was not watching. So the page computes all three and
 * checks them against the launchpad's own limits before offering a signature —
 * and the launch itself is simulated once more, so a refusal arrives with the
 * contract's error name instead of as a transaction someone already paid for.
 *
 * The same launch is also printed as a `cast send --account` command, for
 * anyone who would rather sign from a keystore on their own machine. This site
 * never asks for a key, a phrase or a password, and there is nowhere here to
 * type one.
 */

type Mode = "instant" | "curve";

export type BlueprintOption = {
  id: string;
  author: string;
  royaltyBps: number;
  cfg: BlockConfig;
};

export function LaunchWizard({
  maxPoolEthWei,
  blueprints,
  carried,
}: {
  maxPoolEthWei: bigint;
  blueprints: BlueprintOption[];
  carried: BlockConfig | null;
}) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [mode, setMode] = useState<Mode>("instant");
  const [blueprintId, setBlueprintId] = useState("0");
  const [ethIn, setEthIn] = useState(10n ** 18n);
  const [floatBps, setFloatBps] = useState(2_000);
  const [p0, setP0] = useState(4n * 10n ** 9n);
  const [creatorFeeBps, setCreatorFeeBps] = useState(5_000);

  const chosen = blueprints.find((b) => b.id === blueprintId) ?? null;
  // A blueprint's config wins outright: `Launchpad._configFor` ignores whatever
  // the caller passed whenever blueprintId is non-zero.
  const cfg = chosen?.cfg ?? carried ?? EMPTY;
  const issues = validate(cfg);
  const on = blocksOn(cfg);

  const instant = useMemo(() => planInstant(ethIn, floatBps), [ethIn, floatBps]);
  const curve = useMemo(() => planCurve(p0, maxPoolEthWei), [p0, maxPoolEthWei]);

  const symbolProblem = tickerProblem(symbol);
  const overCap = mode === "instant" && ethIn > maxPoolEthWei;

  const blockers: string[] = [];
  if (name.trim() === "") blockers.push("The token has no name.");
  if (symbol === "") blockers.push("The token has no ticker.");
  if (symbolProblem) blockers.push(symbolProblem);
  if (issues.length > 0) blockers.push(`The hook config would revert: ${issues[0].error}.`);
  if (overCap)
    blockers.push(
      `The launchpad refuses a pool over ${formatEther(maxPoolEthWei)} ETH — PoolTooLarge.`,
    );
  if (mode === "instant" && instant.problem) blockers.push(instant.problem);
  if (mode === "curve" && curve.problem) blockers.push(curve.problem);
  if (creatorFeeBps > CONSTANTS.maxCreatorFeeBps)
    blockers.push("The creator's share cannot exceed 80% — CreatorFeeTooHigh.");

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
      <div className="min-w-0 space-y-4">
        {/* 01 */}
        <Panel title="01 the token" bodyClassName="p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="q-label">name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seed Instant"
                className="mt-1 w-full border border-line bg-ground px-2 py-1.5 outline-none"
              />
              <span className="mt-1 block text-[11px] text-faint">
                Stored on the token itself, unchangeable.
              </span>
            </label>

            <label className="block">
              <span className="q-label">ticker</span>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="SEED"
                maxLength={12}
                className={`mt-1 w-full border bg-ground px-2 py-1.5 outline-none ${
                  symbolProblem ? "border-fail text-fail" : "border-line"
                }`}
              />
              <span
                className={`mt-1 block text-[11px] ${symbolProblem ? "text-fail" : "text-faint"}`}
              >
                {symbolProblem ?? `${CONSTANTS.tickerMinLength}–${CONSTANTS.tickerMaxLength} characters.`}
              </span>
            </label>
          </div>

          <p className="mt-4 border-t border-line pt-3 text-[11px] text-faint">
            Supply is fixed at one billion and is not a field. The token&rsquo;s mark is
            drawn from its address, which the chain assigns when the launchpad creates
            it — so it cannot be previewed here, and there is nothing to upload.
          </p>
        </Panel>

        {/* 02 */}
        <Panel
          title="02 the hook"
          bodyClassName="p-4"
          right={
            <span className={`q-label ${issues.length === 0 ? "text-cyan" : "text-fail"}`}>
              {issues.length === 0 ? "accepted" : "would revert"}
            </span>
          }
        >
          <label className="block">
            <span className="q-label">source</span>
            <select
              value={blueprintId}
              onChange={(e) => setBlueprintId(e.target.value)}
              className="mt-1 w-full border border-line bg-ground px-2 py-1.5 outline-none"
            >
              <option value="0">
                {carried ? "The config carried from the builder" : "No blueprint — a flat fee and nothing else"}
              </option>
              {blueprints.map((b) => (
                <option key={b.id} value={b.id}>
                  Blueprint {b.id} · {formatBps(b.royaltyBps)} royalty
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 flex flex-wrap gap-1">
            {BLOCK_ORDER.map((key) => (
              <span
                key={key}
                className={`border px-1.5 py-0.5 text-[10px] tracking-widest ${
                  on[key] ? "border-cyan/50 text-cyan" : "border-off/40 text-off"
                }`}
              >
                {BLOCK_META[key].tag}
              </span>
            ))}
          </div>

          <dl className="mt-4 space-y-1.5 border-t border-line pt-3">
            <Row k="flat LP fee" v={formatPips(cfg.baseFeePips)} />
            {on.surgeFees && (
              <Row k="fee ceiling" v={formatPips(cfg.maxFeePips)} />
            )}
            {on.antiSnipe && (
              <Row
                k="guard window"
                v={`${cfg.guardBlocks} blocks · ${formatBps(cfg.maxBuyBps)} cap`}
              />
            )}
            {on.autoBurn && <Row k="auto burn" v={formatBps(cfg.burnBps)} />}
            {on.lpRewards && <Row k="lp rewards" v={formatBps(cfg.lpBps)} />}
            {on.pot && (
              <Row k="pot" v={`${formatBps(cfg.potBps)} · every ${cfg.potEveryN}`} />
            )}
          </dl>

          {chosen && (
            <p className="mt-3 text-[11px] text-faint">
              A blueprint&rsquo;s config is used verbatim — the launchpad ignores
              anything else the caller passes. Its author takes{" "}
              {formatBps(chosen.royaltyBps)} of your fee share.
            </p>
          )}

          <Link
            href="/builder"
            className="q-label mt-4 inline-block border border-line px-3 py-2 hover:border-cyan hover:text-cyan"
          >
            {carried ? "change it in the builder" : "build one"}
          </Link>
        </Panel>

        {/* 03 */}
        <Panel
          title="03 the price"
          bodyClassName="p-4"
          right={
            <span className="flex gap-1">
              {(["instant", "curve"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`border px-2 py-0.5 text-[10px] tracking-widest ${
                    mode === m ? "border-cyan text-cyan" : "border-line text-faint"
                  }`}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </span>
          }
        >
          {mode === "instant" ? (
            <>
              <p className="text-dim">
                The pool opens immediately with your ETH on one side. Whatever supply
                does not fit the position is burned in the same transaction — the float
                is a choice of price, not a separate field.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <EthField
                  label="ETH you commit"
                  value={ethIn}
                  invalid={overCap}
                  onChange={setEthIn}
                />
                <NumberField
                  label="float"
                  unit="bps"
                  value={floatBps}
                  max={10_000}
                  meaning={`${formatBps(floatBps)} of the supply in the pool`}
                  onChange={setFloatBps}
                />
              </div>
              <dl className="mt-4 space-y-1.5 border-t border-line pt-3">
                <Row
                  k="opening price"
                  v={`${formatPrice(instant.openingPriceWei)} ETH/token`}
                />
                <Row k="in the pool" v={`${tokens(instant.tokensInPool)} tokens`} />
                <Row k="burned at launch" v={`${tokens(instant.tokensBurned)} tokens`} />
                <Row k="FDV at open" v={`${formatEth(instant.fdvWei)} ETH`} />
                <Row k="sqrtPriceX96" v={instant.sqrtPriceX96.toString()} small />
              </dl>
            </>
          ) : (
            <>
              <p className="text-dim">
                800,000,000 tokens sell in ten tranches, each priced 1.7× the last. When
                the last one sells out the curve opens the pool itself, at the tenth
                price, with everything it raised.
              </p>
              <div className="mt-4">
                <EthField
                  label="first tranche price, per token"
                  value={p0}
                  invalid={curve.problem !== null}
                  onChange={setP0}
                />
              </div>

              <div className="mt-4 overflow-x-auto border-t border-line pt-3">
                <table className="w-full">
                  <thead>
                    <tr className="q-label text-left">
                      <th className="pb-1 font-normal">tranche</th>
                      <th className="pb-1 text-right font-normal">price</th>
                      <th className="pb-1 text-right font-normal">raises</th>
                    </tr>
                  </thead>
                  <tbody className="text-dim">
                    {curve.prices.map((price, i) => (
                      <tr key={i} className="border-t border-line/60">
                        <td className="py-1">{i + 1} of 10</td>
                        <td className="py-1 text-right">{formatPrice(price)}</td>
                        <td className="py-1 text-right">
                          {formatEth(curve.raises[i])} ETH
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="mt-4 space-y-1.5 border-t border-line pt-3">
                <Row k="full sellout raises" v={`${formatEth(curve.totalRaise)} ETH`} />
                <Row
                  k="opens the pool at"
                  v={`${formatPrice(curve.graduationPriceWei)} ETH/token`}
                />
                <Row
                  k="FDV at graduation"
                  v={`${formatEth(curve.fdvAtGraduationWei)} ETH`}
                />
              </dl>
            </>
          )}

          <div className="mt-6 border-t border-line pt-4">
            <NumberField
              label="your share of the pool's fees"
              unit="bps"
              value={creatorFeeBps}
              max={CONSTANTS.maxCreatorFeeBps}
              meaning={`${formatBps(creatorFeeBps)} to you, ${formatBps(10_000 - creatorFeeBps)} to the protocol`}
              invalid={creatorFeeBps > CONSTANTS.maxCreatorFeeBps}
              onChange={setCreatorFeeBps}
            />
          </div>
        </Panel>
      </div>

      <div className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Fixed
          name={name}
          symbol={symbol}
          mode={mode}
          cfg={cfg}
          creatorFeeBps={creatorFeeBps}
          openingPrice={
            mode === "instant" ? instant.openingPriceWei : curve.graduationPriceWei
          }
        />
        <Blockers blockers={blockers} />
        <Command
          ready={blockers.length === 0}
          mode={mode}
          name={name}
          symbol={symbol}
          cfg={cfg}
          creatorFeeBps={creatorFeeBps}
          blueprintId={blueprintId}
          sqrtPriceX96={instant.sqrtPriceX96}
          p0={p0}
          ethIn={ethIn}
        />
      </div>
    </div>
  );
}

/* -- the right rail ------------------------------------------------------- */

function Fixed({
  name,
  symbol,
  mode,
  cfg,
  creatorFeeBps,
  openingPrice,
}: {
  name: string;
  symbol: string;
  mode: Mode;
  cfg: BlockConfig;
  creatorFeeBps: number;
  openingPrice: bigint;
}) {
  return (
    <Panel title="fixed forever by this transaction" ticks bodyClassName="p-4">
      <dl className="space-y-1.5">
        <Row k="name" v={name || "—"} />
        <Row k="ticker" v={symbol ? `$${symbol}` : "—"} />
        <Row k="supply" v="1,000,000,000" />
        <Row k="rules" v={`${BLOCK_ORDER.filter((k) => blocksOn(cfg)[k]).length} of 5 armed`} />
        <Row k="your fee share" v={formatBps(creatorFeeBps)} />
        <Row
          k={mode === "instant" ? "opening price" : "graduation price"}
          v={`${formatPrice(openingPrice)} ETH`}
        />
      </dl>
      <p className="mt-3 border-t border-line pt-3 text-[11px] text-faint">
        Every line above is written into storage once and read from there
        afterwards. There is no function that changes any of them, and no address
        that could call one if there were.
      </p>
    </Panel>
  );
}

function Blockers({ blockers }: { blockers: string[] }) {
  return (
    <Panel
      title="before you can launch"
      bodyClassName="p-4"
      right={
        <span className={`q-label ${blockers.length === 0 ? "text-cyan" : "text-fail"}`}>
          {blockers.length === 0 ? "ready" : `${blockers.length} left`}
        </span>
      }
    >
      {blockers.length === 0 ? (
        <p className="text-dim">
          Nothing here would revert. What the launchpad checks, this page has checked.
        </p>
      ) : (
        <ul className="space-y-2 text-dim">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Command({
  ready,
  mode,
  name,
  symbol,
  cfg,
  creatorFeeBps,
  blueprintId,
  sqrtPriceX96,
  p0,
  ethIn,
}: {
  ready: boolean;
  mode: Mode;
  name: string;
  symbol: string;
  cfg: BlockConfig;
  creatorFeeBps: number;
  blueprintId: string;
  sqrtPriceX96: bigint;
  p0: bigint;
  ethIn: bigint;
}) {
  const { address, walletClient } = useWallet();
  const router = useRouter();

  // The struct the launchpad takes, as one ABI tuple. Written out in full so it
  // can be checked against the interface rather than trusted.
  const params =
    mode === "instant"
      ? `("${name}","${symbol}",${toTuple(cfg)},${creatorFeeBps},${blueprintId},${sqrtPriceX96})`
      : `("${name}","${symbol}",${toTuple(cfg)},${creatorFeeBps},${blueprintId},${p0})`;

  const signature = LAUNCH_SIGNATURES[mode];

  const lines = [
    `cast send ${ADDRESSES.launchpad}`,
    `  '${signature}'`,
    `  '${params}'`,
    ...(mode === "instant" ? [`  --value ${ethIn}`] : []),
    "  --rpc-url https://rpc.mainnet.chain.robinhood.com",
    "  --account <your-keystore>",
  ];
  const command = lines.join(" \\\n");

  return (
    <Panel
      title="launch"
      bodyClassName="p-4"
      right={ready ? <CopyButton text={command} label="copy command" /> : undefined}
    >
      <TxButton
        label={mode === "instant" ? "Launch and open the pool" : "Launch on a curve"}
        pendingLabel="Launching…"
        doneLabel="Launched. Nothing about it can change now."
        disabled={!ready || !walletClient}
        run={() =>
          mode === "instant"
            ? launchInstant(
                browserClient,
                walletClient!,
                address!,
                {
                  name,
                  symbol,
                  cfg,
                  creatorFeeBps,
                  blueprintId: BigInt(blueprintId),
                  sqrtPriceX96,
                },
                ethIn,
              )
            : launchCurve(browserClient, walletClient!, address!, {
                name,
                symbol,
                cfg,
                creatorFeeBps,
                blueprintId: BigInt(blueprintId),
                p0,
              })
        }
        onDone={(receipt) => {
          // The launchpad returns the token address, but a receipt carries logs
          // and not return values, so it comes from the Launched event.
          const created = launchedTokenFromReceipt(receipt.logs);
          if (created) router.push(`/t/${created}`);
        }}
      >
        {ready
          ? "Simulated against the launchpad first, so a refusal arrives by name rather than as a failed transaction."
          : "Finish the checks above first."}
      </TxButton>

      {ready && (
        <>
          <p className="q-label mt-5">or run it yourself</p>
          <pre className="mt-2 overflow-x-auto border border-line bg-ground p-3 text-[11px] leading-relaxed text-cyan">
            {command}
          </pre>
          <p className="mt-2 text-[11px] text-faint">
            <code className="text-dim">--account</code> reads a keystore on your own
            machine and prompts for its password in your own terminal. Quench never asks
            for a key, a phrase or a password, and there is nowhere on this site to type
            one.
          </p>
        </>
      )}
    </Panel>
  );
}

function Row({ k, v, small = false }: { k: string; v: string; small?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="q-label shrink-0">{k}</dt>
      <dd className={`min-w-0 truncate text-right ${small ? "text-[11px] text-dim" : "text-text"}`}>
        {v}
      </dd>
    </div>
  );
}

function tokens(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

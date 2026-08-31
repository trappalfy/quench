"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, parseEther, type Address } from "viem";
import { Panel } from "../Panel";
import { useWallet } from "@/lib/wallet/WalletContext";
import { browserClient } from "@/lib/client";
import { explainWriteError } from "@/lib/writes/errors";
import {
  DEADLINE_SECONDS,
  approve,
  curveBuy,
  curveSell,
  minAfterSlippage,
  poolBuy,
  poolSell,
  quoteCurveBuy,
  quoteCurveSell,
  quotePoolBuy,
  quotePoolSell,
  readAllowance,
  readBalance,
  spenderFor,
} from "@/lib/writes/trade";
import type { PoolKey } from "@/lib/reads/pool";
import { explorerTx } from "@/lib/chain";
import { formatCompactTokens, formatEth, formatPrice } from "@/lib/format";

/**
 * Buying and selling, with the quote coming from the transaction itself.
 *
 * Every figure below is the return value of an `eth_call` of the exact trade
 * that would be signed, so what the panel promises and what the chain does are
 * the same computation. A trade the chain would refuse never reaches a
 * signature: the refusal is decoded and named here first.
 *
 * The hook's cuts are already inside these numbers. There is no line for "you
 * will also pay 2% to LPs", because the quote is what arrives, not what was
 * asked for.
 */

type Side = "buy" | "sell";
type Venue = "pool" | "curve";

type Stage =
  | { kind: "idle" }
  | { kind: "approving" }
  | { kind: "signing" }
  | { kind: "pending"; hash: `0x${string}` }
  | { kind: "done"; hash: `0x${string}` }
  | { kind: "failed"; name: string | null; message: string };

/// Enough left over to pay for the transaction itself. Gas here is measured in
/// fractions of a cent, so this is deliberately generous rather than tight.
const GAS_RESERVE = 10n ** 15n; // 0.001 ETH

const SLIPPAGE_PRESETS = [50, 100, 500] as const;

export function TradePanel({
  token,
  symbol,
  venue,
  poolKey,
  curve,
}: {
  token: Address;
  symbol: string;
  venue: Venue;
  poolKey: PoolKey;
  curve: Address;
}) {
  const { address, onRightChain, walletClient, switchChain } = useWallet();

  const [side, setSide] = useState<Side>("buy");
  const [text, setText] = useState("0.01");
  const [slippageBps, setSlippageBps] = useState<number>(100);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);

  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteProblem, setQuoteProblem] = useState<string | null>(null);
  const [willGraduate, setWillGraduate] = useState(false);

  const spender = spenderFor(venue, curve);

  const amount = useMemo(() => {
    try {
      return parseEther(text || "0");
    } catch {
      return null;
    }
  }, [text]);

  /* -- balances ---------------------------------------------------------- */

  const refreshBalances = useCallback(async () => {
    if (!address) {
      setEthBalance(null);
      setTokenBalance(null);
      setAllowance(null);
      return;
    }
    const [eth, held, allowed] = await Promise.all([
      browserClient.getBalance({ address }).catch(() => null),
      readBalance(browserClient, token, address).catch(() => null),
      readAllowance(browserClient, token, address, spender).catch(() => null),
    ]);
    setEthBalance(eth);
    setTokenBalance(held);
    setAllowance(allowed);
  }, [address, token, spender]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  /* -- the quote --------------------------------------------------------- */

  const needsApproval =
    side === "sell" && amount !== null && amount > 0n && (allowance ?? 0n) < amount;

  useEffect(() => {
    if (amount === null || amount === 0n) {
      setQuote(null);
      setQuoteProblem(null);
      return;
    }

    // A curve buy is quoted by a view function and needs no account, so it
    // prices before anyone connects. Everything else simulates the real call,
    // which needs a `from` — and a sell also needs the allowance to already be
    // there, or the simulation reverts on the transfer rather than on the swap.
    const canQuote =
      venue === "curve" && side === "buy" ? true : address !== null && !needsApproval;

    if (!canQuote) {
      setQuote(null);
      setQuoteProblem(null);
      return;
    }

    let alive = true;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        let out: bigint;
        if (venue === "curve" && side === "buy") {
          const r = await quoteCurveBuy(browserClient, curve, amount);
          out = r.out;
          if (alive) setWillGraduate(r.graduates);
        } else if (venue === "curve") {
          out = await quoteCurveSell(browserClient, curve, amount, address!);
        } else if (side === "buy") {
          out = await quotePoolBuy(browserClient, poolKey, amount, address!);
        } else {
          out = await quotePoolSell(browserClient, poolKey, amount, address!);
        }
        if (!alive) return;
        setQuote(out);
        setQuoteProblem(null);
      } catch (cause) {
        if (!alive) return;
        setQuote(null);
        setQuoteProblem(explainWriteError(cause).message);
      } finally {
        if (alive) setQuoting(false);
      }
      // Debounced: a quote is a round trip, and one per keystroke would be a
      // request per character typed.
    }, 350);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [amount, side, venue, curve, poolKey, address, needsApproval]);

  /* -- submitting -------------------------------------------------------- */

  const submit = async () => {
    if (!walletClient || !address || amount === null || amount === 0n) return;
    setStage({ kind: "signing" });
    try {
      const minOut = quote === null ? 0n : minAfterSlippage(quote, slippageBps);
      const hash =
        venue === "curve"
          ? side === "buy"
            ? await curveBuy(walletClient, address, curve, amount, minOut)
            : await curveSell(walletClient, address, curve, amount, minOut)
          : side === "buy"
            ? await poolBuy(walletClient, address, poolKey, amount, minOut)
            : await poolSell(walletClient, address, poolKey, amount, minOut);

      setStage({ kind: "pending", hash });
      await browserClient.waitForTransactionReceipt({ hash });
      setStage({ kind: "done", hash });
      void refreshBalances();
    } catch (cause) {
      const { name, message } = explainWriteError(cause);
      setStage({ kind: "failed", name, message });
    }
  };

  const doApprove = async (unlimited: boolean) => {
    if (!walletClient || !address || amount === null) return;
    setStage({ kind: "approving" });
    try {
      const hash = await approve(
        walletClient,
        address,
        token,
        spender,
        unlimited ? "unlimited" : amount,
      );
      setStage({ kind: "pending", hash });
      await browserClient.waitForTransactionReceipt({ hash });
      setStage({ kind: "idle" });
      void refreshBalances();
    } catch (cause) {
      const { name, message } = explainWriteError(cause);
      setStage({ kind: "failed", name, message });
    }
  };

  /* -- render ------------------------------------------------------------ */

  const busy =
    stage.kind === "signing" || stage.kind === "pending" || stage.kind === "approving";
  const inputSuffix = side === "buy" ? "ETH" : symbol;
  const balance = side === "buy" ? ethBalance : tokenBalance;

  return (
    <Panel
      title="trade"
      ticks
      bodyClassName="p-4"
      right={
        <span className="q-label">
          {venue === "curve" ? "on the curve" : "in the pool"}
        </span>
      }
    >
      <div className="flex gap-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSide(s);
              setStage({ kind: "idle" });
              setText(s === "buy" ? "0.01" : "");
            }}
            className={`flex-1 border px-3 py-2 tracking-widest transition-colors ${
              side === s
                ? s === "buy"
                  ? "border-cyan text-cyan"
                  : "border-amber text-amber"
                : "border-line text-faint hover:border-line-bright"
            }`}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      <label className="mt-4 block">
        <span className="flex items-baseline justify-between">
          <span className="q-label">you pay</span>
          {balance !== null && (
            <button
              type="button"
              onClick={() =>
                setText(
                  side === "buy"
                    ? formatEther(balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n)
                    : formatEther(balance),
                )
              }
              className="q-label hover:text-text"
              title={
                side === "buy"
                  ? "Your balance less 0.001 ETH, left for gas"
                  : "Your whole balance"
              }
            >
              max {side === "buy" ? formatEth(balance) : formatCompactTokens(balance)}
            </button>
          )}
        </span>
        <span className="mt-1 flex items-stretch border border-line bg-ground">
          <input
            type="text"
            inputMode="decimal"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (stage.kind === "failed" || stage.kind === "done") setStage({ kind: "idle" });
            }}
            placeholder="0.0"
            className="w-full min-w-0 bg-transparent px-2 py-2 outline-none"
          />
          <span className="q-label shrink-0 self-center border-l border-line px-2 py-2">
            {inputSuffix}
          </span>
        </span>
        {amount === null && (
          <span className="mt-1 block text-[11px] text-fail">Not a number.</span>
        )}
      </label>

      <div className="mt-4 border-t border-line pt-3">
        <Row
          k="you receive"
          v={
            quoting
              ? "…"
              : quote === null
                ? "—"
                : side === "buy"
                  ? `${formatCompactTokens(quote)} ${symbol}`
                  : `${formatEth(quote, 6)} ETH`
          }
        />
        {quote !== null && amount !== null && amount > 0n && (
          <Row
            k="at"
            v={
              side === "buy"
                ? `${formatPrice((amount * 10n ** 18n) / (quote === 0n ? 1n : quote))} ETH each`
                : `${formatPrice((quote * 10n ** 18n) / (amount === 0n ? 1n : amount))} ETH each`
            }
          />
        )}
        <Row
          k="at worst"
          v={
            quote === null
              ? "—"
              : side === "buy"
                ? `${formatCompactTokens(minAfterSlippage(quote, slippageBps))} ${symbol}`
                : `${formatEth(minAfterSlippage(quote, slippageBps), 6)} ETH`
          }
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="q-label">slippage</span>
        <span className="flex gap-1">
          {SLIPPAGE_PRESETS.map((bps) => (
            <button
              key={bps}
              type="button"
              onClick={() => setSlippageBps(bps)}
              className={`border px-2 py-0.5 text-[11px] ${
                slippageBps === bps
                  ? "border-cyan text-cyan"
                  : "border-line text-faint hover:border-line-bright"
              }`}
            >
              {bps / 100}%
            </button>
          ))}
        </span>
      </div>

      {willGraduate && side === "buy" && venue === "curve" && (
        <p className="mt-4 border-l-2 border-amber px-3 py-2 text-dim">
          This buy sells out the last tranche. The curve opens the pool in the same
          transaction, and the hook&rsquo;s anti-snipe window starts from that block.
        </p>
      )}

      {quoteProblem && (
        <p className="mt-4 border border-fail/60 px-3 py-2 text-fail">{quoteProblem}</p>
      )}

      <div className="mt-4">
        {!address ? (
          <p className="text-dim">
            Connect a wallet to trade. The quote above needs an address to simulate
            from — nothing is signed until you press a button that says so.
          </p>
        ) : !onRightChain ? (
          <button
            type="button"
            onClick={switchChain}
            className="w-full border border-amber px-3 py-2 text-amber transition-colors hover:bg-amber hover:text-ground"
          >
            Switch to Robinhood Chain
          </button>
        ) : needsApproval ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => doApprove(false)}
              className="w-full border border-cyan px-3 py-2 text-cyan transition-colors hover:bg-cyan hover:text-ground disabled:opacity-50"
            >
              {stage.kind === "approving" ? "Approving…" : `Approve ${text} ${symbol}`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => doApprove(true)}
              className="q-label mt-2 w-full border border-line px-3 py-1.5 hover:border-line-bright disabled:opacity-50"
            >
              or approve without a limit
            </button>
            <p className="mt-2 text-[11px] text-faint">
              Approving exactly what you are selling means a future bug in the
              {venue === "pool" ? " router" : " curve"} cannot take more than this
              trade. An unlimited approval is one signature fewer and one more thing
              to trust.
            </p>
          </>
        ) : (
          <button
            type="button"
            disabled={busy || quote === null || amount === null || amount === 0n}
            onClick={submit}
            className={`w-full border px-3 py-2 transition-colors disabled:opacity-40 ${
              side === "buy"
                ? "border-cyan text-cyan hover:bg-cyan hover:text-ground"
                : "border-amber text-amber hover:bg-amber hover:text-ground"
            }`}
          >
            {stage.kind === "signing"
              ? "Waiting for your wallet…"
              : stage.kind === "pending"
                ? "Sent, waiting for the block…"
                : side === "buy"
                  ? `Buy ${symbol}`
                  : `Sell ${symbol}`}
          </button>
        )}
      </div>

      {stage.kind === "done" && (
        <p className="mt-3 border-l-2 border-cyan px-3 py-2 text-dim">
          Confirmed.{" "}
          <a
            className="text-cyan underline decoration-line underline-offset-2"
            href={explorerTx(stage.hash)}
            target="_blank"
            rel="noreferrer"
          >
            See it on the explorer
          </a>
        </p>
      )}

      {stage.kind === "failed" && (
        <div className="mt-3 border border-fail/60 px-3 py-2">
          {stage.name && <p className="text-fail">{stage.name}</p>}
          <p className={stage.name ? "mt-1 text-dim" : "text-fail"}>{stage.message}</p>
        </div>
      )}

      <p className="mt-4 border-t border-line pt-3 text-[11px] text-faint">
        Quotes come from simulating the exact call, so the hook&rsquo;s cuts are already
        inside the figure you see. Trades expire {Number(DEADLINE_SECONDS) / 60} minutes
        after you sign.
      </p>
    </Panel>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="q-label shrink-0">{k}</dt>
      <dd className="min-w-0 truncate text-right text-text">{v}</dd>
    </div>
  );
}

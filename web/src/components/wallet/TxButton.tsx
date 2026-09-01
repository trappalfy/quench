"use client";

import { useState } from "react";
import type { Hex, TransactionReceipt } from "viem";
import { useWallet } from "@/lib/wallet/WalletContext";
import { browserClient } from "@/lib/client";
import { explainWriteError } from "@/lib/writes/errors";
import { explorerTx } from "@/lib/chain";

/**
 * One button, one transaction, one state machine.
 *
 * Publishing a blueprint, launching a token and claiming fees are three
 * different calls with identical lives: connect, switch chain, sign, wait,
 * report. Written once, so a fix to the awkward part — a rejection that must
 * not read as an error, a receipt that has to come back before anything is
 * claimed — lands in all three.
 *
 * It never says "done" before the receipt. A hash is a transaction that was
 * sent, not one that worked.
 */

type Stage =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "pending"; hash: Hex }
  | { kind: "done"; hash: Hex }
  | { kind: "failed"; name: string | null; message: string };

export function TxButton({
  label,
  pendingLabel,
  doneLabel = "Confirmed.",
  disabled = false,
  tone = "cyan",
  run,
  onDone,
  children,
}: {
  label: string;
  pendingLabel: string;
  doneLabel?: string;
  disabled?: boolean;
  tone?: "cyan" | "amber";
  run: () => Promise<Hex>;
  onDone?: (receipt: TransactionReceipt) => void;
  /// Extra copy shown under the button, whatever the stage.
  children?: React.ReactNode;
}) {
  const { address, onRightChain, switchChain } = useWallet();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  const busy = stage.kind === "signing" || stage.kind === "pending";

  const go = async () => {
    setStage({ kind: "signing" });
    try {
      const hash = await run();
      setStage({ kind: "pending", hash });
      const receipt = await browserClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        setStage({
          kind: "failed",
          name: null,
          message: "The transaction was mined and reverted. Nothing changed.",
        });
        return;
      }
      setStage({ kind: "done", hash });
      onDone?.(receipt);
    } catch (cause) {
      const { name, message } = explainWriteError(cause);
      setStage({ kind: "failed", name, message });
    }
  };

  const border = tone === "amber" ? "border-amber text-amber hover:bg-amber" : "border-cyan text-cyan hover:bg-cyan";

  return (
    <div>
      {!address ? (
        <p className="text-dim">
          Connect a wallet to sign this. Everything above is computed without one.
        </p>
      ) : !onRightChain ? (
        <button
          type="button"
          onClick={switchChain}
          className="w-full border border-amber px-3 py-2 text-amber transition-colors hover:bg-amber hover:text-ground"
        >
          Switch to Robinhood Chain
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={go}
          className={`w-full border px-3 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${border} hover:text-ground`}
        >
          {stage.kind === "signing"
            ? "Waiting for your wallet…"
            : stage.kind === "pending"
              ? pendingLabel
              : label}
        </button>
      )}

      {children && <div className="mt-3 text-[11px] text-faint">{children}</div>}

      {stage.kind === "done" && (
        <p className="mt-3 border-l-2 border-cyan px-3 py-2 text-dim">
          {doneLabel}{" "}
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
    </div>
  );
}

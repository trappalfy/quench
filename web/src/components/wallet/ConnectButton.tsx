"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletContext";
import { truncateAddress } from "@/lib/format";
import { robinhood } from "@/lib/chain";

/**
 * The connect control, and the modal behind it.
 *
 * Written here rather than taken from a wallet kit. The kits arrive with their
 * own rounded, shadowed visual language, and in a page built out of hairlines
 * and right angles a foreign modal is the first thing the eye finds. This is
 * about a hundred lines and it looks like the rest of the site.
 *
 * Nothing here asks for a key, a phrase or a password, and there is no field
 * that would accept one. The wallet signs; this only ever hands it a request.
 */
export function ConnectButton() {
  const { address, chainId, onRightChain, disconnect, switchChain } = useWallet();
  const [open, setOpen] = useState(false);

  if (!address) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="border border-cyan px-3 py-1 text-[11px] tracking-widest text-cyan transition-colors hover:bg-cyan hover:text-ground"
        >
          CONNECT
        </button>
        {open && <ConnectModal onClose={() => setOpen(false)} />}
      </>
    );
  }

  if (!onRightChain) {
    return (
      <button
        type="button"
        onClick={switchChain}
        className="q-hot border border-amber px-3 py-1 text-[11px] tracking-widest"
        title={`Connected to chain ${chainId}. Quench is on ${robinhood.id}.`}
      >
        WRONG CHAIN
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-line-bright px-3 py-1 text-[11px] tracking-widest text-dim hover:text-text"
      >
        {truncateAddress(address, 6, 4)}
      </button>
      {open && (
        <ConnectModal
          onClose={() => setOpen(false)}
          onDisconnect={() => {
            disconnect();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function ConnectModal({
  onClose,
  onDisconnect,
}: {
  onClose: () => void;
  onDisconnect?: () => void;
}) {
  const { wallets, connect, connecting, error, clearError, address, selected } = useWallet();
  const panel = useRef<HTMLDivElement>(null);

  // Escape closes, and focus moves into the dialog so a keyboard can reach it
  // at all. Without this the modal is unusable without a mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-ground/80 p-4 pt-24 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Connect a wallet"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm border border-line-bright bg-panel outline-none"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="q-label">/ {address ? "wallet" : "connect"}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="q-label hover:text-text"
          >
            ESC
          </button>
        </header>

        <div className="p-4">
          {address ? (
            <>
              <p className="q-label">connected</p>
              <p className="mt-1 break-all text-text">{address}</p>
              <p className="mt-1 text-[11px] text-faint">via {selected?.name}</p>
              <button
                type="button"
                onClick={onDisconnect}
                className="mt-4 w-full border border-line px-3 py-2 hover:border-fail hover:text-fail"
              >
                Forget this wallet
              </button>
              <p className="mt-3 text-[11px] text-faint">
                This forgets it here. Your wallet still lists the site as connected
                until you revoke it there — no site can do that for you.
              </p>
            </>
          ) : wallets.length === 0 ? (
            <p className="text-dim">
              No wallet announced itself to this page. Install a browser wallet, or
              use the <code className="text-text">cast</code> command each page offers
              instead — it signs with a keystore on your own machine.
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {wallets.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      disabled={connecting}
                      onClick={async () => {
                        clearError();
                        await connect(w);
                        onClose();
                      }}
                      className="flex w-full items-center gap-3 border border-line px-3 py-2 text-left transition-colors hover:border-cyan hover:text-cyan disabled:opacity-50"
                    >
                      {w.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={w.icon} alt="" className="h-5 w-5 shrink-0" />
                      ) : (
                        <span className="h-5 w-5 shrink-0 border border-line-bright" />
                      )}
                      <span className="min-w-0 truncate">{w.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[11px] text-faint">
                Quench never asks for a private key, a seed phrase or a keystore
                password, and has no field that would take one. Connecting shares your
                address; every transaction is signed in your wallet and broadcast by
                it.
              </p>
            </>
          )}

          {error && (
            <p className="mt-4 border border-fail/60 px-3 py-2 text-fail">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

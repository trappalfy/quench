"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,

  useState,
} from "react";
import type { Address, WalletClient } from "viem";
import { robinhood } from "../chain";
import { discoverWallets, type WalletOption } from "./providers";
import { describeProviderError } from "./messages";

/**
 * Wallet state for the whole app.
 *
 * Deliberately small. It knows which provider was chosen, which account it
 * returned and which chain it is on, and it can ask that provider to switch to
 * Robinhood Chain. It does not sign, quote, or send anything — those live with
 * the actions that need them, so this file never has to know what a trade is.
 *
 * There is no key material here and nowhere to put one. The provider signs; we
 * only ever hand it a transaction and wait.
 */

export type WalletState = {
  wallets: WalletOption[];
  /// The chosen wallet, once someone has chosen one.
  selected: WalletOption | null;
  address: Address | null;
  chainId: number | null;
  onRightChain: boolean;
  connecting: boolean;
  /// The last thing that went wrong, in words a person can act on.
  error: string | null;
  walletClient: WalletClient | null;
  connect: (wallet: WalletOption) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  clearError: () => void;
};

const WalletCtx = createContext<WalletState | null>(null);

/// Remembers only which wallet was used, never an address. The address comes
/// back from the provider on reconnect or it does not come back at all.
const REMEMBERED = "quench.wallet";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [selected, setSelected] = useState<WalletOption | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => discoverWallets(setWallets), []);

  const attach = useCallback((wallet: WalletOption, account: Address, chain: number) => {
    setSelected(wallet);
    setAddress(account);
    setChainId(chain);
    try {
      localStorage.setItem(REMEMBERED, wallet.id);
    } catch {
      // A browser that refuses storage still connects; it just will not
      // reconnect by itself next time.
    }
  }, []);

  const connect = useCallback(
    async (wallet: WalletOption) => {
      setConnecting(true);
      setError(null);
      try {
        const accounts = (await wallet.provider.request({
          method: "eth_requestAccounts",
        })) as Address[];
        if (!accounts?.length) throw new Error("The wallet returned no account.");

        const chainHex = (await wallet.provider.request({ method: "eth_chainId" })) as string;
        attach(wallet, accounts[0], Number(BigInt(chainHex)));
      } catch (cause) {
        setError(describeProviderError(cause));
      } finally {
        setConnecting(false);
      }
    },
    [attach],
  );

  const disconnect = useCallback(() => {
    // EIP-1193 has no disconnect. This forgets the wallet on our side; the
    // extension still considers the site connected until the person revokes it
    // there, and the modal says so rather than implying otherwise.
    setSelected(null);
    setAddress(null);
    setChainId(null);
    setError(null);
    try {
      localStorage.removeItem(REMEMBERED);
    } catch {}
  }, []);

  const switchChain = useCallback(async () => {
    if (!selected) return;
    const hex = `0x${robinhood.id.toString(16)}`;
    setError(null);
    try {
      await selected.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hex }],
      });
    } catch (cause) {
      // 4902 means the wallet has never heard of this chain. Offering to add it
      // is the only way forward, and the parameters are the ones this site
      // already reads from.
      if (isUnknownChain(cause)) {
        try {
          await selected.provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hex,
                chainName: robinhood.name,
                nativeCurrency: robinhood.nativeCurrency,
                rpcUrls: [robinhood.rpcUrls.default.http[0]],
                blockExplorerUrls: [robinhood.blockExplorers.default.url],
              },
            ],
          });
        } catch (addCause) {
          setError(describeProviderError(addCause));
          return;
        }
      } else {
        setError(describeProviderError(cause));
        return;
      }
    }
    const chainHex = (await selected.provider.request({ method: "eth_chainId" })) as string;
    setChainId(Number(BigInt(chainHex)));
  }, [selected]);

  // Reconnect only if the wallet still has an account for us. eth_accounts does
  // not prompt, so a page load never opens a wallet popup.
  useEffect(() => {
    if (selected || wallets.length === 0) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(REMEMBERED);
    } catch {}
    if (!remembered) return;

    const wallet = wallets.find((w) => w.id === remembered);
    if (!wallet) return;

    let alive = true;
    void (async () => {
      try {
        const accounts = (await wallet.provider.request({ method: "eth_accounts" })) as Address[];
        if (!alive || !accounts?.length) return;
        const chainHex = (await wallet.provider.request({ method: "eth_chainId" })) as string;
        attach(wallet, accounts[0], Number(BigInt(chainHex)));
      } catch {
        // Nothing to tell the user: they did not ask for this.
      }
    })();
    return () => {
      alive = false;
    };
  }, [wallets, selected, attach]);

  // The account and the chain can change in the wallet while the page sits
  // there. Following those events is the difference between a stale address and
  // a transaction sent from one the user no longer means to use.
  useEffect(() => {
    const provider = selected?.provider;
    if (!provider?.on) return;

    const onAccounts = (...args: never[]) => {
      const accounts = args[0] as unknown as Address[];
      if (!accounts?.length) disconnect();
      else setAddress(accounts[0]);
    };
    const onChain = (...args: never[]) => {
      setChainId(Number(BigInt(args[0] as unknown as string)));
    };

    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [selected, disconnect]);

  /**
   * Built only once somebody has connected, and imported only then.
   *
   * This provider sits in the root layout, so a static import of viem here put
   * it in the chunk every page loads — sixty-five kilobytes on the docs, which
   * will never sign anything. Nothing needs a wallet client until there is a
   * wallet, and by then the person has clicked a button and can afford a
   * module.
   */
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);

  useEffect(() => {
    if (!selected || !address) {
      setWalletClient(null);
      return;
    }
    let alive = true;
    void (async () => {
      const { createWalletClient, custom } = await import("viem");
      if (!alive) return;
      setWalletClient(
        createWalletClient({
          account: address,
          chain: robinhood,
          transport: custom(selected.provider as Parameters<typeof custom>[0]),
        }),
      );
    })();
    return () => {
      alive = false;
    };
  }, [selected, address]);

  const value: WalletState = {
    wallets,
    selected,
    address,
    chainId,
    onRightChain: chainId === robinhood.id,
    connecting,
    error,
    walletClient,
    connect,
    disconnect,
    switchChain,
    clearError: () => setError(null),
  };

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}

function isUnknownChain(cause: unknown): boolean {
  const code = (cause as { code?: number })?.code;
  return code === 4902 || code === -32603;
}


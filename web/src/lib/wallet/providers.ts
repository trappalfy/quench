/**
 * Finding the wallets a browser actually has, by EIP-6963.
 *
 * The old way — reach for `window.ethereum` — breaks the moment someone has two
 * wallets installed: they fight over the same property and whichever won last
 * is the one you get. EIP-6963 has each extension announce itself with a name,
 * an icon and its own provider object, so the choice belongs to the person
 * rather than to load order.
 *
 * `window.ethereum` is still offered, but only when nothing announced itself,
 * and it is labelled as the injected provider rather than given a name we would
 * be guessing at.
 */

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
};

export type WalletOption = {
  /// EIP-6963's uuid, or "injected" for the fallback.
  id: string;
  name: string;
  /// A data: URI from the announcement. Never fetched from the network.
  icon: string | null;
  provider: Eip1193Provider;
};

type AnnounceEvent = CustomEvent<{
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}>;

/**
 * Listens for announcements and asks for them, in that order.
 *
 * Wallets announce on request *and* on page load, so a listener attached after
 * the load event would miss the early ones — hence the request afterwards.
 * Returns an unsubscribe.
 */
export function discoverWallets(onChange: (wallets: WalletOption[]) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const found = new Map<string, WalletOption>();

  const emit = () => onChange([...found.values()]);

  const handler = (event: Event) => {
    const { info, provider } = (event as AnnounceEvent).detail;
    if (!info?.uuid || found.has(info.uuid)) return;
    found.set(info.uuid, {
      id: info.uuid,
      name: info.name,
      // Announcements carry a data: URI. Anything else would be a request to a
      // third party from a page that makes a point of not making them.
      icon: info.icon?.startsWith("data:") ? info.icon : null,
      provider,
    });
    emit();
  };

  window.addEventListener("eip6963:announceProvider", handler);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  // A wallet that has not adopted EIP-6963 yet still deserves to work, but it
  // only gets a place in the list if nobody announced — otherwise it appears
  // twice under a name we made up.
  const legacyTimer = setTimeout(() => {
    const injected = (window as { ethereum?: Eip1193Provider }).ethereum;
    if (found.size === 0 && injected) {
      found.set("injected", {
        id: "injected",
        name: "Injected wallet",
        icon: null,
        provider: injected,
      });
      emit();
    }
  }, 300);

  return () => {
    window.removeEventListener("eip6963:announceProvider", handler);
    clearTimeout(legacyTimer);
  };
}

import { defineChain } from "viem";

/// Robinhood Chain. An Arbitrum Orbit (Nitro) network, ArbOS 116, ~0.1s blocks,
/// so a 24h window spans roughly 860,000 blocks — never assume a block rate,
/// bisect timestamps instead.
export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

/// Deployed 2026-08-31 in block 50,723,079. Every link between these is
/// immutable, so these addresses are constants, not configuration.
/// See docs/superpowers/specs/2026-08-31-deployed-addresses.md.
export const ADDRESSES = {
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  launchpad: "0x5eE09DF35b6C3503D8fAc6A2863aFd4edBC73a6c",
  blockHook: "0x011a41285314efFE83de63404Aa759a85472E8Cc",
  boundedRouter: "0xD689c128506611e05bf72212eA94B7Df4f9C7C17",
  hookDeployer: "0xeD4856D6CB5883FBC591217482101AE4c5276831",
  potVault: "0x02007750325A4311043CFDEb67Fce87eBe10A380",
  curveImplementation: "0xc149D722195b4915aBf2a64cbBe0e54205119D66",
} as const;

export const DEPLOY_BLOCK = 50_723_079n;

/// Hardcoded in the contracts and unchangeable. Mirrored here so the UI can
/// show them without a round trip; anything that could drift is read instead.
export const CONSTANTS = {
  totalSupply: 1_000_000_000n * 10n ** 18n,
  graduationSupply: 200_000_000n * 10n ** 18n,
  curveSupply: 800_000_000n * 10n ** 18n,
  tranches: 10,
  trancheSize: 80_000_000n * 10n ** 18n,
  curveFeeBps: 100,
  maxCreatorFeeBps: 8_000,
  maxRoyaltyBps: 2_000,
  tickSpacing: 60,
  /// Our product rule, not a contract limit: the chain accepts any string.
  tickerMinLength: 3,
  tickerMaxLength: 5,
} as const;

export const DEAD = "0x000000000000000000000000000000000000dEaD" as const;

export function explorerAddress(address: string): string {
  return `${robinhood.blockExplorers.default.url}/address/${address}`;
}

export function explorerTx(hash: string): string {
  return `${robinhood.blockExplorers.default.url}/tx/${hash}`;
}

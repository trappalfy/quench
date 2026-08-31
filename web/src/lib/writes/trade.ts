import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { maxUint256 } from "viem";
import { BondingCurveAbi, BoundedRouterAbi, LaunchTokenAbi } from "../abi";
import { ADDRESSES } from "../chain";
import type { PoolKey } from "../reads/pool";

/**
 * Trading, quoted by simulation rather than by reimplementation.
 *
 * There is no v4 quoter deployed on this chain, and writing Uniswap's swap
 * maths in TypeScript to fill the gap would be exactly the second source of
 * truth this project keeps refusing. So a quote here is an `eth_call` of the
 * very transaction that would be sent, and the number shown is the number that
 * function returns. It costs one round trip and it cannot drift.
 *
 * That has a second effect worth stating: a trade the chain would reject is
 * rejected here, by name, before anyone signs anything.
 */

/// How long a trade stays valid after it is signed. Long enough to survive a
/// slow wallet, short enough that a stuck transaction expires instead of
/// landing at a price nobody agreed to.
export const DEADLINE_SECONDS = 300n;

export function deadlineFromNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_SECONDS;
}

/// The floor a trade must clear, given a quote and a tolerance in basis points.
/// Rounds down, so the bound is never looser than the tolerance asked for.
export function minAfterSlippage(quoted: bigint, slippageBps: number): bigint {
  if (quoted <= 0n) return 0n;
  return (quoted * BigInt(10_000 - slippageBps)) / 10_000n;
}

export type Quote = {
  /// What the trade returns: tokens for a buy, wei for a sell.
  out: bigint;
  /// Set when the chain refused the simulation. `out` is 0 and nothing should
  /// be offered for signature.
  problem: { name: string | null; message: string } | null;
};

/* -- pool ----------------------------------------------------------------- */

export async function quotePoolBuy(
  client: PublicClient,
  key: PoolKey,
  ethIn: bigint,
  account: Address,
): Promise<bigint> {
  const { result } = await client.simulateContract({
    address: ADDRESSES.boundedRouter,
    abi: BoundedRouterAbi,
    functionName: "buy",
    // A quote asks what the trade returns, so its own floor is zero. The floor
    // the user signs is computed from this answer, not passed into it.
    args: [key, 0n, account, deadlineFromNow()],
    value: ethIn,
    account,
  });
  return result as bigint;
}

export async function quotePoolSell(
  client: PublicClient,
  key: PoolKey,
  tokensIn: bigint,
  account: Address,
): Promise<bigint> {
  const { result } = await client.simulateContract({
    address: ADDRESSES.boundedRouter,
    abi: BoundedRouterAbi,
    functionName: "sell",
    args: [key, tokensIn, 0n, account, deadlineFromNow()],
    account,
  });
  return result as bigint;
}

export async function poolBuy(
  wallet: WalletClient,
  account: Address,
  key: PoolKey,
  ethIn: bigint,
  minOut: bigint,
): Promise<Hex> {
  return wallet.writeContract({
    address: ADDRESSES.boundedRouter,
    abi: BoundedRouterAbi,
    functionName: "buy",
    args: [key, minOut, account, deadlineFromNow()],
    value: ethIn,
    account,
    chain: wallet.chain,
  });
}

export async function poolSell(
  wallet: WalletClient,
  account: Address,
  key: PoolKey,
  tokensIn: bigint,
  minEthOut: bigint,
): Promise<Hex> {
  return wallet.writeContract({
    address: ADDRESSES.boundedRouter,
    abi: BoundedRouterAbi,
    functionName: "sell",
    args: [key, tokensIn, minEthOut, account, deadlineFromNow()],
    account,
    chain: wallet.chain,
  });
}

/* -- curve ---------------------------------------------------------------- */

/// The curve carries its own view quoter, so a buy needs no simulation and no
/// connected account — the panel can price a trade before anyone connects.
export async function quoteCurveBuy(
  client: PublicClient,
  curve: Address,
  ethIn: bigint,
): Promise<{ out: bigint; graduates: boolean }> {
  const [tokensOut, , graduates] = (await client.readContract({
    address: curve,
    abi: BondingCurveAbi,
    functionName: "quoteBuy",
    args: [ethIn],
  })) as [bigint, bigint, boolean];
  return { out: tokensOut, graduates };
}

/// There is no view quoter for a sell — the curve walks back down the tranches
/// inside the call — so this simulates the real one.
export async function quoteCurveSell(
  client: PublicClient,
  curve: Address,
  tokensIn: bigint,
  account: Address,
): Promise<bigint> {
  const { result } = await client.simulateContract({
    address: curve,
    abi: BondingCurveAbi,
    functionName: "sell",
    args: [tokensIn, 0n],
    account,
  });
  return result as bigint;
}

export async function curveBuy(
  wallet: WalletClient,
  account: Address,
  curve: Address,
  ethIn: bigint,
  minTokensOut: bigint,
): Promise<Hex> {
  return wallet.writeContract({
    address: curve,
    abi: BondingCurveAbi,
    functionName: "buy",
    args: [minTokensOut, account],
    value: ethIn,
    account,
    chain: wallet.chain,
  });
}

export async function curveSell(
  wallet: WalletClient,
  account: Address,
  curve: Address,
  tokensIn: bigint,
  minEthOut: bigint,
): Promise<Hex> {
  return wallet.writeContract({
    address: curve,
    abi: BondingCurveAbi,
    functionName: "sell",
    args: [tokensIn, minEthOut],
    account,
    chain: wallet.chain,
  });
}

/* -- the ERC20 side ------------------------------------------------------- */

export async function readBalance(
  client: PublicClient,
  token: Address,
  owner: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: LaunchTokenAbi,
    functionName: "balanceOf",
    args: [owner],
  }) as Promise<bigint>;
}

export async function readAllowance(
  client: PublicClient,
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: LaunchTokenAbi,
    functionName: "allowance",
    args: [owner, spender],
  }) as Promise<bigint>;
}

/**
 * Approve exactly what is being sold, not everything forever.
 *
 * An unlimited approval is one compromised contract away from an empty wallet,
 * and it buys convenience this site does not need: a sell is a deliberate act
 * that already costs a signature, so it can carry its own approval. The
 * unlimited option exists for people who want it and is not the default.
 */
export async function approve(
  wallet: WalletClient,
  account: Address,
  token: Address,
  spender: Address,
  amount: bigint | "unlimited",
): Promise<Hex> {
  return wallet.writeContract({
    address: token,
    abi: LaunchTokenAbi,
    functionName: "approve",
    args: [spender, amount === "unlimited" ? maxUint256 : amount],
    account,
    chain: wallet.chain,
  });
}

/// Who has to be approved to move the tokens, which is not the same contract
/// for the two venues: the pool goes through the router, a curve takes them
/// itself.
export function spenderFor(venue: "pool" | "curve", curve: Address): Address {
  return venue === "pool" ? ADDRESSES.boundedRouter : curve;
}

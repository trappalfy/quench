import { decodeErrorResult, type Hex } from "viem";
import {
  BlockHookAbi,
  BondingCurveAbi,
  BoundedRouterAbi,
  LaunchTokenAbi,
  LaunchpadAbi,
  PoolManagerAbi,
  PotVaultAbi,
} from "../abi";
import { describeProviderError } from "../wallet/messages";

/**
 * Turning a revert into a sentence.
 *
 * Every write on this site is simulated before it is offered, so most reverts
 * are caught here rather than on chain. What comes back is a four-byte selector
 * — `0xde8a16cb` means nothing to anyone — so it is decoded against our own
 * ABIs and given the explanation the contract is too small to carry.
 *
 * An error we cannot name is shown by name and selector rather than replaced by
 * "something went wrong". A user who can see `BadPotEveryN` can search for it;
 * a user who sees "transaction failed" cannot.
 */

const ABIS = [
  BlockHookAbi,
  LaunchpadAbi,
  BoundedRouterAbi,
  BondingCurveAbi,
  PotVaultAbi,
  LaunchTokenAbi,
  PoolManagerAbi,
] as const;

/// Why each of our reverts happens, in terms of the thing the person just did.
/// Only errors a user can actually provoke are here; the rest fall through to
/// their name, which is still better than a selector.
const EXPLAINED: Record<string, string> = {
  // BoundedRouter
  TooLittleReceived:
    "The trade would return less than your slippage allows. Someone moved the price between the quote and the signature — raise the tolerance or try a smaller size.",
  TooMuchSpent: "The trade would cost more ETH than you attached.",
  Expired: "The deadline passed before the transaction landed. Try again.",
  NoRecipient: "No recipient address was set.",

  // BlockHook
  BuyExceedsGuardCap:
    "The anti-snipe window is still open and this buy is over its cap. Buy less, or wait for the window to close.",

  // BondingCurve
  AlreadyGraduated:
    "This curve sold out and opened its pool. Trade the pool instead — the curve is closed for good.",
  NothingToTrade: "There is nothing to trade at that size.",

  // Launchpad
  PoolTooLarge: "The launchpad caps how much ETH a pool can open with, and this is over it.",
  CreatorFeeTooHigh: "A creator's share of the fees cannot exceed 80%.",
  RoyaltyTooHigh: "A blueprint royalty cannot exceed 20%.",
  HookNotDeployed: "The hook is not deployed on this chain.",
  UnknownToken: "The launchpad has no record of that token.",
  NoLiquidity:
    "That combination of ETH and price binds no liquidity. Move the float or the amount.",
  TransferFailed: "A transfer inside the transaction failed.",

  // BlockHook._validate — reachable if a config is submitted from outside the
  // builder, which checks all nine before offering the button.
  BadFeeBounds: "The fee ceiling is below the floor, or above the 10% maximum.",
  EthCutTooLarge: "LP rewards and the pot together cannot exceed 10% of a buy.",
  SnipeTaxTooLarge: "The snipe surcharge cannot exceed 5%.",
  BurnTooLarge: "The burn cannot exceed 10% of the tokens bought.",
  GuardTooLong: "The guard window cannot exceed 7,200 blocks.",
  BadPotEveryN: "The pot pays out on every 2nd buy at the soonest and every 1,000th at the latest.",
  BadMaxBuyBps: "A guard window has to cap the buy size.",
  BurnNeedsTrigger: "A burn needs a minimum buy size.",

  // PotVault
  NotHook: "Only the hook can move the pot.",
};

export type WriteError = {
  /// The Solidity error name where we could decode one.
  name: string | null;
  message: string;
};

/**
 * Best effort, in order: a wallet-level problem (rejection, pending request),
 * then a decoded custom error, then whatever the node said.
 */
export function explainWriteError(cause: unknown): WriteError {
  const code = (cause as { code?: number })?.code;
  if (code === 4001 || code === -32002) {
    return { name: null, message: describeProviderError(cause) };
  }

  const data = findRevertData(cause);
  if (data) {
    const decoded = decodeCustomError(data);
    if (decoded) return decoded;
  }

  return { name: null, message: describeProviderError(cause) };
}

export function decodeCustomError(data: Hex): WriteError | null {
  for (const abi of ABIS) {
    try {
      const { errorName } = decodeErrorResult({ abi, data });
      if (!errorName) continue;
      return {
        name: errorName,
        message: EXPLAINED[errorName] ?? `The contract refused with ${errorName}.`,
      };
    } catch {
      // Not this ABI's error. Try the next.
    }
  }
  return null;
}

/**
 * Digs the revert bytes out of whatever shape the error arrived in.
 *
 * viem nests its causes, wallets nest differently again, and a plain node
 * response puts the data one more level down. Walking the chain is uglier than
 * a single property read and survives all three.
 */
function findRevertData(cause: unknown): Hex | null {
  let node: unknown = cause;
  for (let depth = 0; node && depth < 8; depth++) {
    const record = node as Record<string, unknown>;

    const direct = record.data;
    if (typeof direct === "string" && direct.startsWith("0x") && direct.length >= 10) {
      return direct as Hex;
    }
    // Some providers wrap it once more: { data: { data: "0x..." } }
    if (direct && typeof direct === "object") {
      const nested = (direct as Record<string, unknown>).data;
      if (typeof nested === "string" && nested.startsWith("0x") && nested.length >= 10) {
        return nested as Hex;
      }
    }

    node = record.cause;
  }
  return null;
}

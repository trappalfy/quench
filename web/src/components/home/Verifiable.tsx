"use client";

import { Panel } from "../Panel";
import { CopyButton } from "../builder/CopyButton";
import { ADDRESSES, explorerAddress } from "@/lib/chain";

/**
 * The strongest claim on the page, with the means to check it.
 *
 * "No owner, no upgrade path, no pause" is worth nothing as a sentence. What
 * makes it checkable is that the source contains no such function at all, and
 * that is a thing anyone can confirm in one command against the same source the
 * addresses below were compiled from.
 *
 * The grep is printed with its output rather than described, because the output
 * being empty is the whole point.
 */

const CONTRACTS: { label: string; address: string; what: string }[] = [
  {
    label: "Launchpad",
    address: ADDRESSES.launchpad,
    what: "Mints the token, opens the pool, holds the LP position.",
  },
  {
    label: "BlockHook",
    address: ADDRESSES.blockHook,
    what: "The five rules. One contract, every pool.",
  },
  {
    label: "PotVault",
    address: ADDRESSES.potVault,
    what: "Holds the pots. Funded and paid by the hook and nothing else.",
  },
  {
    label: "BoundedRouter",
    address: ADDRESSES.boundedRouter,
    what: "The only way in and out of a pool, with slippage and a deadline.",
  },
  {
    label: "BondingCurve",
    address: ADDRESSES.curveImplementation,
    what: "The implementation each curve launch is cloned from.",
  },
  {
    label: "PoolManager",
    address: ADDRESSES.poolManager,
    what: "Uniswap v4. Not ours.",
  },
];

const GREP = "grep -rniE 'owner|upgrade|proxy|delegatecall|selfdestruct|pause|admin' src/";

export function Verifiable() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel className="min-w-0" title="there is no owner" ticks bodyClassName="p-4">
        <p className="text-dim">
          Not &ldquo;the owner has renounced&rdquo; and not &ldquo;the keys are in a
          multisig&rdquo;. The
          source has no owner, no admin, no pause, no proxy and no upgrade path,
          because no such function was written. Run this against the source the
          addresses beside it were compiled from:
        </p>
        <div className="mt-4 flex items-center justify-between gap-3 border border-line bg-ground px-3 py-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre text-[11px] text-cyan">
            {GREP}
          </code>
          <CopyButton text={GREP} />
        </div>
        <p className="mt-2 text-[11px] text-faint">
          It prints nothing. That is the claim.
        </p>

        <p className="mt-5 text-dim">
          The hook has exactly one non-view function of its own —{" "}
          <code className="text-text">stageConfig</code> — and it reverts for every
          caller but the launchpad. It writes to transient storage that is cleared
          when it is read, inside the transaction that opens the pool. After that
          transaction there is no path to the config at all.
        </p>
      </Panel>

      <Panel className="min-w-0" title="the addresses" bodyClassName="p-0">
        <ul className="divide-y divide-line">
          {CONTRACTS.map((c) => (
            <li key={c.address} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-text">{c.label}</span>
                <CopyButton text={c.address} label="copy" />
              </div>
              <a
                href={explorerAddress(c.address)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate text-[11px] text-dim underline decoration-line underline-offset-2 hover:text-text"
              >
                {c.address}
              </a>
              <p className="mt-1 text-[11px] text-faint">{c.what}</p>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-3 text-[11px] text-faint">
          Source verification on the explorer is still pending — its API sits behind
          a challenge that refuses automated submissions, so it has to be uploaded by
          hand. Until it is, the addresses are checkable and the bytecode is not.
        </p>
      </Panel>
    </div>
  );
}

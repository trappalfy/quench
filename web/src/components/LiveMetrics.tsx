"use client";

import { useEffect, useRef, useState } from "react";
import {
  DASH,
  blocksToApproxAge,
  formatCompactTokens,
  formatEth,
} from "@/lib/format";
import type { Totals } from "@/lib/reads/totals";

/**
 * The strip under the hero: what the protocol has actually done, and proof the
 * chain under it is moving.
 *
 * Only the head block is polled. Blocks here are about a tenth of a second, so
 * a number that ticks is the cheapest honest evidence the site is reading a
 * live chain rather than serving a snapshot — and one `eth_blockNumber` every
 * two seconds costs a great deal less than re-deriving four log totals would.
 * The totals come from the server render and change on the page's own
 * revalidation.
 *
 * The age of the last launch is derived from the live head, so it counts up
 * without a second request.
 *
 * This is the only thing on the site that animates on its own, and it stops
 * animating under `prefers-reduced-motion`.
 */
export function LiveMetrics({
  initialHead,
  totals,
  lastLaunchBlock,
}: {
  initialHead: bigint | null;
  totals: Totals;
  lastLaunchBlock: bigint | null;
}) {
  const head = useLiveHead(initialHead);

  return (
    <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
      <Cell
        label="head block"
        value={head === null ? DASH : head.toString()}
        hint={head === null ? "The chain did not answer." : "Read from Robinhood Chain"}
        live
      />
      <Cell
        label="burned by hooks"
        value={
          totals.burnedByHooks === null
            ? DASH
            : formatCompactTokens(totals.burnedByHooks)
        }
        hint="Tokens destroyed by the Auto Burn block. Does not include supply the launchpad burned at launch, which is not a rule firing."
      />
      <Cell
        label="held in pots"
        value={totals.potHeld === null ? DASH : `${formatEth(totals.potHeld)} ETH`}
        hint="ETH sitting in the vault across every pool's pot, right now."
      />
      <Cell
        label="donated to LPs"
        value={totals.lpDonated === null ? DASH : `${formatEth(totals.lpDonated)} ETH`}
        hint="ETH the LP Rewards block has donated into pools, counted from the pool manager's Donate events with the hook as sender."
      />
      <Cell
        label="last launch"
        value={
          lastLaunchBlock === null || head === null
            ? DASH
            : `${blocksToApproxAge(head - lastLaunchBlock)} ago`
        }
        hint={
          lastLaunchBlock === null
            ? "Nothing has launched yet."
            : `Block ${lastLaunchBlock}`
        }
        live
      />
    </div>
  );
}

/**
 * Polls the head block and nothing else.
 *
 * Two seconds, not every block: at ~0.1s blocks a per-block poll would be
 * twenty requests a second to move a number nobody reads that fast.
 *
 * By hand rather than through viem, which is the one place on the site that is
 * worth doing. Importing the browser client here pulled a hundred kilobytes of
 * viem into the landing page's bundle to make a single `eth_blockNumber` call
 * — every other page reads the chain on the server. This is eight lines and no
 * dependency.
 */
async function fetchHead(signal: AbortSignal): Promise<bigint> {
  const response = await fetch("/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    signal,
  });
  if (!response.ok) throw new Error(`rpc ${response.status}`);
  const body = await response.json();
  if (typeof body?.result !== "string") throw new Error("rpc returned no result");
  return BigInt(body.result);
}

function useLiveHead(initial: bigint | null) {
  const [head, setHead] = useState(initial);

  useEffect(() => {
    const controller = new AbortController();
    const tick = async () => {
      try {
        setHead(await fetchHead(controller.signal));
      } catch {
        // A failed poll leaves the last good value on screen. Blanking it would
        // claim the chain stopped, when what stopped was one request.
      }
    };
    const id = setInterval(tick, 2000);
    tick();
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, []);

  return head;
}

function Cell({
  label,
  value,
  hint,
  live = false,
}: {
  label: string;
  value: string;
  hint?: string;
  live?: boolean;
}) {
  const flash = useFlashOnChange(live ? value : null);

  return (
    <div className="bg-panel px-4 py-3" title={hint}>
      <div className="q-label">{label}</div>
      <div
        className={`mt-1 truncate text-xl transition-colors duration-700 ${
          flash ? "text-cyan" : "text-text"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/// A short highlight when the value changes, so the eye is told which figure
/// moved without anything looping. Null disables it entirely — a figure that
/// never changes must not flash on mount and imply that it did.
function useFlashOnChange(value: string | null) {
  const [flash, setFlash] = useState(false);
  const previous = useRef(value);

  useEffect(() => {
    if (value === null || previous.current === value) return;
    previous.current = value;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    setFlash(true);
    const id = setTimeout(() => setFlash(false), 450);
    return () => clearTimeout(id);
  }, [value]);

  return flash;
}

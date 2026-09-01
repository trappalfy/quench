"use client";

import { useEffect, useRef, useState } from "react";
import {
  DASH,
  blocksToApproxAge,
  formatCompactTokens,
  formatCount,
  formatEth,
} from "@/lib/format";
import { BLOCK_ORDER, GAS } from "@/lib/hookConfig";
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
type Figure = { label: string; value: string; hint: string; live?: boolean };

/**
 * Five figures, and never a zero among them.
 *
 * A cell is earned, not reserved. Before anything has launched, "burned by
 * hooks · 0" and "donated to LPs · 0" are true and useless: they describe a
 * protocol nobody has used yet, which is the one thing a first visitor works
 * out on their own. So a total appears only once it has a number, and until
 * then its place is taken by something about the system that is already true —
 * how many rules the hook holds, what a token's supply is, what a full stack
 * of rules costs in measured gas, and which block the contracts became
 * unchangeable at.
 *
 * The alternative, filling the strip with invented figures, was considered and
 * refused: every total here is derived from chain logs, so anyone can check one
 * in half a minute, and the site prints the grep it wants to be checked by.
 */
export function LiveMetrics({
  initialHead,
  totals,
  lastLaunchBlock,
  totalSupply,
  deployBlock,
}: {
  initialHead: bigint | null;
  totals: Totals;
  lastLaunchBlock: bigint | null;
  totalSupply: bigint;
  deployBlock: bigint;
}) {
  const head = useLiveHead(initialHead);

  // What the protocol has done. Each one drops out while it has nothing to
  // report — including when the read failed, because a dash beside four real
  // figures reads as a broken cell rather than as an unanswered request.
  const activity: Figure[] = [];

  if (lastLaunchBlock !== null && head !== null) {
    activity.push({
      label: "last launch",
      value: `${blocksToApproxAge(head - lastLaunchBlock)} ago`,
      hint: `Block ${lastLaunchBlock}`,
      live: true,
    });
  }
  if (totals.burnedByHooks !== null && totals.burnedByHooks > 0n) {
    activity.push({
      label: "burned by hooks",
      value: formatCompactTokens(totals.burnedByHooks),
      hint: "Tokens destroyed by the Auto Burn block. Does not include supply the launchpad burned at launch, which is not a rule firing.",
    });
  }
  if (totals.potHeld !== null && totals.potHeld > 0n) {
    activity.push({
      label: "held in pots",
      value: `${formatEth(totals.potHeld)} ETH`,
      hint: "ETH sitting in the vault across every pool's pot, right now.",
    });
  }
  if (totals.lpDonated !== null && totals.lpDonated > 0n) {
    activity.push({
      label: "donated to LPs",
      value: `${formatEth(totals.lpDonated)} ETH`,
      hint: "ETH the LP Rewards block has donated into pools, counted from the pool manager's Donate events with the hook as sender.",
    });
  }

  // True on the day the contracts were deployed and true for as long as they
  // exist, because none of it can be changed.
  const standing: Figure[] = [
    {
      label: "rules in the hook",
      value: BLOCK_ORDER.length.toString(),
      hint: "Anti-snipe, surge fees, auto burn, LP rewards and the Nth-buy pot. Each one optional, all five fixed at launch.",
    },
    {
      label: "supply per token",
      value: formatCompactTokens(totalSupply),
      hint: "Fixed at mint. Not a field anyone fills in, and it can only ever shrink.",
    },
    {
      label: "gas, all five rules",
      value: `+${formatCount(GAS.allFive)}`,
      hint: `Measured in test/unit/BlockGas.t.sol against a real pool, not estimated. On top of ${formatCount(GAS.base)} for the swap itself.`,
    },
    {
      // The number alone. With "block " in front it truncates on a phone,
      // and half a block number is worth less than none.
      label: "immutable since block",
      value: formatCount(Number(deployBlock)),
      hint: "The block the contracts were deployed in. No owner, no upgrade path, no pause.",
    },
  ];

  const figures = [
    {
      label: "head block",
      value: head === null ? DASH : head.toString(),
      hint: head === null ? "The chain did not answer." : "Read from Robinhood Chain",
      live: true,
    },
    ...activity,
    ...standing,
  ].slice(0, 5);

  return (
    <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
      {figures.map((f) => (
        <Cell key={f.label} label={f.label} value={f.value} hint={f.hint} live={f.live} />
      ))}
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

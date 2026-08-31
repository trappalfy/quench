"use client";

import { useEffect, useState } from "react";
import { formatEther, parseEther } from "viem";
import { formatCount } from "@/lib/format";

/**
 * Inputs for a config that has to survive being typed into.
 *
 * Two rules. A field never silently corrects what was typed — clamping as you
 * type makes it impossible to enter 1,200 by way of 12, and hides that a value
 * was out of range. And a field always says what its number means in the unit a
 * person thinks in: 500 bps is 5%, 10,000 pips is 1%.
 *
 * Out-of-range values are left in place and reported by the validation panel,
 * which names the Solidity error they would revert with.
 */

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  unit,
  meaning,
  invalid = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max: number;
  unit: string;
  meaning?: string;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="q-label">{label}</span>
      <span className="mt-1 flex items-stretch border border-line bg-ground">
        <input
          type="number"
          inputMode="numeric"
          value={Number.isNaN(value) ? "" : value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          className={`w-full min-w-0 bg-transparent px-2 py-1.5 outline-none ${
            invalid ? "text-fail" : "text-text"
          }`}
        />
        <span className="q-label shrink-0 self-center border-l border-line px-2 py-1.5">
          {unit}
        </span>
      </span>
      <span className="mt-1 flex justify-between text-[11px] text-faint">
        <span>{meaning ?? ""}</span>
        <span>max {formatCount(max)}</span>
      </span>
    </label>
  );
}

/**
 * ETH in, wei out. The text is kept as typed so a half-finished "0." does not
 * collapse to zero under the cursor; the wei only updates when the string
 * parses.
 */
export function EthField({
  label,
  value,
  onChange,
  invalid = false,
}: {
  label: string;
  value: bigint;
  onChange: (wei: bigint) => void;
  invalid?: boolean;
}) {
  const [text, setText] = useState(() => formatEther(value));

  // A value changed elsewhere — a preset loaded, a block toggled — has to reach
  // the box. A value the box itself just produced must not round-trip back
  // through it, or typing "0.010" would be rewritten to "0.01" mid-keystroke.
  useEffect(() => {
    let parsed: bigint | null = null;
    try {
      parsed = parseEther(text || "0");
    } catch {
      parsed = null;
    }
    if (parsed !== value) setText(formatEther(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className="block">
      <span className="q-label">{label}</span>
      <span className="mt-1 flex items-stretch border border-line bg-ground">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            try {
              onChange(parseEther(next || "0"));
            } catch {
              // Not a number yet. Leave the last good value in the config; the
              // box keeps what was typed.
            }
          }}
          className={`w-full min-w-0 bg-transparent px-2 py-1.5 outline-none ${
            invalid ? "text-fail" : "text-text"
          }`}
        />
        <span className="q-label shrink-0 self-center border-l border-line px-2 py-1.5">
          ETH
        </span>
      </span>
      <span className="mt-1 block text-[11px] text-faint">{value.toString()} wei</span>
    </label>
  );
}

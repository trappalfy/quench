/**
 * Every figure on this site passes through here.
 *
 * Two rules the layout depends on. First, a number never renders more glyphs
 * than its column reserved, because a hairline grid shows a reflow as a crack.
 * Second, nothing is ever invented: a value we could not read is a dash with a
 * reason, never a zero and never an estimate.
 */

/// A value we could not read, and why. Rendered as an em dash with the reason
/// behind a tooltip — the reader is told a question was answered, not ignored.
export type Unknown = { unknown: string };
export type Maybe<T> = T | Unknown;

export function isUnknown<T>(v: Maybe<T>): v is Unknown {
  return typeof v === "object" && v !== null && "unknown" in v;
}

export const DASH = "—";

const ONE = 10n ** 18n;

/// Fixed-width ETH: four decimals up to a thousand, then thousands separators
/// and no decimals at all. A column of these is always the same width bracket.
export function formatEth(wei: bigint, decimals = 4): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / ONE;
  const frac = abs % ONE;

  let out: string;
  if (whole >= 1000n) {
    out = groupThousands(whole.toString());
  } else {
    const fracStr = frac.toString().padStart(18, "0").slice(0, decimals);
    out = `${whole}.${fracStr}`;
  }
  return negative ? `-${out}` : out;
}

/// Prices here span from a few wei per token on a fresh curve to whole ETH on a
/// graduated pool. A fixed decimal count would render most of them as 0.0000,
/// so small values switch to significant digits and keep their magnitude.
export function formatPrice(weiPerToken: bigint): string {
  if (weiPerToken === 0n) return "0";
  if (weiPerToken >= ONE / 1000n) return formatEth(weiPerToken, 6);

  // Below a millieth of an ETH, count the leading zeros and show four digits
  // after them: 0.00000000412 rather than 0.0000.
  const digits = weiPerToken.toString().padStart(19, "0");
  const whole = digits.slice(0, digits.length - 18);
  const frac = digits.slice(digits.length - 18);
  const lead = frac.length - frac.replace(/^0+/, "").length;
  return `${whole}.${frac.slice(0, lead + 4)}`;
}

/// ETH figures span from a fraction of one to a nine-figure FDV. Past a
/// million the exact wei stops meaning anything and the column would blow out,
/// so magnitude replaces precision — and the suffix says which.
export function formatEthCompact(wei: bigint): string {
  const whole = wei / ONE;
  if (whole >= 1_000_000_000n) return `${(Number(whole) / 1e9).toFixed(2)}B`;
  if (whole >= 1_000_000n) return `${(Number(whole) / 1e6).toFixed(2)}M`;
  if (whole >= 10_000n) return `${(Number(whole) / 1e3).toFixed(2)}K`;
  return formatEth(wei);
}

/// Token counts run to a billion, so a feed column shows magnitude, not units.
export function formatCompactTokens(amount: bigint): string {
  const whole = amount / ONE;
  // A non-zero amount that rounds to zero must not print as "0". A dust burn
  // shown as nothing reads as "this never happened", which is a different claim
  // than "this happened and was tiny".
  if (whole === 0n && amount > 0n) return "<1";
  if (whole >= 1_000_000_000n) return `${(Number(whole) / 1e9).toFixed(2)}B`;
  if (whole >= 1_000_000n) return `${(Number(whole) / 1e6).toFixed(2)}M`;
  if (whole >= 1_000n) return `${(Number(whole) / 1e3).toFixed(2)}K`;
  return whole.toString();
}

function groupThousands(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/// Basis points: 10,000 = 100%. Used for every share the contracts hold.
export function formatBps(bps: number): string {
  return `${trimZeros((bps / 100).toFixed(2))}%`;
}

/// Pips: 1,000,000 = 100%. Uniswap's fee unit, not the same as basis points,
/// and mixing the two silently turns a 0.3% fee into a 30% one.
export function formatPips(pips: number): string {
  return `${trimZeros((pips / 10_000).toFixed(3))}%`;
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

export function truncateAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 2) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/// ~0.1s blocks on this chain, so a block delta is a usable clock — but only
/// as an approximation, and the copy says so rather than pretending precision.
export function blocksToApproxAge(blocks: bigint): string {
  const seconds = Number(blocks) / 10;
  // Each unit is rounded before it is compared to its ceiling. Testing the raw
  // seconds instead lets rounding print "60s" or "24h" at the boundaries.
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(seconds / 3600);
  if (h < 24) return `${h}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/// Change is deliberately colourless: a glyph and a sign, nothing more. The two
/// accents mean lifecycle state, and a third and fourth signal colour would
/// leave the page with no hierarchy at all.
export function formatChange(ratio: number | null): { text: string; glyph: string } {
  if (ratio === null) return { text: DASH, glyph: "" };
  const pct = ratio * 100;
  if (Math.abs(pct) < 0.005) return { text: "0.00%", glyph: "·" };
  return {
    text: `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`,
    glyph: pct > 0 ? "▲" : "▼",
  };
}

/// 1st, 2nd, 3rd, 4th — including the teens, which do not follow the last
/// digit. Written out because "every 3th buy" in a rule description reads as
/// carelessness about everything else on the page.
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/// Whole counts — gas, blocks, buys. `toLocaleString` groups with whatever the
/// runtime's locale uses, which differs between the server and the browser and
/// showed up as a non-breaking space where every other figure on the page had a
/// comma. Grouping is a house decision, not the machine's.
export function formatCount(n: number): string {
  const negative = n < 0;
  const out = groupThousands(Math.abs(Math.round(n)).toString());
  return negative ? `-${out}` : out;
}

/**
 * A token's mark, derived from its address and nothing else.
 *
 * There is no logo field in the contracts and no store behind this site, so a
 * tile has to come from what the chain already holds. Deriving it from the
 * address also means it cannot be spoofed: two tokens with the same mark would
 * have to be the same token.
 *
 * The colour is not decoration — it is the token's temperature. A curve that
 * has barely started is amber; one near its last tranche has visibly cooled; a
 * graduated pool is cyan. A grid of these reads as a state of the market before
 * a single label has been read.
 */
export type Lifecycle = "molten" | "set";

const SIZE = 7;
const HALF = Math.ceil(SIZE / 2); // 4 columns, mirrored into 7

export function Tile({
  address,
  temperature,
  px = 40,
  className = "",
}: {
  address: string;
  /** 0 = molten, 1 = fully quenched. */
  temperature: number;
  px?: number;
  className?: string;
}) {
  const bits = BigInt(address.toLowerCase());
  const t = Math.max(0, Math.min(1, temperature));
  const colour = `color-mix(in oklab, var(--color-cyan) ${(t * 100).toFixed(1)}%, var(--color-amber))`;

  const cells: { x: number; y: number; on: boolean }[] = [];
  let bit = 0n;
  for (let x = 0; x < HALF; x++) {
    for (let y = 0; y < SIZE; y++) {
      const on = ((bits >> bit) & 1n) === 1n;
      bit++;
      cells.push({ x, y, on });
      const mirror = SIZE - 1 - x;
      if (mirror !== x) cells.push({ x: mirror, y, on });
    }
  }

  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      shapeRendering="crispEdges"
      className={`border border-line ${className}`}
      role="img"
      aria-label={`Generated mark for ${address}`}
    >
      <rect width={SIZE} height={SIZE} fill="var(--color-panel)" />
      {cells
        .filter((c) => c.on)
        .map((c) => (
          <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={1} height={1} fill={colour} />
        ))}
    </svg>
  );
}

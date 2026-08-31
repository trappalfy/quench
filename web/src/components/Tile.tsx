/**
 * A token's mark, derived from its address and nothing else.
 *
 * There is no logo field in the contracts and no store behind this site, so a
 * tile has to come from what the chain already holds. Deriving it from the
 * address also means it cannot be spoofed: two tokens with the same mark would
 * have to be the same token.
 *
 * The colour is not decoration. Amber means the token is still on its curve;
 * cyan means it has graduated and its rules are set. A wall of these reads as
 * a state at a glance.
 */
export type Lifecycle = "molten" | "set";

const SIZE = 7;
const HALF = Math.ceil(SIZE / 2); // 4 columns, mirrored into 7

export function Tile({
  address,
  state,
  px = 40,
  className = "",
}: {
  address: string;
  state: Lifecycle;
  px?: number;
  className?: string;
}) {
  const bits = BigInt(address.toLowerCase());
  const colour = state === "molten" ? "var(--color-amber)" : "var(--color-cyan)";

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

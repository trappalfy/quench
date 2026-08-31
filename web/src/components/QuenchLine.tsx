/**
 * The product's one signature.
 *
 * A bonding curve fills this line as it sells. The gradient runs amber to cyan
 * across the *whole* track, and the fill uncovers a slice of it — so an early
 * curve reads as still glowing and only a nearly-sold one looks cool. Putting
 * the gradient on the fill instead would show a token at 10% as half quenched,
 * which is the opposite of the truth.
 *
 * On graduation the line is wholly cyan: set, and not going back.
 */
export function QuenchLine({
  progress,
  done = false,
  height = 3,
}: {
  /** 0..1 */
  progress: number;
  done?: boolean;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        height,
        background: done
          ? "var(--color-cyan)"
          : "linear-gradient(to right, var(--color-amber), var(--color-cyan))",
      }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={done ? 100 : Math.round(pct)}
      aria-label={done ? "Graduated" : "Curve progress"}
    >
      {/* The unsold remainder, painted over the gradient from the right. */}
      {!done && (
        <div
          className="absolute inset-y-0 right-0 bg-line transition-[width] duration-500"
          style={{ width: `${100 - pct}%` }}
        />
      )}
    </div>
  );
}

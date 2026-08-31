/**
 * The product's one signature.
 *
 * A bonding curve fills this line as it sells. The fill runs amber at the left
 * and cools toward cyan at the right, so the bar is a picture of the thing the
 * name describes. On graduation it is wholly cyan: set, and not going back.
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
      className="relative w-full bg-line"
      style={{ height }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={done ? 100 : Math.round(pct)}
      aria-label={done ? "Graduated" : "Curve progress"}
    >
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-500"
        style={{
          width: done ? "100%" : `${pct}%`,
          background: done
            ? "var(--color-cyan)"
            : "linear-gradient(to right, var(--color-amber), var(--color-cyan))",
        }}
      />
    </div>
  );
}

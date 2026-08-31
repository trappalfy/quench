import type { ReactNode } from "react";
import { DASH } from "@/lib/format";

/**
 * A labelled figure, in one of exactly three states.
 *
 * There is no fourth state and in particular no spinner: a spinner inside a
 * hairline grid reads as damage, and a placeholder zero is a lie. A value we
 * could not read is a dash carrying the reason it is a dash.
 *
 * `width` reserves the column in character units so the box does not resize
 * when the number arrives.
 */
export function Stat({
  label,
  value,
  unknown,
  failed,
  width,
  accent,
  suffix,
}: {
  label: string;
  value?: ReactNode;
  /** Why there is no value. Renders a dash with this behind a tooltip. */
  unknown?: string;
  /** The read itself failed, which is not the same as having no value. */
  failed?: string;
  width?: number;
  accent?: "amber" | "cyan";
  suffix?: string;
}) {
  const tone =
    accent === "amber" ? "text-amber" : accent === "cyan" ? "text-cyan" : "text-text";

  return (
    <div className="flex flex-col gap-1">
      <span className="q-label">{label}</span>
      <span
        className={`text-sm ${failed ? "text-fail" : unknown ? "text-faint" : tone}`}
        style={width ? { minWidth: `${width}ch` } : undefined}
        title={failed ?? unknown}
      >
        {failed ? DASH : unknown ? DASH : value}
        {!failed && !unknown && suffix ? (
          <span className="ml-1 text-faint">{suffix}</span>
        ) : null}
      </span>
    </div>
  );
}

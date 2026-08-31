import type { ReactNode } from "react";

/**
 * The one container. A hairline box, optionally with a window bar across the
 * top and ticks at the corners. Nothing here is rounded and nothing casts a
 * shadow: depth is drawn with a line or not at all.
 */
export function Panel({
  title,
  right,
  ticks = false,
  className = "",
  bodyClassName = "",
  children,
}: {
  title?: string;
  right?: ReactNode;
  ticks?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={`relative border border-line bg-panel ${className}`}>
      {ticks && <CornerTicks />}
      {title && (
        <header className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="q-label">/ {title}</span>
          {right}
        </header>
      )}
      <div className={bodyClassName || "p-3"}>{children}</div>
    </section>
  );
}

function CornerTicks() {
  const common = "absolute h-2 w-2 border-line-bright pointer-events-none";
  return (
    <>
      <span className={`${common} left-[-1px] top-[-1px] border-l border-t`} />
      <span className={`${common} right-[-1px] top-[-1px] border-r border-t`} />
      <span className={`${common} bottom-[-1px] left-[-1px] border-b border-l`} />
      <span className={`${common} bottom-[-1px] right-[-1px] border-b border-r`} />
    </>
  );
}

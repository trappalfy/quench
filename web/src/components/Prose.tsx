import type { ReactNode } from "react";

/**
 * The few elements the written pages are made of.
 *
 * Prose here is a column of dim text at a readable measure with the occasional
 * word pulled to full brightness — there is no rich text and no markdown step,
 * because every one of these pages is written by hand and read line by line.
 */
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="scroll-mt-24">
      <h2 id={id} className="q-display scroll-mt-24 text-2xl sm:text-3xl">
        {title}
      </h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="max-w-2xl text-dim">{children}</p>;
}

/// Emphasis by brightness rather than by weight: the mono face has one weight
/// that reads well at this size, and bolding it thickens the column unevenly.
export function Strong({ children }: { children: ReactNode }) {
  return <span className="text-text">{children}</span>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="text-text">{children}</code>;
}

/// A list where each item is a claim, not a fragment.
export function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="max-w-2xl space-y-2 text-dim">
      {items.map((item, i) => (
        <li key={i} className="border-l border-line pl-3">
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * The jump list beside a long written page.
 *
 * It earns its place twice: a page of sections is easier to navigate with one,
 * and it gives the left column something to hold, so a narrow measure of prose
 * does not sit alone against a wide empty page.
 */
export function Contents({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <nav className="lg:sticky lg:top-24 lg:self-start">
      <p className="q-label">/ contents</p>
      <ul className="mt-3 space-y-1">
        {items.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`} className="text-dim hover:text-text">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

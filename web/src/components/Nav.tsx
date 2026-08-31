import Link from "next/link";

const LINKS = [
  { href: "/app", label: "Discover" },
  { href: "/hooks", label: "Hooks" },
  { href: "/builder", label: "Builder" },
  { href: "/launch", label: "Launch" },
  { href: "/docs", label: "Docs" },
];

export function Nav({ head }: { head?: bigint }) {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ground/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex items-center justify-between py-3">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="q-display text-xl">Quench</span>
            {/* Decoration, and the first thing to go when space is short. */}
            <span className="q-label hidden sm:inline">v4 hooks</span>
          </Link>

          <div className="hidden items-center gap-5 md:flex">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="q-label hover:text-text">
                {l.label}
              </Link>
            ))}
          </div>

          {/* The head block tells live data from stale without a spinner. On a
              narrow screen the word goes and the number stays, because the
              number is the part that carries the meaning. */}
          <span
            className="q-label whitespace-nowrap"
            title="Latest block read from Robinhood Chain"
          >
            {head !== undefined ? (
              <>
                <span className="hidden sm:inline">BLK </span>
                {head.toString()}
              </>
            ) : (
              "OFFLINE"
            )}
          </span>
        </div>

        {/* Below md the links get their own row and scroll sideways rather than
            collapsing into a menu: five destinations do not warrant hiding. */}
        <div className="-mx-4 flex gap-5 overflow-x-auto border-t border-line px-4 py-2 md:hidden">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="q-label whitespace-nowrap hover:text-text">
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}

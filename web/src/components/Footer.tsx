import Link from "next/link";
import { ADDRESSES, explorerAddress, robinhood } from "@/lib/chain";
import { truncateAddress } from "@/lib/format";

const CONTRACTS = [
  ["launchpad", ADDRESSES.launchpad],
  ["hook", ADDRESSES.blockHook],
  ["router", ADDRESSES.boundedRouter],
  ["pot vault", ADDRESSES.potVault],
  ["pool manager", ADDRESSES.poolManager],
] as const;

const READ = [
  ["Discover", "/app"],
  ["Blueprints", "/hooks"],
  ["Docs", "/docs"],
] as const;

const BUILD = [
  ["Hook builder", "/builder"],
  ["Launch a token", "/launch"],
] as const;

/**
 * Carries the addresses on every page, which is the point: a launchpad that
 * asks to be checked has to make checking one click away from wherever you are.
 *
 * It also gives a short page a bottom. Without it, a page whose content ends
 * halfway down leaves the rest of the viewport as a hole.
 */
export function Footer() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="q-display text-xl">Quench</span>
          <p className="mt-3 max-w-xs text-dim">
            Fixed-supply tokens behind immutable Uniswap v4 hooks. The rules are set
            when the pool opens and nobody can change them afterwards.
          </p>
        </div>

        <Column title="read" links={READ} />
        <Column title="build" links={BUILD} />

        <div>
          <p className="q-label">contracts · chain {robinhood.id}</p>
          <dl className="mt-3 space-y-1.5">
            {CONTRACTS.map(([label, address]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <dt className="q-label">{label}</dt>
                <dd>
                  <a
                    href={explorerAddress(address)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-faint hover:text-cyan"
                  >
                    {truncateAddress(address, 6, 4)} ↗
                  </a>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-4 py-4">
          <p className="min-w-0 text-faint">
            Quench has not been audited. The pot is won on a public counter, not a
            random one, and it will be raced. Nothing here is financial advice.
          </p>
          {/* Kept off the columns above: these are read once, if at all, and
              putting them beside the disclaimer is where a reader who wants
              them will look. */}
          <p className="flex shrink-0 gap-4">
            <Link href="/terms" className="q-label hover:text-text">
              Terms
            </Link>
            <Link href="/privacy" className="q-label hover:text-text">
              Privacy
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

function Column({
  title,
  links,
}: {
  title: string;
  links: readonly (readonly [string, string])[];
}) {
  return (
    <div>
      <p className="q-label">{title}</p>
      <ul className="mt-3 space-y-1.5">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-dim hover:text-text">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

import Link from "next/link";
import { Nav } from "./Nav";
import { Panel } from "./Panel";

/**
 * A route that exists in the navigation but has not been built yet.
 *
 * The alternative was to hide these links until their pages land, which would
 * make the product look smaller than it is planned to be, or to let them 404,
 * which reads as a broken site. Saying plainly what a page will hold — and that
 * it does not hold it yet — costs nothing and claims nothing.
 */
export function Holding({
  route,
  title,
  will,
  head,
}: {
  route: string;
  title: string;
  will: string[];
  head?: bigint;
}) {
  return (
    <>
      <Nav head={head} />
      {/* Short by nature. Centred in whatever space is left between nav and
          footer, so the emptiness reads as composition rather than a hole. */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-16">
        <p className="q-label">/ {route}</p>
        <h1 className="q-display mt-2 text-5xl">{title}</h1>
        <p className="mt-4 text-amber">Not built yet.</p>

        <Panel title="what this page will hold" className="mt-8">
          <ul className="space-y-2">
            {will.map((line) => (
              <li key={line} className="flex gap-3 text-dim">
                <span className="text-faint">—</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <p className="mt-8 text-dim">
          The contracts behind all of this are live and immutable on Robinhood Chain.
          What exists today is the reading side:{" "}
          <Link href="/app" className="text-cyan underline">
            every launch and its rules
          </Link>
          .
        </p>
      </main>
    </>
  );
}

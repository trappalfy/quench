import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Panel } from "@/components/Panel";
import { serverClient } from "@/lib/client";

/**
 * The page a wrong address gets.
 *
 * Without this file Next serves its own: a white box in system-ui, in the
 * middle of a site that is otherwise black and monospaced. It is reached more
 * often than a 404 usually is, because the token page calls notFound() for any
 * address the registry does not know — which is the correct answer to a
 * mistyped or invented token, and deserves to be said in the site's own voice.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Not found — Quench" };

const ELSEWHERE = [
  { href: "/app", label: "Discover", note: "Every token the registry knows, read from the chain" },
  { href: "/builder", label: "Hook builder", note: "Assemble the five rules and see what they cost" },
  { href: "/launch", label: "Launch a token", note: "Instant pool or bonding curve" },
  { href: "/docs", label: "Docs", note: "What each rule does, and what we do not do" },
];

export default async function NotFound() {
  // A 404 is not a reason to stop showing whether the chain is answering.
  const head = await serverClient.getBlockNumber().catch(() => undefined);

  return (
    <>
      <Nav head={head} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="q-label">/ 404</p>
        <h1 className="q-display mt-2 text-4xl sm:text-5xl lg:text-6xl">
          Nothing at
          <br />
          this address
        </h1>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <p className="q-lead max-w-2xl">
            Either the URL is wrong, or it is a token the launchpad never launched.
            Quench will not render a page of dashes around an address it cannot
            verify — a token page here means the registry holds a record for it,
            and this one holds none.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {ELSEWHERE.map((l) => (
            <Link key={l.href} href={l.href} className="group block">
              <Panel className="h-full transition-colors group-hover:border-cyan" bodyClassName="p-4">
                <p className="q-display-sm text-lg group-hover:text-cyan">{l.label}</p>
                <p className="mt-1 text-dim">{l.note}</p>
              </Panel>
            </Link>
          ))}
        </div>

        <p className="q-rule mt-10 pt-4 text-faint">
          If you were following a link to a token, check the address against the
          launchpad in the explorer before trusting it.{" "}
          <Link href="/" className="underline hover:text-text">
            Back to the front
          </Link>
        </p>
      </main>
    </>
  );
}

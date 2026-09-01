import Link from "next/link";
import { Nav } from "@/components/Nav";
import { HookBuilder } from "@/components/builder/HookBuilder";
import { serverClient } from "@/lib/client";
import { fromQuery } from "@/lib/hookConfig";

export const revalidate = 10;

export const metadata = {
  title: "Hook builder — Quench",
  description:
    "Compose the five blocks, see what the stack costs a buyer, and check the config against the hook's own validation before spending gas.",
};

export default async function Builder({
  searchParams,
}: {
  searchParams: Promise<{ cfg?: string; from?: string }>;
}) {
  // The head block is the only thing this page reads from the chain. Everything
  // below it is arithmetic that runs in the browser.
  const [head, params] = await Promise.all([
    serverClient.getBlockNumber().catch(() => undefined),
    searchParams,
  ]);

  // A config carried in from the registry. A malformed one opens the default
  // rather than a config half-taken from a bad link.
  const carried = fromQuery(params.cfg);

  return (
    <>
      <Nav head={head} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="q-label">/ builder</p>
        <h1 className="q-display mt-2 text-4xl sm:text-5xl lg:text-6xl">
          Compose the
          <br />
          rules first
        </h1>
        <p className="q-lead mt-4 max-w-2xl">
          Five blocks, numbered the way the contract names them. Everything on this
          page is computed here in your browser by the same arithmetic the contract
          executes, and checked against the same validation the contract applies.
          Nothing is sent anywhere until you launch.
        </p>
        <p className="mt-3 max-w-2xl text-dim">
          This page settles the rules and only the rules. A token&rsquo;s name, its
          ticker and its opening price belong to the transaction that opens the pool,
          so they are asked for on{" "}
          <Link href="/launch" className="text-cyan hover:underline">
            the launch page
          </Link>{" "}
          — and the panel below the five blocks carries whatever you build here
          into it.
        </p>

        {carried && (
          <p className="mt-4 border-l-2 border-cyan px-3 py-2 text-dim">
            Loaded from{" "}
            <Link className="text-cyan" href="/hooks">
              blueprint {params.from ?? "the registry"}
            </Link>
            . Changing anything here makes it your own config — it does not touch
            the published one, which nobody can change.
          </p>
        )}

        <div className="mt-10">
          <HookBuilder initial={carried ?? undefined} />
        </div>
      </main>
    </>
  );
}

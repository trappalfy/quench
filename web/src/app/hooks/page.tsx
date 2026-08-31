import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Panel } from "@/components/Panel";
import { BlueprintCard } from "@/components/BlueprintCard";
import { serverClient } from "@/lib/client";
import { readBlueprints } from "@/lib/reads/blueprints";

export const revalidate = 10;

export const metadata = {
  title: "Blueprint registry — Quench",
  description:
    "Published hook configs, with the settings they saved, who published them, and how many launches have reused them.",
};

export default async function Hooks() {
  const [head, blueprints] = await Promise.all([
    serverClient.getBlockNumber(),
    readBlueprints(serverClient).catch(() => []),
  ]);

  return (
    <>
      <Nav head={head} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="q-label">/ blueprints</p>
        <h1 className="q-display mt-2 text-4xl sm:text-5xl lg:text-6xl">
          Hooks somebody
          <br />
          already argued about
        </h1>
        <p className="q-lead mt-4 max-w-2xl">
          A blueprint is a saved config anyone can launch against. Launching with one
          copies its settings exactly — the launchpad ignores whatever else the caller
          passes — so what you read here is what your pool would run.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0">
            {blueprints.length === 0 ? (
              <Panel bodyClassName="px-4 py-8">
                <p className="text-dim">
                  Nothing published yet. Any config the builder accepts can be
                  published here, and once it is, it cannot be edited or withdrawn.
                </p>
                <Link
                  href="/builder"
                  className="q-label mt-4 inline-block border border-line px-3 py-2 hover:border-cyan hover:text-cyan"
                >
                  build one
                </Link>
              </Panel>
            ) : (
              // Two columns only once there are two things to put in them. A
              // lone card in a two-column grid leaves a hole beside it, which
              // reads as a failed render rather than as a short registry.
              <div className={`grid gap-4 ${blueprints.length > 1 ? "xl:grid-cols-2" : ""}`}>
                {blueprints.map((bp) => (
                  <BlueprintCard key={bp.id.toString()} bp={bp} head={head} />
                ))}
              </div>
            )}
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
            <Panel title="what a royalty is" bodyClassName="p-4">
              <p className="text-dim">
                A blueprint&rsquo;s author sets a royalty of up to 20%. It is taken
                out of the creator&rsquo;s share of the pool&rsquo;s fees when a token
                launched from that blueprint collects them — not out of the buyer, and
                not out of the LPs.
              </p>
            </Panel>

            <Panel title="what a blueprint cannot do" bodyClassName="p-4">
              <ul className="space-y-2 text-dim">
                <li>
                  It cannot be edited. The config is stored in the launchpad&rsquo;s
                  array and there is no function that writes to it again.
                </li>
                <li>
                  It cannot be withdrawn. A token launched from it keeps working after
                  its author has lost interest.
                </li>
                <li>
                  It carries no endorsement. A blueprint being here means somebody paid
                  gas to publish it, and nothing else.
                </li>
              </ul>
            </Panel>

            <Panel title="publishing" bodyClassName="p-4">
              <p className="text-dim">
                Publishing needs a wallet, and wallet connection is not built yet. The
                builder is finished otherwise: it runs the same arithmetic the hook
                runs and refuses what the hook would refuse.
              </p>
              <Link
                href="/builder"
                className="q-label mt-4 inline-block border border-line px-3 py-2 hover:border-cyan hover:text-cyan"
              >
                open the builder
              </Link>
            </Panel>
          </aside>
        </div>
      </main>
    </>
  );
}

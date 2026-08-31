import { Nav } from "@/components/Nav";
import { LaunchCard } from "@/components/LaunchCard";
import { Panel } from "@/components/Panel";
import { serverClient } from "@/lib/client";
import { readLaunch, readLaunchCount, readTokenPage, type Launch } from "@/lib/reads/launches";

/// Read on every request, cached briefly. Nothing here is prerendered: a feed
/// that says "live from the chain" and serves a build-time snapshot is lying.
export const revalidate = 10;

const PAGE = 24;

export default async function Discover() {
  const [head, count] = await Promise.all([
    serverClient.getBlockNumber(),
    readLaunchCount(serverClient),
  ]);

  const tokens = await readTokenPage(serverClient, 0, PAGE, count);
  const launches = await Promise.all(tokens.map((t) => readLaunch(serverClient, t, head)));

  const set = launches.filter((l) => l.record.graduated);
  const molten = launches.filter((l) => !l.record.graduated);

  return (
    <>
      <Nav head={head} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="q-label">/ discover</p>
        <h1
          className="q-display mt-2 text-6xl"
        >
          Markets with
          <br />
          rules you can read
        </h1>
        <p className="mt-4 max-w-xl text-dim">
          Every token here launched behind a hook whose rules were fixed before the
          first trade and cannot be changed by anyone, including us. Read them
          before you buy.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
          <Cell label="launches" value={count.toString()} />
          <Cell label="graduated" value={set.length.toString()} accent="cyan" />
          <Cell label="on the curve" value={molten.length.toString()} accent="amber" />
          <Cell label="head block" value={head.toString()} />
        </div>

        <Section title="graduated · rules set" empty="No token has graduated yet." items={set} head={head} />
        <Section title="on the curve · still molten" empty="No curve is selling right now." items={molten} head={head} />
      </main>
    </>
  );
}

function Cell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "amber" | "cyan";
}) {
  return (
    <div className="bg-panel px-4 py-3">
      <div className="q-label">{label}</div>
      <div
        className={`mt-1 text-xl ${accent === "cyan" ? "text-cyan" : accent === "amber" ? "text-amber" : "text-text"}`}
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  empty,
  items,
  head,
}: {
  title: string;
  empty: string;
  items: Launch[];
  head: bigint;
}) {
  return (
    <div className="mt-10">
      <p className="q-label">/ {title}</p>
      {items.length === 0 ? (
        // An empty registry is a fact, not a failure. It says so plainly rather
        // than filling the grid with skeletons that imply something is coming.
        <Panel className="mt-3" bodyClassName="px-4 py-8">
          <p className="text-faint">{empty}</p>
        </Panel>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((l) => (
            <LaunchCard key={l.record.token} launch={l} head={head} />
          ))}
        </div>
      )}
    </div>
  );
}

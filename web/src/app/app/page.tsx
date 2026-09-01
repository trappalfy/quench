import { Nav } from "@/components/Nav";
import { LaunchCard } from "@/components/LaunchCard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { Panel } from "@/components/Panel";
import { serverClient } from "@/lib/client";
import { readLaunch, readLaunchCount, readTokenPage, type Launch } from "@/lib/reads/launches";
import { readFeed } from "@/lib/reads/events";
import { blocksToApproxAge } from "@/lib/format";

/// Ten seconds, which for a chain with 0.1s blocks is about a hundred of them.
/// A first copy is rendered at build and every copy after it is re-read, so
/// what a visitor sees is never more than a few seconds behind the chain — a
/// feed that says "live from the chain" and serves a build-time snapshot for
/// an hour would be lying.
export const revalidate = 10;

const PAGE = 24;
/// ~0.1s blocks, so this is roughly a day. The label says "roughly" because the
/// block rate is measured, not promised.
const FEED_WINDOW = 900_000n;

/**
 * Every read this page needs, in one place so that a failure is one failure.
 *
 * It has to be allowed to fail. This page is prerendered at build time and
 * re-read on request, so an endpoint that stumbles for a second would
 * otherwise take out a deployment or answer a visitor with a 500 — and a feed
 * that cannot reach the chain has something honest to say instead.
 */
async function load() {
  const [head, count] = await Promise.all([
    serverClient.getBlockNumber(),
    readLaunchCount(serverClient),
  ]);

  const tokens = await readTokenPage(serverClient, 0, PAGE, count);
  const launches = await Promise.all(tokens.map((t) => readLaunch(serverClient, t, head)));
  // The feed is the one part allowed to come back empty on its own: five log
  // queries are the likeliest thing here to hit a limit, and losing them is
  // not a reason to lose the markets above them.
  const events = await readFeed(serverClient, launches, head, FEED_WINDOW).catch(() => []);

  return { head, count, launches, events };
}

export default async function Discover() {
  const data = await load().catch(() => null);
  if (!data) return <Unreadable />;

  const { head, count, launches, events } = data;
  const set = launches.filter((l) => l.record.graduated);
  const molten = launches.filter((l) => !l.record.graduated);
  const newest = launches.reduce<bigint | null>(
    (acc, l) => (acc === null || l.record.launchBlock > acc ? l.record.launchBlock : acc),
    null,
  );

  return (
    <>
      <Nav head={head} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="q-label">/ discover</p>
        <h1 className="q-display mt-2 text-4xl sm:text-5xl lg:text-6xl">
          Markets with
          <br />
          rules you can read
        </h1>
        <p className="q-lead mt-4 max-w-xl">
          Every token here launched behind a hook whose rules were fixed before the
          first trade and cannot be changed by anyone, including us. Read them before
          you buy.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
          <Cell label="launches" value={count.toString()} />
          <Cell label="graduated" value={set.length.toString()} accent="cyan" />
          <Cell label="on the curve" value={molten.length.toString()} accent="amber" />
          <Cell
            label="last launch"
            value={newest === null ? "—" : `${blocksToApproxAge(head - newest)} ago`}
          />
        </div>

        {/* Two columns from lg up: the markets, and what has been happening to
            them. With a handful of launches the grid alone left the right half
            of the screen empty. */}
        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_380px]">
          <div className="min-w-0 space-y-10">
            <Section
              title="graduated · rules set"
              empty="No token has graduated yet. A curve launch opens its pool when the last of ten tranches sells out."
              items={set}
              head={head}
            />
            <Section
              title="on the curve · still molten"
              empty="No curve is selling right now."
              items={molten}
              head={head}
            />
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <ActivityFeed
              events={events}
              head={head}
              windowLabel={`last ~${blocksToApproxAge(FEED_WINDOW)}`}
            />
          </aside>
        </div>
      </main>
    </>
  );
}

/**
 * What the page says when the chain did not answer.
 *
 * Not zeros. A registry with nothing in it and a registry we could not read
 * look identical if both are drawn as "0 launches", and only one of them is
 * true — so this says which one happened.
 */
function Unreadable() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="q-label">/ discover</p>
        <h1 className="q-display mt-2 text-4xl sm:text-5xl">
          The chain did not answer
        </h1>
        <Panel className="mt-6 max-w-2xl" bodyClassName="px-4 py-6">
          <p className="text-dim">
            This page holds no data of its own — every figure on it is read from
            Robinhood Chain when you ask for it, and that read failed. Nothing is
            wrong with any token or pool; the endpoint did not reply.
          </p>
          <p className="mt-3 text-dim">
            Reloading is worth trying. The contracts are reachable without this
            site at any time.
          </p>
        </Panel>
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
    <div>
      <p className="q-label">/ {title}</p>
      {items.length === 0 ? (
        // An empty registry is a fact, not a failure. It says so plainly rather
        // than filling the grid with skeletons that imply something is coming.
        <Panel className="mt-3" bodyClassName="px-4 py-8">
          <p className="text-faint">{empty}</p>
        </Panel>
      ) : (
        // A lone card in a two-column grid leaves the right half of the section
        // empty, which reads as a missing card rather than as a short list.
        <div className={`mt-3 grid gap-4 ${items.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {items.map((l) => (
            <LaunchCard key={l.record.token} launch={l} head={head} />
          ))}
        </div>
      )}
    </div>
  );
}

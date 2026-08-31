import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Panel } from "@/components/Panel";
import { serverClient } from "@/lib/client";
import { readLaunchCount } from "@/lib/reads/launches";
import { LaunchpadAbi } from "@/lib/abi";
import { ADDRESSES, explorerAddress } from "@/lib/chain";
import { truncateAddress } from "@/lib/format";

export const revalidate = 30;

const BLOCKS = [
  {
    name: "Anti-Snipe",
    line: "For a set number of blocks after the pool opens, buys are capped against the in-range reserve and pay an extra fee.",
  },
  {
    name: "Surge Fees",
    line: "The LP fee climbs with how deep a single trade cuts into liquidity. No oracle, no keeper.",
  },
  {
    name: "Auto Burn",
    line: "A share of the tokens a buy produces goes to the dead address inside that same swap.",
  },
  {
    name: "LP Rewards",
    line: "A share of the ETH on every buy is donated to whoever holds in-range liquidity at that moment.",
  },
  {
    name: "Nth-buy Pot",
    line: "A share of each qualifying buy fills a pot, and every Nth qualifying buy takes it. The counter is public.",
  },
];

export default async function Home() {
  const [head, launches, blueprints] = await Promise.all([
    serverClient.getBlockNumber().catch(() => undefined),
    readLaunchCount(serverClient).catch(() => null),
    serverClient
      .readContract({
        address: ADDRESSES.launchpad,
        abi: LaunchpadAbi,
        functionName: "blueprintCount",
      })
      .catch(() => null),
  ]);

  return (
    <>
      <Nav head={head} />

      <main className="mx-auto max-w-7xl px-4">
        <section className="py-20">
          <p className="q-label">/ quench</p>
          <h1 className="q-display mt-3 text-6xl sm:text-8xl">
            Build the hook.
            <br />
            <span className="text-cyan">Then quench it.</span>
          </h1>
          <p className="mt-6 max-w-xl text-dim">
            Stack up to five swap rules, launch a fixed-supply token behind them, and the
            rules set at the moment the pool opens. There is no owner, no upgrade path and
            no pause. Not even us.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/app"
              className="border border-cyan px-4 py-2 text-cyan hover:bg-cyan hover:text-ground"
            >
              Explore markets
            </Link>
            <Link
              href="/builder"
              className="border border-line-bright px-4 py-2 hover:border-text"
            >
              Compose a hook
            </Link>
          </div>
        </section>

        {/* Counts come from the registry itself. If the chain cannot be reached
            they read as a dash — the page never invents a number to look busy. */}
        <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
          <Cell label="launches" value={launches?.toString() ?? "—"} />
          <Cell
            label="blueprints"
            value={blueprints !== null ? (Number(blueprints) - 1).toString() : "—"}
            hint="Index 0 is a sentinel, not a blueprint."
          />
          <Cell label="rules per hook" value="5" />
          <Cell label="chain" value="4663" hint="Robinhood Chain" />
        </div>

        <section className="py-20">
          <p className="q-label">/ the five blocks</p>
          <h2 className="q-display mt-2 text-4xl">Rules that run inside the swap</h2>
          <p className="mt-4 max-w-xl text-dim">
            Each block is a branch in one immutable Uniswap v4 hook. A block is off when
            its parameters are zero, so what a token does is readable from the chain
            before anyone trades it.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BLOCKS.map((b, i) => (
              <Panel key={b.name} ticks>
                <div className="flex items-baseline justify-between">
                  <span className="q-display-sm text-base">{b.name}</span>
                  <span className="q-label">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <p className="mt-2 text-dim">{b.line}</p>
              </Panel>
            ))}
          </div>
        </section>

        <section className="q-rule py-16">
          <p className="q-label">/ what quench does not claim</p>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <p className="text-dim">
              The contracts have not been audited. The pot is won on a public counter, not
              a random one, and it will be raced. The hook charges its cuts on exact-input
              buys only — sells and exact-output buys pay the LP fee and nothing else.
              None of this is advice.
            </p>
            <dl className="space-y-2">
              <Row label="launchpad" value={ADDRESSES.launchpad} />
              <Row label="hook" value={ADDRESSES.blockHook} />
              <Row label="router" value={ADDRESSES.boundedRouter} />
              <Row label="pool manager" value={ADDRESSES.poolManager} />
            </dl>
          </div>
        </section>
      </main>
    </>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-panel px-4 py-3" title={hint}>
      <div className="q-label">{label}</div>
      <div className="mt-1 text-xl">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="q-label">{label}</dt>
      <dd>
        <a
          href={explorerAddress(value)}
          target="_blank"
          rel="noreferrer"
          className="hover:text-cyan"
        >
          {truncateAddress(value)} ↗
        </a>
      </dd>
    </div>
  );
}

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Panel } from "@/components/Panel";
import { LaunchCard } from "@/components/LaunchCard";
import { LiveMetrics } from "@/components/LiveMetrics";
import { TokenAddress } from "@/components/TokenAddress";
import { HeroComposer } from "@/components/home/HeroComposer";
import { BlockShowcase, type PotFacts } from "@/components/home/BlockShowcase";
import { LaunchPath } from "@/components/home/LaunchPath";
import { Verifiable } from "@/components/home/Verifiable";
import { serverClient } from "@/lib/client";
import { readLaunch, readLaunchCount, readTokenPage } from "@/lib/reads/launches";
import { readTotals } from "@/lib/reads/totals";
import { CONSTANTS, DEPLOY_BLOCK } from "@/lib/chain";
import { buysUntilPot } from "@/lib/derive";

export const revalidate = 30;

/// Three, because three is what fits the grid without the row breaking, and a
/// preview that needs scrolling is the page it is previewing.
const PREVIEW = 3;

const PRIMARY =
  "border border-cyan px-7 py-4 text-base text-cyan transition-colors hover:bg-cyan hover:text-ground";
const SECONDARY =
  "border border-line-bright px-7 py-4 text-base transition-colors hover:border-text";

export default async function Home() {
  const [head, count, totals] = await Promise.all([
    serverClient.getBlockNumber().catch(() => null),
    readLaunchCount(serverClient).catch(() => 0n),
    readTotals(serverClient).catch(() => ({
      burnedByHooks: null,
      potHeld: null,
      potPaid: null,
      lpDonated: null,
    })),
  ]);

  const tokens = await readTokenPage(serverClient, 0, PREVIEW, count).catch(() => []);
  const launches = await Promise.all(
    tokens.map((t) => readLaunch(serverClient, t, head ?? undefined)),
  ).catch(() => []);

  const lastLaunchBlock = launches.reduce<bigint | null>(
    (acc, l) => (acc === null || l.record.launchBlock > acc ? l.record.launchBlock : acc),
    null,
  );

  // The pot card shows a real counter or says it has none. Whichever launch is
  // closest to paying out is the one worth watching.
  const potFacts: PotFacts = launches
    .filter((l) => l.record.cfg.potBps > 0 && l.record.cfg.potEveryN > 1)
    .map((l) => ({
      symbol: l.symbol,
      balance: l.potBalance,
      buysUntil: buysUntilPot(l),
      everyN: l.record.cfg.potEveryN,
      buysSoFar: l.hookState.potBuyCount,
    }))
    .sort((a, b) => (a.buysUntil ?? 99) - (b.buysUntil ?? 99))[0] ?? null;

  return (
    <>
      <Nav head={head ?? undefined} />

      <main className="mx-auto max-w-7xl px-4">
        {/* Two halves. The left states what the product is; the right lets you
            do it. Neither is decoration for the other. */}
        <section className="grid items-center gap-10 py-16 lg:grid-cols-2 lg:py-20">
          <div>
            <p className="q-label">/ quench</p>
            <h1 className="q-display mt-3 text-5xl sm:text-7xl">
              Build the hook.
              <br />
              <span className="text-cyan">Then quench it.</span>
            </h1>
            <p className="q-lead mt-6 max-w-xl">
              Stack up to five swap rules, launch a fixed-supply token behind them, and
              the rules set at the moment the pool opens. There is no owner, no upgrade
              path and no pause. Not even us.
            </p>

            {/* The first button has to lead somewhere worth arriving at.
                Until something has launched, "Explore markets" promises a market
                and delivers an empty room — so the builder takes the front,
                which costs a visitor nothing and is the thing this site is
                actually for. Discover stays in the navigation throughout, and
                takes the front back the moment there is a market in it. */}
            <div className="mt-8 flex flex-wrap gap-3">
              {count > 0n ? (
                <>
                  <Link href="/app" className={PRIMARY}>
                    Explore markets
                  </Link>
                  <Link href="/builder" className={SECONDARY}>
                    Compose a hook
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/builder" className={PRIMARY}>
                    Compose a hook
                  </Link>
                  <Link href="/launch" className={SECONDARY}>
                    Launch the first token
                  </Link>
                </>
              )}
            </div>

            {/* Renders nothing until an address is set, so this line costs the
                page exactly one component call before listing day. */}
            <TokenAddress />
          </div>

          <HeroComposer />
        </section>

        <LiveMetrics
          initialHead={head}
          totals={totals}
          lastLaunchBlock={lastLaunchBlock}
          totalSupply={CONSTANTS.totalSupply}
          deployBlock={DEPLOY_BLOCK}
        />

        <section className="py-16">
          <p className="q-label">/ the five blocks</p>
          <h2 className="q-display mt-2 text-3xl sm:text-4xl">
            Rules that run inside the swap
          </h2>
          <p className="q-lead mt-4 max-w-2xl">
            Each block is a branch in one immutable Uniswap v4 hook. A block is off when
            its parameters are zero, so what a token does is readable from the chain
            before anyone trades it. The numbers are names — Auto Burn is 03 and runs
            last, because it works on an output the swap has not produced yet.
          </p>

          <div className="mt-8">
            <BlockShowcase pot={potFacts} />
          </div>
        </section>

        {launches.length > 0 && (
          <section className="py-16">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="q-label">/ launched</p>
                <h2 className="q-display mt-2 text-3xl sm:text-4xl">
                  Live on chain 4663
                </h2>
              </div>
              <Link
                href="/app"
                className="q-label border border-line px-3 py-2 hover:border-cyan hover:text-cyan"
              >
                all {count.toString()} →
              </Link>
            </div>

            {/* Three columns only with three cards. Two cards in a three-column
                grid leave a hole on the right, which is the void this redesign
                exists to close. */}
            <div
              className={`mt-6 grid gap-4 sm:grid-cols-2 ${launches.length >= 3 ? "lg:grid-cols-3" : ""}`}
            >
              {launches.map((l) => (
                <LaunchCard key={l.record.token} launch={l} head={head ?? 0n} />
              ))}
            </div>
          </section>
        )}

        <section className="py-16">
          <p className="q-label">/ the path</p>
          <h2 className="q-display mt-2 text-3xl sm:text-4xl">
            From an argument to a rule
          </h2>
          <p className="q-lead mt-4 max-w-2xl">
            Six stages, and only the first two are yours. After the transaction that
            opens the pool, nothing you or we do changes what the hook charges.
          </p>
          <div className="mt-8">
            <LaunchPath />
          </div>
        </section>

        <section className="py-16">
          <p className="q-label">/ why robinhood chain</p>
          <h2 className="q-display mt-2 text-3xl sm:text-4xl">
            Rules this fine need cheap blocks
          </h2>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <Panel bodyClassName="p-4">
              <p className="q-display-sm text-base">Blocks are about 0.1s</p>
              <p className="mt-2 text-dim">
                An anti-snipe window measured in blocks is measured in seconds here, not
                minutes. A 300-block guard is half a minute — long enough to matter to a
                bot, short enough not to punish a person.
              </p>
            </Panel>
            <Panel bodyClassName="p-4">
              <p className="q-display-sm text-base">Gas is nearly free</p>
              <p className="mt-2 text-dim">
                The whole system — router, launchpad, hook, vault, curve — cost 0.00283
                ETH to deploy. The five blocks add tens of thousands of gas to a buy,
                which is a rounding error here and would be a design constraint on
                mainnet.
              </p>
            </Panel>
            <Panel bodyClassName="p-4">
              <p className="q-display-sm text-base">Logs answer fast</p>
              <p className="mt-2 text-dim">
                A filtered query over a day of blocks comes back in under half a second,
                with no range limit. That is why this site has no indexer and no
                database: every figure on it is read from the chain when you ask for it.
              </p>
            </Panel>
          </div>
        </section>

        <section className="py-16">
          <p className="q-label">/ check it yourself</p>
          <h2 className="q-display mt-2 text-3xl sm:text-4xl">
            The claim and the way to test it
          </h2>
          <div className="mt-8">
            <Verifiable />
          </div>
        </section>

        {/* The most honest thing on the page, and for a while the quietest.
            It gets a border and its own section now. */}
        <section className="pb-20">
          <Panel title="what quench does not claim" ticks bodyClassName="p-6">
            <ul className="grid gap-4 text-dim sm:grid-cols-2">
              <li>
                <span className="text-text">The contracts have not been audited.</span>{" "}
                They have tests, a differential check against this site&rsquo;s own
                arithmetic, and no audit. Those are not the same thing.
              </li>
              <li>
                <span className="text-text">The pot is raced.</span> It is won on a
                public counter, not a random one. Anyone reading the chain can see which
                buy takes it and bid to be that buy.
              </li>
              <li>
                <span className="text-text">
                  The hook charges on exact-input buys only.
                </span>{" "}
                Sells and exact-output buys pay the LP fee and nothing else — no burn,
                no pot, no donation.
              </li>
              <li>
                <span className="text-text">Immutable cuts both ways.</span> A config
                that turns out to be wrong stays wrong. There is no one to appeal to,
                which is the point and also the risk.
              </li>
            </ul>
            <p className="mt-6 border-t border-line pt-4 text-faint">
              None of this is financial advice, and none of it is a prediction.
            </p>
          </Panel>
        </section>
      </main>
    </>
  );
}

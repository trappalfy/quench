import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Panel } from "@/components/Panel";
import { serverClient } from "@/lib/client";
import { ADDRESSES, CONSTANTS, explorerAddress } from "@/lib/chain";
import { LIMITS } from "@/lib/hookConfig";
import { formatCount } from "@/lib/format";

export const revalidate = 30;

export const metadata = {
  title: "How it works — Quench",
  description:
    "The two launch paths, the five blocks with their units and ranges, where the fees go, and what Quench does not claim.",
};

export default async function Docs() {
  const head = await serverClient.getBlockNumber().catch(() => undefined);

  return (
    <>
      <Nav head={head} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="q-label">/ docs</p>
        <h1 className="q-display mt-2 text-4xl sm:text-5xl lg:text-6xl">
          How it works,
          <br />
          including the parts
          <br />
          that do not
        </h1>
        <p className="q-lead mt-4 max-w-2xl">
          Quench is a launchpad on Robinhood Chain. A token is a fixed billion units
          behind one immutable Uniswap v4 hook, and everything the hook will ever do is
          decided by the transaction that opens the pool.
        </p>

        <div className="mt-12 grid gap-8 lg:grid-cols-[200px_1fr] xl:grid-cols-[200px_1fr_260px]">
          <nav className="lg:sticky lg:top-24 lg:self-start">
            <p className="q-label">/ contents</p>
            <ul className="mt-3 space-y-1">
              {[
                ["the-token", "The token"],
                ["two-paths", "Two ways to launch"],
                ["the-blocks", "The five blocks"],
                ["fees", "Where the money goes"],
                ["blueprints", "Blueprints"],
                ["limits", "Limits the contract enforces"],
                ["not-claimed", "What Quench does not claim"],
              ].map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className="text-dim hover:text-text">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 space-y-12">
            <Section id="the-token" title="The token">
              <P>
                Every launch mints exactly 1,000,000,000 units with 18 decimals. Supply
                is not a field, cannot be minted afterwards, and the token contract has
                no owner. Name and ticker are stored on it and cannot be changed.
              </P>
              <P>
                A ticker here is held to {CONSTANTS.tickerMinLength}–
                {CONSTANTS.tickerMaxLength} characters. That is our rule, not the
                chain&rsquo;s — the contract accepts any string, and a longer one would
                simply break the columns on this site.
              </P>
              <P>
                There is no logo field and no upload. A token&rsquo;s mark is drawn from
                its address, so it exists the moment the token does and depends on
                nothing we host.
              </P>
            </Section>

            <Section id="two-paths" title="Two ways to launch">
              <P>
                <Strong>Instant.</Strong> You commit ETH and choose an opening price. The
                launchpad mints the supply, opens a full-range position with your ETH and
                as many tokens as that price implies, refunds any ETH that did not bind,
                and burns every token that did not fit. The pool is live in the same
                block, and the hook starts its clock there.
              </P>
              <P>
                <Strong>Bonding curve.</Strong> 800,000,000 tokens — 80% of supply — sell
                in ten tranches of 80,000,000, each priced 1.7× the one before. There is
                no pool and no hook while the curve is selling; the curve is the market.
                When the last tranche sells out, the curve opens the pool itself at the
                tenth price with everything it raised, and the remaining 200,000,000
                tokens become the pool&rsquo;s side of the position.
              </P>
              <P>
                A curve charges {CONSTANTS.curveFeeBps / 100}% on each trade. The five
                blocks do not run on a curve at all — they are hook code, and there is no
                hook until the pool exists.
              </P>
            </Section>

            <Section id="the-blocks" title="The five blocks">
              <P>
                Up to five rules run inside a swap. A block is off when its parameters
                are zero, which is why a token&rsquo;s rules can be read from the chain
                before anyone trades it. All five apply to exact-input buys only.
              </P>

              <Block
                n="01"
                name="Anti-snipe"
                where="beforeSwap, while the window is open"
                params={[
                  ["guardBlocks", `0–${formatCount(LIMITS.guardBlocks)} blocks`],
                  ["maxBuyBps", "1–10,000 bps of the in-range reserve"],
                  ["snipeTaxPips", `0–${formatCount(LIMITS.snipeTaxPips)} pips (0–5%)`],
                ]}
              >
                For the first N blocks after the pool opens, a buy larger than the cap
                reverts with <Code>BuyExceedsGuardCap</Code>, and every buy pays the
                surcharge on top of whatever fee Surge computed. The clock starts when
                the pool opens, which for a curve launch is graduation, not launch.
              </Block>

              <Block
                n="02"
                name="Surge fees"
                where="beforeSwap, every buy"
                params={[
                  ["baseFeePips", "0–100,000 pips (0–10%)"],
                  ["maxFeePips", "at or above baseFeePips, up to 100,000"],
                  ["surgeSens", "0–65,535"],
                ]}
              >
                The LP fee rises linearly with how deep the trade bites into the in-range
                reserve, from the floor at nothing to the ceiling at a buy the size of
                the whole reserve. No oracle and no keeper: it is arithmetic on the
                reserve at the moment of the swap. Sensitivity scales how quickly it
                climbs — at 10,000 the ceiling is reached at 100% depth.
              </Block>

              <Block
                n="03"
                name="Auto burn"
                where="afterSwap, once the output is known"
                params={[
                  ["burnBps", "0–1,000 bps (0–10%) of the tokens bought"],
                  ["burnTriggerWei", "the smallest buy that fires it"],
                ]}
              >
                The hook claims a share of the buyer&rsquo;s output and sends it straight
                to <Code>0x…dEaD</Code> in the same swap. The pool&rsquo;s reserves are
                untouched — what shrinks is only what the buyer receives. This is the one
                block that runs after the swap, because it works on an output the swap
                has not produced yet.
              </Block>

              <Block
                n="04"
                name="LP rewards"
                where="beforeSwap, out of the input"
                params={[["lpBps", "0–1,000 bps, shared with the pot"]]}
              >
                A share of the ETH is donated to whoever holds in-range liquidity before
                the swap sees it. The ETH never leaves the pool: the hook takes a credit
                and <Code>donate</Code> spends it, so the two net to zero and the value
                lands in the LPs&rsquo; fee growth.
              </Block>

              <Block
                n="05"
                name="Nth-buy pot"
                where="beforeSwap, out of the input"
                params={[
                  ["potBps", "0–1,000 bps, shared with LP rewards"],
                  ["potEveryN", "2–1,000 qualifying buys"],
                  ["potMinBuyWei", "the smallest buy that counts"],
                ]}
              >
                A share of each buy accumulates in the pot vault, and every Nth
                qualifying buy takes the whole pot. The counter advances at most once per
                block — without that, N−1 dust buys and one real buy in a single block
                would win it every time. The counter is public, and the pot will be
                raced.
              </Block>
            </Section>

            <Section id="fees" title="Where the money goes">
              <P>
                The pool&rsquo;s own LP fee accrues to the position the launchpad holds.
                Anyone can call <Code>claimFees</Code> for a token; the ETH side splits
                between the creator and the protocol at the share fixed at launch, and if
                the launch used a blueprint, its author&rsquo;s royalty comes out of the
                creator&rsquo;s half. The token side of the fee is burned rather than
                paid out.
              </P>
              <P>
                A creator&rsquo;s share is capped at{" "}
                {CONSTANTS.maxCreatorFeeBps / 100}% and a blueprint royalty at{" "}
                {CONSTANTS.maxRoyaltyBps / 100}%. Both are set at launch and neither can
                be changed afterwards.
              </P>
              <P>
                LP rewards and the pot are not fees: they come out of the buyer&rsquo;s
                input before the swap, and together they cannot exceed{" "}
                {LIMITS.ethCutBps / 100}% of a buy.
              </P>
            </Section>

            <Section id="blueprints" title="Blueprints">
              <P>
                A blueprint is a published config anyone can launch against. When a
                launch names one, the launchpad uses the blueprint&rsquo;s config
                verbatim and ignores whatever else the caller passed — so what a
                blueprint says is what the pool runs.
              </P>
              <P>
                A blueprint cannot be edited or withdrawn. Its author earns a royalty on
                the fees of every token launched from it, and being listed is not an
                endorsement of anything: it means somebody paid gas.{" "}
                <Link className="text-cyan" href="/hooks">
                  The registry
                </Link>{" "}
                shows every one with the exact settings it saved.
              </P>
            </Section>

            <Section id="limits" title="Limits the contract enforces">
              <P>
                These are checks in <Code>BlockHook._validate</Code> and{" "}
                <Code>Launchpad</Code>, not house style. A config that breaks one reverts
                with the error named beside it, and{" "}
                <Link className="text-cyan" href="/builder">
                  the builder
                </Link>{" "}
                applies the same nine checks before you spend gas finding out.
              </P>
              <table className="mt-4 w-full text-dim">
                <tbody>
                  {[
                    ["max fee above 100,000 pips", "BadFeeBounds"],
                    ["base fee above the max fee", "BadFeeBounds"],
                    ["lpBps + potBps above 1,000", "EthCutTooLarge"],
                    ["snipe surcharge above 50,000 pips", "SnipeTaxTooLarge"],
                    ["burn above 1,000 bps", "BurnTooLarge"],
                    ["guard longer than 7,200 blocks", "GuardTooLong"],
                    ["N below 2 or above 1,000", "BadPotEveryN"],
                    ["a guard window with no cap", "BadMaxBuyBps"],
                    ["a burn with no minimum buy", "BurnNeedsTrigger"],
                    ["a pool over the launchpad's ETH cap", "PoolTooLarge"],
                    ["a creator share above 80%", "CreatorFeeTooHigh"],
                    ["a blueprint royalty above 20%", "RoyaltyTooHigh"],
                  ].map(([what, error]) => (
                    <tr key={what + error} className="border-t border-line">
                      <td className="py-1.5 pr-4">{what}</td>
                      <td className="py-1.5 text-right text-fail">{error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section id="not-claimed" title="What Quench does not claim">
              <Panel bodyClassName="p-4">
                <ul className="space-y-3 text-dim">
                  <li>
                    <Strong>No audit.</Strong> There are tests, invariants and a
                    differential check between the contracts and this site&rsquo;s
                    arithmetic. None of that is an audit and none of it is a guarantee.
                  </li>
                  <li>
                    <Strong>No MEV protection.</Strong> The pot is won on a public
                    counter, not a random one. Ordering is whatever the sequencer does.
                  </li>
                  <li>
                    <Strong>Buys only.</Strong> Sells and exact-output buys pay the LP fee
                    and nothing else — no burn, no pot, no donation.
                  </li>
                  <li>
                    <Strong>Immutable cuts both ways.</Strong> A config that turns out to
                    be wrong stays wrong. Nobody can fix it, us included.
                  </li>
                  <li>
                    <Strong>No source verification yet.</Strong> The explorer&rsquo;s
                    submission API sits behind a challenge that refuses automated
                    uploads, so the bytecode at{" "}
                    <a
                      className="text-cyan"
                      href={explorerAddress(ADDRESSES.blockHook)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      the hook&rsquo;s address
                    </a>{" "}
                    is not yet matched to source there.
                  </li>
                </ul>
              </Panel>
              <P>
                How every figure on this site is computed, and why some of them are a
                dash, is in{" "}
                <Link className="text-cyan" href="/methodology">
                  the methodology
                </Link>
                .
              </P>
            </Section>
          </div>

          {/* Everything the contracts hardcode, in one column. Prose wants a
              measure; the space beside it wants facts, not filler. */}
          <aside className="hidden xl:sticky xl:top-24 xl:block xl:self-start">
            <Panel title="fixed by the contracts" bodyClassName="p-4">
              <dl className="space-y-2">
                {[
                  ["chain", "4663"],
                  ["supply", "1,000,000,000"],
                  ["decimals", "18"],
                  ["on the curve", "800,000,000"],
                  ["tranches", `${CONSTANTS.tranches} × 80,000,000`],
                  ["tranche step", "1.7×"],
                  ["curve fee", `${CONSTANTS.curveFeeBps / 100}%`],
                  ["creator share", `≤ ${CONSTANTS.maxCreatorFeeBps / 100}%`],
                  ["blueprint royalty", `≤ ${CONSTANTS.maxRoyaltyBps / 100}%`],
                  ["ETH cut per buy", `≤ ${LIMITS.ethCutBps / 100}%`],
                  ["burn", `≤ ${LIMITS.burnBps / 100}%`],
                  ["guard window", `≤ ${formatCount(LIMITS.guardBlocks)} blocks`],
                  ["tick spacing", CONSTANTS.tickSpacing.toString()],
                  ["hook flags", "0x28CC"],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3">
                    <dt className="q-label shrink-0">{k}</dt>
                    <dd className="min-w-0 truncate text-right">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 border-t border-line pt-3 text-[11px] text-faint">
                None of these is configurable. They are constants in the source or
                immutables set at deployment.
              </p>
            </Panel>
          </aside>
        </div>
      </main>
    </>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="scroll-mt-24">
      <h2 id={id} className="q-display scroll-mt-24 text-2xl sm:text-3xl">
        {title}
      </h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="max-w-2xl text-dim">{children}</p>;
}

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="text-text">{children}</span>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="text-text">{children}</code>;
}

function Block({
  n,
  name,
  where,
  params,
  children,
}: {
  n: string;
  name: string;
  where: string;
  params: [string, string][];
  children: React.ReactNode;
}) {
  return (
    <Panel title={`${n} ${name}`} right={<span className="q-label">{where}</span>} bodyClassName="p-4">
      <p className="max-w-2xl text-dim">{children}</p>
      <dl className="mt-4 space-y-1.5 border-t border-line pt-3">
        {params.map(([k, v]) => (
          <div key={k} className="flex flex-wrap items-baseline justify-between gap-3">
            <dt className="shrink-0 text-text">{k}</dt>
            <dd className="min-w-0 text-right text-[12px] text-faint">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

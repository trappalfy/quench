import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Panel } from "@/components/Panel";
import { Section, P, Strong, Code, Points, Contents } from "@/components/Prose";
import { serverClient } from "@/lib/client";
import { ADDRESSES, CONSTANTS, DEPLOY_BLOCK, robinhood } from "@/lib/chain";
import { formatBps, formatCount } from "@/lib/format";

export const revalidate = 3600;

export const metadata = {
  title: "Terms — Quench",
  description:
    "What Quench is, what it is not, who holds what, and the risks of using it. Written to be read.",
};

const LAST_UPDATED = "1 September 2026";

const SECTIONS = [
  ["what", "What Quench is"],
  ["custody", "Keys and funds"],
  ["fees", "Where the money goes"],
  ["listing", "Not an endorsement"],
  ["risk", "What can go wrong"],
  ["you", "Your side"],
  ["warranty", "No warranty"],
] as const;

export default async function Terms() {
  const head = await serverClient.getBlockNumber().catch(() => undefined);

  return (
    <>
      <Nav head={head} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="q-label">/ terms</p>
        <h1 className="q-display mt-2 text-4xl sm:text-5xl lg:text-6xl">
          Terms, written
          <br />
          to be read
        </h1>
        <p className="q-lead mt-4 max-w-2xl">
          Most of what follows is a description of how Quench already works rather
          than a promise about how it might. That is deliberate: the contracts cannot
          be changed, so the honest version of these terms is mostly a statement of
          fact.
        </p>
        <p className="q-label mt-4">last updated {LAST_UPDATED}</p>

        <div className="mt-12 grid gap-8 lg:grid-cols-[200px_1fr]">
          <Contents items={SECTIONS} />

          <div className="min-w-0 space-y-12">
            <Section id="what" title="What Quench is">
              <P>
                Quench is two separate things, and the difference matters more here than
                it does on most sites.
              </P>
              <Points
                items={[
                  <>
                    <Strong>The contracts.</Strong> Deployed to {robinhood.name} (chain{" "}
                    {robinhood.id}) at block {formatCount(Number(DEPLOY_BLOCK))} and immutable
                    from that moment. They have no owner, no upgrade path and no pause
                    function. Nobody — including whoever runs this site — can change
                    what they do, stop them, or take anything out of them.
                  </>,
                  <>
                    <Strong>This interface.</Strong> A website that reads those contracts
                    and helps you build transactions for them. It can be changed, taken
                    offline, or become wrong. If it disappears tomorrow, every pool,
                    curve and hook carries on exactly as before, and anyone can reach
                    them directly.
                  </>,
                ]}
              />
              <P>
                Using the interface is optional. Using the contracts through it does not
                create a relationship with us beyond your visit to this site.
              </P>
            </Section>

            <Section id="custody" title="We never hold your keys or your funds">
              <P>
                There is no account here, and nothing to sign up for. Your wallet holds
                your keys, signs your transactions, and broadcasts them through its own
                connection.
              </P>
              <P>
                This site&rsquo;s only route to the chain is <Code>/api/rpc</Code>, and
                it allows reads only — <Code>eth_sendRawTransaction</Code> is absent from
                its list on purpose, because a wallet does not need us to relay anything
                and we do not want to be able to. Quench will never ask you for a private
                key, a seed phrase or a keystore password, and any page or person that
                does is not us.
              </P>
            </Section>

            <Section id="fees" title="Where the money goes">
              <P>
                Every split below is fixed by the contracts at launch and taken by them,
                not by this site.
              </P>
              <Panel title="the splits" bodyClassName="p-4">
                <dl className="space-y-2">
                  <Row
                    k="curve fee"
                    v={formatBps(CONSTANTS.curveFeeBps)}
                    note="taken on each trade against a bonding curve"
                  />
                  <Row
                    k="creator's share of pool fees"
                    v={`up to ${formatBps(CONSTANTS.maxCreatorFeeBps)}`}
                    note="chosen at launch; the remainder goes to the protocol"
                  />
                  <Row
                    k="blueprint royalty"
                    v={`up to ${formatBps(CONSTANTS.maxRoyaltyBps)}`}
                    note="out of the creator's share, never on top of it"
                  />
                </dl>
              </Panel>
              <P>
                A pool&rsquo;s LP fee accrues to the position the launchpad holds, and
                anyone may push it out — the destinations were fixed at launch, so it
                lands in the same places no matter who pays the gas. The token side of a
                claim is burned.
              </P>
            </Section>

            <Section id="listing" title="Nothing here is an endorsement">
              <P>
                A token appearing on this site means somebody paid gas to launch it.
                That is the whole of what it means. A blueprint in the registry means
                somebody paid gas to publish it.
              </P>
              <P>
                We do not review tokens, vet creators, or check that a name belongs to
                whoever used it. Two tokens may carry the same name and symbol; the
                address is the only identity that cannot be copied, which is why it is
                on every card and every page.
              </P>
            </Section>

            <Section id="risk" title="What can go wrong">
              <Points
                items={[
                  <>
                    <Strong>There has been no audit.</Strong> The contracts have tests, a
                    fuzzed set of invariants and a differential check against this
                    site&rsquo;s own arithmetic. None of that is an audit, and we do not
                    describe it as one.
                  </>,
                  <>
                    <Strong>Immutability cuts both ways.</Strong> A configuration that
                    turns out to be wrong is wrong permanently. There is nobody to appeal
                    to, and that is the point as much as it is the risk.
                  </>,
                  <>
                    <Strong>The pot is raced.</Strong> It is won on a public counter, not
                    a random one. Anyone reading the chain can see which buy takes it and
                    bid to be that buy.
                  </>,
                  <>
                    <Strong>Nothing here defends against MEV.</Strong> Your transaction is
                    visible before it lands and can be ordered around.
                  </>,
                  <>
                    <Strong>Quoted numbers can still be wrong.</Strong> Trades are
                    simulated against the chain before your wallet opens, which catches
                    most of it, but the state can move between the simulation and the
                    transaction.
                  </>,
                  <>
                    <Strong>You can lose everything you put in.</Strong> These are
                    volatile assets with no floor, launched by strangers.
                  </>,
                ]}
              />
            </Section>

            <Section id="you" title="Your side">
              <P>
                You are responsible for whether using this is lawful where you are, for
                the transactions you sign, and for the keys that sign them. Do not use
                Quench to launder money, to defraud people, or in any way that breaks the
                law that applies to you.
              </P>
              <P>
                We may change or withdraw this interface at any time, including without
                notice. We cannot change or withdraw the contracts, so a change here
                never takes anything away from a token that already exists.
              </P>
            </Section>

            <Section id="warranty" title="No warranty, and the limit of what we owe you">
              <P>
                The interface is provided as it is, with no warranty of any kind: not
                that it is accurate, not that it is available, not that it fits any
                purpose you have in mind. To the fullest extent the law allows, we are
                not liable for any loss arising from using it or from being unable to
                use it — including losses from trades, from a figure shown here being
                wrong, and from the contracts behaving in ways nobody anticipated.
              </P>
              <P>
                Nothing on this site is financial, investment, tax or legal advice, and
                nothing on it is a prediction.
              </P>
            </Section>
          </div>
        </div>

        <p className="q-rule mt-12 pt-4 text-faint">
          The contracts these terms describe are at{" "}
          <Code>{ADDRESSES.launchpad}</Code> and can be read without this site.{" "}
          <Link href="/privacy" className="underline hover:text-text">
            What this site knows about you
          </Link>
        </p>
      </main>
    </>
  );
}

function Row({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <dt className="text-text">{k}</dt>
        <dd className="text-cyan">{v}</dd>
      </div>
      <p className="q-label mt-0.5">{note}</p>
    </div>
  );
}

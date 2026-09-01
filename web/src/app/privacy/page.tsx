import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Section, P, Strong, Code, Points } from "@/components/Prose";
import { serverClient } from "@/lib/client";

export const revalidate = 3600;

export const metadata = {
  title: "Privacy — Quench",
  description:
    "What this site sees, what it keeps, and what it sends elsewhere. There is no database, no account and no analytics.",
};

const LAST_UPDATED = "1 September 2026";

export default async function Privacy() {
  const head = await serverClient.getBlockNumber().catch(() => undefined);

  return (
    <>
      <Nav head={head} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="q-label">/ privacy</p>
        <h1 className="q-display mt-2 text-4xl sm:text-5xl lg:text-6xl">
          What this site
          <br />
          knows about you
        </h1>
        <p className="q-lead mt-4 max-w-2xl">
          Short version: there is no account, no database, no cookie and no analytics.
          You can check the second half of that yourself — open the network tab and
          load any page here. Nothing is requested from a third-party host.
        </p>
        <p className="q-label mt-4">last updated {LAST_UPDATED}</p>

        <div className="mt-12 space-y-12">
          <Section id="none" title="What we do not collect">
            <Points
              items={[
                <>
                  <Strong>No accounts.</Strong> Nothing to sign up for, so no name, no
                  email, no password.
                </>,
                <>
                  <Strong>No analytics and no trackers.</Strong> No Google Analytics,
                  no pixels, no session recording, no third-party scripts of any kind.
                  If that ever changes, this page changes before it does.
                </>,
                <>
                  <Strong>No cookies.</Strong> None are set by this site.
                </>,
                <>
                  <Strong>No database.</Strong> There is nowhere here for your data to
                  be stored, because every figure on the site is read from the chain
                  when you ask for it.
                </>,
                <>
                  <Strong>No fonts fetched from Google.</Strong> The two typefaces are
                  downloaded once when the site is built and served from this domain,
                  so loading a page does not tell Google you were here.
                </>,
              ]}
            />
          </Section>

          <Section id="server" title="What the server necessarily sees">
            <P>
              A web request cannot be made anonymously to the server answering it. When
              you load a page, our host receives what every web server receives: the
              address you asked for, your IP address, your browser&rsquo;s user agent,
              and the time.
            </P>
            <P>
              <Code>/api/rpc</Code> — the only route the browser uses to reach the
              chain — counts calls per IP address in memory over a ten-second window,
              so that one tab cannot flood the endpoint. The counter is held in the
              running process and nothing else, it is not written anywhere, and it is
              gone when the process is recycled.
            </P>
            <P>
              We do not build profiles from any of this and we do not join it to your
              wallet address.
            </P>
          </Section>

          <Section id="elsewhere" title="Where a request goes after it leaves you">
            <Points
              items={[
                <>
                  <Strong>Vercel</Strong> hosts this site. Requests reach their
                  servers, and they keep operational logs under their own policy.
                </>,
                <>
                  <Strong>The chain&rsquo;s public RPC endpoint</Strong> receives the
                  reads our server forwards. Those come from our server, not from your
                  browser, so the endpoint sees us rather than you.
                </>,
                <>
                  <Strong>Your wallet</Strong> is software you chose and it has its own
                  policy. When you sign a transaction, it goes out through your
                  wallet&rsquo;s connection, not ours.
                </>,
                <>
                  <Strong>The block explorer</Strong> only sees you if you click one of
                  the links to it. Those are ordinary links, followed only on purpose.
                </>,
              ]}
            />
          </Section>

          <Section id="device" title="What is kept on your device">
            <P>
              One entry in your browser&rsquo;s local storage, <Code>quench.wallet</Code>,
              holding the identifier of the wallet you last connected — something like{" "}
              <Code>io.metamask</Code>. It exists so that returning to the site can
              reconnect to the same wallet without asking, and it is removed when you
              disconnect.
            </P>
            <P>
              No address, no balance and no key is stored. Nothing in local storage is
              ever sent to us.
            </P>
          </Section>

          <Section id="chain" title="The chain is public, and we did not make it so">
            <P>
              Every transaction you sign, the address that signed it and everything it
              moved are recorded permanently on a public chain that anyone can read.
              That is a property of the network, not of this site, and connecting a
              wallet here does not make it more public than it already was.
            </P>
            <P>
              What connecting does is let this page read balances for the address you
              chose to connect, in your browser, so that a trade panel can show what
              you hold.
            </P>
          </Section>

          <Section id="rights" title="Asking us about your data">
            <P>
              There is very little to ask about: with no accounts and no database, we
              hold no record that identifies you. If you believe otherwise, or want to
              know what our host&rsquo;s logs contain, ask — and if we ever start
              keeping something, this page will say so first.
            </P>
          </Section>
        </div>

        <p className="q-rule mt-12 pt-4 text-faint">
          The claim that this page loads nothing from a third party is checkable in
          your browser, which is the only kind of privacy claim worth making.{" "}
          <Link href="/terms" className="underline hover:text-text">
            Terms
          </Link>
        </p>
      </main>
    </>
  );
}

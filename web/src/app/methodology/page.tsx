import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Panel } from "@/components/Panel";
import { serverClient } from "@/lib/client";
import { DEPLOY_BLOCK } from "@/lib/chain";

export const revalidate = 30;

export const metadata = {
  title: "Methodology — Quench",
  description:
    "Where every figure on this site comes from, how it is computed, and why some of them are a dash.",
};

/// One row per figure the site shows. Kept as data rather than prose so a
/// number that gains a new source is a line here, not a paragraph somewhere.
const FIGURES: { what: string; from: string; caveat?: string }[] = [
  {
    what: "Price of a graduated token",
    from: "slot0 of its pool, read through extsload and converted to wei per whole token. v4 has no getter; the storage slot is keccak256(poolId ++ 6) and slot0 is the first word.",
    caveat:
      "ETH is currency0, so the pool quotes tokens per ETH — the inverse of the price shown. This was once implemented backwards and every check passed, because the fixture opened at exactly 1:1.",
  },
  {
    what: "Price of a token still on its curve",
    from: "The tranche it is currently selling from: p0 × 1.7^i, taken from the curve's own table.",
  },
  {
    what: "FDV",
    from: "That price times the whole billion. It is an ETH figure and never a dollar one — there is no oracle here and we do not pretend to one.",
  },
  {
    what: "In-range ETH reserve",
    from: "liquidity × 2^96 ÷ sqrtPriceX96, the same expression BlockMath uses. Both values come from the pool's storage, one slot apart.",
  },
  {
    what: "Curve progress and target",
    from: "Tokens sold against the 800,000,000 on the curve. The sellout target is p0 × 80,000,000 × Σ1.7^i, reimplemented here and asserted against the contract's own totalRaiseAtFullSellout to the wei.",
  },
  {
    what: "Tokens burned by a rule",
    from: "The hook's AutoBurned events for that pool, summed.",
    caveat:
      "Deliberately not the balance at 0x…dEaD. An instant launch burns whatever supply did not fit the opening position, and that is a consequence of the price, not the Auto Burn block doing something. The two are shown separately.",
  },
  {
    what: "Pot balance",
    from: "The vault's own balanceOf for that pool. The site-wide total is the vault's ETH balance.",
  },
  {
    what: "ETH donated to LPs",
    from: "The pool manager's Donate events with the hook as sender. Every donate on a Quench pool comes from the hook; nothing else has a reason to call it.",
  },
  {
    what: "Activity feed",
    from: "Five log queries per read — the hook, the launchpad, every curve at once, and the pool manager for graduated pools.",
    caveat:
      "A swap's direction comes from the sign of amount0. v4 emits the swapper's delta, not the pool's, so a buy shows it negative. Read the other way round, every buy is labelled a sell.",
  },
  {
    what: "Ages in seconds, minutes and hours",
    from: "A block delta divided by the measured rate of about ten blocks a second.",
    caveat:
      "An approximation, and marked as one. The block rate is measured, not promised, and nothing here depends on it being exact.",
  },
  {
    what: "Gas a hook stack costs",
    from: "Measured in test/unit/BlockGas.t.sol: a 0.1 ETH buy against a 10 ETH pool, second buy so the storage is warm.",
    caveat:
      "The marginal costs do not add up to the whole, because the blocks share work. A full stack is quoted from its own measurement rather than from the sum.",
  },
  {
    what: "What a buy would cost",
    from: "ts/src/simulate.ts, which mirrors BlockMath.sol statement for statement and is checked against it on the same 2,000 vectors.",
  },
];

export default async function Methodology() {
  const head = await serverClient.getBlockNumber().catch(() => undefined);

  return (
    <>
      <Nav head={head} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="q-label">/ methodology</p>
        <h1 className="q-display mt-2 text-4xl sm:text-5xl lg:text-6xl">
          Where every
          <br />
          number comes from
        </h1>
        <p className="q-lead mt-4 max-w-2xl">
          There is no database behind this site and no indexer. Every figure is read from
          Robinhood Chain when you ask for it, either from contract storage or from event
          logs since block {DEPLOY_BLOCK.toString()}, where the launchpad was deployed.
        </p>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-3">
            {FIGURES.map((f) => (
              <Panel key={f.what} bodyClassName="p-4">
                <p className="q-display-sm text-base">{f.what}</p>
                <p className="mt-2 text-dim">{f.from}</p>
                {f.caveat && (
                  <p className="mt-2 border-l-2 border-amber pl-3 text-[12px] text-faint">
                    {f.caveat}
                  </p>
                )}
              </Panel>
            ))}
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
            <Panel title="why a figure is a dash" ticks bodyClassName="p-4">
              <p className="text-dim">
                A dash means the question was asked and not answered. It never means
                zero.
              </p>
              <ul className="mt-3 space-y-2 text-dim">
                <li>
                  The value does not exist yet — a token on its curve has no pool, so it
                  has no pool price, and reading slot 0 would return zeros that look like
                  one.
                </li>
                <li>
                  The chain did not answer. A failed read leaves the last good value or a
                  dash; it never substitutes an estimate.
                </li>
                <li>
                  The query hit the node&rsquo;s 10,000-log cap. The window is halved and
                  retried, and if that still fails the figure is a dash rather than a
                  partial sum presented as a total.
                </li>
              </ul>
            </Panel>

            <Panel title="what we do not compute" bodyClassName="p-4">
              <ul className="space-y-2 text-dim">
                <li>
                  <span className="text-text">Holders.</span> The explorer&rsquo;s API is
                  behind a challenge that refuses automated requests, and counting from
                  Transfer logs breaks on an active token. Rather than show a number that
                  is right for quiet tokens and wrong for busy ones, we show none.
                </li>
                <li>
                  <span className="text-text">Anything in dollars.</span> There is no
                  price oracle on this chain that we would trust, so every figure is in
                  ETH.
                </li>
                <li>
                  <span className="text-text">Predictions.</span> No projected returns, no
                  implied valuations, no &ldquo;potential&rdquo;.
                </li>
              </ul>
            </Panel>

            <Panel title="how it is checked" bodyClassName="p-4">
              <p className="text-dim">
                The reading layer runs against a forked chain seeded with real launches,
                and asserts its own answers against the contracts&rsquo; — the sellout
                target to the wei, the pot against the vault, the protocol-wide totals
                against the sum of the per-launch reads.
              </p>
              <Link
                href="/docs"
                className="q-label mt-4 inline-block border border-line px-3 py-2 hover:border-cyan hover:text-cyan"
              >
                how the protocol works
              </Link>
            </Panel>
          </aside>
        </div>
      </main>
    </>
  );
}

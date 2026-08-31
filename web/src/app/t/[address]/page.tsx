import Link from "next/link";
import { notFound } from "next/navigation";
import { isAddress, getAddress } from "viem";
import { Nav } from "@/components/Nav";
import { Panel } from "@/components/Panel";
import { Stat } from "@/components/Stat";
import { Tile } from "@/components/Tile";
import { QuenchLine } from "@/components/QuenchLine";
import { HookPanel } from "@/components/HookPanel";
import { serverClient } from "@/lib/client";
import { readLaunch } from "@/lib/reads/launches";
import { inRangeEthReserve } from "@/lib/reads/pool";
import { ADDRESSES, explorerAddress } from "@/lib/chain";
import { curveProgress, curveTarget, fdvOf, lifecycleOf, priceOf } from "@/lib/derive";
import {
  blocksToApproxAge,
  formatCompactTokens,
  formatEth,
  formatEthCompact,
  formatPrice,
  truncateAddress,
} from "@/lib/format";

export const revalidate = 5;

const ZERO = "0x0000000000000000000000000000000000000000";

export default async function TokenPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  const token = getAddress(address);

  const [head, launch] = await Promise.all([
    serverClient.getBlockNumber(),
    readLaunch(serverClient, token).catch(() => null),
  ]);

  // An address the registry does not know is not a Quench token, and saying so
  // is more useful than rendering a page of dashes.
  if (!launch || launch.record.token === ZERO) notFound();

  const state = lifecycleOf(launch);
  const price = priceOf(launch);
  const fdv = fdvOf(launch);
  const progress = curveProgress(launch);
  const target = curveTarget(launch);
  const reserve = launch.pool ? inRangeEthReserve(launch.pool) : null;

  return (
    <>
      <Nav head={head} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <header className="flex flex-wrap items-start gap-4">
          <Tile address={token} state={state} px={72} />
          <div className="min-w-0 flex-1">
            <p className="q-label">
              / {state === "set" ? "graduated · rules set" : "on the curve · still molten"}
            </p>
            <h1 className="q-display mt-1 text-5xl">{launch.name}</h1>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className={state === "set" ? "text-cyan" : "text-amber"}>
                ${launch.symbol}
              </span>
              <a
                href={explorerAddress(token)}
                target="_blank"
                rel="noreferrer"
                className="q-label hover:text-text"
              >
                {truncateAddress(token, 10, 8)} ↗
              </a>
              <span className="q-label">
                launched {blocksToApproxAge(head - launch.record.launchBlock)} ago by{" "}
                {truncateAddress(launch.record.creator)}
              </span>
            </div>
          </div>
        </header>

        <div className="mt-6 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
          <div className="bg-panel px-4 py-3">
            <Stat
              label="price"
              accent={state === "set" ? "cyan" : "amber"}
              width={16}
              suffix="ETH"
              value={price !== null ? formatPrice(price) : undefined}
              unknown={price === null ? "the pool has not opened yet" : undefined}
            />
          </div>
          <div className="bg-panel px-4 py-3">
            <Stat
              label="fdv"
              width={12}
              suffix="ETH"
              value={fdv !== null ? formatEthCompact(fdv) : undefined}
              unknown={fdv === null ? "no price to derive it from" : undefined}
            />
          </div>
          <div className="bg-panel px-4 py-3">
            <Stat
              label="supply"
              width={10}
              suffix={launch.symbol}
              value={formatCompactTokens(launch.totalSupply)}
            />
          </div>
          <div className="bg-panel px-4 py-3">
            <Stat
              label={state === "set" ? "in-range reserve" : "raised"}
              width={12}
              suffix="ETH"
              value={
                state === "set"
                  ? reserve !== null
                    ? formatEth(reserve)
                    : undefined
                  : launch.curve
                    ? formatEth(launch.curve.raised)
                    : undefined
              }
              unknown={
                state === "set" && reserve === null
                  ? "pool state could not be read"
                  : undefined
              }
            />
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            {progress !== null && launch.curve && (
              <Panel title="bonding curve" ticks>
                <QuenchLine progress={progress} done={launch.record.graduated} height={6} />
                <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="tranche" value={`${launch.curve.tranche + 1} / 10`} width={7} />
                  <Stat
                    label="sold"
                    value={formatCompactTokens(launch.curve.sold)}
                    suffix={launch.symbol}
                    width={9}
                  />
                  <Stat
                    label="raised"
                    value={formatEth(launch.curve.raised)}
                    suffix="ETH"
                    width={10}
                  />
                  <Stat
                    label="target"
                    value={target ? formatEth(target) : undefined}
                    unknown={target ? undefined : "the curve did not report p0"}
                    suffix="ETH"
                    width={10}
                  />
                </div>
                <p className="mt-3 text-dim">
                  Trades run through the curve until the last of ten tranches sells out.
                  Graduation happens inside that same transaction: the raise opens a
                  Uniswap v4 pool at the final curve price with this hook attached, and
                  the liquidity has no removal function.
                </p>
              </Panel>
            )}

            <HookPanel launch={launch} head={head} />
          </div>

          <aside className="space-y-6">
            {/* Trading is not wired yet. An inert Buy button would be worse than
                saying so: it implies a wallet path has been tested when none
                has been written. */}
            <Panel title="trade">
              <p className="text-dim">
                Trading from this page is not connected yet. Until it is, this page is
                for reading the rules — every figure above comes straight from the chain.
              </p>
            </Panel>

            <Panel title="onchain">
              <dl className="space-y-2">
                <Row label="token" value={token} />
                <Row label="creator" value={launch.record.creator} />
                {launch.curve && <Row label="curve" value={launch.record.curve} />}
                <Row label="hook" value={ADDRESSES.blockHook} />
                <Row label="launchpad" value={ADDRESSES.launchpad} />
                <div className="flex items-baseline justify-between gap-2 pt-2">
                  <dt className="q-label">pool id</dt>
                  <dd className="text-faint">{truncateAddress(launch.poolId, 10, 8)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="q-label">chain</dt>
                  <dd className="text-faint">Robinhood Chain · 4663</dd>
                </div>
              </dl>
            </Panel>
          </aside>
        </div>

        <p className="q-rule mt-10 pt-4 text-faint">
          Quench has not been audited. The pot is won on a public counter, not a random
          one, and it will be raced. Nothing here is advice.{" "}
          <Link href="/docs" className="underline hover:text-text">
            What we do and do not claim
          </Link>
        </p>
      </main>
    </>
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

import Link from "next/link";
import { Tile } from "./Tile";
import { QuenchLine } from "./QuenchLine";
import { BlockBadges } from "./BlockBadges";
import { Stat } from "./Stat";
import type { Launch } from "@/lib/reads/launches";
import {
  blockHeat,
  curveProgress,
  curveTarget,
  fdvOf,
  lifecycleOf,
  priceOf,
  temperatureOf,
} from "@/lib/derive";
import {
  blocksToApproxAge,
  formatEth,
  formatEthCompact,
  formatPrice,
  truncateAddress,
} from "@/lib/format";

export function LaunchCard({ launch, head }: { launch: Launch; head: bigint }) {
  const state = lifecycleOf(launch);
  const temperature = temperatureOf(launch);
  const heat = blockHeat(launch, head);
  const price = priceOf(launch);
  const fdv = fdvOf(launch);
  const progress = curveProgress(launch);
  const target = curveTarget(launch);

  return (
    <Link
      href={`/t/${launch.record.token}`}
      className="group flex flex-col border border-line bg-panel transition-colors hover:border-line-bright"
    >
      <div className="flex items-start gap-3 p-4">
        <Tile address={launch.record.token} temperature={temperature} px={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="q-display-sm truncate text-lg">{launch.name}</span>
            <span className={state === "set" ? "text-cyan" : "text-amber"}>
              ${launch.symbol}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-faint">
            <span className="q-label">{truncateAddress(launch.record.creator)}</span>
            <span className="q-label">
              {blocksToApproxAge(head - launch.record.launchBlock)} ago
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-line px-4 py-3">
        <Stat
          label="price"
          width={14}
          accent={state === "set" ? "cyan" : "amber"}
          value={price !== null ? formatPrice(price) : undefined}
          unknown={price === null ? "the pool has not opened yet" : undefined}
          suffix="ETH"
        />
        <Stat
          label="fdv"
          width={12}
          value={fdv !== null ? formatEthCompact(fdv) : undefined}
          unknown={fdv === null ? "no price to derive it from" : undefined}
          suffix="ETH"
        />
      </div>

      {progress !== null && (
        <div className="px-4 pb-3">
          <QuenchLine progress={progress} done={launch.record.graduated} />
          <div className="mt-1.5 flex justify-between">
            <span className="q-label">
              tranche {launch.curve ? launch.curve.tranche + 1 : "—"}/10
            </span>
            <span className="q-label">
              {launch.curve ? formatEth(launch.curve.raised) : "—"}
              {target ? ` / ${formatEth(target)}` : ""} ETH
            </span>
          </div>
        </div>
      )}

      {/* Pushed to the bottom so the badge row lines up across a grid of cards
          whose bodies differ in height — the row is the thing being compared. */}
      <div className="mt-auto border-t border-line px-4 py-3">
        <BlockBadges cfg={launch.record.cfg} heat={heat} compact />
      </div>
    </Link>
  );
}

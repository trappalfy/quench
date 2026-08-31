import Link from "next/link";
import { Tile } from "./Tile";
import { QuenchLine } from "./QuenchLine";
import { BlockBadges } from "./BlockBadges";
import { Stat } from "./Stat";
import type { Launch } from "@/lib/reads/launches";
import { curveProgress, curveTarget, fdvOf, lifecycleOf, priceOf } from "@/lib/derive";
import { blocksToApproxAge, formatEth, formatEthCompact, formatPrice, truncateAddress } from "@/lib/format";

export function LaunchCard({ launch, head }: { launch: Launch; head: bigint }) {
  const state = lifecycleOf(launch);
  const price = priceOf(launch);
  const fdv = fdvOf(launch);
  const progress = curveProgress(launch);
  const target = curveTarget(launch);

  return (
    <Link
      href={`/t/${launch.record.token}`}
      className="group block border border-line bg-panel transition-colors hover:border-line-bright"
    >
      <div className="flex items-start gap-3 p-3">
        <Tile address={launch.record.token} state={state} px={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="q-display-sm truncate text-lg">{launch.name}</span>
            <span className={state === "set" ? "text-cyan" : "text-amber"}>${launch.symbol}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-faint">
            <span className="q-label">{truncateAddress(launch.record.creator)}</span>
            <span className="q-label">
              {blocksToApproxAge(head - launch.record.launchBlock)} ago
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-line px-3 py-2">
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
        <div className="px-3 pb-2">
          <QuenchLine progress={progress} done={launch.record.graduated} />
          <div className="mt-1 flex justify-between">
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

      <div className="border-t border-line px-3 py-2">
        <BlockBadges cfg={launch.record.cfg} compact />
      </div>
    </Link>
  );
}

import Link from "next/link";
import { Panel } from "./Panel";
import type { FeedEvent } from "@/lib/reads/events";
import {
  blocksToApproxAge,
  formatCompactTokens,
  formatEth,
  truncateAddress,
} from "@/lib/format";

/**
 * What has actually happened, newest first.
 *
 * Read from logs at request time, so the list is as long as the chain makes it
 * and no longer. An empty feed says the window was quiet; it is never filled.
 *
 * Colour follows the venue, which is the same temperature rule the rest of the
 * site uses: a trade on a curve is molten, a trade in a graduated pool is not.
 */
const LABEL: Record<FeedEvent["kind"], string> = {
  launch: "launched",
  buy: "bought",
  sell: "sold",
  graduate: "graduated",
  pot: "pot paid",
  burn: "burned",
};

const GLYPH: Record<FeedEvent["kind"], string> = {
  launch: "+",
  buy: "▲",
  sell: "▼",
  graduate: "◆",
  pot: "★",
  burn: "×",
};

export function ActivityFeed({
  events,
  head,
  limit = 12,
  windowLabel,
}: {
  events: FeedEvent[];
  head: bigint;
  limit?: number;
  windowLabel: string;
}) {
  const shown = events.slice(0, limit);

  return (
    <Panel
      title="activity"
      right={<span className="q-label">{windowLabel}</span>}
      bodyClassName="p-0"
    >
      {shown.length === 0 ? (
        <p className="px-4 py-6 text-faint">
          Nothing has happened in this window. The feed is read from chain logs, so it
          shows what is there and nothing else.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((e) => (
            <li key={`${e.block}-${e.logIndex}`}>
              {/* Two lines on a narrow screen, one on a wide one. Fixed column
                  widths in a 380px rail overflowed the page at 390px. */}
              <Link
                href={`/t/${e.token}`}
                className="block px-4 py-2.5 hover:bg-raised"
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className={`shrink-0 ${e.venue === "curve" ? "text-amber" : "text-cyan"}`}
                    aria-hidden
                  >
                    {GLYPH[e.kind]}
                  </span>
                  <span className="min-w-0 truncate">${e.symbol}</span>
                  <span className="q-label shrink-0">{LABEL[e.kind]}</span>
                  <span
                    className="q-label ml-auto shrink-0"
                    title={`block ${e.block}`}
                  >
                    {blocksToApproxAge(head - e.block)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-dim">
                  {e.eth !== undefined && `${formatEth(e.eth)} ETH`}
                  {e.eth !== undefined && e.tokens !== undefined && " · "}
                  {e.tokens !== undefined && `${formatCompactTokens(e.tokens)} ${e.symbol}`}
                  {e.eth === undefined && e.tokens === undefined && e.actor
                    ? truncateAddress(e.actor)
                    : ""}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

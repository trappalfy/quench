import Link from "next/link";
import { Panel } from "./Panel";
import { CopyButton } from "./builder/CopyButton";
import type { Blueprint } from "@/lib/reads/blueprints";
import {
  BLOCK_META,
  BLOCK_ORDER,
  blocksOn,
  toQuery,
  toSolidity,
} from "@/lib/hookConfig";
import { explorerAddress } from "@/lib/chain";
import {
  blocksToApproxAge,
  formatBps,
  formatCount,
  formatEth,
  formatPips,
  ordinal,
  truncateAddress,
} from "@/lib/format";

/**
 * One published blueprint, with the settings it actually saved.
 *
 * A blueprint has no pool, so its rules are armed or off and never hot — heat
 * means "happening at this block", and nothing is happening to a config sitting
 * in an array. Showing it in amber would borrow urgency it has not got.
 */
export function BlueprintCard({ bp, head }: { bp: Blueprint; head?: bigint }) {
  const on = blocksOn(bp.cfg);
  const armed = BLOCK_ORDER.filter((k) => on[k]);

  return (
    <Panel
      title={`blueprint ${bp.id}`}
      bodyClassName="p-0"
      right={
        <span className="q-label">
          {bp.uses === 0
            ? "not used yet"
            : `${formatCount(bp.uses)} launch${bp.uses === 1 ? "" : "es"}`}
        </span>
      }
    >
      <div className="flex flex-wrap gap-1 border-b border-line px-4 py-3">
        {BLOCK_ORDER.map((key) => (
          <span
            key={key}
            title={
              on[key]
                ? `${BLOCK_META[key].name}: armed`
                : `${BLOCK_META[key].name}: not armed`
            }
            className={`border px-1.5 py-0.5 text-[10px] tracking-widest ${
              on[key] ? "border-cyan/50 text-cyan" : "border-off/40 text-off"
            }`}
          >
            {BLOCK_META[key].tag}
          </span>
        ))}
      </div>

      <dl className="divide-y divide-line">
        <Line k="author">
          <a
            href={explorerAddress(bp.author)}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-line underline-offset-2 hover:text-text"
          >
            {truncateAddress(bp.author)}
          </a>
        </Line>
        <Line k="royalty">
          {bp.royaltyBps === 0
            ? "none"
            : `${formatBps(bp.royaltyBps)} of the creator's fee`}
        </Line>
        <Line k="published">
          {bp.publishedAt === null
            ? "—"
            : head === undefined
              ? `block ${bp.publishedAt}`
              : `block ${bp.publishedAt} · ~${blocksToApproxAge(head - bp.publishedAt)} ago`}
        </Line>
        <Line k="flat LP fee">{formatPips(bp.cfg.baseFeePips)}</Line>

        {on.antiSnipe && (
          <Line k="anti-snipe">
            {formatCount(bp.cfg.guardBlocks)} blocks · buys capped at{" "}
            {formatBps(bp.cfg.maxBuyBps)} of the reserve · +
            {formatPips(bp.cfg.snipeTaxPips)} fee
          </Line>
        )}
        {on.surgeFees && (
          <Line k="surge fees">
            {formatPips(bp.cfg.baseFeePips)} → {formatPips(bp.cfg.maxFeePips)} ·
            sensitivity {formatCount(bp.cfg.surgeSens)}
          </Line>
        )}
        {on.autoBurn && (
          <Line k="auto burn">
            {formatBps(bp.cfg.burnBps)} of the output, on buys of{" "}
            {formatEth(bp.cfg.burnTriggerWei, 6)} ETH or more
          </Line>
        )}
        {on.lpRewards && (
          <Line k="lp rewards">{formatBps(bp.cfg.lpBps)} of each buy to in-range LPs</Line>
        )}
        {on.pot && (
          <Line k="nth-buy pot">
            {formatBps(bp.cfg.potBps)} of each buy · the {ordinal(bp.cfg.potEveryN)} wins
            · minimum {formatEth(bp.cfg.potMinBuyWei, 6)} ETH
          </Line>
        )}
        {armed.length === 0 && (
          <Line k="rules">
            None. A flat fee and nothing else — which is a legitimate hook, and
            the honest way to say so.
          </Line>
        )}
      </dl>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <Link
          href={`/builder?cfg=${toQuery(bp.cfg)}&from=${bp.id}`}
          className="q-label border border-line px-2 py-1 hover:border-cyan hover:text-cyan"
        >
          open in builder
        </Link>
        <CopyButton text={toSolidity(bp.cfg)} label="copy struct" />
      </div>
    </Panel>
  );
}

function Line({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
      <dt className="q-label w-28 shrink-0">{k}</dt>
      <dd className="min-w-0 flex-1 text-dim">{children}</dd>
    </div>
  );
}

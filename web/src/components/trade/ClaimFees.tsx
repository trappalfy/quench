"use client";

import { useState } from "react";
import { decodeEventLog, type Address } from "viem";
import { Panel } from "../Panel";
import { TxButton } from "../wallet/TxButton";
import { useWallet } from "@/lib/wallet/WalletContext";
import { browserClient } from "@/lib/client";
import { claimFees } from "@/lib/writes/launchpad";
import { LaunchpadAbi } from "@/lib/abi";
import { ADDRESSES } from "@/lib/chain";
import { formatBps, formatCompactTokens, formatEth } from "@/lib/format";

/**
 * Push a pool's collected fees out to the people they belong to.
 *
 * Callable by anyone, which is deliberate rather than sloppy: the split was
 * fixed at launch, so wherever the call comes from the ETH lands in the same
 * two or three places. The button is therefore offered to whoever is reading.
 *
 * What it cannot do is say how much is waiting. v4 keeps uncollected fees as
 * fee growth inside the pool manager, and turning that back into an amount
 * needs the position's last-seen growth and the tick data around it — several
 * reads and a reimplementation of Uniswap's accounting, which is exactly the
 * second source of truth this project keeps declining to write. So the amount
 * is reported after the fact, from the event, where it is exact.
 */
export function ClaimFees({
  token,
  symbol,
  creatorFeeBps,
}: {
  token: Address;
  symbol: string;
  creatorFeeBps: number;
}) {
  const { address, walletClient } = useWallet();
  const [claimed, setClaimed] = useState<{
    creator: bigint;
    protocol: bigint;
    author: bigint;
    burned: bigint;
  } | null>(null);

  return (
    <Panel title="fees" bodyClassName="p-4">
      <p className="text-dim">
        The pool&rsquo;s LP fee accrues to the position the launchpad holds. Anyone can
        push it out; the ETH splits {formatBps(creatorFeeBps)} to the creator and the
        rest to the protocol, with a blueprint author&rsquo;s royalty coming out of the
        creator&rsquo;s half. The token side is burned.
      </p>

      <div className="mt-4">
        <TxButton
          label="Claim fees for this pool"
          pendingLabel="Claiming…"
          doneLabel="Claimed."
          disabled={!walletClient}
          run={() => claimFees(browserClient, walletClient!, address!, token)}
          onDone={(receipt) => {
            for (const log of receipt.logs) {
              if (log.address.toLowerCase() !== ADDRESSES.launchpad.toLowerCase()) continue;
              try {
                const decoded = decodeEventLog({
                  abi: LaunchpadAbi,
                  data: log.data,
                  topics: log.topics,
                });
                if (decoded.eventName !== "FeesClaimed") continue;
                // Field names taken from the generated ABI, not from memory:
                // FeesClaimed(address indexed token, uint256 ethToCreator,
                // uint256 ethToProtocol, uint256 ethToAuthor, uint256
                // tokensBurned).
                const a = decoded.args as unknown as {
                  ethToCreator: bigint;
                  ethToProtocol: bigint;
                  ethToAuthor: bigint;
                  tokensBurned: bigint;
                };
                setClaimed({
                  creator: a.ethToCreator,
                  protocol: a.ethToProtocol,
                  author: a.ethToAuthor,
                  burned: a.tokensBurned,
                });
              } catch {
                // Another contract's log in the same receipt.
              }
            }
          }}
        >
          Nothing here needs you to be the creator. If there is nothing to collect the
          transaction succeeds and moves nothing — which is why the figures below
          appear afterwards rather than before.
        </TxButton>
      </div>

      {claimed && (
        <dl className="mt-4 space-y-1.5 border-t border-line pt-3">
          <Row k="to the creator" v={`${formatEth(claimed.creator, 6)} ETH`} />
          {claimed.author > 0n && (
            <Row k="to the blueprint author" v={`${formatEth(claimed.author, 6)} ETH`} />
          )}
          <Row k="to the protocol" v={`${formatEth(claimed.protocol, 6)} ETH`} />
          <Row k="burned" v={`${formatCompactTokens(claimed.burned)} ${symbol}`} />
        </dl>
      )}
    </Panel>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="q-label shrink-0">{k}</dt>
      <dd className="min-w-0 truncate text-right text-text">{v}</dd>
    </div>
  );
}

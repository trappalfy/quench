import { CopyButton } from "@/components/builder/CopyButton";
import { explorerAddress } from "@/lib/chain";

/**
 * Where $QNCH lives, for the people who came here to copy it.
 *
 * The address arrives in an environment variable rather than in this file, so
 * listing day needs a value typed into the host and a rebuild, not a commit.
 * Until one is set there is no block at all: an empty frame saying "soon" is a
 * promise with a date nobody has named, and it goes stale on its own.
 *
 * Cyan because the palette means something here. Amber is what has not set
 * yet; cyan is what can no longer change. A token address is the second kind.
 */

const ADDRESS = process.env.NEXT_PUBLIC_QNCH_ADDRESS ?? "";

/** Twenty bytes and nothing else. A wrong address in front of buyers is money. */
const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;

export function TokenAddress() {
  if (!ADDRESS_SHAPE.test(ADDRESS)) return null;

  return (
    <div className="mt-8 border border-line-bright">
      <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-2">
        <p className="q-label">/ $QNCH contract</p>
        <CopyButton text={ADDRESS} label="copy address" />
      </div>

      <div className="px-4 py-4">
        <p className="break-all text-sm text-cyan sm:text-base">{ADDRESS}</p>
        <a
          href={explorerAddress(ADDRESS)}
          target="_blank"
          rel="noreferrer"
          className="q-label mt-3 inline-block border-b border-line pb-0.5 transition-colors hover:text-text"
        >
          view on blockscout
        </a>
      </div>
    </div>
  );
}

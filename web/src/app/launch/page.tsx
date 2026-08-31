import { Nav } from "@/components/Nav";
import { LaunchWizard, type BlueprintOption } from "@/components/launch/LaunchWizard";
import { serverClient } from "@/lib/client";
import { readBlueprints } from "@/lib/reads/blueprints";
import { LaunchpadAbi } from "@/lib/abi";
import { ADDRESSES } from "@/lib/chain";
import { fromQuery } from "@/lib/hookConfig";

export const revalidate = 30;

export const metadata = {
  title: "Launch a token — Quench",
  description:
    "Settle the name, the rules, the opening price and the fee split, checked against the launchpad's own limits, before any wallet is involved.",
};

/// Read, not assumed. The cap is immutable but it is the contract's number, and
/// a page that hardcodes it would be wrong about a different deployment.
const DEFAULT_CAP = 100n * 10n ** 18n;

export default async function Launch({
  searchParams,
}: {
  searchParams: Promise<{ cfg?: string }>;
}) {
  const [head, maxPoolEthWei, blueprints, params] = await Promise.all([
    serverClient.getBlockNumber().catch(() => undefined),
    (serverClient.readContract({
      address: ADDRESSES.launchpad,
      abi: LaunchpadAbi,
      functionName: "maxPoolEthWei",
    }) as Promise<bigint>).catch(() => DEFAULT_CAP),
    readBlueprints(serverClient).catch(() => []),
    searchParams,
  ]);

  const options: BlueprintOption[] = blueprints.map((b) => ({
    id: b.id.toString(),
    author: b.author,
    royaltyBps: b.royaltyBps,
    cfg: b.cfg,
  }));

  return (
    <>
      <Nav head={head} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="q-label">/ launch</p>
        <h1 className="q-display mt-2 text-4xl sm:text-5xl lg:text-6xl">
          Everything you
          <br />
          cannot take back
        </h1>
        <p className="q-lead mt-4 max-w-2xl">
          One transaction fixes the rules, the opening price and your share of the fees.
          This page settles all three and checks them against the launchpad&rsquo;s own
          limits, so the only thing left to decide is whether to sign.
        </p>

        <div className="mt-10">
          <LaunchWizard
            maxPoolEthWei={maxPoolEthWei}
            blueprints={options}
            carried={fromQuery(params.cfg)}
          />
        </div>
      </main>
    </>
  );
}

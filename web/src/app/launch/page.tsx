import { Holding } from "@/components/Holding";
import { serverClient } from "@/lib/client";

export const revalidate = 10;

export default async function Page() {
  const head = await serverClient.getBlockNumber().catch(() => undefined);
  return (
    <Holding
      head={head}
      route="launch"
      title="Launch a token"
      will={[
        "Name and ticker, with the ticker held to three to five characters.",
        "A hook, either built here or taken from a blueprint.",
        "Instant pool: commit ETH and choose the float; the opening price follows.",
        "Bonding curve: set the first tranche price and see all ten, and the total raise.",
        "A summary of everything that will be fixed forever before you sign.",
      ]}
    />
  );
}

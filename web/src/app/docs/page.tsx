import { Holding } from "@/components/Holding";
import { serverClient } from "@/lib/client";

export const revalidate = 10;

export default async function Page() {
  const head = await serverClient.getBlockNumber().catch(() => undefined);
  return (
    <Holding
      head={head}
      route="docs"
      title="How it works"
      will={[
        "The two launch paths and what each one fixes at the moment it runs.",
        "The five blocks in detail, with units and ranges.",
        "Where fees go, and what happens to supply that does not fit the pool.",
        "What Quench does not claim: no audit, a public pot counter, no MEV guarantees.",
      ]}
    />
  );
}

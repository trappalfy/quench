import { Holding } from "@/components/Holding";
import { serverClient } from "@/lib/client";

export const revalidate = 10;

export default async function Page() {
  const head = await serverClient.getBlockNumber().catch(() => undefined);
  return (
    <Holding
      head={head}
      route="builder"
      title="Hook builder"
      will={[
        "The five blocks, each with the parameters the contract actually accepts.",
        "A live figure for what the stack adds to a buy, and a rough gas estimate.",
        "A simulated buy at a depth you choose, computed with the same maths the hook runs.",
        "Publishing the result as a blueprint others can launch with, for a royalty.",
      ]}
    />
  );
}

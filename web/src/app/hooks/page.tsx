import { Holding } from "@/components/Holding";
import { serverClient } from "@/lib/client";

export const revalidate = 10;

export default async function Page() {
  const head = await serverClient.getBlockNumber().catch(() => undefined);
  return (
    <Holding
      head={head}
      route="hooks"
      title="Blueprint registry"
      will={[
        "Every published blueprint, with the exact settings it saved.",
        "Its author, the royalty they take, and how many launches have reused it.",
        "Filters by which of the five blocks a blueprint arms, and sorting by reuse.",
        "A link that carries a blueprint straight into the builder or a launch.",
      ]}
    />
  );
}

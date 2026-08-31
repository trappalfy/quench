import { Holding } from "@/components/Holding";
import { serverClient } from "@/lib/client";

export const revalidate = 10;

export default async function Page() {
  const head = await serverClient.getBlockNumber().catch(() => undefined);
  return (
    <Holding
      head={head}
      route="methodology"
      title="How the figures are computed"
      will={[
        "Price: from the pool for a graduated token, from the current tranche for one still on its curve.",
        "FDV: that price times the fixed supply. There is no dollar oracle and no pretence of one.",
        "Volume and change: counted from settled trades in a window found by bisecting block timestamps, never by assuming a block rate.",
        "Why a figure is a dash, for each of the reasons it can be one.",
      ]}
    />
  );
}

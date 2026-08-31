import { createPublicClient, http } from "viem";
import { robinhood } from "./chain";

/// Two clients on purpose. Server components read straight from the upstream
/// endpoint — proxying our own server through our own proxy would only add a
/// hop. The browser reads through /api/rpc, which is the only endpoint it knows.
///
/// Both aggregate: `batch.multicall` folds independent `eth_call`s into one
/// Multicall3 call, and `batch` on the transport packs whatever is left into a
/// single JSON-RPC array. A screen full of numbers costs one or two round trips.
const BATCH = {
  multicall: { batchSize: 1024, wait: 8 },
} as const;

export const serverClient = createPublicClient({
  chain: robinhood,
  transport: http(process.env.QUENCH_RPC_URL ?? undefined, {
    batch: { wait: 8 },
    retryCount: 2,
  }),
  batch: BATCH,
});

export const browserClient = createPublicClient({
  chain: robinhood,
  transport: http("/api/rpc", { batch: { wait: 16 }, retryCount: 1 }),
  batch: BATCH,
});

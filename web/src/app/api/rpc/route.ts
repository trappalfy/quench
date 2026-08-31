import { NextRequest, NextResponse } from "next/server";

/// The browser never talks to the chain directly. Everything goes through here
/// so that the upstream endpoint can be swapped for a keyed provider without a
/// client release, so that reads can be batched and cached in one place, and so
/// that a hostile page cannot use our endpoint as a general-purpose relay.
///
/// Writes are deliberately absent from the allowlist: a wallet broadcasts its
/// own signed transactions through its own provider, so `eth_sendRawTransaction`
/// would be a relay we neither need nor want to operate.
const UPSTREAM = process.env.QUENCH_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getLogs",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
]);

const MAX_BATCH = 64;
const MAX_BODY_BYTES = 512 * 1024;

/// Per-instance and therefore approximate: on a serverless host each cold
/// instance starts its own counter. It is a brake on accidental floods from one
/// tab, not a security control.
const WINDOW_MS = 10_000;
const MAX_CALLS_PER_WINDOW = 300;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string, cost: number): boolean {
  const now = Date.now();
  const seen = hits.get(ip);
  if (!seen || now > seen.resetAt) {
    hits.set(ip, { count: cost, resetAt: now + WINDOW_MS });
    return false;
  }
  seen.count += cost;
  return seen.count > MAX_CALLS_PER_WINDOW;
}

type RpcCall = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

function invalid(id: unknown, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message } };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(invalid(null, "payload too large"), { status: 413 });
  }

  let body: RpcCall | RpcCall[];
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(invalid(null, "malformed JSON"), { status: 400 });
  }

  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) {
    return NextResponse.json(invalid(null, `batch must hold 1..${MAX_BATCH} calls`), {
      status: 400,
    });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  if (rateLimited(ip, calls.length)) {
    return NextResponse.json(invalid(null, "too many calls"), { status: 429 });
  }

  const rejected = calls.find(
    (c) => typeof c.method !== "string" || !ALLOWED_METHODS.has(c.method),
  );
  if (rejected) {
    return NextResponse.json(
      invalid(rejected.id, `method not allowed: ${String(rejected.method)}`),
      { status: 400 },
    );
  }

  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json(
      invalid(null, `upstream returned ${upstream.status}`),
      { status: 502 },
    );
  }

  return new NextResponse(await upstream.text(), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

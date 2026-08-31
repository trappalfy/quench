/**
 * Reads the launch registry through the same code the pages use and prints what
 * it found. Point it at a seeded anvil fork:
 *
 *   anvil --fork-url https://rpc.mainnet.chain.robinhood.com
 *   forge script script/Seed.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
 *     --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
 *   npx tsx scripts/verify-reads.ts http://127.0.0.1:8545
 *
 * The point is not that it runs — it is that the numbers are the ones the
 * contracts actually hold. Slot maths for v4 pool state is computed here, not
 * read from a getter, so it has to be checked against a live pool.
 */
import { createPublicClient, http, formatEther } from "viem";
import { robinhood } from "../src/lib/chain";
import { readLaunchCount, readTokenPage, readLaunch, activeBlocks } from "../src/lib/reads/launches";
import { inRangeEthReserve, priceWeiPerToken } from "../src/lib/reads/pool";
import { curveTarget, fdvOf, priceOf } from "../src/lib/derive";
import { readFeed } from "../src/lib/reads/events";
import { readTotals } from "../src/lib/reads/totals";
import { readBlueprintCount, readBlueprints } from "../src/lib/reads/blueprints";
import { BondingCurveAbi } from "../src/lib/abi";

const rpc = process.argv[2] ?? "http://127.0.0.1:8545";

const client = createPublicClient({
  chain: robinhood,
  transport: http(rpc),
  batch: { multicall: { batchSize: 1024, wait: 8 } },
});

function fail(message: string): never {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

function check(condition: boolean, message: string) {
  if (!condition) fail(message);
  console.log(`  ok   ${message}`);
}

const count = await readLaunchCount(client);
console.log(`launchCount = ${count}\n`);
if (count === 0n) fail("registry is empty — seed the fork first");

const tokens = await readTokenPage(client, 0, 10, count);
check(tokens.length === Number(count), `paged ${tokens.length} of ${count} tokens, newest first`);

for (const token of tokens) {
  const l = await readLaunch(client, token);
  const blocks = activeBlocks(l.record.cfg);

  console.log(`\n── ${l.name} ($${l.symbol})  ${token}`);
  console.log(`   creator      ${l.record.creator}`);
  console.log(`   launchBlock  ${l.record.launchBlock}`);
  console.log(`   graduated    ${l.record.graduated}`);
  console.log(`   blocks on    ${Object.entries(blocks).filter(([, v]) => v).map(([k]) => k).join(", ")}`);
  console.log(`   poolId       ${l.poolId}`);
  console.log(`   pot          ${formatEther(l.potBalance)} ETH  (buys ${l.hookState.potBuyCount})`);

  check(l.record.token === token, "record echoes the token it was keyed by");
  check(l.totalSupply === 1_000_000_000n * 10n ** 18n, "supply is the fixed one billion");
  check(l.key.hooks.toLowerCase() === "0x011a41285314effe83de63404aa759a85472e8cc", "pool key names our hook");
  // The hook's clock starts when the *pool* opens, which for a curve launch is
  // graduation, not launch. Only an instant launch has the two coincide.
  if (l.record.graduated) {
    check(l.hookState.startBlock >= l.record.launchBlock, "hook's start block is at or after the launch");
  } else {
    check(l.hookState.startBlock === 0n, "hook has no clock before the pool exists");
  }

  if (l.record.graduated) {
    if (!l.pool) fail("graduated token has no pool state");
    const reserve = inRangeEthReserve(l.pool);
    console.log(`   sqrtPriceX96 ${l.pool.sqrtPriceX96}`);
    console.log(`   liquidity    ${l.pool.liquidity}`);
    console.log(`   reserve      ${formatEther(reserve)} ETH`);
    console.log(`   price        ${formatEther(priceWeiPerToken(l.pool.sqrtPriceX96))} ETH/token`);
    check(l.pool.sqrtPriceX96 > 0n, "slot0 decoded a real price — extsload slot maths holds");

    // The seed opens at 5 gwei per token, deliberately not 1:1. At 1:1 an
    // inverted price formula reads correctly, which is how one shipped.
    const OPENING = 5_000_000_000n;
    const read = priceWeiPerToken(l.pool.sqrtPriceX96);
    // The seed buys after opening, which moves the price up a little, so this
    // is a sanity band rather than an equality. It is wide on purpose: the bug
    // it guards against reads 2e26 where the truth is 5e9, and no plausible
    // trade closes that gap.
    check(
      read >= OPENING && read < (OPENING * 110n) / 100n,
      `price reads at the opening price plus the seeded buy (${read} vs ${OPENING} wei/token opened)`,
    );
    check(l.pool.liquidity > 0n, "liquidity decoded from stateSlot+3");
    check(reserve > 0n, "in-range ETH reserve is positive");
  } else {
    if (!l.curve) fail("pre-graduation token has no curve");
    console.log(`   curve sold   ${formatEther(l.curve.sold)} tokens`);
    console.log(`   curve p0     ${l.curve.p0} wei`);
    check(l.curve.sold > 0n, "curve recorded the seeded buy");
    check(l.pool === null, "no pool state is read before graduation");

    // curveTarget re-implements the curve's sellout sum in TypeScript. That is
    // exactly the kind of formula that drifts, so it is checked against the
    // contract's own answer rather than trusted.
    const mine = curveTarget(l)!;
    const theirs = await client.readContract({
      address: l.record.curve,
      abi: BondingCurveAbi,
      functionName: "totalRaiseAtFullSellout",
      args: [l.curve.p0],
    });
    console.log(`   target       ${formatEther(mine)} ETH`);
    check(mine === theirs, `sellout target matches the contract exactly (${theirs} wei)`);
    check(priceOf(l) === l.curve.tranchePrice, "curve price comes from the current tranche");
    check(fdvOf(l)! > 0n, "FDV derives from that price and the fixed supply");
  }
}

// The seed makes exactly one router buy against the graduated pool and one
// curve buy, and sells nothing. v4 emits the swapper's delta rather than the
// pool's, so reading the sign backwards labels every buy a sell — which it
// did, silently, until the feed was rendered and looked at.
const feedHead = await client.getBlockNumber();
const feedLaunches = await Promise.all(tokens.map((t) => readLaunch(client, t, feedHead)));
const feed = await readFeed(client, feedLaunches, feedHead);

console.log(`\nfeed: ${feed.length} events`);
for (const e of feed) {
  console.log(`   ${e.kind.padEnd(9)} ${e.venue.padEnd(9)} ${e.symbol}`);
}

check(feed.length > 0, "the feed found events in the window");
check(
  feed.some((e) => e.kind === "buy" && e.venue === "pool"),
  "the seeded router buy reads as a buy, not a sell",
);
check(
  feed.some((e) => e.kind === "buy" && e.venue === "curve"),
  "the seeded curve buy reads as a buy",
);
check(feed.some((e) => e.kind === "burn"), "the auto burn shows up in the feed");
check(
  !feed.some((e) => e.kind === "sell"),
  "nothing was sold in the seed, so nothing reads as a sell",
);


check(
  feed.filter((e) => e.kind === "launch").length === feedLaunches.length,
  `every launch in the registry appears in the feed (${feedLaunches.length})`,
);

// The home page shows protocol-wide totals from unfiltered log queries rather
// than by summing what it read per launch. Two ways of counting the same thing
// is exactly where a figure quietly drifts, so they are checked against each
// other here.
const totals = await readTotals(client);
console.log("\ntotals");
console.log(`   burned by hooks  ${totals.burnedByHooks}`);
console.log(`   held in pots     ${formatEther(totals.potHeld ?? 0n)} ETH`);
console.log(`   paid out         ${formatEther(totals.potPaid ?? 0n)} ETH`);
console.log(`   donated to LPs   ${formatEther(totals.lpDonated ?? 0n)} ETH`);

const burnedPerLaunch = feedLaunches.reduce((sum, l) => sum + l.burnedByHook, 0n);
const potPerLaunch = feedLaunches.reduce((sum, l) => sum + l.potBalance, 0n);

check(
  totals.burnedByHooks === burnedPerLaunch,
  `protocol-wide burn matches the sum of the per-launch reads (${burnedPerLaunch})`,
);
check(
  totals.potHeld === potPerLaunch,
  `the vault's balance matches the sum of the per-pool pots (${potPerLaunch})`,
);
check(
  (totals.lpDonated ?? 0n) > 0n,
  "the LP Rewards block's donations are visible in the pool manager's Donate logs",
);

// Index 0 is a sentinel the constructor pushes. Listing it would show an
// anonymous hook with every block off, which is why this asserts the count
// rather than trusting the loop bounds.
const blueprints = await readBlueprints(client);
console.log(`\nblueprints: ${blueprints.length}`);
for (const bp of blueprints) {
  console.log(`   #${bp.id} by ${bp.author} · ${bp.royaltyBps} bps · ${bp.uses} uses`);
}

const rawCount = await readBlueprintCount(client);
check(
  blueprints.length === Number(rawCount) - 1,
  `the sentinel at index 0 is not listed (${rawCount} entries, ${blueprints.length} blueprints)`,
);
check(
  blueprints.every((bp) => bp.publishedAt !== null),
  "every blueprint found its own BlueprintPublished log",
);

console.log("\nall read-layer checks passed");

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
    check(l.pool.liquidity > 0n, "liquidity decoded from stateSlot+3");
    check(reserve > 0n, "in-range ETH reserve is positive");
  } else {
    if (!l.curve) fail("pre-graduation token has no curve");
    console.log(`   curve sold   ${formatEther(l.curve.sold)} tokens`);
    console.log(`   curve p0     ${l.curve.p0} wei`);
    check(l.curve.sold > 0n, "curve recorded the seeded buy");
    check(l.pool === null, "no pool state is read before graduation");
  }
}

console.log("\nall read-layer checks passed");

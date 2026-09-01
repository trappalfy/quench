/**
 * Every write the site can make, through the actual interface, in a real
 * browser, against a forked chain.
 *
 * The unit tests check arithmetic and the fork script checks reads. Neither can
 * tell you that the connect button connects, that a quote appears, that the
 * right contract gets approved, that a launch finds its own token in the
 * receipt, or that a signature produces anything at all — and every one of
 * those is a place where the product silently does not work.
 *
 * The wallet is injected as an EIP-6963 provider that forwards to anvil. Anvil
 * unlocks its own accounts, so nothing here holds or asks for a key: the node
 * signs, exactly as a real wallet would.
 *
 *   anvil --fork-url https://rpc.mainnet.chain.robinhood.com
 *   forge script script/Seed.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
 *     --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
 *   npx tsx scripts/e2e.mts
 */
import { chromium, type Page } from "playwright";
import { createPublicClient, http, formatEther, type Address } from "viem";
import { ADDRESSES, robinhood } from "../src/lib/chain";
import { readLaunchCount, readTokenPage, readLaunch } from "../src/lib/reads/launches";
import { LaunchpadAbi } from "../src/lib/abi";

const site = process.argv[2] ?? "http://127.0.0.1:3000";
const rpc = process.argv[3] ?? "http://127.0.0.1:8545";

/// Anvil's first account, unlocked by the node and documented in its own help
/// output. It is a test account on a local fork and nothing else.
const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

const client = createPublicClient({ chain: robinhood, transport: http(rpc) });

let failures = 0;
function check(ok: boolean, what: string) {
  if (ok) console.log(`  ok   ${what}`);
  else {
    console.error(`  FAIL ${what}`);
    failures++;
  }
}

/**
 * The injected wallet.
 *
 * Runs before any page script, announces itself the way a real extension does,
 * and forwards everything to anvil. `eth_sendTransaction` goes straight through
 * because anvil holds the account — the browser never sees a key.
 */
const INJECT = `
(() => {
  const RPC = ${JSON.stringify(rpc)};
  const ACCOUNT = ${JSON.stringify(ACCOUNT)};
  let id = 0;

  const call = async (method, params) => {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
    });
    const body = await res.json();
    if (body.error) {
      const err = new Error(body.error.message);
      err.code = body.error.code;
      err.data = body.error.data;
      throw err;
    }
    return body.result;
  };

  const provider = {
    request: async ({ method, params }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_sendTransaction") {
        const tx = { ...params[0], from: ACCOUNT };
        return call("eth_sendTransaction", [tx]);
      }
      return call(method, params);
    },
    on: () => {},
    removeListener: () => {},
  };

  const announce = () => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({
          info: {
            uuid: "11111111-2222-3333-4444-555555555555",
            name: "Anvil (test)",
            icon: "data:image/svg+xml,%3Csvg/%3E",
            rdns: "test.quench.anvil",
          },
          provider,
        }),
      }),
    );
  };

  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();
`;

async function connect(page: Page) {
  await page.getByRole("button", { name: "CONNECT" }).click();
  await page.getByRole("button", { name: "Anvil (test)" }).click();
  await page.waitForSelector(`text=${ACCOUNT.slice(0, 6)}`, { timeout: 10_000 });
}

/// The panel quotes by simulating, so "you receive" holding a dash means the
/// simulation failed or never ran. Waiting for a real figure is the assertion.
async function waitForQuote(page: Page) {
  await page.waitForFunction(
    `(() => {
      const dts = [...document.querySelectorAll("dt")];
      const dt = dts.find((d) => d.textContent.trim() === "you receive");
      if (!dt) return false;
      const v = dt.nextElementSibling?.textContent?.trim() ?? "";
      return v !== "" && v !== "—" && v !== "…";
    })()`,
    { timeout: 20_000 },
  );
  return page.evaluate(`(() => {
    const dt = [...document.querySelectorAll("dt")].find((d) => d.textContent.trim() === "you receive");
    return dt.nextElementSibling.textContent.trim();
  })()`) as Promise<string>;
}

async function amount(page: Page, value: string) {
  const box = page.getByPlaceholder("0.0");
  await box.fill(value);
}

async function main() {
  const count = await readLaunchCount(client);
  if (count === 0n) throw new Error("registry is empty — seed the fork first");
  const tokens = await readTokenPage(client, 0, 10, count);
  const launches = await Promise.all(tokens.map((t) => readLaunch(client, t)));

  const pooled = launches.find((l) => l.record.graduated);
  const curved = launches.find((l) => !l.record.graduated);
  if (!pooled || !curved) throw new Error("the fork needs one graduated token and one on a curve");

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addInitScript(INJECT);
  const page = await context.newPage();

  page.on("console", (m) => {
    if (m.type() === "error") console.error(`  browser: ${m.text()}`);
  });

  /* -- a buy on the curve ------------------------------------------------ */

  console.log(`\ncurve · $${curved.symbol}  ${curved.record.token}`);
  await page.goto(`${site}/t/${curved.record.token}`, { waitUntil: "networkidle" });
  await connect(page);
  check(true, "the injected wallet connects through the modal");

  const beforeCurve = await balanceOf(curved.record.token);
  await amount(page, "0.05");
  const curveQuote = await waitForQuote(page);
  check(curveQuote !== "—", `the curve quotes a buy without an approval (${curveQuote})`);

  await page.getByRole("button", { name: `Buy ${curved.symbol}` }).click();
  await page.waitForSelector("text=Confirmed.", { timeout: 30_000 });
  const afterCurve = await balanceOf(curved.record.token);
  check(afterCurve > beforeCurve, `the buy landed and the balance grew (+${formatEther(afterCurve - beforeCurve)})`);

  /* -- a buy in the pool ------------------------------------------------- */

  console.log(`\npool · $${pooled.symbol}  ${pooled.record.token}`);
  await page.goto(`${site}/t/${pooled.record.token}`, { waitUntil: "networkidle" });
  await page.waitForSelector(`text=${ACCOUNT.slice(0, 6)}`, { timeout: 10_000 });
  check(true, "the wallet is still connected after a navigation");

  const beforePool = await balanceOf(pooled.record.token);
  await amount(page, "0.02");
  const poolQuote = await waitForQuote(page);
  check(poolQuote !== "—", `the router quotes a buy by simulating it (${poolQuote})`);

  await page.getByRole("button", { name: `Buy ${pooled.symbol}` }).click();
  await page.waitForSelector("text=Confirmed.", { timeout: 30_000 });
  const afterPool = await balanceOf(pooled.record.token);
  check(afterPool > beforePool, `the pool buy landed (+${formatEther(afterPool - beforePool)} tokens)`);

  /* -- a sell, which needs an approval first ----------------------------- */

  await page.getByRole("button", { name: "SELL" }).click();
  await amount(page, "1000");

  const approveButton = page.getByRole("button", { name: /^Approve 1000/ });
  check(await approveButton.isVisible(), "a sell asks for an approval before it quotes");

  await approveButton.click();
  await page.waitForFunction(
    `!document.body.textContent.includes("Approving…")`,
    { timeout: 30_000 },
  );

  const sellQuote = await waitForQuote(page);
  check(sellQuote.includes("ETH"), `once approved, the sell quotes in ETH (${sellQuote})`);

  // Measured on the token side, not the ETH side. A sell pays gas out of the
  // same balance it pays into, so a small sell can land perfectly and still
  // leave the account with less ETH than it started with — which is a fact
  // about gas, not about whether the trade worked.
  const heldBefore = await balanceOf(pooled.record.token);
  await page.getByRole("button", { name: `Sell ${pooled.symbol}` }).click();
  await page.waitForSelector("text=Confirmed.", { timeout: 30_000 });
  const heldAfter = await balanceOf(pooled.record.token);
  check(
    heldBefore - heldAfter === 1000n * 10n ** 18n,
    `the sell moved exactly the 1000 tokens it was given (-${formatEther(heldBefore - heldAfter)})`,
  );

  /* -- publishing a blueprint -------------------------------------------- */

  console.log("\nbuilder");
  await page.goto(`${site}/builder`, { waitUntil: "networkidle" });
  const blueprintsBefore = await blueprintCount();

  await page.getByRole("button", { name: "Publish as a blueprint" }).click();
  await page.waitForSelector("text=Published, and now unchangeable.", { timeout: 30_000 });
  const blueprintsAfter = await blueprintCount();
  check(
    blueprintsAfter === blueprintsBefore + 1n,
    `the registry gained a blueprint (${blueprintsBefore} → ${blueprintsAfter})`,
  );

  await page.goto(`${site}/hooks`, { waitUntil: "networkidle" });
  check(
    await page.getByText(`blueprint ${blueprintsAfter - 1n}`, { exact: false }).first().isVisible(),
    "the new blueprint appears in the registry",
  );

  /* -- launching a token -------------------------------------------------- */

  console.log("\nlaunch");
  await page.goto(`${site}/launch`, { waitUntil: "networkidle" });
  const launchesBefore = await client
    .readContract({
      address: ADDRESSES.launchpad,
      abi: LaunchpadAbi,
      functionName: "launchCount",
    })
    .catch(() => 0n);

  await page.getByPlaceholder("Seed Instant").fill("End To End");
  await page.getByPlaceholder("SEED", { exact: true }).fill("E2E");

  check(
    await page.getByText("Nothing here would revert.").isVisible(),
    "with a name and a ticker, nothing is left blocking the launch",
  );

  await page.getByRole("button", { name: "Launch and open the pool" }).click();
  // The wizard sends you to the token it just created, which is the only proof
  // that the address came back out of the receipt correctly.
  await page.waitForURL(/\/t\/0x[0-9a-fA-F]{40}/, { timeout: 40_000 });
  const launchesAfter = (await client.readContract({
    address: ADDRESSES.launchpad,
    abi: LaunchpadAbi,
    functionName: "launchCount",
  })) as bigint;
  check(
    launchesAfter === (launchesBefore as bigint) + 1n,
    `the registry gained a launch (${launchesBefore} → ${launchesAfter})`,
  );
  check(
    await page.getByRole("heading", { name: "End To End" }).isVisible(),
    "the wizard landed on the token it created",
  );

  /* -- claiming the fees the trading above produced ----------------------- */

  console.log("\nfees");
  await page.goto(`${site}/t/${pooled.record.token}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Claim fees for this pool" }).click();
  await page.waitForSelector("text=Claimed.", { timeout: 30_000 });
  check(
    await page.getByText("to the creator", { exact: true }).isVisible(),
    "the claim reports what actually moved, decoded from its own event",
  );

  await browser.close();

  if (failures > 0) {
    console.error(`\n${failures} check${failures === 1 ? "" : "s"} failed`);
    process.exit(1);
  }
  console.log("\nevery write the interface can make, works");
}

async function blueprintCount(): Promise<bigint> {
  return client.readContract({
    address: ADDRESSES.launchpad,
    abi: LaunchpadAbi,
    functionName: "blueprintCount",
  }) as Promise<bigint>;
}

async function balanceOf(token: Address): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "balanceOf",
    args: [ACCOUNT],
  }) as Promise<bigint>;
}

await main();

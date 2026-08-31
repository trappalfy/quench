/**
 * Screenshots the given routes at two widths into shots/, and fails if any of
 * them scrolls sideways.
 *
 * A cyber-brutalist grid either holds together or it does not, and no DOM
 * assertion tells you that — hence the pictures. But horizontal overflow is
 * exactly the kind of thing eyes skip and a measurement catches, so it is
 * checked here rather than left to whoever happens to open a phone.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:3000";
const routes = (process.argv[3] ?? "/app").split(",");

mkdirSync("shots", { recursive: true });

const VIEWPORTS = [
  ["desktop", 1440, 1000],
  ["mobile", 390, 844],
] as const;

const overflows: string[] = [];

const browser = await chromium.launch();
for (const [label, width, height] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width, height } });
  for (const route of routes) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    const name = route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
    await page.screenshot({ path: `shots/${name}-${label}.png`, fullPage: true });

    const scrollWidth = await page.evaluate(
      "Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)",
    );
    const bad = (scrollWidth as number) > width + 1;
    if (bad) overflows.push(`${route} @ ${label}: ${scrollWidth}px in a ${width}px viewport`);
    console.log(`shots/${name}-${label}.png${bad ? "   ← OVERFLOWS" : ""}`);
  }
  await page.close();
}
await browser.close();

if (overflows.length > 0) {
  console.error("\nhorizontal overflow:");
  for (const line of overflows) console.error(`  ${line}`);
  process.exit(1);
}
console.log("\nno page scrolls sideways");

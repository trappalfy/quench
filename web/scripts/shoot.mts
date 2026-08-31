/**
 * Screenshots the pages that exist, at two widths, into shots/.
 * A cyber-brutalist grid either holds together or it does not, and that is not
 * something a DOM assertion can tell you.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:3000";
const routes = (process.argv[3] ?? "/app").split(",");

mkdirSync("shots", { recursive: true });

const browser = await chromium.launch();
for (const [label, width, height] of [
  ["desktop", 1440, 1000],
  ["mobile", 390, 844],
] as const) {
  const page = await browser.newPage({ viewport: { width, height } });
  for (const route of routes) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    const name = route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
    await page.screenshot({ path: `shots/${name}-${label}.png`, fullPage: true });
    console.log(`shots/${name}-${label}.png`);
  }
  await page.close();
}
await browser.close();

/**
 * What is actually rendering, as opposed to what the CSS asks for.
 *
 * Passed as source strings rather than closures: the TypeScript loader rewrites
 * arrow functions with a `__name` helper that does not exist inside the page.
 */
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:3000/app";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle" });

const result = await page.evaluate(`(() => {
  const cs = getComputedStyle(document.body);
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
  document.body.appendChild(probe);
  probe.textContent = "iiiiiiiiii";
  const narrow = probe.getBoundingClientRect().width;
  probe.textContent = "mmmmmmmmmm";
  const wide = probe.getBoundingClientRect().width;
  probe.remove();
  const h1 = document.querySelector("h1");
  return {
    bodyFontFamily: cs.fontFamily,
    monoVar: cs.getPropertyValue("--font-mono").trim(),
    monoFaceVar: cs.getPropertyValue("--font-mono-face").trim(),
    displayVar: cs.getPropertyValue("--font-display").trim(),
    h1FontFamily: h1 ? getComputedStyle(h1).fontFamily : null,
    facesLoaded: Array.from(document.fonts).map(f => f.family + " " + f.weight + " " + f.status),
    narrow, wide,
    isMonospaced: Math.abs(narrow - wide) < 0.5
  };
})()`);

console.log(JSON.stringify(result, null, 2));
await browser.close();

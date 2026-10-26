// Read-only: for each page, prints the ancestor chain (tag.class) of elements showing a person's name, so blur.js
// can target whole rows. Usage: node inspect.mjs
import { chromium } from "playwright";
import { LAUNCH, PROFILE, SITE } from "./config.mjs";

const ctx = await chromium.launchPersistentContext(PROFILE, LAUNCH);
const page = ctx.pages()[0] ?? (await ctx.newPage());
for (const [route, names] of [
  ["/", ["James Nichol", "Associate · Bank of America (SF)"]],
  ["/sheet?view=contacts", ["@"]],
  ["/drafts?bank=Evercore", ["@", "Megan"]],
  ["/followups", ["Michael Bender"]],
  ["/calendar", ["Coffee", "Not in your tracker"]],
]) {
  await page.goto(SITE + route);
  await page.waitForTimeout(6000);
  const out = await page.evaluate((names) => {
    const res = [];
    const walker = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode()) && res.length < 3) {
      if (!names.some((x) => n.textContent.includes(x))) continue;
      const chain = [];
      for (let el = n.parentElement; el && el !== document.body && chain.length < 9; el = el.parentElement)
        chain.push(`${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}.${(el.className?.toString?.() ?? "").split(" ").slice(0, 5).join(".")}`);
      res.push({ text: n.textContent.slice(0, 40), chain });
    }
    return { hasMain: !!document.querySelector("main"), res, tables: document.querySelectorAll("main table").length };
  }, names);
  console.log("\n==", route, JSON.stringify(out, null, 1));
}
await ctx.close();

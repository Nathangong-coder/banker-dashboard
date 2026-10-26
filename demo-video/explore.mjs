// Read-only look at the live pages on the signed-in profile: screenshots + visible buttons, so record.mjs's
// selectors can be checked before a real take. Writes to raw/explore/. Changes nothing in the app.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LAUNCH, PROFILE, RAW, SITE } from "./config.mjs";

const dir = path.join(RAW, "explore");
mkdirSync(dir, { recursive: true });
const ctx = await chromium.launchPersistentContext(PROFILE, LAUNCH);
const page = ctx.pages()[0] ?? (await ctx.newPage());
const report = {};

for (const [name, route] of [
  ["home", "/"],
  ["contacts", "/sheet?view=contacts"],
  ["drafts", "/drafts"],
  ["followups", "/followups"],
  ["calendar", "/calendar"],
]) {
  await page.goto(SITE + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
  report[name] = {
    url: page.url(),
    buttons: (await page.getByRole("button").allInnerTexts()).map((t) => t.trim()).filter(Boolean).slice(0, 80),
    banner: (await page.locator("body").innerText()).slice(0, 600),
  };
}
writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
await ctx.close();
console.log("done", dir);

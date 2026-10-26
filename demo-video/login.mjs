// Manual Google sign-in inside a Playwright-launched Chrome (same flags as the recording, no video).
// Google ties its session to how the browser was launched, so a sign-in from setup.mjs's plain Chrome can show as
// "Signed out" here. Sign in (nagong1@g.ucla.edu), then into Coverage, then close the window.
import { chromium } from "playwright";
import { LAUNCH, PROFILE, SITE } from "./config.mjs";

const ctx = await chromium.launchPersistentContext(PROFILE, LAUNCH);
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("https://accounts.google.com/ServiceLogin?continue=https://mail.google.com/mail/u/0/");
const app = await ctx.newPage();
await app.goto(`${SITE}/api/auth/google/start?returnTo=/`);
console.log("Sign in to Google in the first tab and to Coverage in the second, then close the window.");
await new Promise((r) => ctx.on("close", r));
console.log("closed");

// Records the demo on the live site with the signed-in demo profile (run setup.mjs once first).
// One tab for everything (Coverage → Gmail → Coverage → Calendar → Coverage) so it's one continuous video.
// Writes raw/<video>.webm + raw/take.json ({video, marks, cuts}); build.mjs turns that into the MP4.
//
//   node record.mjs            full take
//   node record.mjs --from=calendar   start at a later beat (skips login/contacts/email)
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LAUNCH, PROFILE, RAW, SITE, TEST_CONTACT as T } from "./config.mjs";

const from = (process.argv.find((a) => a.startsWith("--from=")) ?? "--from=login").slice(7);
const BEATS = ["login", "contacts", "email", "calendar"];
const runs = (beat) => BEATS.indexOf(beat) >= BEATS.indexOf(from);

mkdirSync(RAW, { recursive: true });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  ...LAUNCH,
  slowMo: 40,
  recordVideo: { dir: RAW, size: { width: 1920, height: 1080 } },
});
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const marks = [];
const cuts = [];
const mark = (key) => (marks.push({ key, t: now() }), console.log(`[${now().toFixed(1)}s] ${key}`));
let cutAt = null;
const cutStart = () => (cutAt = now());
const cutEnd = (pad = 0.4) => {
  // Keep a little on both sides so the cut lands on a settled frame.
  if (cutAt !== null && now() - cutAt > 2 * pad) cuts.push([cutAt + pad, now() - pad]);
  cutAt = null;
};

await ctx.addInitScript({ content: readFileSync(new URL("./overlay.js", import.meta.url), "utf8") });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(30_000);

// Google popups (Gmail / Calendar tokens) and the sign-in page: pick the UCLA account, approve.
async function handleGoogle(p, ms = 25_000) {
  const end = Date.now() + ms;
  while (Date.now() < end && !p.isClosed()) {
    if (!/accounts\.google\.com/.test(p.url())) {
      if (p !== page) return;
      return;
    }
    for (const loc of [p.getByText(/nagong1@(g\.)?ucla\.edu/).first(), p.getByRole("button", { name: /^(Continue|Allow)$/ })]) {
      if (await loc.isVisible().catch(() => false)) await loc.click().catch(() => {});
    }
    await p.waitForTimeout(800);
  }
}
ctx.on("page", (p) => p !== page && handleGoogle(p).catch(() => {}));

const pause = (ms = 1200) => page.waitForTimeout(ms);
let cursor = { x: 960, y: 540 };
async function moveTo(loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) return;
  const x = b.x + Math.min(b.width / 2, 60), y = b.y + b.height / 2;
  await page.mouse.move(x, y, { steps: 28 });
  cursor = { x, y };
  await pause(250);
}
async function click(loc, after = 1100) {
  await loc.waitFor({ state: "visible" });
  await moveTo(loc);
  await loc.click();
  await pause(after);
}
async function type(loc, text, delay = 75) {
  await click(loc, 300);
  await loc.pressSequentially(text, { delay });
  await pause(500);
}
async function go(url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.mouse.move(cursor.x + 1, cursor.y); // puts the drawn cursor back where the mouse is
}
async function smoothScroll(y, ms = 1600, sel) {
  await page.evaluate(([y, sel]) => {
    const el = sel ? document.querySelector(sel) : null;
    (el ?? window).scrollBy({ top: y, behavior: "smooth" });
  }, [y, sel]);
  await pause(ms);
}
const appReady = () => page.locator("main h1, main h2").first().waitFor({ state: "visible", timeout: 45_000 });
async function dismissConsent() {
  const b = page.getByRole("button", { name: "Essential only" });
  if (await b.isVisible().catch(() => false)) await b.click();
}
async function snap(name) {
  await page.screenshot({ path: path.join(RAW, `step-${name}.png`) }).catch(() => {});
}

let failed = null;
try {
  // ---------------------------------------------------------------- pre-roll (cut)
  cutStart();
  await go(SITE + "/");
  await appReady();
  await dismissConsent();

  // ---------------------------------------------------------------- 2. log in → dashboard
  if (runs("login")) {
    // Sign out locally only (drop the session cookie) so the take can show a real Google sign-in.
    await ctx.clearCookies({ name: "coverage_session" });
    await go(SITE + "/welcome");
    await page.getByRole("link", { name: /Open dashboard/ }).first().waitFor();
    await pause(800);
    cutEnd();
    mark("login");
    await pause(1500);
    await click(page.getByRole("link", { name: /Open dashboard/ }).first(), 1500);
    const signIn = page.getByRole("link", { name: /Sign in/ }).or(page.getByRole("button", { name: /Sign in with Google/ })).first();
    await click(signIn, 600);
    cutStart();
    await page.waitForURL(/accounts\.google\.com|vercel\.app\/(\?|$)/, { timeout: 30_000 });
    await handleGoogle(page, 30_000);
    await page.waitForURL(new RegExp(SITE.replace(/\./g, "\\.")), { timeout: 60_000 });
    await page.getByText(/Good (morning|afternoon|evening)/).waitFor({ timeout: 60_000 });
    await dismissConsent();
    await pause(1200);
    cutEnd();
  } else {
    cutEnd();
  }
  mark("dashboard");
  await pause(2200);
  await smoothScroll(380);
  await pause(1400);
  await smoothScroll(-380);
  await snap("dashboard");

  // ---------------------------------------------------------------- 3a. contacts: add + list
  if (runs("contacts")) {
    await click(page.getByRole("link", { name: "Spreadsheet" }).first(), 400);
    cutStart();
    await appReady();
    await click(page.getByRole("tab", { name: "Contacts" }).or(page.getByRole("button", { name: "Contacts" })).first(), 300);
    await page.getByRole("button", { name: "Add contact" }).waitFor();
    await pause(600);
    cutEnd();
    mark("contacts");
    await pause(1500);
    await smoothScroll(500, 1800, "main .overflow-auto");
    await smoothScroll(-500, 1200, "main .overflow-auto");

    await click(page.getByRole("button", { name: "Add contact" }).first(), 900);
    const dlg = page.getByRole("dialog");
    mark("add");
    await type(dlg.getByLabel("Name"), T.name);
    await type(dlg.getByLabel("Bank"), T.bank);
    await page.keyboard.press("Escape").catch(() => {}); // close the datalist suggestions, not the dialog
    if (!(await dlg.isVisible())) throw new Error("Add contact dialog closed on Escape");
    await type(dlg.getByLabel("Email"), T.email, 55);
    await type(dlg.getByLabel("Position"), T.position);
    await type(dlg.getByPlaceholder("SF, NY, LA…"), T.location);
    await type(dlg.getByPlaceholder("Tech, Healthcare, RX…"), T.team);
    const toSheet = dlg.getByLabel("Add to the spreadsheet");
    if (await toSheet.isVisible().catch(() => false) && (await toSheet.isChecked())) await click(toSheet, 500);
    await snap("add-filled");
    await click(dlg.getByRole("button", { name: "Add contact" }), 1500);
    await type(page.getByPlaceholder("Search…").first(), "Test Account");
    await pause(2000);
    await snap("added");
  }

  // ---------------------------------------------------------------- 3b. draft → Gmail → send → sync → follow-ups
  if (runs("email")) {
    await go(SITE + "/drafts?bank=" + encodeURIComponent(T.bank));
    cutStart();
    await appReady();
    await pause(800);
    cutEnd();
    const row = page.locator("main tbody tr", { hasText: T.name }).first();
    await row.waitFor();
    mark("send");
    await click(row.getByRole("checkbox").first(), 600);
    await click(page.getByRole("button", { name: "Generate drafts" }), 300);
    cutStart();
    await page.getByText(/Drafted \d+ email/).waitFor({ timeout: 120_000 });
    await pause(600);
    cutEnd();
    await snap("drafted");
    await click(row.locator("button").filter({ hasText: /Hi Test|Seeking|Connect/ }).first(), 1200);
    const dlg = page.getByRole("dialog");
    await smoothScroll(300, 1500, "[role=dialog] .overflow-auto");
    await pause(1500);
    await click(dlg.getByRole("button", { name: /Send to Gmail|Update Gmail draft/ }), 300);
    cutStart();
    await page.getByText(/Draft (created|updated) in Gmail/).waitFor({ timeout: 90_000 });
    await pause(500);
    cutEnd();
    await snap("gmail-draft");
    await page.keyboard.press("Escape");

    // Open that draft in Gmail and send it (Gmail's own Send button: the app never sends right away).
    await go("https://mail.google.com/mail/u/0/#search/in%3Adrafts+to%3A" + encodeURIComponent(T.email));
    cutStart();
    const thread = page.locator("tr.zA").first();
    await thread.waitFor({ timeout: 60_000 });
    await pause(800);
    cutEnd();
    await click(thread, 1800);
    const send = page.locator('div[role=button][aria-label^="Send"]').first();
    await send.waitFor();
    await pause(1500);
    await click(send, 300);
    await page.getByText(/Message sent/).waitFor({ timeout: 30_000 });
    await pause(1800);
    await snap("sent");

    // Back in Coverage: Gmail sync fills in the sent date, then Follow-ups shows who's due.
    await go(SITE + "/followups");
    cutStart();
    await appReady();
    await pause(600);
    cutEnd();
    mark("sync");
    await click(page.getByRole("button", { name: "Sync with Gmail" }), 2500);
    cutStart();
    await page.getByRole("button", { name: "Sync with Gmail" }).waitFor({ timeout: 300_000 });
    await pause(800);
    cutEnd();
    mark("followups");
    await pause(2000);
    await smoothScroll(450, 1800);
    await pause(1200);
    await smoothScroll(-450, 1200);
    await snap("followups");

    // The contact now reads Sent; update its status by hand (they replied).
    await go(SITE + "/sheet?view=contacts");
    cutStart();
    await appReady();
    await click(page.getByRole("tab", { name: "Contacts" }).or(page.getByRole("button", { name: "Contacts" })).first(), 300);
    cutEnd();
    await type(page.getByPlaceholder("Search…").first(), "Test Account");
    mark("status");
    await pause(1800);
    await click(page.locator("main tbody tr", { hasText: T.name }).first(), 1200);
    const modal = page.getByRole("dialog");
    await moveTo(modal.getByLabel("Status"));
    await modal.getByLabel("Status").selectOption({ label: "Replied" });
    await pause(1200);
    await click(modal.getByRole("button", { name: "Save" }), 1800);
    await snap("status");
  }

  // ---------------------------------------------------------------- 4. Google Calendar → Coverage
  if (runs("calendar")) {
    await go("https://calendar.google.com/calendar/u/0/r/eventedit?dates=20261027T100000/20261027T103000");
    cutStart();
    const title = page.getByPlaceholder("Add title").or(page.getByLabel("Title")).first();
    await title.waitFor({ timeout: 60_000 });
    await pause(800);
    cutEnd();
    mark("calendar");
    await type(title, "Coffee chat with Test Account", 70);
    const guests = page.getByPlaceholder("Add guests").or(page.getByLabel(/^Guests$|Add guests/)).first();
    await type(guests, T.email, 50);
    await page.keyboard.press("Enter");
    await pause(1200);
    await snap("calendar-filled");
    await click(page.getByRole("button", { name: /^Save$/ }), 1200);
    const sendInvite = page.getByRole("button", { name: /^Send$/ });
    if (await sendInvite.isVisible().catch(() => false)) await click(sendInvite, 1500);
    await pause(1500);
    await snap("calendar-saved");

    await go(SITE + "/calendar");
    cutStart();
    await appReady();
    await pause(600);
    cutEnd();
    mark("calsync");
    await click(page.getByRole("button", { name: "Sync Google Calendar" }), 300);
    cutStart();
    await page.getByText(/Synced/).first().waitFor({ timeout: 90_000 }).catch(() => {});
    await pause(600);
    cutEnd();
    const chat = page.locator("main li", { hasText: T.name }).first();
    await chat.waitFor({ timeout: 20_000 });
    await moveTo(chat);
    await pause(3500);
    await snap("calsync");
  }
  mark("end");
  await pause(1000);
} catch (e) {
  failed = e;
  console.error("FAILED:", e.message);
  await snap("failure");
} finally {
  const video = page.video();
  await ctx.close();
  const file = video ? await video.path() : null;
  writeFileSync(path.join(RAW, "take.json"), JSON.stringify({ video: file, from, marks, cuts, failed: failed?.message ?? null }, null, 2));
  console.log("video:", file);
  process.exit(failed ? 1 : 0);
}

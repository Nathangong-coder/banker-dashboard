// The extension's background worker.
//
// Autofill one page (popup → "Autofill this page"):
//   1. read the form on the job tab (sites/apply.js#scanForm; the popup click grants access to that tab, and a site
//      you allowed (optional host permission) also lets it read forms embedded from that site),
//   2. ask your open Coverage tab what goes in each field (content/dashboard.js → src/lib/applyBridge.ts),
//   3. type those values into the scanned fields (sites/apply.js#fillForm).
// On Workday, "Fill the next pages too" repeats this page by page, pressing Next by fixed rules (clickNext) and
// stopping at anything that needs you, any error the site shows, or the review page. Nothing ever submits.
//
// Fill selected (dashboard → Applications → "Fill selected", 1.3): the dashboard sends a list of tracked jobs; each
// opens in a "Coverage" tab group and is filled up to its review page, signing in with a saved login when you
// turned that on (vault.js), and reporting back a status per job. Only sites you allowed are filled this way.
// "Watch it work" fills one tab at a time in front of you, typing visibly, with a Stop button on the page.
//
// LinkedIn job search (opt-in, test build only): reads a LinkedIn Jobs search in your own browser at a human pace
// and hands each job to your dashboard. The store build has no LinkedIn access, so it can't run there.
//
// The job page never talks to the extension: it only gets values typed into its fields.
import { getDashboard } from "./settings.js";
import { loginFor } from "./vault.js";
import {
  clickNext,
  fillForm,
  isBlockedSite,
  isMultiPageSite,
  loginState,
  pageState,
  scanForm,
  signIn,
  sitePattern,
  startApplication,
  stopRequested,
  switchToSignIn,
} from "./sites/apply.js";
import { captureLinkedInJob, isLinkedInWall, linkedinJobsUrl, readLinkedInJobs } from "./sites/linkedin.js";

const progress = (tabId, text) => chrome.runtime.sendMessage({ type: "autofill-progress", tabId, text }).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LINKEDIN = "https://www.linkedin.com/*";

/**
 * The open Coverage tab (or a new one), with its bridge answering. Tabs are found by asking each one: only the bridge
 * script answers, with its page's origin (the extension can't read other tabs' addresses, and doesn't need to).
 */
async function dashboardTab() {
  const dashboard = await getDashboard();
  const ping = (id) => chrome.tabs.sendMessage(id, { to: "dashboard", type: "ping" }).then((r) => r?.ok === true && r.origin === dashboard, () => false);
  for (const t of await chrome.tabs.query({})) if (await ping(t.id)) return t;
  const t = await chrome.tabs.create({ url: `${dashboard}/applications`, active: false });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await ping(t.id)) return t;
  }
  throw new Error(`Couldn't reach Coverage at ${dashboard}. Open your dashboard in a tab and try again.`);
}

async function askDashboard(type, payload) {
  const tab = await dashboardTab();
  const res = await chrome.tabs.sendMessage(tab.id, { to: "dashboard", type, payload });
  if (!res?.ok) throw new Error(res?.error || "Coverage didn't answer.");
  return res.result;
}

/** The plan comes from the dashboard, but check it against what was scanned before typing anything. */
function checkPlan(plan, fields) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  return (Array.isArray(plan?.items) ? plan.items : []).flatMap((it) => {
    const f = it && byId.get(it.id);
    if (!f) return [];
    const out = { id: f.id, label: f.label, source: it.source === "ai" ? "ai" : "profile" };
    if (it.fileData) {
      if (f.kind !== "file" || typeof it.fileData.base64 !== "string" || it.fileData.base64.length > 11_000_000) return [];
      return [{ ...out, fileData: { name: String(it.fileData.name).slice(0, 200), type: String(it.fileData.type).slice(0, 100), base64: it.fileData.base64 } }];
    }
    if (typeof it.checked === "boolean") return [{ ...out, checked: it.checked, value: typeof it.value === "string" ? it.value.slice(0, 10) : undefined }];
    if (typeof it.value !== "string") return [];
    if (["select", "radio", "checkboxes", "listbox"].includes(f.kind)) {
      const opt = f.options?.find((o) => o.value === it.value);
      if (!opt) return [];
      return [{ ...out, value: it.value, optionLabel: opt.label }];
    }
    const alts = Array.isArray(it.alts) ? it.alts.filter((a) => typeof a === "string").map((a) => a.slice(0, 100)).slice(0, 8) : undefined;
    return [{ ...out, value: it.value.slice(0, 20000), ...(f.kind === "typeahead" && alts ? { alts } : {}) }];
  });
}

/**
 * Scan every frame we may read (the page itself, plus forms embedded from an application site you allowed) and
 * use the one with the most fields. Frames we have no access to are skipped.
 */
async function scanBest(tabId) {
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: scanForm });
  } catch {
    results = await chrome.scripting.executeScript({ target: { tabId }, func: scanForm });
  }
  const ok = results.filter((r) => r.result && Array.isArray(r.result.fields));
  const top = ok.find((r) => r.frameId === 0)?.result;
  const best = ok.reduce((a, r) => (!a || r.result.fields.length > a.result.fields.length ? r : a), null);
  return { frameId: best?.frameId ?? 0, scan: best?.result, frames: top?.frames ?? [] };
}

/** One page: scan → plan (in your Coverage tab) → fill. `opts`: { jobId, watch, batch } for Fill selected. */
async function fillPage(tabId, confirmed, opts = {}) {
  const tab = await chrome.tabs.get(tabId);
  const dashboard = await getDashboard();
  if (!/^https?:\/\//.test(tab.url ?? "")) throw new Error("Open the application page first.");
  if (isBlockedSite(tab.url)) throw new Error("Autofill doesn't run on LinkedIn. Click Apply there (not Easy Apply) to get to the bank's own form.");
  if (tab.url.startsWith(dashboard)) throw new Error("That's your Coverage tab. Open the job application, then click Autofill there.");

  progress(tabId, "Reading the form…");
  const { frameId, scan, frames } = await scanBest(tabId);
  if (!scan?.fields?.length) {
    // The form is embedded from another site: allow that site (if it's an application system) and try again.
    const frame = frames.find((f) => sitePattern(f)) ?? frames[0];
    if (frame) throw new Error(`FRAME:${frame}`);
    const seen = scan?.seen;
    if (seen?.error) throw new Error(`Couldn't read this form (${seen.error}). Reload the page and try again, and tell Coverage's developer this message.`);
    if (seen && seen.inputs + seen.dropdowns > 0)
      throw new Error(`Found ${seen.inputs} inputs and ${seen.dropdowns} dropdowns, but none look fillable (hidden or disabled). Close any open popup on the page, scroll the form into view and try again.`);
    throw new Error("No form fields on this page. Open the application form itself (after any 'Apply' button).");
  }

  progress(tabId, `Found ${scan.fields.length} fields. Asking Coverage what goes in them…`);
  const plan = await askDashboard("plan", {
    url: scan.url,
    title: scan.title,
    pageText: scan.text,
    fields: scan.fields,
    confirmed: !!confirmed,
    ...(opts.jobId ? { jobId: opts.jobId, batch: true } : {}),
  });

  // Still the same page? (A redirect while the AI was writing would put the answers somewhere else.)
  const now = await chrome.tabs.get(tabId);
  if (frameId === 0 && new URL(now.url).origin !== new URL(scan.url).origin) throw new Error("The page changed while answers were being written. Click Autofill again.");

  progress(tabId, "Filling…");
  const items = checkPlan(plan, scan.fields);
  const skipped = (plan.skipped ?? []).slice(0, 40).map((s) => ({ id: s.id, label: String(s.label ?? "").slice(0, 200), why: String(s.why ?? "").slice(0, 300) }));
  const [{ result: filled }] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: fillForm, args: [items, { skipped, watch: !!opts.watch }] });
  const required = new Set(scan.fields.filter((f) => f.required).map((f) => f.id));
  const failedRequired = (filled?.failed ?? []).filter((x) => scan.fields.some((f) => f.label === x.label && f.required));
  return {
    job: plan.job ?? null,
    filled: filled?.filled ?? 0,
    failed: filled?.failed ?? [],
    skipped,
    stopped: !!filled?.stopped,
    // Required questions still empty after this page (a multi-page run stops here so you can answer them).
    needsYou: [...skipped.filter((s) => required.has(s.id)).map((s) => s.label), ...failedRequired.map((x) => x.label)],
    aiError: plan.ai?.error,
    ai: items.filter((i) => i.source === "ai").length,
    frameId,
    url: scan.url,
    at: Date.now(),
  };
}

async function remember(tabId, result) {
  const multi = isMultiPageSite(result.url);
  const pattern = sitePattern(result.url);
  const allowed = pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false;
  const r = { ...result, multi, pattern, allowed };
  await chrome.storage.session.set({ [`autofill:${tabId}`]: r });
  return r;
}

async function autofill(tabId, confirmed) {
  return remember(tabId, await fillPage(tabId, confirmed));
}

async function waitForNextPage(tabId, frameId, before) {
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const [{ result: st }] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: pageState }).catch(() => [{ result: null }]);
    if (!st) continue;
    if (st.errors.length && st.sig === before.sig) return { st, error: st.errors.join(" · ") };
    if (st.sig !== before.sig && !st.busy) {
      await sleep(600); // let the new page's fields render
      return { st };
    }
  }
  return { error: "The next page didn't load. Check the form and click Autofill again." };
}

/**
 * Workday: press Next and fill each following page, stopping at anything that needs you or the review page.
 * `opts.batch` (Fill selected): AI drafts don't stop it (you read everything on the review page), Stop on the page does.
 */
async function continuePages(tabId, opts = {}) {
  const key = `autofill:${tabId}`;
  let last = (await chrome.storage.session.get(key))[key];
  if (!last) throw new Error("Fill this page first.");
  if (!last.multi) throw new Error("Page-by-page filling is for Workday applications.");
  if (!(await hasAccess(last.url))) throw new Error("Allow Coverage on this site first (button above).");
  const frameIds = [last.frameId ?? 0];
  for (let step = 0; step < 10; step++) {
    if (last.stopped) return { ...last, stop: "You pressed Stop." };
    if (last.needsYou?.length) return { ...last, stop: `This page needs you: ${last.needsYou.slice(0, 3).join(", ")}${last.needsYou.length > 3 ? "…" : ""}` };
    if (last.ai && !opts.batch) return { ...last, stop: "This page has AI-drafted answers: read them, then click Continue again." };
    const [{ result: before }] = await chrome.scripting.executeScript({ target: { tabId, frameIds }, func: pageState });
    if (before.review) return { ...last, review: true, stop: "Reached the review page. Check everything and submit it yourself." };
    progress(tabId, "Going to the next page…");
    const [{ result: click }] = await chrome.scripting.executeScript({ target: { tabId, frameIds }, func: clickNext });
    if (!click.clicked) return { ...last, stop: click.why };
    const next = await waitForNextPage(tabId, frameIds[0], before);
    if (next.error) return { ...last, stop: `The site said: ${next.error}` };
    if (next.st.review) {
      last = await remember(tabId, { ...last, filled: 0, failed: [], skipped: [], needsYou: [], ai: 0 });
      return { ...last, review: true, stop: "Reached the review page. Check everything and submit it yourself." };
    }
    progress(tabId, `Page ${step + 2}: filling…`);
    last = await remember(tabId, await fillPage(tabId, true, opts));
  }
  return { ...last, stop: "Stopped after 10 pages. Check where it is and continue yourself." };
}

/* ---------------- Fill selected (from the dashboard) ---------------- */

const batchKey = (tabId) => `batch:${tabId}`;
const report = (jobId, status, note, needs) => askDashboard("fillStatus", { jobId, status, note, needs }).catch(() => {});

/** Does the extension have access to this page's site (an application site you allowed in Options or the popup)? */
async function hasAccess(url) {
  try {
    return await chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] });
  } catch {
    return false;
  }
}

async function loaded(tabId) {
  for (let i = 0; i < 60; i++) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw new Error("The tab was closed.");
    if (t.status === "complete") return t;
    await sleep(500);
  }
  return chrome.tabs.get(tabId);
}

/** All of a batch's tabs go in one "Coverage" tab group in the dashboard's window. */
async function addToGroup(tabId) {
  try {
    const { batchGroup } = await chrome.storage.session.get("batchGroup");
    const ok = batchGroup && (await chrome.tabGroups.get(batchGroup).catch(() => null));
    const groupId = await chrome.tabs.group(ok ? { groupId: batchGroup, tabIds: [tabId] } : { tabIds: [tabId] });
    if (!ok) {
      await chrome.tabGroups.update(groupId, { title: "Coverage", color: "green" });
      await chrome.storage.session.set({ batchGroup: groupId });
    }
  } catch {
    // Grouping is a nicety: the fill works without it.
  }
}

const inTab = async (tabId, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId }, func, args }))[0]?.result;

/**
 * Drives one tracked job's tab from wherever it is (job page, sign-in, form) to its review page. Returns when it's
 * done or when it needs you; a tab waiting for you to sign in is picked up again by itself (onUpdated below).
 */
async function drive(tabId, job) {
  const key = batchKey(tabId);
  await chrome.storage.session.set({ [key]: { ...job, stage: "filling" } });
  const wait = async (status, note) => {
    await chrome.storage.session.set({ [key]: { ...job, stage: "waiting" } });
    return report(job.id, status, note);
  };
  let signInTries = 0;
  let started = false;
  for (let step = 0; step < 12; step++) {
    if (await inTab(tabId, stopRequested)) return report(job.id, "stopped", "You pressed Stop on the page.");
    const tab = await chrome.tabs.get(tabId);
    if (!(await hasAccess(tab.url))) return wait("access", `The application moved to ${new URL(tab.url).hostname}. Allow that site in the extension's Options, then press Fill again.`);
    const ls = await inTab(tabId, loginState);
    if (ls?.kind === "signin" || ls?.kind === "signup") {
      const cred = await loginFor(tab.url);
      if (ls.kind === "signup" && cred.username && ls.signInSwitch && signInTries < 2) {
        await inTab(tabId, switchToSignIn);
        signInTries++;
        await sleep(2000);
        continue;
      }
      if (ls.kind === "signup") return wait("account", `${new URL(tab.url).hostname} wants an account. Create it in that tab (Chrome can make and save the password); Coverage carries on once you're in.`);
      if (cred.username && signInTries < 2) {
        progress(tabId, "Signing in with your saved login…");
        const r = await inTab(tabId, signIn, [cred.username, cred.password, new URL(tab.url).origin]);
        signInTries++;
        if (r?.clicked) {
          await sleep(4000);
          await loaded(tabId);
          continue;
        }
      }
      const why = {
        locked: "Unlock your saved logins (extension Options), or sign in in that tab. Coverage carries on once you're in.",
        off: "Sign in in that tab (Chrome fills your saved password with one click). Coverage carries on once you're in.",
        none: "Sign in in that tab. Coverage carries on once you're in (save this login in the extension's Options to skip this next time).",
        several: "You saved more than one login for this site: sign in in that tab. Coverage carries on once you're in.",
      }[cred.why] ?? "Sign in in that tab. Coverage carries on once you're in.";
      return wait("signin", signInTries ? "Your saved login didn't get in. Sign in in that tab; Coverage carries on once you're in." : why);
    }
    if (ls?.kind === "verify") return wait("account", "Verify your email (check your inbox), then sign in in that tab. Coverage carries on once you're in.");

    const { scan } = await scanBest(tabId);
    if ((scan?.fields?.length ?? 0) < 3 && !started) {
      // Still the job description: open the application (Workday Apply → Apply Manually, Lever's apply link).
      const s = await inTab(tabId, startApplication);
      started = true;
      if (s?.clicked) {
        progress(tabId, `Opened the application (${s.label})…`);
        await sleep(3500);
        await loaded(tabId);
        continue;
      }
    }
    if (!scan?.fields?.length) return report(job.id, "error", "No application form on that page. Open it there and use the Coverage icon.");

    let r = await remember(tabId, await fillPage(tabId, true, { jobId: job.id, watch: job.watch }));
    if (r.multi && !r.stopped) r = await continuePages(tabId, { jobId: job.id, watch: job.watch, batch: true });
    await chrome.storage.session.remove(key);
    if (r.stopped) return report(job.id, "stopped", "You pressed Stop on the page.");
    if (r.needsYou?.length) return report(job.id, "needs_you", `${r.needsYou.length} required question${r.needsYou.length === 1 ? "" : "s"} left for you.`, r.needsYou.slice(0, 10));
    if (r.review || !r.multi)
      return report(job.id, "ready", `${r.multi ? "On the review page" : `Filled ${r.filled} field${r.filled === 1 ? "" : "s"}`}${r.ai ? " (AI drafts to read)" : ""}. Check it and submit it yourself.`);
    return report(job.id, "needs_you", r.stop || "Stopped before the review page: carry on in that tab.");
  }
  return report(job.id, "error", "Gave up after too many steps. Carry on in that tab.");
}

async function fillOne(job, active) {
  const dash = await dashboardTab();
  const tab = await chrome.tabs.create({ url: job.url, active, windowId: dash.windowId });
  await addToGroup(tab.id);
  await chrome.storage.session.set({ [batchKey(tab.id)]: { ...job, stage: "filling" } });
  await report(job.id, "filling", "Opening the application…");
  await loaded(tab.id);
  await sleep(2500); // single-page apps render after "complete"
  await inTab(tab.id, () => delete document.documentElement.dataset.coverageStop).catch(() => {});
  return drive(tab.id, job).catch((e) => report(job.id, "error", e instanceof Error ? e.message : String(e)));
}

let running = Promise.resolve();

/** Fill selected: one tab at a time when you watch, two at a time otherwise. */
function fillJobs({ jobs, watch }) {
  const list = jobs.slice(0, 25);
  running = running.then(async () => {
    const queue = [];
    for (const job of list) {
      if (isBlockedSite(job.url)) await report(job.id, "error", "That's a LinkedIn listing: add the bank's own application link to the job.");
      else if (!(await hasAccess(job.url))) await report(job.id, "access", `Allow Coverage on ${new URL(job.url).hostname} (extension Options → Application sites), then press Fill again.`);
      else {
        await report(job.id, "queued", "Waiting for a free tab…");
        queue.push({ ...job, watch });
      }
    }
    const workers = Array.from({ length: watch ? 1 : 2 }, async () => {
      while (queue.length) await fillOne(queue.shift(), watch);
    });
    await Promise.all(workers);
  });
  return { queued: list.length };
}

// A tab that was waiting for you to sign in (or create an account) carries on once the page changes and isn't a
// login page any more.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  const key = batchKey(tabId);
  const job = (await chrome.storage.session.get(key))[key];
  if (!job || job.stage !== "waiting") return;
  await sleep(2500);
  const ls = await inTab(tabId, loginState).catch(() => null);
  if (!ls || ls.kind !== "none") return;
  await report(job.id, "filling", "You're in. Carrying on…");
  drive(tabId, job).catch((e) => report(job.id, "error", e instanceof Error ? e.message : String(e)));
});
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(batchKey(tabId)));

async function focusJob(jobId) {
  const all = await chrome.storage.session.get(null);
  const hit = Object.entries(all).find(([k, v]) => k.startsWith("batch:") && v?.id === jobId);
  const tabId = hit ? Number(hit[0].slice(6)) : null;
  const tab = tabId && (await chrome.tabs.get(tabId).catch(() => null));
  if (!tab) return { found: false };
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { found: true };
}

/* ---------------- LinkedIn job search (opt-in, test build) ---------------- */

async function linkedinReady() {
  const { linkedinAgent } = await chrome.storage.local.get("linkedinAgent");
  return linkedinAgent === true && (await chrome.permissions.contains({ origins: [LINKEDIN] }).catch(() => false));
}

const finder = (text, done = false) => askDashboard("finderStatus", { text, done }).catch(() => {});

async function linkedinJobs({ terms, location, max, watch }) {
  if (!(await linkedinReady())) throw new Error("Turn on LinkedIn job search in the extension's Options first (test build only).");
  const today = new Date().toISOString().slice(0, 10);
  const { liDay } = await chrome.storage.local.get("liDay");
  const used = liDay?.date === today ? liDay.count : 0;
  const n = Math.max(0, Math.min(max, 25, 60 - used));
  if (!n) throw new Error("Reached today's limit of 60 LinkedIn jobs (kept low so it reads like a person). Try again tomorrow.");
  const dash = await dashboardTab();
  const tab = await chrome.tabs.create({ url: linkedinJobsUrl(terms, location), active: !!watch, windowId: dash.windowId });
  await addToGroup(tab.id);
  (async () => {
    let got = 0;
    try {
      await loaded(tab.id);
      await sleep(4000 + Math.random() * 2000);
      if (isLinkedInWall((await chrome.tabs.get(tab.id)).url)) return finder("LinkedIn asked you to sign in or pass a check. Do that in the tab, then search again.", true);
      finder("Reading the search results…");
      const list = (await inTab(tab.id, readLinkedInJobs, [n])) ?? [];
      if (!list.length) return finder("No jobs on that LinkedIn search.", true);
      for (const [i, j] of list.entries()) {
        finder(`Reading job ${i + 1} of ${list.length}: ${j.company || ""} ${j.title}`.trim());
        await chrome.tabs.update(tab.id, { url: `https://www.linkedin.com/jobs/view/${j.id}/` });
        await loaded(tab.id);
        await sleep(6000 + Math.random() * 8000); // a person's pace, not a scraper's
        if (isLinkedInWall((await chrome.tabs.get(tab.id)).url)) return finder(`LinkedIn asked for a check after ${got} jobs. Stopped there.`, true);
        const job = await inTab(tab.id, captureLinkedInJob);
        if (job && !job.error) {
          await askDashboard("foundJob", job).catch(() => {});
          got++;
          await chrome.storage.local.set({ liDay: { date: today, count: used + got } });
        }
      }
      finder(`Done: ${got} LinkedIn job${got === 1 ? "" : "s"} added to your finds.`, true);
    } catch (e) {
      finder(`LinkedIn search stopped: ${e instanceof Error ? e.message : String(e)}`, true);
    } finally {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  })();
  return { started: true, max: n };
}

/* ---------------- saved logins sync (1.3.1) ---------------- */

// The vault (vault.js) is encrypted with your PIN; only that ciphertext goes to your Coverage account, through the
// dashboard tab, so another browser where you sign in to Coverage gets the same logins (unlock with the same PIN).
// The newer copy wins (`vaultAt`); a copy taken from the account locks this browser's vault until the PIN is entered.
const okVault = (b) => b === null || (b && b.v === 1 && ["salt", "iv", "data"].every((k) => typeof b[k] === "string" && b[k].length < 400_000));
let lastAdopted = null;
let vaultBusy = false;
async function syncVault() {
  if (vaultBusy) return { busy: true };
  vaultBusy = true;
  try {
    const { vault, vaultAt } = await chrome.storage.local.get(["vault", "vaultAt"]);
    const remote = await askDashboard("vault", { op: "get" }).catch(() => undefined);
    if (remote === undefined) return { synced: false };
    const localAt = typeof vaultAt === "string" ? vaultAt : "";
    const remoteAt = typeof remote?.at === "string" ? remote.at : "";
    if (remote && remoteAt > localAt && okVault(remote.blob)) {
      lastAdopted = JSON.stringify(remote.blob ?? null);
      if (remote.blob) await chrome.storage.local.set({ vault: remote.blob, vaultAt: remoteAt, vaultOn: true });
      else {
        await chrome.storage.local.remove(["vault", "vaultOn"]);
        await chrome.storage.local.set({ vaultAt: remoteAt });
      }
      await chrome.storage.session.remove("vaultKey");
      return { synced: true, from: "account" };
    }
    if (localAt && localAt > remoteAt) {
      await askDashboard("vault", { op: "put", blob: vault ?? null, at: localAt });
      return { synced: true, from: "here" };
    }
    return { synced: true };
  } finally {
    vaultBusy = false;
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !("vault" in changes)) return;
  // The change that syncVault just made itself: nothing to send back.
  if (lastAdopted !== null && JSON.stringify(changes.vault.newValue ?? null) === lastAdopted) {
    lastAdopted = null;
    return;
  }
  chrome.storage.local.set({ vaultAt: new Date().toISOString() }).then(() => syncVault().catch(() => {}));
});

/* ---------------- messages ---------------- */

const ID = /^[A-Za-z0-9_-]{1,60}$/;
function cleanJobs(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 25).flatMap((j) => {
    // https only (plain http just for a local dev server, as in settings.js).
    if (!j || typeof j !== "object" || !ID.test(String(j.id)) || typeof j.url !== "string" || !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(j.url)) return [];
    return [{ id: String(j.id), url: j.url.slice(0, 2000), company: String(j.company ?? "").slice(0, 120) }];
  });
}

/** Commands from your Coverage tab (through content/dashboard.js), only from the dashboard address you set. */
async function fromDashboard(msg, sender) {
  const dashboard = await getDashboard();
  if (sender.frameId !== 0 || !sender.url || new URL(sender.url).origin !== dashboard) throw new Error("Not your Coverage dashboard.");
  const p = msg.payload ?? {};
  if (msg.type === "vaultSync") return syncVault();
  if (msg.type === "fillJobs") return fillJobs({ jobs: cleanJobs(p.jobs), watch: p.watch === true });
  if (msg.type === "focusJob" && ID.test(String(p.jobId))) return focusJob(String(p.jobId));
  if (msg.type === "linkedinJobs")
    return linkedinJobs({ terms: String(p.terms ?? "").slice(0, 120), location: String(p.location ?? "").slice(0, 80), max: Math.min(Number(p.max) || 15, 25), watch: p.watch === true });
  throw new Error("Unknown command.");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const reply = (p) => {
    p.then(
      (result) => sendResponse({ ok: true, result }),
      (e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  };
  // The dashboard bridge (a content script on the dashboard's own pages only).
  if (sender.tab && msg?.from === "dashboard") return reply(fromDashboard(msg, sender));
  // Everything else: only the popup / options (extension pages, not a content script in some tab).
  if (sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  if (msg?.type === "autofill" && Number.isInteger(msg.tabId)) return reply(autofill(msg.tabId, msg.confirmed === true));
  if (msg?.type === "continue" && Number.isInteger(msg.tabId)) return reply(continuePages(msg.tabId));
  if (msg?.type === "submitted" && typeof msg.url === "string") return reply(askDashboard("submitted", { url: msg.url }));
  return false;
});

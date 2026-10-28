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
// LinkedIn / Handshake job search (opt-in, test build only): reads a job search in your own browser at a human pace
// and hands each job to your dashboard, where the AI reviews it. The store build has no access to either site.
// Fill selected on a Handshake posting presses "Apply externally" and fills the bank's form it opens.
//
// The job page never talks to the extension: it only gets values typed into its fields.
import { getDashboard } from "./settings.js";
import { loginFor, saveLogin, vaultStatus } from "./vault.js";
import {
  clickNext,
  createAccount,
  switchToCreateAccount,
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
import { runFill } from "./agent/agent.js";
import { GMAIL_ORIGIN, TRACKING_TYPES, flushOutbox, fromGmail, syncPixelKey } from "./tracking.js";
import { captureHandshakeJob, clickApplyExternally, handshakeJobUrl, handshakePage, isHandshake, isHandshakeWall, readHandshakeJobs } from "./sites/handshake.js";

const progress = (tabId, text) => chrome.runtime.sendMessage({ type: "autofill-progress", tabId, text }).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LINKEDIN = "https://www.linkedin.com/*";
const HANDSHAKE = "https://*.joinhandshake.com/*";

/**
 * The open Coverage tab (or a new one), with its bridge answering. Tabs are found by asking each one: only the bridge
 * script answers, with its page's origin (the extension can't read other tabs' addresses, and doesn't need to).
 */
// Every status report, plan and lookup goes through the dashboard tab, so finding it is on the hot path: it used to ask
// every open tab, one after another, on every call (dozens of round trips with a full tab strip). Now the last tab
// that answered is asked first, and a search asks all tabs at once (owner, 2026-10-28: "slow and memory intensive").
let dashTabId = null;
async function dashboardTab() {
  const dashboard = await getDashboard();
  const ping = (id) => chrome.tabs.sendMessage(id, { to: "dashboard", type: "ping" }).then((r) => r?.ok === true && r.origin === dashboard, () => false);
  if (dashTabId === null) dashTabId = (await chrome.storage.session.get("dashTab")).dashTab ?? null;
  if (dashTabId !== null && (await ping(dashTabId))) {
    const t = await chrome.tabs.get(dashTabId).catch(() => null);
    if (t) return t;
  }
  const tabs = (await chrome.tabs.query({})).filter((t) => !t.discarded && /^https?:/.test(t.url ?? "https:"));
  const hits = await Promise.all(tabs.map((t) => ping(t.id)));
  let found = tabs.find((_, i) => hits[i]);
  if (!found) {
    const t = await chrome.tabs.create({ url: `${dashboard}/applications`, active: false });
    for (let i = 0; i < 40 && !found; i++) {
      await sleep(500);
      if (await ping(t.id)) found = t;
    }
  }
  if (!found) throw new Error(`Couldn't reach Coverage at ${dashboard}. Open your dashboard in a tab and try again.`);
  dashTabId = found.id;
  await chrome.storage.session.set({ dashTab: found.id });
  return found;
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
    // School searches: what to type, in order, and only accept a real match (the dashboard's schoolNames).
    const search = Array.isArray(it.search) ? it.search.filter((a) => typeof a === "string").map((a) => a.slice(0, 100)).slice(0, 4) : undefined;
    return [{ ...out, value: it.value.slice(0, 20000), ...(f.kind === "typeahead" && alts ? { alts } : {}), ...(f.kind === "typeahead" && search ? { search, strict: it.strict === true } : {}) }];
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
  let items = checkPlan(plan, scan.fields);
  // Resume first (owner, 2026-10-26): on sites that read the resume into the form (Workday's experience / education),
  // upload it, give the site a moment to parse it, then look at the page again and fill the rest from there.
  const fileItems = items.filter((i) => i.fileData);
  if (fileItems.length && fileItems.length < items.length && !opts.resumeDone && isMultiPageSite(scan.url)) {
    progress(tabId, "Uploading your resume first (the site fills your experience from it)…");
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: fillForm, args: [fileItems, { skipped: [], watch: !!opts.watch }] });
    await sleep(9000);
    return fillPage(tabId, true, { ...opts, resumeDone: true });
  }
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
  const r = await remember(tabId, await fillPage(tabId, confirmed));
  // The toolbar button gets the same backup as Fill selected: the AI agent finishes what the rules / Jev / the
  // answer model left (it runs on after the popup closes; its steps show on the page).
  if (needsAgent(r) && (await agentModel())) {
    const tab = await chrome.tabs.get(tabId);
    void agentFinish(tabId, { id: r.job?.id ?? "", url: tab.url })
      .catch(() => {})
      .finally(() => detachDebugger(tabId));
    return { ...r, agent: true };
  }
  return r;
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

/* ---------------- real clicks and typing (test build, 1.11; owner 2026-10-26) ----------------
 * Greenhouse's dropdowns (react-select) and similar widgets ignore script-made events: a dispatched mousedown /
 * keydown / input never opens them (checked on a live Greenhouse form). Chrome's debugging protocol delivers input
 * exactly like a person's mouse and keyboard, and works in background tabs. The page scripts Coverage injects ask for
 * it ("cov-click" / "cov-type" / "cov-key"); Chrome shows "Coverage started debugging this browser" while a tab is
 * attached. The store build has no "debugger" permission, so there the page scripts fall back to dispatched events. */

const attached = new Set();
const canDebug = () => typeof chrome.debugger?.attach === "function";

async function cdp(tabId, method, params) {
  if (!attached.has(tabId)) {
    await chrome.debugger.attach({ tabId }, "1.3");
    attached.add(tabId);
  }
  return chrome.debugger.sendCommand({ tabId }, method, params);
}
async function detachDebugger(tabId) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => {});
}
if (canDebug()) chrome.debugger.onDetach.addListener((src) => attached.delete(src.tabId));
chrome.tabs.onRemoved.addListener((tabId) => attached.delete(tabId));

async function trustedClick(tabId, x, y) {
  const at = { x: Math.round(x), y: Math.round(y) };
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", buttons: 0, clickCount: 1 });
}
const KEYS = { Enter: 13, ArrowDown: 40, ArrowUp: 38, Escape: 27, Tab: 9, Backspace: 8 };
async function trustedKey(tabId, key) {
  const code = KEYS[key];
  if (!code) return;
  for (const type of ["rawKeyDown", "keyUp"]) await cdp(tabId, "Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
}
/** Real input for a page script (top frame only: its coordinates are the tab's). */
async function trustedInput(msg, sender) {
  if (!canDebug() || !sender.tab?.id || sender.frameId !== 0) return false;
  const tabId = sender.tab.id;
  if (msg.type === "cov-click" && Number.isFinite(msg.x) && Number.isFinite(msg.y)) await trustedClick(tabId, msg.x, msg.y);
  else if (msg.type === "cov-type" && typeof msg.text === "string") {
    // Long answers go in pieces (it used to stop at 500 characters, cutting essay answers off mid-word).
    const text = msg.text.slice(0, 12000);
    for (let i = 0; i < text.length; i += 400) await cdp(tabId, "Input.insertText", { text: text.slice(i, i + 400) });
  }
  else if (msg.type === "cov-key" && typeof msg.key === "string") await trustedKey(tabId, msg.key);
  else return false;
  return true;
}

/* ---------------- accounts (opt-in, test build; owner 2026-10-26) ---------------- */

/** "Create accounts for me" (extension Options): off unless you turned it on. */
async function autoAccountsOn() {
  const { autoAccounts } = await chrome.storage.local.get("autoAccounts");
  return autoAccounts === true;
}

/** A strong password: 20 characters with upper / lower / digit / symbol (what application sites require). */
function newPassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%*?"];
  const all = sets.join("");
  const pick = (chars) => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length];
  const out = [...sets.map(pick), ...Array.from({ length: 16 }, () => pick(all))];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

/**
 * Create an account on this site: your email and name from Coverage (My info), a new password saved to your vault
 * first (so it's never lost), then the site's own create-account form. Returns { clicked } or { why }.
 */
async function makeAccount(tabId, url, job) {
  const st = await vaultStatus();
  if (!st.on || !st.hasPin) return { why: "To create accounts, turn on saved logins (extension Options) so the password Coverage makes is kept." };
  if (!st.unlocked) return { why: "Unlock your saved logins (extension Options → enter your PIN) so Coverage can save the new password, then press Fill again." };
  const me = await askDashboard("accountInfo", {}).catch(() => null);
  if (!me?.email) return { why: "Add your email in Applications → My info, then press Fill again." };
  const password = newPassword();
  const origin = new URL(url).origin;
  await saveLogin(url, me.email, password);
  const r = await inTab(tabId, createAccount, [me.email, password, me.firstName ?? "", me.lastName ?? "", origin]);
  await askDashboard("accountCreated", { jobId: job.id, origin, email: me.email, clicked: !!r?.clicked }).catch(() => {});
  return r?.clicked ? { clicked: true } : { why: r?.why ?? "Filled the account form; press Create Account in that tab." };
}

/** All of a batch's tabs go in one "Coverage" tab group in the dashboard's window. */
async function addToGroup(tabId) {
  try {
    const { batchGroup } = await chrome.storage.session.get("batchGroup");
    const tab = await chrome.tabs.get(tabId);
    const group = batchGroup && (await chrome.tabGroups.get(batchGroup).catch(() => null));
    // Only the group in this tab's window (grouping into another window's group would move the tab there).
    const ok = group && group.windowId === tab.windowId;
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
  let created = false;
  let verifyTries = 0;
  const since = Date.now();
  for (let step = 0; step < 12; step++) {
    if (await inTab(tabId, stopRequested)) return report(job.id, "stopped", "You pressed Stop on the page.");
    let tab = await chrome.tabs.get(tabId);
    if (isHandshake(tab.url) && !isHandshakeWall(tab.url)) {
      progress(tabId, "Pressing Apply externally on Handshake…");
      const h = await handshakeHandOff(tabId, job);
      if (h.needs) return wait("needs_you", h.needs);
      if (h.error) return wait("needs_you", h.error);
      if (h.tabId !== tabId) return drive(h.tabId, job);
      tab = await chrome.tabs.get(tabId);
    }
    if (!(await hasAccess(tab.url)))
      return wait("access", `The application moved to ${new URL(tab.url).hostname}. Allow that site in the extension's Options${typeof runFill === "function" ? ' (or "Fill applications on any site")' : ""}, then press Fill again.`);
    const ls = await inTab(tabId, loginState);
    if (ls?.kind === "signin" || ls?.kind === "signup") {
      const cred = await loginFor(tab.url);
      if (ls.kind === "signup" && cred.username && ls.signInSwitch && signInTries < 2) {
        await inTab(tabId, switchToSignIn);
        signInTries++;
        await sleep(2000);
        continue;
      }
      // A sign-in page and no saved login for this site: open its "Create Account" (Workday shows sign-in first).
      if (ls.kind === "signin" && !cred.username && !created && signInTries === 0 && (await autoAccountsOn())) {
        const sw = await inTab(tabId, switchToCreateAccount);
        if (sw?.clicked) {
          signInTries++;
          progress(tabId, "No account here yet: opening Create Account…");
          await sleep(2500);
          continue;
        }
      }
      // No account here yet: create one (opt-in), with a password saved to your vault BEFORE it's used.
      if (ls.kind === "signup" && !cred.username && !created && (await autoAccountsOn())) {
        const made = await makeAccount(tabId, tab.url, job);
        created = true;
        if (made.clicked) {
          progress(tabId, "Created an account (password saved in your vault)…");
          await sleep(5000);
          await loaded(tabId);
          continue;
        }
        return wait("account", made.why);
      }
      if (ls.kind === "signup") return wait("account", `${new URL(tab.url).hostname} wants an account. Create it in that tab (Chrome can make and save the password), or turn on "Create accounts for me" in the extension's Options; Coverage carries on once you're in.`);
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
    if (ls?.kind === "verify") {
      // The site emailed a verification link: your Coverage tab finds it in Gmail; it's opened here, then sign-in
      // (saved login) and the application carry on.
      if (verifyTries < 2 && (await autoAccountsOn())) {
        verifyTries++;
        await report(job.id, "filling", "Waiting for the verification email (Coverage checks your Gmail)…");
        const link = await askDashboard("verifyLink", { jobId: job.id, url: tab.url, since }).catch(() => null);
        if (typeof link === "string" && /^https:\/\//.test(link)) {
          progress(tabId, "Opening the verification link…");
          await chrome.tabs.update(tabId, { url: link });
          await sleep(5000);
          await loaded(tabId);
          // Back to the job (verification pages land on the site's home or sign-in page).
          await chrome.tabs.update(tabId, { url: job.url });
          await sleep(3000);
          await loaded(tabId);
          continue;
        }
      }
      return wait("account", "Verify your email (check your inbox), then sign in in that tab. Coverage carries on once you're in.");
    }

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
    if (!scan?.fields?.length) {
      // No form the rules can read (a careers page with its own Apply flow, an unusual site): the AI agent takes it.
      const run = await agentFinish(tabId, job);
      await chrome.storage.session.remove(key);
      if (run) return agentReport(job, run, "");
      return report(job.id, "error", "No application form on that page. Open it there and use the Coverage icon (or pick an agent model in the agent test bench to let the AI do it).");
    }

    let r = await remember(tabId, await fillPage(tabId, true, { jobId: job.id, watch: job.watch }));
    if (r.multi && !r.stopped) r = await continuePages(tabId, { jobId: job.id, watch: job.watch, batch: true });
    if (r.stopped) {
      await chrome.storage.session.remove(key);
      return report(job.id, "stopped", "You pressed Stop on the page.");
    }
    // The AI agent is the backup (owner, 2026-10-26: "use the other frameworks for most of the stuff"): it only runs
    // when the rules, Jev and the answer model left something it could do.
    const run = needsAgent(r) ? await agentFinish(tabId, job) : null;
    await chrome.storage.session.remove(key);
    if (run) return agentReport(job, run, `Rules filled ${r.filled ?? 0} field${r.filled === 1 ? "" : "s"}.`);
    if (r.needsYou?.length) return report(job.id, "needs_you", `${r.needsYou.length} required question${r.needsYou.length === 1 ? "" : "s"} left for you.`, r.needsYou.slice(0, 10));
    if (r.review || !r.multi)
      return report(job.id, "ready", `${r.multi ? "On the review page" : `Filled ${r.filled} field${r.filled === 1 ? "" : "s"}`}${r.ai ? " (AI drafts to read)" : ""}. Check it and submit it yourself.`);
    return report(job.id, "needs_you", r.stop || "Stopped before the review page: carry on in that tab.");
  }
  return report(job.id, "error", "Gave up after too many steps. Carry on in that tab.");
}

/**
 * Where a background batch runs (owner, 2026-10-26: "running in the background of my work"): its own window, opened
 * behind yours, so the applications aren't hidden tabs Chrome slows to a crawl in the window you're using. Keep it
 * open (not minimized: Chrome pauses minimized windows). Watching fills in your window instead.
 */
async function batchWindow() {
  const { batchWin } = await chrome.storage.session.get("batchWin");
  if (batchWin && (await chrome.windows.get(batchWin).catch(() => null))) return batchWin;
  const w = await chrome.windows.create({ focused: false, state: "normal", width: 1280, height: 900 });
  await chrome.storage.session.set({ batchWin: w.id, batchGroup: null });
  return w.id;
}

async function fillOne(job, active) {
  const windowId = active ? (await dashboardTab()).windowId : await batchWindow();
  // A window of their own keeps background fills out of your tab strip; their waits are timed by this worker (see
  // "cov-sleep"), so being a hidden tab doesn't stall them, and they're never discarded mid-fill.
  const tab = await chrome.tabs.create({ url: job.url, active, windowId });
  await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  await addToGroup(tab.id);
  await chrome.storage.session.set({ [batchKey(tab.id)]: { ...job, stage: "filling" } });
  await report(job.id, "filling", "Opening the application…");
  await loaded(tab.id);
  await sleep(2500); // single-page apps render after "complete"
  await inTab(tab.id, () => delete document.documentElement.dataset.coverageStop).catch(() => {});
  return drive(tab.id, job)
    .catch((e) => report(job.id, "error", e instanceof Error ? e.message : String(e)))
    .finally(() => detachDebugger(tab.id));
}

let running = Promise.resolve();

/** Fill selected: one tab at a time when you watch, two at a time otherwise. */
function fillJobs({ jobs, watch }) {
  const list = jobs.slice(0, 50);
  running = running.then(async () => {
    const queue = [];
    for (const job of list) {
      if (isBlockedSite(job.url)) await report(job.id, "error", "That's a LinkedIn listing: add the bank's own application link to the job.");
      else if (!(await hasAccess(job.url)))
        await report(
          job.id,
          "access",
          isHandshake(job.url)
            ? "Turn on Handshake job search in the extension's Options (test build), then press Fill again."
            : typeof runFill === "function"
              ? `Coverage can't open ${new URL(job.url).hostname} yet: extension Options → "Fill applications on any site" (or allow just this site), then press Fill again.`
              : `Allow Coverage on ${new URL(job.url).hostname} (extension Options → Application sites), then press Fill again.`,
        );
      else queue.push({ ...job, watch });
    }
    // Up to 4 at once (owner, 2026-10-26: "do more, text me when ~30 are done"). The AI's model calls are paced
    // across all tabs (agent.js#paced), so more tabs don't mean more rate-limit errors; watching = one at a time.
    const width = watch ? 1 : 4;
    for (const [i, job] of queue.entries()) if (i >= width) await report(job.id, "queued", `Waiting: #${i - width + 1} in line (${width} fill at a time).`);
    const workers = Array.from({ length: width }, async (_, w) => {
      await sleep(w * 4000); // staggered starts
      while (queue.length) {
        const job = queue.shift();
        await fillOne(job, watch);
        queue.forEach((q, i) => void report(q.id, "queued", `Waiting: #${i + 1} in line (${width} fill at a time).`));
      }
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

/* ---------------- AI agent finishes the application (test build, 1.5) ---------------- */

/**
 * The model you picked in the agent test bench (side panel), with its key, if "Finish applications with this model"
 * isn't turned off there. The store build ships a stub runAgent (null): no agent.
 */
async function agentModel() {
  if (typeof runFill !== "function") return null;
  const S = await chrome.storage.local.get({ keys: {}, bases: {}, picked: {}, prefs: {}, compare: [], benchTurn: 0 });
  if (S.prefs.fillAgent === false) return null;
  // Benchmark mode (Options): take turns through the models ticked in the agent test bench's comparison list, so each
  // model gets a share of the same kind of applications (Applications → Agent benchmark compares them).
  const pool = S.prefs.benchmark ? (S.compare ?? []).filter((c) => c.on && c.model && S.keys[c.provider]) : [];
  let pick = S.picked ?? {};
  if (pool.length > 1) {
    pick = pool[S.benchTurn % pool.length];
    await chrome.storage.local.set({ benchTurn: S.benchTurn + 1 });
  }
  const { provider, model } = pick;
  if (!provider || !model || !S.keys[provider]) return null;
  return { provider, model, key: S.keys[provider], baseURL: S.bases[provider] };
}

/**
 * "Mix models" (Options): the models ticked in the agent test bench's comparison list take turns step by step (not in
 * benchmark mode, which keeps one model per job so they can be compared). Returns null when off / fewer than two.
 */
async function mixedModels() {
  const S = await chrome.storage.local.get({ keys: {}, bases: {}, prefs: {}, compare: [] });
  if (!S.prefs.mix || S.prefs.benchmark) return null;
  const pool = (S.compare ?? []).filter((c) => c.on && c.model && S.keys[c.provider]).map((c) => ({ provider: c.provider, model: c.model, key: S.keys[c.provider], baseURL: S.bases[c.provider] }));
  return pool.length > 1 ? pool : null;
}

/**
 * Can this model read a screenshot? Claude, Gemini and GPT-4o-class models can; for Qwen / GLM / other OpenAI-compatible
 * ones only vision models (names with VL / V / vision / omni). DeepSeek's API takes no images.
 */
function canSee(m) {
  if (!m) return false;
  if (m.provider === "anthropic" || m.provider === "google") return true;
  if (m.provider === "openai") return /gpt-4o|gpt-4\.1|gpt-5|^o\d/i.test(m.model);
  if (m.provider === "deepseek") return false;
  return /vl|vision|omni|(^|-)v(\d|$|-)|\dv|4v|5v/i.test(m.model);
}

/** The optional vision helper (Options): reads the screenshots when the agent's own model can't (DeepSeek). */
async function visionModel() {
  const S = await chrome.storage.local.get({ keys: {}, bases: {}, prefs: {} });
  const v = S.prefs.vision;
  return v?.provider && v?.model && S.keys[v.provider] ? { provider: v.provider, model: v.model, key: S.keys[v.provider], baseURL: S.bases[v.provider] } : undefined;
}

/**
 * After the rule-based fill (and the resume upload), the AI agent finishes the page and the next ones: experience
 * entries, custom widgets, questions the rules skipped, Next / Continue. It stops at the final submit (fillGate).
 * Returns null when there's no agent model.
 */
async function agentFinish(tabId, job) {
  const model = await agentModel();
  if (!model) return null;
  const tab = await chrome.tabs.get(tabId);
  const brief = await askDashboard("agentBrief", { jobId: job.id, url: tab.url });
  if (!brief?.task) return null;
  await report(job.id, "filling", `AI agent (${model.model}) is filling the rest…`);
  const ctrl = new AbortController();
  const vision = await visionModel();
  const models = await mixedModels();
  // runFill: several actions per model call, text first, a screenshot only when stuck (agent/agent.js).
  const started = Date.now();
  const run = await runFill({
    tabId,
    task: brief.task,
    secrets: brief.secrets ?? {},
    model,
    models: models ?? undefined,
    maxSteps: 30,
    // Screenshots go to the main model only when it can read images; otherwise only to the vision helper.
    screenshots: canSee(model),
    vision,
    // Why it's paused right now (shown on the page): its turn in the pacing, or the provider being busy.
    onWait: (msg) => progress(tabId, msg),
    // Answers that worked here are remembered for the next application on the same platform (no AI call then).
    learn: (a) => askDashboard("learnAnswer", { ...a, url: tab.url }).catch(() => {}),
    // Dropdown wording not found: Jev (your TypeSafe key, through your Coverage tab) picks from the shown options.
    pick: (q) => askDashboard("pickOption", { ...q, jobId: job.id }),
    // Screenshots through the debugging protocol: background tabs too (test build).
    shot: canDebug() ? async (id) => `data:image/jpeg;base64,${(await cdp(id, "Page.captureScreenshot", { format: "jpeg", quality: 50 })).data}` : undefined,
    signal: ctrl.signal,
    onStep: (s) => {
      progress(tabId, `AI step ${s.n}: ${s.thought || s.result}`);
      inTab(tabId, stopRequested).then((stop) => stop && ctrl.abort(), () => {});
    },
  });
  // For the agent benchmark (Applications): model, steps, tokens, time, how it ended.
  void askDashboard("agentRun", {
    jobId: job.id,
    url: tab.url,
    provider: run.provider,
    model: run.model,
    vision: vision?.model,
    steps: run.steps,
    inTokens: run.inTokens,
    cachedTokens: run.cachedTokens,
    outTokens: run.outTokens,
    ms: Date.now() - started,
    failedActions: run.failedActions,
    visionSteps: run.visionSteps,
    outcome: run.outcome,
    answer: String(run.answer ?? "").slice(0, 300),
  }).catch(() => {});
  return run;
}

/** Skips the agent shouldn't act on either (yours to decide), so they don't call it in. */
const YOURS = /consent|certification|salary|optional|never filled|sensitive|leave for|left for you|not set in your info|cover letter|attach this file|replace it/i;

/**
 * Did the rule-based fill leave work the agent could do? A required question still empty, a field that failed, a
 * field nobody could place, or (multi-page sites) not at the review page yet.
 */
function needsAgent(r) {
  if (r.needsYou?.length || r.failed?.length) return true;
  if (r.multi && !r.review) return true;
  return (r.skipped ?? []).some((s) => !YOURS.test(s.why ?? ""));
}

/** The agent's result as a Fill selected status. */
function agentReport(job, run, before) {
  if (run.outcome === "stopped") return report(job.id, "stopped", "You pressed Stop on the page.");
  if (run.outcome === "done") return report(job.id, "ready", `${before ? `${before} ` : ""}AI agent: ${run.answer || "filled up to review"}. Check it and submit it yourself.`.trim());
  const why = run.outcome === "max_steps" ? "Ran out of steps" : run.outcome === "error" ? `AI error: ${run.answer}` : run.answer || "Stopped";
  return report(job.id, "needs_you", `${why}. Carry on in that tab.`.slice(0, 300));
}

/* ---------------- LinkedIn / Handshake job readers (opt-in, test build) ---------------- */

const SITES = {
  linkedin: {
    name: "LinkedIn",
    origin: LINKEDIN,
    flag: "linkedinAgent",
    dayKey: "liDay",
    page: (url, i) => {
      const u = new URL(url);
      if (i) u.searchParams.set("start", String(i * 25));
      return u.toString();
    },
    view: (id) => `https://www.linkedin.com/jobs/view/${id}/`,
    read: readLinkedInJobs,
    capture: captureLinkedInJob,
    wall: isLinkedInWall,
  },
  handshake: {
    name: "Handshake",
    origin: HANDSHAKE,
    flag: "handshakeAgent",
    dayKey: "hsDay",
    page: (url, i) => handshakePage(url, i + 1),
    view: handshakeJobUrl,
    read: readHandshakeJobs,
    capture: captureHandshakeJob,
    wall: isHandshakeWall,
  },
};
/** Per run and per day, per site: a good session is 30; three of those a day (owner, 2026-10-25). */
const PER_RUN = 30;
const PER_DAY = 90;

async function siteReady(site) {
  const s = SITES[site];
  const flags = await chrome.storage.local.get(s.flag);
  return flags[s.flag] === true && (await chrome.permissions.contains({ origins: [s.origin] }).catch(() => false));
}

const finder = (text, done = false) => askDashboard("finderStatus", { text, done }).catch(() => {});

/** Waits for a tab to finish loading, at most `ms` (never forever: a stuck page is skipped). */
async function loadedWithin(tabId, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw new Error("The tab was closed.");
    if (t.status === "complete") return true;
    await sleep(400);
  }
  return false;
}

/**
 * Reads up to `max` new jobs from a LinkedIn / Handshake search in your browser: the search pages one by one
 * (ids you already have are skipped without opening them), then each new job's own page at a person's pace, handing
 * every posting to your dashboard (which stores it and has the AI review it). Every wait has a time limit.
 */
async function readJobs(site, { urls, max, watch, known }) {
  const url = urls[0];
  const s = SITES[site];
  if (!(await siteReady(site))) throw new Error(`Turn on ${s.name} job search in the extension's Options first (test build only).`);
  const today = new Date().toISOString().slice(0, 10);
  const day = (await chrome.storage.local.get(s.dayKey))[s.dayKey];
  const used = day?.date === today ? day.count : 0;
  const n = Math.max(0, Math.min(max, PER_RUN, PER_DAY - used));
  if (!n) throw new Error(`Reached today's limit of ${PER_DAY} ${s.name} jobs (kept low so it reads like a person). Try again tomorrow.`);
  const dash = await dashboardTab();
  const tab = await chrome.tabs.create({ url: s.page(url, 0), active: !!watch, windowId: dash.windowId });
  await addToGroup(tab.id);
  (async () => {
    let got = 0;
    const skip = new Set(known);
    try {
      // 1. The list: each search (your words, then variations), page after page, until there are enough new ids.
      const ids = [];
      for (const [q, search] of urls.entries())
      for (let page = 0; page < (urls.length > 1 ? 3 : 6) && ids.length < n; page++) {
        if (page || q) await chrome.tabs.update(tab.id, { url: s.page(search, page) });
        await loadedWithin(tab.id, 30000);
        await sleep(3500 + Math.random() * 2000);
        if (s.wall((await chrome.tabs.get(tab.id)).url)) return finder(`${s.name} asked you to sign in or pass a check. Do that in the tab, then search again.`, true);
        finder(`Reading ${s.name} results, page ${page + 1}…`);
        const list = (await inTab(tab.id, s.read, [n - ids.length, [...skip]]).catch(() => [])) ?? [];
        if (!list.length) break; // this search has no more new jobs: next variation
        for (const j of list) {
          if (skip.has(j.id)) continue;
          skip.add(j.id);
          ids.push(j);
        }
      }
      if (!ids.length) return finder(`No new ${s.name} jobs on that search (the ones listed are already in Coverage).`, true);
      // 2. Each job's own page (full description), at a person's pace.
      for (const [i, j] of ids.slice(0, n).entries()) {
        finder(`Reading ${s.name} job ${i + 1} of ${Math.min(n, ids.length)}: ${j.company || ""} ${j.title}`.trim());
        await chrome.tabs.update(tab.id, { url: s.view(j.id) });
        if (!(await loadedWithin(tab.id, 30000))) continue; // didn't load in time: skip it
        await sleep(6000 + Math.random() * 8000); // a person's pace, not a scraper's
        if (s.wall((await chrome.tabs.get(tab.id)).url)) return finder(`${s.name} asked for a check after ${got} jobs. Stopped there.`, true);
        const job = await inTab(tab.id, s.capture).catch(() => null);
        if (job && !job.error) {
          await askDashboard("foundJob", { ...job, site }).catch(() => {});
          got++;
          await chrome.storage.local.set({ [s.dayKey]: { date: today, count: used + got } });
        }
      }
      finder(`Done: read ${got} ${s.name} job${got === 1 ? "" : "s"}.`, true);
    } catch (e) {
      finder(`${s.name} search stopped after ${got} jobs: ${e instanceof Error ? e.message : String(e)}`, true);
    } finally {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  })();
  return { started: true, max: n };
}

/**
 * Fill selected on a Handshake posting: press "Apply externally" and carry on in the bank's form. A link is opened in
 * the same tab; a button opens a new tab, which takes this job over (the Handshake tab is closed).
 */
async function handshakeHandOff(tabId, job) {
  const r = await inTab(tabId, clickApplyExternally);
  if (r?.href) {
    await chrome.tabs.update(tabId, { url: r.href });
    await loadedWithin(tabId, 30000);
    await sleep(2500);
    return { tabId };
  }
  if (r?.clicked) {
    const child = await new Promise((resolve) => {
      const done = (id) => {
        chrome.tabs.onCreated.removeListener(onCreated);
        clearTimeout(timer);
        resolve(id);
      };
      const onCreated = (t) => t.openerTabId === tabId && done(t.id);
      const timer = setTimeout(() => done(null), 15000);
      chrome.tabs.onCreated.addListener(onCreated);
    });
    if (!child) {
      // Some postings open the form in the same tab instead.
      await loadedWithin(tabId, 15000);
      return isHandshake((await chrome.tabs.get(tabId)).url) ? { error: "Pressed Apply externally, but no application opened. Carry on in that tab." } : { tabId };
    }
    await addToGroup(child);
    await chrome.storage.session.remove(batchKey(tabId));
    await chrome.storage.session.set({ [batchKey(child)]: { ...job, stage: "filling" } });
    chrome.tabs.remove(tabId).catch(() => {});
    // Handshake opens the tab blank, then sends it to the bank's site: wait for a real address (≤ 25 s).
    for (let i = 0; i < 50; i++) {
      const t = await chrome.tabs.get(child).catch(() => null);
      if (!t) return { error: "The application tab was closed." };
      if (/^https?:\/\//.test(t.url ?? t.pendingUrl ?? "") && !/^about:/.test(t.url ?? "")) break;
      await sleep(500);
    }
    await loadedWithin(child, 30000);
    await sleep(2500);
    return { tabId: child };
  }
  if (r?.internal) return { needs: "This one applies inside Handshake: pick your resume there and submit it yourself." };
  return { error: "Couldn't find Handshake's Apply externally button. Carry on in that tab." };
}

/* ---------------- saved logins sync (1.3.1) ---------------- */

// The vault (vault.js) is encrypted with your PIN; only that ciphertext goes to your Coverage account, through the
// dashboard tab, so another browser where you sign in to Coverage gets the same logins (unlock with the same PIN).
// The newer copy wins (`vaultAt`); a copy taken from the account locks this browser's vault until the PIN is entered.
const okVault = (b) => b === null || (b && b.v === 1 && ["salt", "iv", "data"].every((k) => typeof b[k] === "string" && b[k].length < 400_000));
let lastAdopted = null;
let vaultBusy = false;
/**
 * Your AI keys from the Coverage dashboard (Settings → Data), so the agent test bench, Mix models and the vision helper
 * can use them without typing them again (owner, 2026-10-27). Runs when your Coverage tab opens. A key you typed in the
 * extension for a provider the dashboard doesn't have is kept; the dashboard's wins for the same provider.
 */
async function syncAiKeys() {
  const list = await askDashboard("aiKeys", {}).catch(() => null);
  if (!Array.isArray(list) || !list.length) return;
  const S = await chrome.storage.local.get({ keys: {}, bases: {}, models: {} });
  for (const k of list) {
    if (!k || typeof k.provider !== "string" || typeof k.key !== "string" || !/^(anthropic|openai|google|deepseek|qwen|glm|compatible)$/.test(k.provider)) continue;
    S.keys[k.provider] = k.key.slice(0, 400);
    if (typeof k.baseURL === "string" && /^https:\/\//.test(k.baseURL)) S.bases[k.provider] = k.baseURL.slice(0, 300);
    if (Array.isArray(k.models)) S.models[k.provider] = k.models.filter((m) => typeof m === "string").slice(0, 200);
  }
  await chrome.storage.local.set({ keys: S.keys, bases: S.bases, models: S.models, aiKeysAt: new Date().toISOString() });
}

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
  return (Array.isArray(raw) ? raw : []).slice(0, 50).flatMap((j) => {
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
  if (msg.type === "vaultSync") {
    syncAiKeys().catch(() => {});
    syncPixelKey(askDashboard).then(() => flushOutbox(askDashboard)).catch(() => {});
    return syncVault();
  }
  if (msg.type === "fillJobs") return fillJobs({ jobs: cleanJobs(p.jobs), watch: p.watch === true });
  if (msg.type === "focusJob" && ID.test(String(p.jobId))) return focusJob(String(p.jobId));
  const known = (Array.isArray(p.known) ? p.known : []).map(String).filter((x) => /^\d{3,15}$/.test(x)).slice(-3000);
  const max = Math.min(Number(p.max) || PER_RUN, PER_RUN);
  if (msg.type === "linkedinJobs") {
    const where = String(p.location ?? "").slice(0, 80);
    const terms = (Array.isArray(p.variants) && p.variants.length ? p.variants : [p.terms]).slice(0, 5).map((t) => String(t ?? "").slice(0, 120));
    return readJobs("linkedin", { urls: terms.map((t) => linkedinJobsUrl(t, where)), max, watch: p.watch === true, known });
  }
  if (msg.type === "handshakeJobs") {
    // Only Handshake job search addresses (the dashboard builds them from your words).
    const urls = (Array.isArray(p.urls) && p.urls.length ? p.urls : [p.url]).slice(0, 5).map((u) => String(u ?? "").slice(0, 600));
    if (!urls.every((u) => /^https:\/\/app\.joinhandshake\.com\/(job-search|stu\/postings|jobs)\b/.test(u))) throw new Error("Not a Handshake job search.");
    return readJobs("handshake", { urls, max, watch: p.watch === true, known });
  }
  throw new Error("Unknown command.");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  // A wait for the page scripts Coverage injects (sites/*.js): the worker's timers aren't throttled in hidden tabs.
  if (msg?.type === "cov-sleep") {
    setTimeout(() => sendResponse(true), Math.min(Math.max(Number(msg.ms) || 0, 0), 10_000));
    return true;
  }
  // Real clicks / typing for the page scripts Coverage injects (test build; false = use dispatched events).
  if (msg?.type === "cov-click" || msg?.type === "cov-type" || msg?.type === "cov-key") {
    trustedInput(msg, sender).then(sendResponse, () => sendResponse(false));
    return true;
  }
  const reply = (p) => {
    p.then(
      (result) => sendResponse({ ok: true, result }),
      (e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  };
  // The dashboard bridge (a content script on the dashboard's own pages only).
  if (sender.tab && msg?.from === "dashboard") return reply(fromDashboard(msg, sender));
  // Open tracking, from the Gmail content script: top frame of mail.google.com only (see tracking.js).
  if (sender.tab && TRACKING_TYPES.has(msg?.type) && sender.frameId === 0 && sender.url && new URL(sender.url).origin === GMAIL_ORIGIN) return reply(fromGmail(msg, askDashboard));
  // Everything else: only the popup / options (extension pages, not a content script in some tab).
  if (sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  if (msg?.type === "autofill" && Number.isInteger(msg.tabId)) return reply(autofill(msg.tabId, msg.confirmed === true));
  if (msg?.type === "continue" && Number.isInteger(msg.tabId)) return reply(continuePages(msg.tabId));
  if (msg?.type === "submitted" && typeof msg.url === "string") return reply(askDashboard("submitted", { url: msg.url }));
  return false;
});

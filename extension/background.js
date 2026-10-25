// The extension's background worker. It runs an autofill when you click "Autofill this page" in the popup:
//   1. read the form on the job tab (sites/apply.js#scanForm; the popup click grants access to that tab, and a site
//      you allowed from the popup (optional host permission) also lets it read forms embedded from that site),
//   2. ask your open Coverage tab what goes in each field (content/dashboard.js → src/lib/applyBridge.ts),
//   3. type those values into the scanned fields (sites/apply.js#fillForm).
// On Workday, "Fill the next pages too" repeats this page by page, pressing Next by fixed rules (clickNext) and
// stopping at anything that needs you, any error the site shows, or the review page. Nothing ever submits.
// The job page never talks to the extension: it only gets values typed into its fields.
import { getDashboard } from "./settings.js";
import { clickNext, fillForm, isBlockedSite, isMultiPageSite, pageState, scanForm, sitePattern } from "./sites/apply.js";

const progress = (tabId, text) => chrome.runtime.sendMessage({ type: "autofill-progress", tabId, text }).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** One page: scan → plan (in your Coverage tab) → fill. */
async function fillPage(tabId, confirmed) {
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
    throw new Error("No form fields on this page. Open the application form itself (after any 'Apply' button).");
  }

  progress(tabId, `Found ${scan.fields.length} fields. Asking Coverage what goes in them…`);
  const plan = await askDashboard("plan", { url: scan.url, title: scan.title, pageText: scan.text, fields: scan.fields, confirmed: !!confirmed });

  // Still the same page? (A redirect while the AI was writing would put the answers somewhere else.)
  const now = await chrome.tabs.get(tabId);
  if (frameId === 0 && new URL(now.url).origin !== new URL(scan.url).origin) throw new Error("The page changed while answers were being written. Click Autofill again.");

  progress(tabId, "Filling…");
  const items = checkPlan(plan, scan.fields);
  const skipped = (plan.skipped ?? []).slice(0, 40).map((s) => ({ id: s.id, label: String(s.label ?? "").slice(0, 200), why: String(s.why ?? "").slice(0, 300) }));
  const [{ result: filled }] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: fillForm, args: [items, { skipped }] });
  const required = new Set(scan.fields.filter((f) => f.required).map((f) => f.id));
  const failedRequired = (filled?.failed ?? []).filter((x) => scan.fields.some((f) => f.label === x.label && f.required));
  return {
    job: plan.job ?? null,
    filled: filled?.filled ?? 0,
    failed: filled?.failed ?? [],
    skipped,
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

/** Workday: press Next and fill each following page, stopping at anything that needs you or the review page. */
async function continuePages(tabId) {
  const key = `autofill:${tabId}`;
  let last = (await chrome.storage.session.get(key))[key];
  if (!last) throw new Error("Fill this page first.");
  if (!last.multi) throw new Error("Page-by-page filling is for Workday applications.");
  if (!last.pattern || !(await chrome.permissions.contains({ origins: [last.pattern] }))) throw new Error("Allow Coverage on this site first (button above).");
  const frameIds = [last.frameId ?? 0];
  for (let step = 0; step < 10; step++) {
    if (last.needsYou?.length) return { ...last, stop: `This page needs you: ${last.needsYou.slice(0, 3).join(", ")}${last.needsYou.length > 3 ? "…" : ""}` };
    if (last.ai) return { ...last, stop: "This page has AI-drafted answers: read them, then click Continue again." };
    const [{ result: before }] = await chrome.scripting.executeScript({ target: { tabId, frameIds }, func: pageState });
    if (before.review) return { ...last, stop: "Reached the review page. Check everything and submit it yourself." };
    progress(tabId, "Going to the next page…");
    const [{ result: click }] = await chrome.scripting.executeScript({ target: { tabId, frameIds }, func: clickNext });
    if (!click.clicked) return { ...last, stop: click.why };
    const next = await waitForNextPage(tabId, frameIds[0], before);
    if (next.error) return { ...last, stop: `The site said: ${next.error}` };
    if (next.st.review) {
      last = await remember(tabId, { ...last, filled: 0, failed: [], skipped: [], needsYou: [], ai: 0 });
      return { ...last, stop: "Reached the review page. Check everything and submit it yourself." };
    }
    progress(tabId, `Page ${step + 2}: filling…`);
    last = await remember(tabId, await fillPage(tabId, true));
  }
  return { ...last, stop: "Stopped after 10 pages. Check where it is and continue yourself." };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only the popup (an extension page, not a content script in some tab) can start anything.
  if (sender.id !== chrome.runtime.id || sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  const reply = (p) => {
    p.then(
      (result) => sendResponse({ ok: true, result }),
      (e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  };
  if (msg?.type === "autofill" && Number.isInteger(msg.tabId)) return reply(autofill(msg.tabId, msg.confirmed === true));
  if (msg?.type === "continue" && Number.isInteger(msg.tabId)) return reply(continuePages(msg.tabId));
  if (msg?.type === "submitted" && typeof msg.url === "string") return reply(askDashboard("submitted", { url: msg.url }));
  return false;
});

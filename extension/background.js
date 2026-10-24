// The extension's background worker. It runs an autofill when you click "Autofill this page" in the popup:
//   1. read the form on the job tab (sites/apply.js#scanForm; the popup click is what grants access to that tab),
//   2. ask your open Coverage tab what goes in each field (content/dashboard.js → src/lib/applyBridge.ts),
//   3. type those values into the scanned fields (sites/apply.js#fillForm). Never clicks Submit.
// The job page never talks to the extension: it only gets values typed into its fields.
import { getDashboard } from "./settings.js";
import { fillForm, isBlockedSite, scanForm } from "./sites/apply.js";

const progress = (tabId, text) => chrome.runtime.sendMessage({ type: "autofill-progress", tabId, text }).catch(() => {});

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
    await new Promise((r) => setTimeout(r, 500));
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
    if ((f.kind === "select" || f.kind === "radio" || f.kind === "checkboxes") && !f.options?.some((o) => o.value === it.value)) return [];
    return [{ ...out, value: it.value.slice(0, 20000) }];
  });
}

async function autofill(tabId, confirmed) {
  const tab = await chrome.tabs.get(tabId);
  const dashboard = await getDashboard();
  if (!/^https?:\/\//.test(tab.url ?? "")) throw new Error("Open the application page first.");
  if (isBlockedSite(tab.url)) throw new Error("Autofill doesn't run on LinkedIn.");
  if (tab.url.startsWith(dashboard)) throw new Error("That's your Coverage tab. Open the job application, then click Autofill there.");

  progress(tabId, "Reading the form…");
  const [{ result: scan }] = await chrome.scripting.executeScript({ target: { tabId }, func: scanForm });
  if (!scan?.fields?.length) {
    if (scan?.frames?.length) throw new Error(`The form is inside another site's frame. Open it on its own and click Autofill there: ${scan.frames[0]}`);
    throw new Error("No form fields on this page. Open the application form itself (after any 'Apply' button).");
  }

  progress(tabId, `Found ${scan.fields.length} fields. Asking Coverage what goes in them…`);
  const plan = await askDashboard("plan", { url: scan.url, title: scan.title, pageText: scan.text, fields: scan.fields, confirmed: !!confirmed });

  // Still the same page? (A redirect while the AI was writing would put the answers somewhere else.)
  const now = await chrome.tabs.get(tabId);
  if (new URL(now.url).origin !== new URL(scan.url).origin) throw new Error("The page changed while answers were being written. Click Autofill again.");

  progress(tabId, "Filling…");
  const items = checkPlan(plan, scan.fields);
  const [{ result: filled }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: fillForm,
    args: [items, { skipped: (plan.skipped ?? []).slice(0, 40).map((s) => ({ label: String(s.label ?? "").slice(0, 200), why: String(s.why ?? "").slice(0, 300) })), combos: scan.combos }],
  });
  const result = {
    job: plan.job ?? null,
    filled: filled?.filled ?? 0,
    failed: filled?.failed ?? [],
    skipped: plan.skipped ?? [],
    aiError: plan.ai?.error,
    ai: items.filter((i) => i.source === "ai").length,
    url: scan.url,
    at: Date.now(),
  };
  await chrome.storage.session.set({ [`autofill:${tabId}`]: result });
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only the popup (an extension page, not a content script in some tab) can start an autofill.
  if (sender.id !== chrome.runtime.id || sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  if (msg?.type === "autofill" && Number.isInteger(msg.tabId)) {
    autofill(msg.tabId, msg.confirmed === true).then(
      (result) => sendResponse({ ok: true, result }),
      (e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  }
  if (msg?.type === "submitted" && typeof msg.url === "string") {
    askDashboard("submitted", { url: msg.url }).then(
      (result) => sendResponse({ ok: true, result }),
      (e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  }
  return false;
});

// The toolbar popup: looks at the tab you're on and offers what Coverage can do there. Each site lives in sites/*.js.
// Nothing runs on a page until you click a button here (that click is what grants "activeTab" access to the tab).
import { getDashboard } from "./settings.js";
import { captureLinkedIn, captureUrl, isLinkedIn, isProfile } from "./sites/linkedin.js";

const view = document.getElementById("view");

/** Small DOM helper: el("p", { class: "muted" }, "text", child…). Text is always set as text, never as HTML. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "onclick") node.addEventListener("click", v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function show(...nodes) {
  view.replaceChildren(...nodes);
}

async function linkedInView(tab) {
  const profile = isProfile(tab.url);
  const error = el("p", { class: "error", hidden: "" });
  const send = (auto) => async (e) => {
    const button = e.currentTarget;
    const label = button.textContent;
    for (const b of view.querySelectorAll("button")) b.disabled = true;
    button.textContent = "Reading this page…";
    error.hidden = true;
    try {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureLinkedIn });
      if (!result || result.error) throw new Error(result?.error ?? "Couldn't read this page. Reload it and try again.");
      await chrome.tabs.create({ url: captureUrl(await getDashboard(), result, { auto }) });
      window.close();
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
      error.hidden = false;
      for (const b of view.querySelectorAll("button")) b.disabled = false;
      button.textContent = label;
    }
  };
  show(
    el(
      "div",
      { class: "card" },
      el("h2", {}, profile ? "LinkedIn profile" : "LinkedIn search"),
      el(
        "p",
        { class: "muted" },
        profile
          ? "Adds them to your tracker (or updates them if they're already there) and looks up their email."
          : "Adds the bankers listed here that match your criteria and looks up their emails. Scroll first so everyone has loaded.",
      ),
      el("button", { onclick: send(true) }, profile ? "Add to tracker + find email" : "Add matches + find emails"),
      el("button", { class: "secondary", onclick: send(false), style: "margin-top:6px" }, profile ? "Just open in Coffee chat prep" : "Review them in Find people first"),
      error,
    ),
  );
}

/** Any other page: fill a job application from your Coverage info. */
async function applyView(tab) {
  const host = (() => {
    try {
      return new URL(tab.url).hostname;
    } catch {
      return "";
    }
  })();
  const status = el("p", { class: "muted", hidden: "", "data-status": "1" });
  const error = el("p", { class: "error", hidden: "" });
  const result = el("div");
  const button = el("button", {}, "Autofill this page");
  const run = async (confirmed) => {
    button.disabled = true;
    error.hidden = true;
    status.hidden = false;
    status.textContent = "Starting…";
    result.replaceChildren();
    const res = await chrome.runtime.sendMessage({ type: "autofill", tabId: tab.id, confirmed });
    button.disabled = false;
    status.hidden = true;
    if (!res?.ok) {
      const msg = res?.error ?? "Autofill failed.";
      if (msg.startsWith("UNKNOWN_SITE:")) {
        // Not a tracked job and not a known application system: one more click, so your info only goes where you mean it to.
        const site = msg.slice("UNKNOWN_SITE:".length);
        result.replaceChildren(
          el("p", {}, `${site} isn't one of your tracked jobs or a known application site. Fill your info in here anyway?`),
          el("button", { onclick: () => run(true) }, `Yes, fill ${site}`),
        );
        return;
      }
      error.textContent = msg;
      error.hidden = false;
      return;
    }
    renderResult(res.result);
  };
  button.addEventListener("click", () => run(false));

  const renderResult = (r) => {
    const left = [...(r.skipped ?? []), ...(r.failed ?? [])];
    const done = el("button", { class: "secondary", style: "margin-top:8px" }, "I submitted it");
    done.addEventListener("click", async () => {
      done.disabled = true;
      const res = await chrome.runtime.sendMessage({ type: "submitted", url: r.url });
      done.textContent = res?.ok && res.result?.ok ? `Marked submitted in Coverage` : "Not a tracked job (add it on Applications)";
    });
    result.replaceChildren(
      el("p", {}, `Filled ${r.filled} field${r.filled === 1 ? "" : "s"}${r.ai ? ` (${r.ai} AI draft${r.ai === 1 ? "" : "s"})` : ""}${r.job ? ` for ${r.job.company}${r.job.role ? ` · ${r.job.role}` : ""}` : ""}.`),
      r.aiError ? el("p", { class: "error" }, `AI answers: ${r.aiError}`) : "",
      left.length ? el("p", { class: "muted" }, `${left.length} left for you (listed on the page). Multi-page forms: click Autofill again on each page.`) : "",
      el("p", { class: "muted" }, "Read every field, then press Submit yourself. Coverage never submits."),
      done,
    );
  };

  // Show the last fill on this tab, if any (the popup closes when you click the page).
  const key = `autofill:${tab.id}`;
  const prev = (await chrome.storage.session.get(key))[key];
  if (prev && prev.url === tab.url) renderResult(prev);

  show(
    el(
      "div",
      { class: "card" },
      el("h2", {}, "Job application"),
      el("p", { class: "muted" }, `Fills the form on ${host || "this page"} from Applications → My info, uploads your resume and drafts open answers in your voice. You review and submit.`),
      button,
      status,
      error,
      result,
    ),
  );
}

function otherView() {
  show(
    el(
      "div",
      { class: "card" },
      el("h2", {}, "Nothing to do on this page"),
      el("p", { class: "muted" }, "Coverage works on LinkedIn profiles and searches, and on job application forms."),
    ),
  );
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "autofill-progress") return;
  const status = view.querySelector('[data-status="1"]');
  if (status && !status.hidden) status.textContent = msg.text;
});

async function main() {
  document.getElementById("open").addEventListener("click", async (e) => {
    e.preventDefault();
    await chrome.tabs.create({ url: await getDashboard() });
    window.close();
  });
  // Opens the side panel in this window (needs this click: sidePanel.open only works from a user gesture).
  // The window id is read up front: awaiting anything before open() can lose the click.
  // The store build has no agent (scripts/pack-extension.mjs strips it), so the button may not exist.
  const agent = document.getElementById("agent");
  if (agent && chrome.sidePanel) {
    const win = await chrome.windows.getCurrent();
    agent.addEventListener("click", () => {
      chrome.sidePanel.open({ windowId: win.id }).then(() => window.close());
    });
  }
  document.getElementById("settings").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const dashboard = await getDashboard();
  if (tab?.id && isLinkedIn(tab.url)) await linkedInView(tab);
  else if (tab?.id && /^https?:\/\//.test(tab.url ?? "") && !tab.url.startsWith(dashboard)) await applyView(tab);
  else otherView();
}

main();

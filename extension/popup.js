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
  const button = el(
    "button",
    {
      onclick: async () => {
        button.disabled = true;
        button.textContent = "Reading this page…";
        error.hidden = true;
        try {
          const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureLinkedIn });
          if (!result || result.error) throw new Error(result?.error ?? "Couldn't read this page. Reload it and try again.");
          await chrome.tabs.create({ url: captureUrl(await getDashboard(), result) });
          window.close();
        } catch (e) {
          error.textContent = e instanceof Error ? e.message : String(e);
          error.hidden = false;
          button.disabled = false;
          button.textContent = profile ? "Send profile to Coverage" : "Send these people to Coverage";
        }
      },
    },
    profile ? "Send profile to Coverage" : "Send these people to Coverage",
  );
  show(
    el(
      "div",
      { class: "card" },
      el("h2", {}, profile ? "LinkedIn profile" : "LinkedIn"),
      el(
        "p",
        { class: "muted" },
        profile
          ? "Opens Coffee chat prep with this profile, so you can add them or prep a call."
          : "On a People search, sends the people listed here to Find people (scroll first so they've loaded).",
      ),
      button,
      error,
    ),
  );
}

function otherView() {
  show(
    el(
      "div",
      { class: "card" },
      el("h2", {}, "Nothing to do on this page yet"),
      el("p", { class: "muted" }, "Coverage works on:"),
      el("ul", {}, el("li", {}, "LinkedIn profiles and People searches")),
      el("p", { class: "muted", style: "margin:8px 0 0" }, "Coming next: Granola notes and job application forms."),
    ),
  );
}

async function main() {
  document.getElementById("open").addEventListener("click", async (e) => {
    e.preventDefault();
    await chrome.tabs.create({ url: await getDashboard() });
    window.close();
  });
  // Opens the side panel in this window (needs this click: sidePanel.open only works from a user gesture).
  // The window id is read up front: awaiting anything before open() can lose the click.
  const win = await chrome.windows.getCurrent();
  document.getElementById("agent").addEventListener("click", () => {
    chrome.sidePanel.open({ windowId: win.id }).then(() => window.close());
  });
  document.getElementById("settings").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && isLinkedIn(tab.url)) await linkedInView(tab);
  else otherView();
}

main();

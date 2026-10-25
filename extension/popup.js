// The toolbar popup: looks at the tab you're on and offers what Coverage can do there. Each site lives in sites/*.js.
// Nothing runs on a page until you click a button here (that click is what grants "activeTab" access to the tab).
import { getDashboard } from "./settings.js";
import { captureLinkedIn, captureLinkedInJob, captureUrl, isLinkedIn, isLinkedInJob, isProfile, jobCaptureUrl } from "./sites/linkedin.js";
import { sitePattern } from "./sites/apply.js";

const view = document.getElementById("view");

/** Small DOM helper: el("p", { class: "muted" }, "text", child…). Text is always set as text, never as HTML. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "onclick") node.addEventListener("click", v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

function show(...nodes) {
  view.replaceChildren(...nodes);
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** Ask for one application site (an optional host permission). Chrome usually closes the popup while it asks. */
function allowButton(pattern, label) {
  return el(
    "button",
    {
      class: "secondary",
      style: "margin-top:6px",
      onclick: () => {
        // Called straight from the click (permission requests need the gesture).
        chrome.permissions.request({ origins: [pattern] }).then((ok) => {
          if (ok) view.querySelector("[data-allow-note]")?.replaceChildren("Allowed. Click Autofill again to carry on.");
        });
      },
    },
    label,
  );
}

async function linkedInView(tab) {
  const error = el("p", { class: "error", hidden: "" });
  const busy = (e, text) => {
    for (const b of view.querySelectorAll("button")) b.disabled = true;
    e.currentTarget.textContent = text;
    error.hidden = true;
  };
  const fail = (err, button, label) => {
    error.textContent = err instanceof Error ? err.message : String(err);
    error.hidden = false;
    for (const b of view.querySelectorAll("button")) b.disabled = false;
    button.textContent = label;
  };

  if (isLinkedInJob(tab.url)) {
    const track = el("button", {}, "Track this job in Coverage");
    track.addEventListener("click", async (e) => {
      busy(e, "Reading the job…");
      try {
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureLinkedInJob });
        if (!result || result.error) throw new Error(result?.error ?? "Couldn't read this job. Reload the page and try again.");
        await chrome.tabs.create({ url: jobCaptureUrl(await getDashboard(), result) });
        window.close();
      } catch (err) {
        fail(err, track, "Track this job in Coverage");
      }
    });
    show(
      el(
        "div",
        { class: "card" },
        el("h2", {}, "LinkedIn job"),
        el("p", { class: "muted" }, "Saves the job (title, company, description and the bank's apply link if LinkedIn shows it) to Applications, so you can autofill it later."),
        track,
        el("p", { class: "muted", style: "margin-top:8px" }, "To apply: click Apply on LinkedIn (not Easy Apply), then click Coverage on the bank's form."),
        error,
      ),
    );
    return;
  }

  const profile = isProfile(tab.url);
  const send = (auto) => async (e) => {
    const button = e.currentTarget;
    const label = button.textContent;
    busy(e, "Reading this page…");
    try {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureLinkedIn });
      if (!result || result.error) throw new Error(result?.error ?? "Couldn't read this page. Reload it and try again.");
      await chrome.tabs.create({ url: captureUrl(await getDashboard(), result, { auto }) });
      window.close();
    } catch (err) {
      fail(err, button, label);
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
  const host = hostOf(tab.url);
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
    if (res?.ok) return renderResult(res.result);
    const msg = res?.error ?? "Autofill failed.";
    if (msg.startsWith("UNKNOWN_SITE:")) {
      // Not a tracked job and not a known application site: one more click, so your info only goes where you mean it to.
      const site = msg.slice("UNKNOWN_SITE:".length);
      return result.replaceChildren(
        el("p", {}, `${site} isn't one of your tracked jobs or a known application site. Fill your info in here anyway?`),
        el("button", { onclick: () => run(true) }, `Yes, fill ${site}`),
      );
    }
    if (msg.startsWith("FRAME:")) {
      // The form is embedded from another site (a Greenhouse or Workday form on a bank's careers page).
      const frame = msg.slice("FRAME:".length);
      const pattern = sitePattern(frame);
      return result.replaceChildren(
        el("p", {}, `The form on this page comes from ${hostOf(frame)}.`),
        pattern
          ? el("div", {}, allowButton(pattern, `Allow Coverage on ${hostOf(frame)}`), el("p", { class: "muted", "data-allow-note": "1", style: "margin-top:6px" }, "Then click the Coverage icon and Autofill again."))
          : el("p", { class: "muted" }, "Coverage can't fill it inside this page. Open the form on its own:"),
        el("button", { class: "secondary", style: "margin-top:6px", onclick: () => chrome.tabs.create({ url: frame }) }, "Open the form in its own tab"),
      );
    }
    error.textContent = msg;
    error.hidden = false;
  };
  button.addEventListener("click", () => run(false));

  const renderResult = (r) => {
    const left = [...(r.skipped ?? []), ...(r.failed ?? [])];
    const done = el("button", { class: "secondary", style: "margin-top:8px" }, "I submitted it");
    done.addEventListener("click", async () => {
      done.disabled = true;
      const res = await chrome.runtime.sendMessage({ type: "submitted", url: r.url });
      done.textContent = res?.ok && res.result?.ok ? "Marked submitted in Coverage" : "Not a tracked job (add it on Applications)";
    });
    // Workday: keep going page by page once the site is allowed.
    let next = null;
    if (r.multi && r.pattern && !r.allowed)
      next = el(
        "div",
        {},
        allowButton(r.pattern, `Allow Coverage on ${host} to fill page after page`),
        el("p", { class: "muted", "data-allow-note": "1", style: "margin-top:6px" }, "Then click the Coverage icon again."),
      );
    else if (r.multi && r.allowed) {
      const go = el("button", { style: "margin-top:6px" }, "Fill the next pages too");
      go.addEventListener("click", async () => {
        go.disabled = true;
        status.hidden = false;
        status.textContent = "Going on…";
        const res = await chrome.runtime.sendMessage({ type: "continue", tabId: tab.id });
        status.hidden = true;
        go.disabled = false;
        if (!res?.ok) {
          error.textContent = res?.error ?? "Couldn't continue.";
          error.hidden = false;
          return;
        }
        renderResult(res.result);
      });
      next = el("div", {}, go, el("p", { class: "muted", style: "margin-top:4px" }, "Presses Next for you and fills each page. Stops at anything that needs you and at the review page; never submits."));
    }
    result.replaceChildren(
      r.stop ? el("p", {}, r.stop) : "",
      el("p", {}, `Filled ${r.filled} field${r.filled === 1 ? "" : "s"}${r.ai ? ` (${r.ai} AI draft${r.ai === 1 ? "" : "s"})` : ""}${r.job ? ` for ${r.job.company}${r.job.role ? ` · ${r.job.role}` : ""}` : ""}.`),
      r.aiError ? el("p", { class: "error" }, `AI answers: ${r.aiError}`) : "",
      left.length ? el("p", { class: "muted" }, `${left.length} left for you (listed on the page).`) : "",
      next,
      el("p", { class: "muted" }, "Read every field, then press Submit yourself. Coverage never submits."),
      done,
    );
  };

  // Show the last fill on this tab, if any (the popup closes when you click the page), with the site's permission now.
  const key = `autofill:${tab.id}`;
  const prev = (await chrome.storage.session.get(key))[key];
  if (prev && hostOf(prev.url) === host) {
    if (prev.pattern) prev.allowed = await chrome.permissions.contains({ origins: [prev.pattern] });
    renderResult(prev);
  }

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
      el("p", { class: "muted" }, "Coverage works on LinkedIn profiles, searches and jobs, and on job application forms."),
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

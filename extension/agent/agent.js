// The agent loop: observe the tab → ask the model for ONE action → (confirm if risky) → do it → repeat.
// Each step sends only the task, a short history and the current page, not the whole conversation, which keeps
// tokens per step roughly flat instead of growing with every step.
import { actPage, describeTarget, observePage } from "./page.js";
import { complete, parseJson } from "./llm.js";

const MAX_ELEMENTS = 150;
const MAX_TEXT = 3500;
const HISTORY = 12;

export const SYSTEM = `You control one web browser tab to complete the user's task.
Each turn you get the task, what you already did, and the current page: a numbered list of interactive elements and the page's visible text (and, in screenshot mode, a screenshot of the visible area).
Reply with ONLY a JSON object, no other text:
{"thought": "<one short sentence: what you see and why this action>", "action": <one action>}
Actions:
{"type":"click","index":N}
{"type":"type","index":N,"text":"...","enter":false}   (replaces the field's text; enter:true presses Enter after)
{"type":"select","index":N,"value":"<option text>"}     (native dropdowns only; for custom dropdowns click them)
{"type":"scroll","direction":"down"|"up"}
{"type":"navigate","url":"https://..."}
{"type":"wait"}                                          (the page is still loading)
{"type":"done","success":true|false,"answer":"<what you did or found, or what's missing>"}
Rules: one action per turn. Use only indexes from the CURRENT list (they change every turn). Elements marked "(below the fold)" may need a scroll before they are visible in the screenshot, but you can still act on them by index. If the task needs information you weren't given, finish with done/success:false and say what's missing; never invent personal data. If the same action failed twice, try something else.`;

/** Clicks that change something outside the page (send, submit, apply, buy…) always wait for your OK. */
const RISKY = /\b(submit|apply|send|post|publish|connect|invite|follow|buy|purchase|pay|checkout|order|place order|confirm|delete|remove|sign up|register|accept|message)\b/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isLinkedIn = (url) => /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(url ?? "");

async function waitForLoad(tabId, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") return t;
    await sleep(250);
  }
  return chrome.tabs.get(tabId);
}

async function inTab(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r?.result;
}

function promptFor(task, history, page, mode) {
  return [
    `TASK\n${task}`,
    `WHAT YOU DID SO FAR\n${history.length ? history.slice(-HISTORY).join("\n") : "(nothing yet)"}`,
    `CURRENT PAGE\nURL: ${page.url}\nTitle: ${page.title}\nScroll: ${page.scroll.y}/${page.scroll.max}px`,
    `INTERACTIVE ELEMENTS\n${page.elements.join("\n") || "(none visible)"}`,
    `VISIBLE TEXT\n${page.text}`,
    mode === "screenshot" ? "A screenshot of the visible area is attached." : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Run one task. `model` = { provider, model, key, baseURL }. Calls `onStep(step)` after every step and
 * `confirm(text)` → "approve" | "skip" | "stop" before risky clicks. Returns the run summary.
 */
export async function runAgent({ tabId, task, model, mode, maxSteps, allowLinkedIn, onStep, confirm, signal }) {
  const run = { task, provider: model.provider, model: model.model, mode, steps: 0, inTokens: 0, outTokens: 0, ms: 0, outcome: "max_steps", answer: "", startedAt: new Date().toISOString() };
  const history = [];
  let badReplies = 0;
  for (let n = 1; n <= maxSteps; n++) {
    if (signal.aborted) return { ...run, outcome: "stopped" };
    const tab = await waitForLoad(tabId);
    if (isLinkedIn(tab.url) && !allowLinkedIn) return { ...run, outcome: "blocked", answer: "LinkedIn is off. Tick \"Allow LinkedIn\" in this panel to test it there (your account, your risk)." };
    if (!/^https?:/.test(tab.url ?? "")) return { ...run, outcome: "blocked", answer: "The agent can only work on normal web pages (http/https)." };

    const page = await inTab(tabId, observePage, [MAX_ELEMENTS, MAX_TEXT]);
    if (!page) return { ...run, outcome: "error", answer: "Couldn't read the page (some pages, like the Web Store, block extensions)." };
    let image;
    if (mode === "screenshot") image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });

    const step = { n, url: page.url, thought: "", action: null, result: "", inTokens: 0, outTokens: 0, ms: 0 };
    let reply;
    try {
      const r = await complete({ ...model, system: SYSTEM, text: promptFor(task, history, page, mode), image });
      Object.assign(step, { inTokens: r.inTokens, outTokens: r.outTokens, ms: r.ms });
      run.inTokens += r.inTokens;
      run.outTokens += r.outTokens;
      run.ms += r.ms;
      reply = parseJson(r.text);
    } catch (e) {
      step.result = `model error: ${e.message}`;
      run.steps = n;
      onStep(step);
      if (/^(401|403|404)/.test(e.message) || ++badReplies >= 3) return { ...run, outcome: "error", answer: e.message };
      history.push(`${n}. (your reply couldn't be used: ${e.message.slice(0, 120)}) Reply with only the JSON object.`);
      continue;
    }
    const a = reply.action ?? {};
    step.thought = String(reply.thought ?? "").slice(0, 300);
    step.action = a;
    run.steps = n;

    if (a.type === "done") {
      step.result = a.success ? "finished" : "gave up";
      onStep(step);
      return { ...run, outcome: a.success ? "done" : "gave_up", answer: String(a.answer ?? "").slice(0, 1000) };
    }

    let target = "";
    if (a.index !== undefined) target = (await inTab(tabId, describeTarget, [a.index])) ?? "";
    const risky = (a.type === "click" && RISKY.test(target)) || (a.type === "type" && a.enter);
    if (risky) {
      const verdict = await confirm(`${a.type === "click" ? "Click" : "Type + Enter in"} "${target || `element ${a.index}`}"?`);
      if (verdict === "stop") {
        step.result = "you stopped it";
        onStep(step);
        return { ...run, outcome: "stopped" };
      }
      if (verdict === "skip") {
        step.result = "you skipped this action";
        history.push(`${n}. ${JSON.stringify(a)} → the user declined this action; do something else or finish.`);
        onStep(step);
        continue;
      }
    }

    if (a.type === "navigate") {
      if (!/^https?:\/\//i.test(String(a.url))) step.result = "only http(s) addresses";
      else {
        await chrome.tabs.update(tabId, { url: a.url });
        await sleep(400);
        step.result = "navigated";
      }
    } else if (a.type === "wait") {
      await sleep(1500);
      step.result = "waited";
    } else {
      const r = await inTab(tabId, actPage, [a]);
      step.result = r?.note ?? "no result (the page may have navigated)";
      await sleep(700);
    }
    history.push(`${n}. ${a.type}${a.index !== undefined ? ` [${a.index}] "${target.slice(0, 50)}"` : ""}${a.text ? ` "${String(a.text).slice(0, 60)}"` : ""}${a.value ? ` "${a.value}"` : ""}${a.url ? ` ${a.url}` : ""}${a.direction ? ` ${a.direction}` : ""} → ${step.result}`);
    onStep(step);
  }
  return run;
}

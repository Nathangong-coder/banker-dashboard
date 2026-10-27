/**
 * The extension AI agent's fill loop (extension/agent/agent.js#runFill) on a simulated three-page application:
 * batched actions, {{token}} swap, refused clicks, stop before Submit, screenshot only when stuck.
 * Mocked chrome + model (no browser, no network).   npm run check:agent
 */
import { pathToFileURL } from "node:url";
const repo = process.cwd();
const acted = [];
let shots = 0;
// Page 1 (fields), then the same page again after Next fails once, then a review page with Submit.
const pages = [
  { url: "https://x.wd1.myworkdayjobs.com/apply/1", title: "Apply", elements: ['[0] input type=text "First Name"', '[1] select [dropdown] "Degree"', '[2] button "Next"'], text: "My Information", scroll: { y: 0, max: 0 } },
  { url: "https://x.wd1.myworkdayjobs.com/apply/2", title: "Apply", elements: ['[0] input type=text "Phone"', '[1] button "Create Account"', '[2] button "Next"'], text: "Contact", scroll: { y: 0, max: 0 } },
  { url: "https://x.wd1.myworkdayjobs.com/apply/2", title: "Apply", elements: ['[0] input type=text "Phone"', '[1] button "Create Account"', '[2] button "Next"'], text: "Contact", scroll: { y: 0, max: 0 } },
  { url: "https://x.wd1.myworkdayjobs.com/review", title: "Review", elements: ['[0] button "Submit Application"'], text: "Review", scroll: { y: 0, max: 0 } },
];
const targets = [
  ["Nathan", "Degree", "Next"],
  ["Phone", "Create Account", "Next"],
  ["Phone", "Create Account", "Next"],
  ["Submit Application"],
];
let pageIdx = 0;
globalThis.chrome = {
  tabs: {
    get: async () => ({ status: "complete", url: pages[pageIdx].url, active: true, windowId: 1 }),
    captureVisibleTab: async () => {
      shots++;
      return "data:image/jpeg;base64,AAAA";
    },
  },
  scripting: {
    executeScript: async ({ func, args }) => {
      if (func.name === "observePage") {
        return [{ result: pages[pageIdx] }];
      }
      if (func.name === "describeTarget") return [{ result: targets[pageIdx][args[0]] }];
      if (func.name === "actPage") {
        const a = args[0];
        acted.push(`${pageIdx}:${a.type}:${a.index ?? ""}:${a.text || a.value || ""}:${a.noSubmit ? "noSubmit" : ""}`);
        // Next on page 1 works; the first Next on page 2 "fails"; the second works.
        if (a.type === "click" && targets[pageIdx][a.index] === "Next") {
          if (pageIdx === 1) {
            pageIdx = 2;
            return [{ result: { ok: false, note: "a required field is empty" } }];
          }
          pageIdx++;
          if (pageIdx === 2) pageIdx = 3;
        }
        return [{ result: { ok: true, note: "ok" } }];
      }
      return [{ result: null }];
    },
  },
};
const replies = [
  { thought: "fill page 1", actions: [{ type: "type", index: 0, text: "Nathan" }, { type: "choose", index: 1, value: "Bachelor's" }, { type: "click", index: 2 }] },
  { thought: "page 2", actions: [{ type: "type", index: 0, text: "{{phone}}" }, { type: "click", index: 1 }, { type: "navigate", url: "https://evil.example" }, { type: "click", index: 2 }] },
  { thought: "retry", actions: [{ type: "click", index: 2 }] },
  { thought: "review", actions: [{ type: "click", index: 0 }] },
];
let call = 0;
const prompts = [];
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  prompts.push(body.messages[1].content);
  const text = JSON.stringify(replies[call++] ?? { actions: [{ type: "done", success: false, answer: "out of replies" }] });
  return { ok: true, json: async () => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) };
};
const { runFill } = await import(pathToFileURL(`${repo}/extension/agent/agent.js`).href);
const t0 = Date.now();
const run = await runFill({
  tabId: 1,
  task: "Fill out this application.",
  model: { provider: "compatible", model: "deepseek-chat", key: "k", baseURL: "https://api.deepseek.com/v1" },
  secrets: { phone: "425-000-0000" },
  signal: new AbortController().signal,
  onStep: () => {},
});
const checks = [
  ["outcome done, stopped before Submit", run.outcome === "done" && /Submit Application/.test(run.answer)],
  ["4 model calls for 3 pages (fields batched)", call === 4],
  ["page 1: typed + chose + clicked Next in one reply", acted.slice(0, 3).join(",") === "0:type:0:Nathan:noSubmit,0:choose:1:Bachelor's:noSubmit,0:click:2::noSubmit"],
  ["phone token swapped in by the extension", acted.includes("1:type:0:425-000-0000:noSubmit")],
  ["Create Account refused, navigate refused, never sent to the page", !acted.some((a) => a.startsWith("1:click:1"))],
  ["Submit never clicked", !acted.some((a) => a.startsWith("3:click"))],
  ["model never saw the real phone number", !prompts.some((p) => (typeof p === "string" ? p : JSON.stringify(p)).includes("425-000-0000"))],
  ["one screenshot, only after the failed Next", shots === 1],
];
for (const [name, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
console.log({ calls: call, acted, shots, secs: Math.round((Date.now() - t0) / 1000) });
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);

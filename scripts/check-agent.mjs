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
const hosts = [];
globalThis.fetch = async (_url, init) => {
  hosts.push(new URL(String(_url)).host);
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
// Mix models: two providers take turns step by step within one application.
pageIdx = 0;
call = 0;
hosts.length = 0;
const mixed = await runFill({
  tabId: 1,
  task: "Fill out this application.",
  model: { provider: "compatible", model: "deepseek-chat", key: "k", baseURL: "https://api.deepseek.com/v1" },
  models: [
    { provider: "compatible", model: "deepseek-chat", key: "k", baseURL: "https://api.deepseek.com/v1" },
    { provider: "compatible", model: "qwen-plus", key: "k", baseURL: "https://dashscope.example.com/v1" },
  ],
  secrets: { phone: "425-000-0000" },
  signal: new AbortController().signal,
  onStep: () => {},
});
const mixOk = hosts.join(",") === "api.deepseek.com,dashscope.example.com,api.deepseek.com,dashscope.example.com" && mixed.model === "deepseek-chat + qwen-plus";
console.log(`${mixOk ? "ok  " : "FAIL"} mix models: providers take turns step by step`);
checks.push(["mix", mixOk]);
// Screenshots reach vision models in each provider's own format; JSON mode is dropped for models that reject it.
{
  const { complete } = await import(pathToFileURL(`${repo}/extension/agent/llm.js`).href);
  const sent = [];
  let rejectJson = false;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ host: new URL(String(url)).host, body });
    if (rejectJson && body.response_format) return { ok: false, status: 400, statusText: "Bad Request", json: async () => ({ error: { message: "response_format is not supported for this model" } }) };
    if (String(url).includes("anthropic")) return { ok: true, json: async () => ({ content: [{ type: "text", text: "{}" }], usage: {} }) };
    if (String(url).includes("googleapis")) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }], usageMetadata: {} }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: "{}" } }], usage: {} }) };
  };
  const image = "data:image/jpeg;base64,QUJD";
  await complete({ provider: "anthropic", model: "claude-haiku-5-5", key: "k", system: "s", text: "t", image });
  await complete({ provider: "google", model: "gemini-flash", key: "k", system: "s", text: "t", image });
  await complete({ provider: "qwen", model: "qwen-vl-max", key: "k", system: "s", text: "t", image });
  rejectJson = true;
  await complete({ provider: "glm", model: "glm-4.5v", key: "k", system: "s", text: "t", image });
  const [a, g, q, glm1, glm2] = sent;
  const ok = [
    ["Claude gets a base64 image block", a.body.messages[0].content.some((c) => c.type === "image" && c.source.data === "QUJD" && c.source.media_type === "image/jpeg")],
    ["Gemini gets inline image data", g.body.contents[0].parts.some((p) => p.inlineData?.data === "QUJD")],
    ["Qwen gets a data-URL image at DashScope", q.host === "dashscope-intl.aliyuncs.com" && q.body.messages[1].content.some((c) => c.type === "image_url" && c.image_url.url === image)],
    ["GLM at Z.ai: JSON mode refused → asked again without it, image kept", glm1.host === "api.z.ai" && !!glm1.body.response_format && !glm2.body.response_format && glm2.body.messages[1].content.some((c) => c.type === "image_url")],
  ];
  for (const [name, pass] of ok) {
    console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
    checks.push([name, pass]);
  }
}

// The vision helper: DeepSeek fills, and only the screenshot step goes to the helper (Gemini).
{
  pageIdx = 0;
  call = 0;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const host = new URL(String(url)).host;
    const body = JSON.parse(init.body);
    const withImage = JSON.stringify(body).includes("inlineData") || JSON.stringify(body).includes("image_url");
    seen.push(`${host}${withImage ? "+img" : ""}`);
    const text = JSON.stringify(replies[call++] ?? { actions: [{ type: "done", success: false, answer: "out of replies" }] });
    if (host.includes("googleapis")) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: {} }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: text } }], usage: {} }) };
  };
  const run = await runFill({
    tabId: 1,
    task: "Fill out this application.",
    model: { provider: "deepseek", model: "deepseek-chat", key: "k" },
    vision: { provider: "google", model: "gemini-flash", key: "k" },
    screenshots: false,
    shot: async () => "data:image/jpeg;base64,QUJD",
    secrets: { phone: "425-000-0000" },
    signal: new AbortController().signal,
    onStep: () => {},
  });
  const pass = seen.filter((x) => x.includes("+img")).every((x) => x.startsWith("generativelanguage")) && seen.some((x) => x === "generativelanguage.googleapis.com+img") && !seen.some((x) => x.startsWith("api.deepseek.com+img")) && run.visionSteps === 1;
  console.log(`${pass ? "ok  " : "FAIL"} vision helper: only the screenshot step goes to it (${seen.join(", ")})`);
  checks.push(["vision helper", pass]);
}
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);

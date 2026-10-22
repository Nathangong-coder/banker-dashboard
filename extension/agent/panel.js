// The agent test bench (side panel): pick a model, give it a task, watch every step with its tokens and time, and
// compare models on the same task. Runs are kept in this browser's extension storage.
import { PROVIDERS, listModels } from "./llm.js";
import { runAgent } from "./agent.js";
import { getDashboard } from "../settings.js";

const $ = (id) => document.getElementById(id);
const store = chrome.storage.local;

// ---------- state in storage ----------
// keys: { anthropic: "...", openai: "...", ... } · bases: { compatible: "https://..." } · picked: { provider, model }
// compare: [{ provider, model, on }] · runs: [...] · prices: { "provider/model": { in, out } } · prefs: {...}
const S = await store.get({ keys: {}, bases: {}, picked: { provider: "anthropic", model: "" }, compare: [], runs: [], prices: {}, prefs: {} });
const save = (k) => store.set({ [k]: S[k] });

// ---------- element helper (text only, never HTML) ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}
const fmt = (n) => (n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const id = (p, m) => `${p}/${m}`;

// ---------- site access (optional permission, asked once) ----------
const ALL = { origins: ["<all_urls>"] };
async function checkAccess() {
  $("access").hidden = await chrome.permissions.contains(ALL);
}
$("grant").addEventListener("click", async () => {
  await chrome.permissions.request(ALL);
  checkAccess();
});
checkAccess();

// ---------- model picker ----------
for (const [k, p] of Object.entries(PROVIDERS)) $("provider").append(el("option", { value: k }, p.label));
function showModel() {
  const p = S.picked.provider;
  $("provider").value = p;
  $("model").value = S.picked.model;
  $("model").placeholder = PROVIDERS[p].placeholder;
  $("key").value = S.keys[p] ?? "";
  $("baseRow").hidden = !PROVIDERS[p].needsBase;
  $("base").value = S.bases[p] ?? "";
}
showModel();
$("provider").addEventListener("change", () => {
  S.picked = { provider: $("provider").value, model: "" };
  save("picked");
  $("models").replaceChildren();
  showModel();
});
$("model").addEventListener("change", () => {
  S.picked.model = $("model").value.trim();
  save("picked");
});
$("key").addEventListener("change", () => {
  S.keys[S.picked.provider] = $("key").value.trim();
  save("keys");
});
$("base").addEventListener("change", () => {
  S.bases[S.picked.provider] = $("base").value.trim();
  save("bases");
});
$("listModels").addEventListener("click", async () => {
  const b = $("listModels");
  b.disabled = true;
  b.textContent = "Loading…";
  try {
    const ids = await listModels({ provider: S.picked.provider, key: S.keys[S.picked.provider], baseURL: S.bases[S.picked.provider] });
    $("models").replaceChildren(...ids.map((m) => el("option", { value: m })));
    b.textContent = `${ids.length} models: pick in the Model box`;
  } catch (e) {
    b.textContent = `Couldn't list: ${e.message}`.slice(0, 60);
  } finally {
    b.disabled = false;
  }
});

// ---------- compare list ----------
function renderCompare() {
  $("compareCount").textContent = String(S.compare.filter((c) => c.on).length);
  $("compareList").replaceChildren(
    ...S.compare.map((c, i) =>
      el(
        "li",
        {},
        el("input", { type: "checkbox", checked: c.on, onchange: (e) => ((S.compare[i].on = e.target.checked), save("compare"), renderCompare()) }),
        el("span", {}, `${PROVIDERS[c.provider]?.label.split(" ")[0]} · ${c.model}`),
        el("button", { class: "secondary", onclick: () => (S.compare.splice(i, 1), save("compare"), renderCompare()) }, "✕"),
      ),
    ),
  );
}
renderCompare();
$("saveModel").addEventListener("click", () => {
  const { provider, model } = S.picked;
  if (!model) return alertInLog("Pick a model first.");
  if (!S.compare.some((c) => c.provider === provider && c.model === model)) S.compare.push({ provider, model, on: true });
  save("compare");
  renderCompare();
  $("compareBox").open = true;
});

// ---------- prefs ----------
for (const k of ["mode", "maxSteps", "allowLinkedIn", "task", "start"]) {
  const input = $(k);
  const v = S.prefs[k];
  if (v !== undefined) {
    if (input.type === "checkbox") input.checked = v;
    else input.value = v;
  }
  input.addEventListener("change", () => {
    S.prefs[k] = input.type === "checkbox" ? input.checked : input.value;
    save("prefs");
  });
}
// Side panels can't show confirm() dialogs, so the LinkedIn warning is shown inline while the box is ticked.
const showLinkedInWarn = () => ($("linkedInWarn").hidden = !$("allowLinkedIn").checked);
$("allowLinkedIn").addEventListener("change", showLinkedInWarn);
showLinkedInWarn();

// ---------- presets ----------
const PRESETS = {
  practice: async () => ({
    start: `${await getDashboard()}/agent-practice`,
    task:
      "Fill in and submit this summer analyst application with: first name Alex, last name Kim, email alex.kim@example.com, school University of California, Los Angeles, graduation year 2028, GPA 3.8, office New York, LinkedIn https://www.linkedin.com/in/alex-kim-example/, and for 'Why this firm' write two sentences about wanting to learn M&A in technology. Agree to the certification. Then tell me the confirmation number.",
  }),
  search: async () => ({ start: "https://en.wikipedia.org/wiki/Evercore", task: "Find the year Evercore was founded and who founded it, then finish with the answer." }),
};
for (const b of document.querySelectorAll("[data-preset]"))
  b.addEventListener("click", async () => {
    const p = await PRESETS[b.dataset.preset]();
    $("task").value = p.task;
    $("start").value = p.start;
    S.prefs.task = p.task;
    S.prefs.start = p.start;
    save("prefs");
  });

// ---------- step log ----------
function alertInLog(text) {
  $("log").append(el("li", { class: "bad" }, text));
}
function logStep(s) {
  const a = s.action ? JSON.stringify(s.action) : "";
  $("log").append(
    el(
      "li",
      {},
      s.thought ? el("div", {}, s.thought) : null,
      a ? el("div", { class: "act" }, a) : null,
      el("div", { class: /error|couldn't|no element|declined/.test(s.result) ? "meta bad" : "meta" }, `→ ${s.result} · ${fmt(s.inTokens)} in / ${fmt(s.outTokens)} out · ${(s.ms / 1000).toFixed(1)}s`),
    ),
  );
  $("log").lastChild.scrollIntoView({ block: "nearest" });
}

// ---------- confirm prompt ----------
let answer = null;
function askUser(text) {
  $("confirmText").textContent = text;
  $("confirmBox").hidden = false;
  $("confirmBox").scrollIntoView({ block: "nearest" });
  return new Promise((resolve) => (answer = resolve));
}
for (const [btn, v] of [["approve", "approve"], ["skip", "skip"], ["halt", "stop"]])
  $(btn).addEventListener("click", () => {
    $("confirmBox").hidden = true;
    answer?.(v);
    answer = null;
  });

// ---------- running ----------
let controller = null;
async function runOne(m) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No tab to work in.");
  const start = $("start").value.trim();
  if (start) {
    await chrome.tabs.update(tab.id, { url: start });
    await new Promise((r) => setTimeout(r, 600));
  }
  $("log").append(el("li", { class: "meta" }, `${m.provider} · ${m.model} · ${$("mode").value} mode`));
  const run = await runAgent({
    tabId: tab.id,
    task: $("task").value.trim(),
    model: { provider: m.provider, model: m.model, key: S.keys[m.provider], baseURL: S.bases[m.provider] },
    mode: $("mode").value,
    maxSteps: Math.max(1, Math.min(100, Number($("maxSteps").value) || 25)),
    allowLinkedIn: $("allowLinkedIn").checked,
    onStep: logStep,
    confirm: askUser,
    signal: controller.signal,
  });
  run.id = crypto.randomUUID();
  S.runs.unshift(run);
  S.runs = S.runs.slice(0, 300);
  await save("runs");
  $("log").append(el("li", { class: run.outcome === "done" ? "meta" : "meta bad" }, `${run.outcome}${run.answer ? `: ${run.answer}` : ""}`));
  renderResults();
  return run;
}

async function runMany(models) {
  if (!$("task").value.trim()) return alertInLog("Write a task first (or pick a preset).");
  if (!(await chrome.permissions.contains(ALL))) return alertInLog("Allow access to websites first (button at the top).");
  const missing = models.find((m) => !S.keys[m.provider] || !m.model);
  if (missing) return alertInLog(`Add an API key and model for ${PROVIDERS[missing.provider].label}.`);
  controller = new AbortController();
  $("run").disabled = $("runAll").disabled = true;
  $("stop").disabled = false;
  $("log").replaceChildren();
  try {
    for (const m of models) {
      if (controller.signal.aborted) break;
      await runOne(m);
    }
  } catch (e) {
    alertInLog(e.message);
  } finally {
    $("run").disabled = $("runAll").disabled = false;
    $("stop").disabled = true;
    $("confirmBox").hidden = true;
    controller = null;
  }
}
$("run").addEventListener("click", () => runMany([S.picked]));
$("runAll").addEventListener("click", () => runMany(S.compare.filter((c) => c.on)));
$("stop").addEventListener("click", () => {
  controller?.abort();
  answer?.("stop");
});

// ---------- results ----------
function cost(r) {
  const p = S.prices[id(r.provider, r.model)];
  if (!p || (!p.in && !p.out)) return undefined;
  return (r.inTokens * (Number(p.in) || 0) + r.outTokens * (Number(p.out) || 0)) / 1e6;
}
function renderResults() {
  // One row per model + mode: how often it finished (and how often you marked it right), steps, tokens, time, cost.
  const groups = new Map();
  for (const r of S.runs) {
    const k = `${id(r.provider, r.model)} · ${r.mode}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const avg = (list, f) => list.reduce((n, r) => n + (f(r) ?? 0), 0) / list.length;
  const head = el("tr", {}, ...["Model · mode", "Runs", "Finished", "You: right", "Steps", "Tokens in", "Out", "Secs", "Cost/run"].map((h) => el("th", {}, h)));
  const rows = [...groups].map(([k, list]) => {
    const judged = list.filter((r) => r.verdict);
    const c = list.map(cost).filter((x) => x !== undefined);
    return el(
      "tr",
      {},
      el("td", {}, k),
      el("td", { class: "num" }, String(list.length)),
      el("td", { class: "num" }, `${Math.round((100 * list.filter((r) => r.outcome === "done").length) / list.length)}%`),
      el("td", { class: "num" }, judged.length ? `${judged.filter((r) => r.verdict === "right").length}/${judged.length}` : "–"),
      el("td", { class: "num" }, avg(list, (r) => r.steps).toFixed(1)),
      el("td", { class: "num" }, fmt(avg(list, (r) => r.inTokens))),
      el("td", { class: "num" }, fmt(avg(list, (r) => r.outTokens))),
      el("td", { class: "num" }, (avg(list, (r) => r.ms) / 1000).toFixed(0)),
      el("td", { class: "num" }, c.length ? `$${(c.reduce((a, b) => a + b, 0) / c.length).toFixed(3)}` : "–"),
    );
  });
  // The latest runs, to mark right / wrong.
  const recent = S.runs.slice(0, 8).map((r) =>
    el(
      "tr",
      {},
      el("td", { title: r.answer || "" }, `${r.model.slice(0, 22)} · ${r.outcome}`),
      el("td", { colspan: "8" }, ...["right", "wrong"].map((v) => el("button", { class: r.verdict === v ? "chip" : "secondary chip", onclick: () => ((r.verdict = r.verdict === v ? undefined : v), save("runs"), renderResults()) }, v === "right" ? "✓ right" : "✗ wrong"))),
    ),
  );
  $("results").replaceChildren(head, ...rows, ...(recent.length ? [el("tr", {}, el("th", { colspan: "9" }, "Latest runs: was it right?")), ...recent] : []));
  // Price inputs for every model seen.
  const models = [...new Set(S.runs.map((r) => id(r.provider, r.model)))];
  $("prices").replaceChildren(
    ...models.map((m) =>
      el(
        "label",
        {},
        el("span", {}, m),
        el("input", { type: "number", step: "0.01", min: "0", placeholder: "in", value: S.prices[m]?.in ?? "", onchange: (e) => ((S.prices[m] = { ...S.prices[m], in: e.target.value }), save("prices"), renderResults()) }),
        el("input", { type: "number", step: "0.01", min: "0", placeholder: "out", value: S.prices[m]?.out ?? "", onchange: (e) => ((S.prices[m] = { ...S.prices[m], out: e.target.value }), save("prices"), renderResults()) }),
      ),
    ),
  );
}
renderResults();
// Two clicks instead of confirm() (not available in side panels).
$("clear").addEventListener("click", () => {
  const b = $("clear");
  if (b.dataset.armed !== "1") {
    b.dataset.armed = "1";
    b.textContent = "Click again to clear all runs";
    setTimeout(() => ((b.dataset.armed = ""), (b.textContent = "Clear results")), 4000);
    return;
  }
  b.dataset.armed = "";
  b.textContent = "Clear results";
  S.runs = [];
  save("runs");
  renderResults();
});

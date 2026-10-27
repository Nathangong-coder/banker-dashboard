// Calls an AI model straight from the extension with your own key (stored in this browser's extension storage only).
// One shape for every provider: complete({ provider, model, key, baseURL, system, text, image }) →
// { text, inTokens, outTokens, ms }. `image` = a JPEG data URL (screenshot mode) or undefined (text mode).

export const PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", placeholder: "claude-haiku-5-5" },
  openai: { label: "OpenAI", placeholder: "a model id from your account" },
  google: { label: "Google (Gemini)", placeholder: "a Gemini model id" },
  // OpenAI-compatible providers with their own slots (owner, 2026-10-27: DeepSeek + Qwen + GLM side by side). Their
  // keys and base addresses come from your Coverage dashboard (Settings → Data) automatically.
  deepseek: { label: "DeepSeek", placeholder: "deepseek-chat", base: "https://api.deepseek.com/v1" },
  qwen: { label: "Qwen (Alibaba Model Studio)", placeholder: "qwen-plus, or qwen-vl-max for screenshots", base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", needsBase: true },
  glm: { label: "GLM (Z.ai / Zhipu)", placeholder: "a GLM model id (a GLM-V one for screenshots)", base: "https://api.z.ai/api/paas/v4", needsBase: true },
  compatible: { label: "Other OpenAI-compatible", placeholder: "model id", needsBase: true },
};
/** The provider's base address: the one you (or the dashboard) set, else its default. */
const baseOf = (provider, baseURL) => String(baseURL || PROVIDERS[provider]?.base || "").replace(/\/+$/, "");

const b64 = (dataUrl) => dataUrl.slice(dataUrl.indexOf(",") + 1);

async function post(url, headers, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || data?.error?.status || data?.message || r.statusText;
    throw new Error(`${r.status}: ${msg}`);
  }
  return data;
}

export async function complete({ provider, model, key, baseURL, system, text, image }) {
  const t0 = performance.now();
  let out;
  if (provider === "anthropic") {
    const content = [{ type: "text", text }];
    if (image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64(image) } });
    const d = await post(
      "https://api.anthropic.com/v1/messages",
      // Required for calls from a browser context; the key never leaves this browser except to Anthropic.
      { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      { model, max_tokens: 1024, system, messages: [{ role: "user", content }] },
    );
    out = {
      text: (d.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(""),
      inTokens: (d.usage?.input_tokens ?? 0) + (d.usage?.cache_read_input_tokens ?? 0),
      cachedTokens: d.usage?.cache_read_input_tokens ?? 0,
      outTokens: d.usage?.output_tokens ?? 0,
    };
  } else if (provider === "google") {
    const parts = [{ text }];
    if (image) parts.push({ inlineData: { mimeType: "image/jpeg", data: b64(image) } });
    const d = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": key },
      { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json" } },
    );
    out = {
      text: (d.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
      inTokens: d.usageMetadata?.promptTokenCount ?? 0,
      cachedTokens: d.usageMetadata?.cachedContentTokenCount ?? 0,
      outTokens: (d.usageMetadata?.candidatesTokenCount ?? 0) + (d.usageMetadata?.thoughtsTokenCount ?? 0),
    };
  } else {
    const base = provider === "openai" ? "https://api.openai.com/v1" : baseOf(provider, baseURL);
    if (!/^https:\/\//.test(base)) throw new Error("Set the provider's https:// base URL (e.g. https://api.deepseek.com/v1).");
    const content = [{ type: "text", text }];
    if (image) content.push({ type: "image_url", image_url: { url: image } });
    const body = { model, messages: [{ role: "system", content: system }, { role: "user", content: image ? content : text }], response_format: { type: "json_object" } };
    const d = await post(
      `${base}/chat/completions`,
      { authorization: `Bearer ${key}` },
      body,
    ).catch(async (e) => {
      // Some OpenAI-compatible models (GLM vision ones, some Qwen-VL) reject JSON mode: ask again without it (the
      // prompt already asks for JSON only, and parseJson reads it out of the reply).
      if (!/response_format|json/i.test(e.message)) throw e;
      const plain = { ...body };
      delete plain.response_format;
      return post(`${base}/chat/completions`, { authorization: `Bearer ${key}` }, plain);
    });
    out = {
      text: d.choices?.[0]?.message?.content ?? "",
      inTokens: d.usage?.prompt_tokens ?? 0,
      // DeepSeek: prompt_cache_hit_tokens; OpenAI: prompt_tokens_details.cached_tokens (both part of prompt_tokens).
      cachedTokens: d.usage?.prompt_cache_hit_tokens ?? d.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outTokens: d.usage?.completion_tokens ?? 0,
    };
  }
  return { ...out, ms: Math.round(performance.now() - t0) };
}

/** The model ids your key can use (so you never have to guess a name). */
export async function listModels({ provider, key, baseURL }) {
  if (provider === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || r.statusText);
    return (d.data ?? []).map((m) => m.id);
  }
  if (provider === "google") {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || r.statusText);
    return (d.models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
  }
  const base = provider === "openai" ? "https://api.openai.com/v1" : baseOf(provider, baseURL);
  const r = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || r.statusText);
  return (d.data ?? []).map((m) => m.id).sort();
}

/** The first JSON object in a model's reply (models sometimes wrap it in ```json fences or add a sentence). */
export function parseJson(text) {
  const s = String(text ?? "");
  const start = s.indexOf("{");
  if (start < 0) throw new Error("no JSON in the reply");
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("unfinished JSON in the reply");
}

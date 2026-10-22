// Calls an AI model straight from the extension with your own key (stored in this browser's extension storage only).
// One shape for every provider: complete({ provider, model, key, baseURL, system, text, image }) →
// { text, inTokens, outTokens, ms }. `image` = a JPEG data URL (screenshot mode) or undefined (text mode).

export const PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", placeholder: "claude-haiku-5-5" },
  openai: { label: "OpenAI", placeholder: "a model id from your account" },
  google: { label: "Google (Gemini)", placeholder: "a Gemini model id" },
  compatible: { label: "OpenAI-compatible (DeepSeek, GLM, …)", placeholder: "model id", needsBase: true },
};

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
    out = { text: (d.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(""), inTokens: d.usage?.input_tokens ?? 0, outTokens: d.usage?.output_tokens ?? 0 };
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
      outTokens: (d.usageMetadata?.candidatesTokenCount ?? 0) + (d.usageMetadata?.thoughtsTokenCount ?? 0),
    };
  } else {
    const base = provider === "openai" ? "https://api.openai.com/v1" : String(baseURL || "").replace(/\/+$/, "");
    if (!/^https:\/\//.test(base)) throw new Error("Set the provider's https:// base URL (e.g. https://api.deepseek.com/v1).");
    const content = [{ type: "text", text }];
    if (image) content.push({ type: "image_url", image_url: { url: image } });
    const d = await post(
      `${base}/chat/completions`,
      { authorization: `Bearer ${key}` },
      { model, messages: [{ role: "system", content: system }, { role: "user", content: image ? content : text }], response_format: { type: "json_object" } },
    );
    out = { text: d.choices?.[0]?.message?.content ?? "", inTokens: d.usage?.prompt_tokens ?? 0, outTokens: d.usage?.completion_tokens ?? 0 };
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
  const base = provider === "openai" ? "https://api.openai.com/v1" : String(baseURL || "").replace(/\/+$/, "");
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

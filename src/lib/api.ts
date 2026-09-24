"use client";

import type { Settings } from "./types";

export async function callApi<T>(path: string, body: unknown, s: Settings): Promise<T> {
  const k = s.keys;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (k.apollo) headers["x-apollo-key"] = k.apollo;
  if (k.hunter) headers["x-hunter-key"] = k.hunter;
  if (k.serper) headers["x-serper-key"] = k.serper;
  if (k.ai) headers["x-ai-key"] = k.ai;
  if (k.aiModel) headers["x-ai-model"] = k.aiModel;
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j as T;
}

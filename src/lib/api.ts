"use client";

import type { Settings } from "./types";
import { aiHeader, usableKeys } from "./keys";
import { useStore } from "./store";

/**
 * POST to one of our API routes. Every usable key for each service rides along as a JSON array
 * header; the server tries them in order and falls through on invalid / out-of-credit keys.
 */
export async function callApi<T>(path: string, body: unknown, s: Settings): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  for (const svc of ["apollo", "hunter", "serper", "brave"] as const) {
    const keys = usableKeys(s, svc).map((k) => k.value);
    if (keys.length) headers[`x-${svc}-keys`] = JSON.stringify(keys);
  }
  const ai = aiHeader(s, useStore.getState().aiCooldowns);
  if (ai) headers["x-ai"] = ai;
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  const fallback = res.headers.get("x-ai-fallback");
  let skippedModels: { model: string; reason: string }[] = [];
  try {
    skippedModels = JSON.parse(res.headers.get("x-ai-skipped") ?? "[]");
  } catch {
    // Only the explanation is lost.
  }
  if (fallback && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ai-fallback", { detail: { model: fallback, skipped: skippedModels } }));
  const spent = res.headers.get("x-ai-exhausted");
  if (spent) {
    try {
      const list = JSON.parse(spent) as { provider: string; model: string; keyId?: string; until: string; daily: boolean }[];
      useStore.getState().noteAiCooldowns(list);
      const daily = [...new Set(list.filter((x) => x.daily).map((x) => x.model))];
      if (daily.length && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ai-exhausted", { detail: daily }));
    } catch {
      // A malformed header only costs us the skip-ahead; the request itself already succeeded or failed.
    }
  }
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) {
    reportFailure(path, res, j);
    throw new Error(j.error ?? `HTTP ${res.status}`);
  }
  if (skippedModels.length) console.info(`[Coverage] ${path}: skipped`, skippedModels.map((x) => `${x.model} (${x.reason})`).join(", "), `→ answered by ${fallback}`);
  return j as T;
}

/**
 * Print what went wrong in the browser console (F12 → Console): the error, every model/key the server tried and
 * why each failed, and Vercel's request id to find the same request in the deployment's logs. Keys are never included.
 */
function reportFailure(path: string, res: Response, j: { error?: string; attempts?: { model: string; key: string; ok: boolean; kind?: string; status?: number; error?: string; ms: number }[] }) {
  if (typeof console === "undefined") return;
  console.groupCollapsed(`%c[Coverage] ${path} failed (${res.status})`, "color:#b3261e;font-weight:600");
  console.error(j.error ?? `HTTP ${res.status}`);
  if (j.attempts?.length) console.table(j.attempts.map((a) => ({ model: a.model, key: a.key, result: a.ok ? "ok" : a.kind, status: a.status ?? "", error: a.error ?? "", ms: a.ms })));
  const id = res.headers.get("x-vercel-id");
  if (id) console.info(`Vercel request id: ${id} (Vercel → Deployments → Logs, search this id)`);
  console.groupEnd();
}

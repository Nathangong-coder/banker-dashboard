"use client";

import type { Settings } from "./types";
import { aiHeader, usableKeys } from "./keys";

/**
 * POST to one of our API routes. Every usable key for each service rides along as a JSON array
 * header; the server tries them in order and falls through on invalid / out-of-credit keys.
 */
export async function callApi<T>(path: string, body: unknown, s: Settings): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  for (const svc of ["apollo", "hunter", "serper"] as const) {
    const keys = usableKeys(s, svc).map((k) => k.value);
    if (keys.length) headers[`x-${svc}-keys`] = JSON.stringify(keys);
  }
  const ai = aiHeader(s);
  if (ai) headers["x-ai"] = ai;
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j as T;
}

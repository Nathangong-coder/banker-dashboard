import "server-only";
import { HttpError } from "./http";

/** Read the ordered key list the client sent for a service (JSON array header). */
export function keysFrom(req: Request, service: "apollo" | "hunter" | "serper" | "brave"): string[] {
  const raw = req.headers.get(`x-${service}-keys`);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim()) : [];
  } catch {
    return [];
  }
}

function statusOf(e: unknown): number | undefined {
  if (e instanceof HttpError) return e.status;
  const s = (e as { statusCode?: number; status?: number })?.statusCode ?? (e as { status?: number })?.status;
  return typeof s === "number" ? s : undefined;
}

/** Errors that mean "this key is bad or exhausted, try the next one". */
export function isKeyProblem(e: unknown) {
  const st = statusOf(e);
  if (st && [401, 402, 403, 429].includes(st)) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /invalid api key|unauthori[sz]ed|quota|credit|insufficient|rate.?limit|exceeded|billing|balance/i.test(msg);
}

/** Run `fn` with each key in order until one works. Non-key errors are thrown immediately. */
export async function withFallback<T>(keys: string[], label: string, fn: (key: string) => Promise<T>): Promise<T> {
  if (!keys.length) throw new HttpError(400, `Add a ${label} key in Settings.`);
  let last: unknown;
  for (const [i, key] of keys.entries()) {
    try {
      return await fn(key);
    } catch (e) {
      last = e;
      if (!isKeyProblem(e) || i === keys.length - 1) break;
    }
  }
  if (keys.length > 1 && isKeyProblem(last)) {
    const msg = last instanceof Error ? last.message : "key rejected";
    throw new HttpError(statusOf(last) ?? 401, `All ${keys.length} ${label} keys failed (last: ${msg})`);
  }
  throw last;
}

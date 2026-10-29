import "server-only";
import { db } from "@/lib/server/accounts";
import type { RawHit } from "@/lib/opens";

/** Pixel hits waiting for the dashboard (oldest first), capped and expiring. */
export const OPENS = (acct: string) => `opens:${acct}`;
const MAX_KEPT = 2000;
const TTL = 30 * 86400;

export const hitKey = (h: Pick<RawHit, "id" | "at">) => `${h.id}|${h.at}`;

export async function pushHit(acct: string, hit: RawHit) {
  const p = db().pipeline();
  p.rpush(OPENS(acct), hit);
  p.ltrim(OPENS(acct), -MAX_KEPT, -1);
  p.expire(OPENS(acct), TTL);
  await p.exec();
}

export async function readHits(acct: string, max: number): Promise<{ hits: RawHit[]; more: boolean }> {
  const rows = ((await db().lrange(OPENS(acct), 0, max)) ?? []) as RawHit[];
  return { hits: rows.slice(0, max), more: rows.length > max };
}

/**
 * Drops hits the dashboard has stored (`id|at`). They are always the oldest ones it was handed, so trim from the head
 * (one LTRIM): a hit pushed meanwhile lands at the tail and is never lost. `afterRead` is for tests only.
 */
export async function ackHits(acct: string, keys: string[], afterRead?: () => Promise<void>) {
  if (!keys.length) return;
  const gone = new Set(keys);
  const rows = ((await db().lrange(OPENS(acct), 0, keys.length - 1)) ?? []) as RawHit[];
  let n = 0;
  while (n < rows.length && gone.has(hitKey(rows[n]))) n++;
  await afterRead?.();
  if (n) await db().ltrim(OPENS(acct), n, -1);
}

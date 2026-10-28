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

/** Drops hits the dashboard has stored (`id|at`): rewrite the list without them. */
export async function ackHits(acct: string, keys: string[]) {
  if (!keys.length) return;
  const gone = new Set(keys);
  const rows = ((await db().lrange(OPENS(acct), 0, -1)) ?? []) as RawHit[];
  const keep = rows.filter((h) => !gone.has(hitKey(h)));
  if (keep.length === rows.length) return;
  const p = db().pipeline();
  p.del(OPENS(acct));
  if (keep.length) {
    p.rpush(OPENS(acct), ...keep);
    p.expire(OPENS(acct), TTL);
  }
  await p.exec();
}

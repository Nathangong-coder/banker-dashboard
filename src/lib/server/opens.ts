import "server-only";
import { db } from "@/lib/server/accounts";
import type { RawHit } from "@/lib/opens";

/** Pixel hits waiting for the dashboard (oldest first), capped and expiring. */
export const OPENS = (acct: string) => `opens:${acct}`;
const MAX_KEPT = 2000;
const TTL = 30 * 86400;

export const hitKey = (h: Pick<RawHit, "id" | "at">) => `${h.id}|${h.at}`;

/** Housekeeping (cap + TTL) runs on a new list and every this-many pushes, not on each one. */
const TIDY_EVERY = 25;

/**
 * One command per open (RPUSH, which returns the length). The cap and TTL are refreshed only when the list is new
 * or every 25th hit, so the list can run up to 24 past the cap and expires 30 days after its last tidy: Upstash bills
 * every command, scripts and pipelines included, so this is ~1.1 commands per open instead of 3.
 */
export async function pushHit(acct: string, hit: RawHit) {
  const n = await db().rpush(OPENS(acct), hit);
  if (n !== 1 && n % TIDY_EVERY !== 0) return;
  const p = db().pipeline();
  if (n > MAX_KEPT) p.ltrim(OPENS(acct), -MAX_KEPT, -1);
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

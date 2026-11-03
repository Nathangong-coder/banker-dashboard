/**
 * Copies the server's data from Upstash Redis to Postgres (src/lib/server/store.ts), expiry times included.
 * Rate-limit counters (rl:*) stay in Redis: the limiter keeps using it.
 *   npm run db:migrate -- --dry-run         counts by type, writes nothing
 *   npm run db:migrate                      copies every key; refuses when Postgres already has data
 *   npm run db:migrate -- --force           copies anyway (Redis replaces what Postgres has under the same keys)
 * Then it compares both stores key by key. Run it with every Coverage tab closed and not at the top of the hour (the
 * hourly job), then set DATA_STORE=postgres and redeploy right away: writes in between would go to Redis only.
 */
import "./pg-env.mts";
import { isDeepStrictEqual } from "node:util";
import { Redis } from "@upstash/redis";
const { PgStore } = await import("../src/lib/server/store");
type Store = import("../src/lib/server/store").Store;

const dry = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const pg = new PgStore(process.env.DATABASE_URL!);

const keys: string[] = [];
let cursor: string | number = 0;
do {
  const [next, batch] = (await redis.scan(cursor, { count: 1000 })) as [string | number, string[]];
  keys.push(...batch.filter((k) => !k.startsWith("rl:")));
  cursor = next;
} while (String(cursor) !== "0");

const already = (await pg.scan(0, { match: "*" }))[1];
if (!dry && already.length && !force) {
  console.error(`Postgres already has ${already.length} keys. If the app is already on Postgres, copying would overwrite newer data with Redis's. Use --force only if you're sure.`);
  process.exit(1);
}
const counts: Record<string, number> = {};
let copied = 0;
for (const k of keys) {
  const type = await redis.type(k);
  counts[type] = (counts[type] ?? 0) + 1;
  if (dry) continue;
  const ttl = await redis.pttl(k);
  if (ttl === -2) continue; // expired while we were copying
  await pg.del(k);
  if (type === "string") {
    await pg.set(k, await redis.get(k), ttl > 0 ? { ex: Math.ceil(ttl / 1000) } : {});
  } else {
    if (type === "hash") await pg.hset(k, (await redis.hgetall(k)) ?? {});
    else if (type === "set") await pg.sadd(k, ...((await redis.smembers(k)) as string[]));
    else if (type === "list") {
      const items = await redis.lrange(k, 0, -1);
      for (let i = 0; i < items.length; i += 500) await pg.rpush(k, ...items.slice(i, i + 500));
    } else if (type === "zset") {
      const flat = (await redis.zrange(k, 0, -1, { withScores: true })) as (string | number)[];
      const m: { member: string; score: number }[] = [];
      for (let i = 0; i < flat.length; i += 2) m.push({ member: String(flat[i]), score: Number(flat[i + 1]) });
      for (let i = 0; i < m.length; i += 1000) await pg.zadd(k, ...m.slice(i, i + 1000));
    } else {
      console.warn(`skipped ${k}: type ${type}`);
      continue;
    }
    if (ttl > 0) await pg.expire(k, Math.ceil(ttl / 1000));
  }
  copied++;
}
console.log(`${keys.length} keys in Redis (rate-limit counters left out):`, counts);
if (dry) process.exit(0);
console.log(`copied ${copied}`);

// Compare (keys written by the live app meanwhile may differ; those are listed, not fatal).
let diff = 0;
for (const k of keys) {
  const type = await redis.type(k);
  const read = async (s: Store) =>
    type === "string" ? s.get(k)
    : type === "hash" ? s.hgetall(k)
    : type === "set" ? ((await s.smembers(k)) as string[]).sort()
    : type === "list" ? s.lrange(k, 0, -1)
    : type === "zset" ? s.zrange(k, "-inf", "+inf", { byScore: true, withScores: true })
    : null;
  const [a, b] = await Promise.all([read(redis as unknown as Store), read(pg)]);
  if (!isDeepStrictEqual(a, b)) {
    diff++;
    console.log(`differs: ${k} (${type})`);
  }
}
console.log(diff ? `${diff} key(s) differ (expected only for ones the app changed meanwhile)` : "every key matches");

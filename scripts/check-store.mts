/**
 * The Postgres store answers like Upstash Redis for every call the server makes (src/lib/server/store.ts): the same
 * steps run against both on throwaway `chk:<random>:` keys, which are deleted afterwards.
 *   npm run check:store      (needs .env.local for Upstash and .env.neon for DATABASE_URL)
 */
import "./pg-env.mts";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Redis } from "@upstash/redis";
const { PgStore } = await import("../src/lib/server/store");
type Store = import("../src/lib/server/store").Store;

const pg = new PgStore(process.env.DATABASE_URL!);
const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! }) as unknown as Store;
const P = `chk:${randomBytes(4).toString("hex")}:`;
const k = (s: string) => P + s;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const steps: [string, (s: Store) => Promise<unknown>][] = [
  ["set/get object", async (s) => (await s.set(k("a"), { x: 1, y: "two" }), s.get(k("a")))],
  ["get missing", (s) => s.get(k("nope"))],
  ["set nx on existing", (s) => s.set(k("a"), 5, { nx: true })],
  ["set nx on new", (s) => s.set(k("b"), "v", { nx: true, ex: 60 })],
  ["getset", async (s) => [await s.getset(k("b"), "w"), await s.get(k("b"))]],
  ["getdel", async (s) => [await s.getdel(k("b")), await s.get(k("b"))]],
  ["incr new + again", async (s) => [await s.incr(k("n")), await s.incr(k("n")), await s.get(k("n"))]],
  ["set ex expires", async (s) => (await s.set(k("e"), 1, { ex: 1 }), await sleep(2200), s.get(k("e")))],
  ["hset + hgetall", async (s) => [await s.hset(k("h"), { f1: "a", f2: { z: 1 } }), await s.hset(k("h"), { f2: "b", f3: "c" }), await s.hgetall(k("h"))]],
  ["hget / hlen / hkeys", async (s) => [await s.hget(k("h"), "f1"), await s.hget(k("h"), "x"), await s.hlen(k("h")), (await s.hkeys(k("h"))).sort()]],
  ["hmget some missing", (s) => s.hmget(k("h"), "f1", "zz", "f3")],
  ["hmget all missing", (s) => s.hmget(k("nohash"), "a")],
  ["hgetall missing", (s) => s.hgetall(k("nohash"))],
  ["hdel", async (s) => [await s.hdel(k("h"), "f1", "zz"), await s.hlen(k("h"))]],
  ["hscan match", async (s) => {
    await s.hset(k("h2"), { "c:1": "a", "c:2": "b", "x:1": "c" });
    const out: unknown[] = [];
    let cur: string | number = 0;
    do {
      const [next, f] = await s.hscan(k("h2"), cur, { match: "c:*", count: 1000 });
      out.push(...f);
      cur = next;
    } while (String(cur) !== "0");
    const pairs: string[] = [];
    for (let i = 0; i < out.length; i += 2) pairs.push(`${out[i]}=${out[i + 1]}`);
    return pairs.sort();
  }],
  ["sets", async (s) => [await s.sadd(k("s"), "a", "b", "a"), await s.sadd(k("s"), "c"), await s.srem(k("s"), "a", "q"), (await s.smembers(k("s"))).sort(), await s.smembers(k("nos"))]],
  ["lists", async (s) => [
    await s.rpush(k("l"), { a: 1 }, { a: 2 }),
    await s.rpush(k("l"), { a: 3 }, { a: 4 }, { a: 5 }),
    await s.lrange(k("l"), 0, 1),
    await s.lrange(k("l"), -2, -1),
    await s.lrange(k("l"), 0, 100),
    await s.ltrim(k("l"), 2, -1),
    await s.lrange(k("l"), 0, -1),
    await s.ltrim(k("l"), -2, -1),
    await s.lrange(k("l"), 0, -1),
    await s.lrange(k("nolist"), 0, 10),
  ]],
  ["zset byScore", async (s) => [
    await s.zadd(k("z"), { score: 1, member: "a" }, { score: 2, member: "b" }, { score: 3, member: "c" }),
    await s.zadd(k("z"), { score: 4, member: "a" }),
    await s.zrange(k("z"), "(2", "+inf", { byScore: true, withScores: true }),
    await s.zrange(k("z"), "(0", "+inf", { byScore: true, withScores: true }),
  ]],
  ["multi", async (s) => {
    await s.multi().hset(k("m"), { a: "1", b: "2" }).hdel(k("m"), "a").zadd(k("mz"), { score: 7, member: "x" }).exec();
    return [await s.hgetall(k("m")), await s.zrange(k("mz"), "(0", "+inf", { byScore: true, withScores: true })];
  }],
  ["expire a hash", async (s) => [await s.expire(k("m"), 1), await sleep(2200), await s.hgetall(k("m")), await s.hlen(k("m"))]],
  ["expire a list via pipeline", async (s) => {
    await s.rpush(k("pl"), 1, 2, 3);
    await s.pipeline().ltrim(k("pl"), -2, -1).expire(k("pl"), 60).exec();
    return s.lrange(k("pl"), 0, -1);
  }],
  ["scan match", async (s) => (await s.scan(0, { match: `${P}h*`, count: 500 }))[1].slice().sort()],
  ["del counts keys", async (s) => [await s.del(k("a"), k("h"), k("s"), k("missing")), await s.get(k("a")), await s.hgetall(k("h"))]],
];

let failed = 0;
try {
  for (const [name, step] of steps) {
    const [a, b] = await Promise.all([step(redis), step(pg)]);
    const ok = isDeepStrictEqual(a, b);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     redis: ${JSON.stringify(a)}\n     pg:    ${JSON.stringify(b)}`}`);
  }
} finally {
  for (const s of [redis, pg]) {
    const [, keys] = await s.scan(0, { match: `${P}*`, count: 1000 });
    if (keys.length) await s.del(...keys);
  }
}
console.log(failed ? `\n${failed} check(s) failed` : "\nstore matches Redis");
process.exit(failed ? 1 : 0);

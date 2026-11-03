import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * The server's key-value store (owner, 2026-11-02: moving off Upstash Redis, which bills per command, to Neon Postgres,
 * which bills for compute time and storage). `db()` in accounts.ts returns either backend behind this one interface,
 * so the routes keep their Redis-shaped calls: `DATA_STORE=postgres` picks Postgres, anything else Upstash.
 *
 * Postgres layout (scripts/pg-setup.mts): one table per Redis type, keyed by the same key strings, values as jsonb.
 * Expiry: `kv.exp` for plain values, `kv_ttl` for hashes / sets / lists / sorted sets; expired rows read as missing
 * and the hourly tick deletes them (`sweepExpired`).
 */

type Opts = { ex?: number; nx?: boolean };
type ZMember = { score: number; member: string };

export interface Batch {
  hset(key: string, values: Record<string, unknown>): Batch;
  hdel(key: string, ...fields: string[]): Batch;
  zadd(key: string, ...members: ZMember[]): Batch;
  ltrim(key: string, start: number, stop: number): Batch;
  expire(key: string, seconds: number): Batch;
  exec(): Promise<unknown[]>;
}

export interface Store {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: Opts): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  getdel<T = unknown>(key: string): Promise<T | null>;
  getset<T = unknown>(key: string, value: unknown): Promise<T | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  hset(key: string, values: Record<string, unknown>): Promise<number>;
  hget<T = unknown>(key: string, field: string): Promise<T | null>;
  hgetall<T = Record<string, unknown>>(key: string): Promise<T | null>;
  hmget<T = Record<string, unknown>>(key: string, ...fields: string[]): Promise<T | null>;
  hkeys(key: string): Promise<string[]>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hlen(key: string): Promise<number>;
  hscan(key: string, cursor: string | number, opts?: { match?: string; count?: number }): Promise<[string | number, unknown[]]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  rpush(key: string, ...values: unknown[]): Promise<number>;
  lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
  ltrim(key: string, start: number, stop: number): Promise<"OK">;
  zadd(key: string, ...members: ZMember[]): Promise<number>;
  zrange<T = unknown[]>(key: string, min: string | number, max: string | number, opts?: { byScore?: boolean; withScores?: boolean }): Promise<T>;
  scan(cursor: string | number, opts?: { match?: string; count?: number }): Promise<[string | number, string[]]>;
  multi(): Batch;
  pipeline(): Batch;
}

/** Redis glob (only `*` is used here) → SQL LIKE. */
const like = (glob: string) => glob.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "%");
const j = (v: unknown) => JSON.stringify(v ?? null);
/**
 * Upstash reads every stored string back through JSON.parse (a hash field written as "2" comes back as the number 2),
 * and the routes were written against that, so reads here do the same.
 */
function rd<T>(v: unknown): T {
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return v as T;
  }
}
/** A collection key that has expired (its rows still sit there until the sweep). */
const LIVE = (col: string) => `not exists (select 1 from kv_ttl t where t.k = ${col} and t.exp <= now())`;
const TABLES = ["kv", "kv_hash", "kv_set", "kv_list", "kv_zset", "kv_ttl"] as const;

export class PgStore implements Store {
  private sql: NeonQueryFunction<false, false>;
  constructor(url: string) {
    this.sql = neon(url);
  }
  private q<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
    return this.sql.query(text, params) as Promise<T[]>;
  }

  async get<T = unknown>(key: string) {
    const r = await this.q<{ v: T }>(`select v from kv where k = $1 and (exp is null or exp > now())`, [key]);
    return r.length ? rd<T>(r[0].v) : null;
  }
  async set(key: string, value: unknown, opts: Opts = {}) {
    const exp = opts.ex ? new Date(Date.now() + opts.ex * 1000).toISOString() : null;
    if (opts.nx) {
      // Only when missing or expired.
      const r = await this.q(
        `insert into kv (k, v, exp) values ($1, $2::jsonb, $3) on conflict (k) do update set v = excluded.v, exp = excluded.exp
         where kv.exp is not null and kv.exp <= now() returning k`,
        [key, j(value), exp],
      );
      return r.length ? "OK" : null;
    }
    await this.q(`insert into kv (k, v, exp) values ($1, $2::jsonb, $3) on conflict (k) do update set v = excluded.v, exp = excluded.exp`, [key, j(value), exp]);
    return "OK";
  }
  async del(...keys: string[]) {
    if (!keys.length) return 0;
    // One statement: a CTE per table.
    const ctes = TABLES.map((t, i) => `d${i} as (delete from ${t} where k = any($1::text[]) returning k)`).join(", ");
    const r = await this.q<{ n: string }>(`with ${ctes} select count(distinct k) as n from (${TABLES.slice(0, 5).map((_, i) => `select k from d${i}`).join(" union all ")}) x`, [keys]);
    return Number(r[0].n);
  }
  async getdel<T = unknown>(key: string) {
    const r = await this.q<{ v: T; exp: string | null }>(`delete from kv where k = $1 returning v, exp`, [key]);
    return r.length && (!r[0].exp || Date.parse(r[0].exp) > Date.now()) ? rd<T>(r[0].v) : null;
  }
  async getset<T = unknown>(key: string, value: unknown) {
    const old = await this.get<T>(key);
    await this.set(key, value);
    return old;
  }
  async incr(key: string) {
    const r = await this.q<{ v: number }>(
      `insert into kv (k, v) values ($1, '1'::jsonb) on conflict (k) do update
       set v = to_jsonb(case when kv.exp is not null and kv.exp <= now() then 0 else (kv.v #>> '{}')::bigint end + 1),
           exp = case when kv.exp is not null and kv.exp <= now() then null else kv.exp end
       returning v`,
      [key],
    );
    return Number(r[0].v);
  }
  async expire(key: string, seconds: number) {
    const exp = new Date(Date.now() + seconds * 1000).toISOString();
    const r = await this.q(`update kv set exp = $2 where k = $1 returning k`, [key, exp]);
    if (r.length) return 1;
    await this.q(`insert into kv_ttl (k, exp) values ($1, $2) on conflict (k) do update set exp = excluded.exp`, [key, exp]);
    return 1;
  }

  /** Writing to an expired collection starts it over, as in Redis. */
  private async revive(key: string) {
    const r = await this.q(`delete from kv_ttl where k = $1 and exp <= now() returning k`, [key]);
    if (r.length) await Promise.all(["kv_hash", "kv_set", "kv_list", "kv_zset"].map((t) => this.q(`delete from ${t} where k = $1`, [key])));
  }

  async hset(key: string, values: Record<string, unknown>) {
    const fields = Object.keys(values);
    if (!fields.length) return 0;
    await this.revive(key);
    const r = await this.q<{ added: boolean }>(
      `insert into kv_hash (k, f, v) select $1, f, v from jsonb_each($2::jsonb) as e(f, v)
       on conflict (k, f) do update set v = excluded.v returning (xmax = 0) as added`,
      [key, JSON.stringify(values)],
    );
    return r.filter((x) => x.added).length;
  }
  async hget<T = unknown>(key: string, field: string) {
    const r = await this.q<{ v: T }>(`select v from kv_hash where k = $1 and f = $2 and ${LIVE("$1")}`, [key, field]);
    return r.length ? rd<T>(r[0].v) : null;
  }
  async hgetall<T = Record<string, unknown>>(key: string) {
    const r = await this.q<{ f: string; v: unknown }>(`select f, v from kv_hash where k = $1 and ${LIVE("$1")}`, [key]);
    return r.length ? (Object.fromEntries(r.map((x) => [x.f, rd(x.v)])) as T) : null;
  }
  async hmget<T = Record<string, unknown>>(key: string, ...fields: string[]) {
    const r = await this.q<{ f: string; v: unknown }>(`select f, v from kv_hash where k = $1 and f = any($2::text[]) and ${LIVE("$1")}`, [key, fields]);
    if (!r.length) return null;
    const got = new Map(r.map((x) => [x.f, rd(x.v)]));
    return Object.fromEntries(fields.map((f) => [f, got.has(f) ? got.get(f) : null])) as T;
  }
  async hkeys(key: string) {
    return (await this.q<{ f: string }>(`select f from kv_hash where k = $1 and ${LIVE("$1")}`, [key])).map((x) => x.f);
  }
  async hdel(key: string, ...fields: string[]) {
    if (!fields.length) return 0;
    return (await this.q(`delete from kv_hash where k = $1 and f = any($2::text[]) returning f`, [key, fields])).length;
  }
  async hlen(key: string) {
    const r = await this.q<{ n: string }>(`select count(*) as n from kv_hash where k = $1 and ${LIVE("$1")}`, [key]);
    return Number(r[0].n);
  }
  /** One page with everything (cursor "0" = done); callers loop until "0". */
  async hscan(key: string, _cursor: string | number, opts: { match?: string } = {}): Promise<[string | number, unknown[]]> {
    const r = await this.q<{ f: string; v: unknown }>(`select f, v from kv_hash where k = $1 and f like $2 and ${LIVE("$1")}`, [key, like(opts.match ?? "*")]);
    return ["0", r.flatMap((x) => [x.f, rd(x.v)])];
  }

  async sadd(key: string, ...members: string[]) {
    if (!members.length) return 0;
    await this.revive(key);
    return (await this.q(`insert into kv_set (k, m) select $1, unnest($2::text[]) on conflict do nothing returning m`, [key, members])).length;
  }
  async srem(key: string, ...members: string[]) {
    if (!members.length) return 0;
    return (await this.q(`delete from kv_set where k = $1 and m = any($2::text[]) returning m`, [key, members])).length;
  }
  async smembers(key: string) {
    return (await this.q<{ m: string }>(`select m from kv_set where k = $1 and ${LIVE("$1")}`, [key])).map((x) => x.m);
  }

  async rpush(key: string, ...values: unknown[]) {
    await this.revive(key);
    const r = await this.q<{ n: string }>(
      `with ins as (insert into kv_list (k, v) select $1, e from jsonb_array_elements($2::jsonb) as e returning 1)
       select (select count(*) from kv_list where k = $1) + (select count(*) from ins) as n`,
      [key, JSON.stringify(values)],
    );
    return Number(r[0].n);
  }
  /** Rows numbered from 0 in push order; negative indexes count from the end, as in Redis. */
  private ranged = `select i, v, n from (select i, v, row_number() over (order by i) - 1 as n, count(*) over () as c from kv_list where k = $1) x
    where n >= case when $2::bigint < 0 then c + $2::bigint else $2::bigint end and n <= case when $3::bigint < 0 then c + $3::bigint else $3::bigint end`;
  async lrange<T = unknown>(key: string, start: number, stop: number) {
    const r = await this.q<{ v: T }>(`${this.ranged} and ${LIVE("$1")} order by n`, [key, start, stop]);
    return r.map((x) => rd<T>(x.v));
  }
  async ltrim(key: string, start: number, stop: number) {
    await this.q(`delete from kv_list where k = $1 and i not in (select i from (${this.ranged}) kept)`, [key, start, stop]);
    return "OK" as const;
  }

  async zadd(key: string, ...members: ZMember[]) {
    if (!members.length) return 0;
    await this.revive(key);
    const r = await this.q<{ added: boolean }>(
      `insert into kv_zset (k, m, s) select $1, m, s from unnest($2::text[], $3::float8[]) as u(m, s)
       on conflict (k, m) do update set s = excluded.s returning (xmax = 0) as added`,
      [key, members.map((m) => m.member), members.map((m) => m.score)],
    );
    return r.filter((x) => x.added).length;
  }
  /** Only the byScore form is used: `(N` = exclusive, `+inf` / `-inf`. */
  async zrange<T = unknown[]>(key: string, min: string | number, max: string | number, opts: { byScore?: boolean; withScores?: boolean } = {}) {
    if (!opts.byScore) throw new Error("PgStore.zrange supports byScore only");
    const bound = (b: string | number, low: boolean) => {
      const s = String(b);
      if (s === "+inf" || s === "-inf") return { sql: "true", val: null };
      const open = s.startsWith("(");
      const n = Number(open ? s.slice(1) : s);
      return { sql: `s ${low ? (open ? ">" : ">=") : open ? "<" : "<="} `, val: n };
    };
    const lo = bound(min, true);
    const hi = bound(max, false);
    const params: unknown[] = [key];
    const cond = [lo, hi].map((b) => (b.val === null ? "true" : `${b.sql}$${params.push(b.val)}`)).join(" and ");
    const r = await this.q<{ m: string; s: number }>(`select m, s from kv_zset where k = $1 and ${cond} and ${LIVE("$1")} order by s, m`, params);
    return (opts.withScores ? r.flatMap((x) => [x.m, Number(x.s)]) : r.map((x) => x.m)) as T;
  }

  async scan(_cursor: string | number, opts: { match?: string } = {}): Promise<[string | number, string[]]> {
    const p = like(opts.match ?? "*");
    const r = await this.q<{ k: string }>(
      `select k from kv where k like $1 union select k from kv_hash where k like $1 union select k from kv_set where k like $1
       union select k from kv_list where k like $1 union select k from kv_zset where k like $1`,
      [p],
    );
    return ["0", r.map((x) => x.k)];
  }

  multi() {
    return this.batch();
  }
  pipeline() {
    return this.batch();
  }
  /** Runs the queued calls in order on exec (not atomic: the callers don't need it). */
  private batch(): Batch {
    const ops: (() => Promise<unknown>)[] = [];
    const b: Batch = {
      hset: (k, v) => (ops.push(() => this.hset(k, v)), b),
      hdel: (k, ...f) => (ops.push(() => this.hdel(k, ...f)), b),
      zadd: (k, ...m) => (ops.push(() => this.zadd(k, ...m)), b),
      ltrim: (k, s, e) => (ops.push(() => this.ltrim(k, s, e)), b),
      expire: (k, s) => (ops.push(() => this.expire(k, s)), b),
      exec: async () => {
        const out: unknown[] = [];
        for (const op of ops) out.push(await op());
        return out;
      },
    };
    return b;
  }

  /** Delete expired rows (the hourly tick). */
  async sweepExpired() {
    await this.q(`delete from kv where exp is not null and exp <= now()`);
    const gone = (await this.q<{ k: string }>(`delete from kv_ttl where exp <= now() returning k`)).map((x) => x.k);
    if (gone.length) await Promise.all(["kv_hash", "kv_set", "kv_list", "kv_zset"].map((t) => this.q(`delete from ${t} where k = any($1::text[])`, [gone])));
  }
}

/** The tables (idempotent; scripts/pg-setup.mts runs it). */
export const SCHEMA = [
  `create table if not exists kv (k text primary key, v jsonb not null, exp timestamptz)`,
  `create index if not exists kv_exp on kv (exp) where exp is not null`,
  `create table if not exists kv_hash (k text not null, f text not null, v jsonb not null, primary key (k, f))`,
  `create table if not exists kv_set (k text not null, m text not null, primary key (k, m))`,
  `create table if not exists kv_list (i bigserial primary key, k text not null, v jsonb not null)`,
  `create index if not exists kv_list_k on kv_list (k, i)`,
  `create table if not exists kv_zset (k text not null, m text not null, s double precision not null, primary key (k, m))`,
  `create index if not exists kv_zset_ks on kv_zset (k, s)`,
  `create table if not exists kv_ttl (k text primary key, exp timestamptz not null)`,
];

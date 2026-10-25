import "server-only";
import { createHash } from "node:crypto";
import { del as blobDel, get as blobGet, list as blobList, put as blobPut } from "@vercel/blob";
import { HttpError } from "./http";
import { db, seal, unseal } from "./accounts";
import { validDocKey } from "../syncDocs";

/**
 * A user's dashboard data on the server (owner, 2026-10-25). The browser cuts its saved state into docs
 * (lib/syncDocs.ts); each is stored sealed with SERVER_ENC_KEY (AES-256-GCM) in one Redis hash. Every push gets a new
 * revision, and a sorted set records the revision each doc last changed at, so a pull asks only for what changed since
 * the revision it has. A removed doc stays in that log (its hash field is gone), which is how deletes reach other tabs.
 *
 * Big files (workbook, parsed sheets, resumes, logo) are stored in parts of ≤3 MB (Vercel caps a request at 4.5 MB):
 * in Vercel Blob (private) when BLOB_READ_WRITE_TOKEN is set, else in Redis (local testing).
 */

const DOCS = (uid: string) => `ud:${uid}`;
const LOG = (uid: string) => `udlog:${uid}`;
const REV = (uid: string) => `udrev:${uid}`;
/** One pull answer stays under this many characters of doc JSON (Vercel's response cap is 4.5 MB). */
const PULL_BUDGET = 3_000_000;

export async function pushDocs(uid: string, changed: Record<string, string>, removed: string[]) {
  for (const k of [...Object.keys(changed), ...removed]) if (!validDocKey(k)) throw new HttpError(400, `Unknown data key "${k.slice(0, 40)}".`);
  const rev = await db().incr(REV(uid));
  const keys = [...Object.keys(changed), ...removed];
  if (!keys.length) return rev;
  const sealed = Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, seal(v)]));
  const tx = db().multi();
  if (Object.keys(sealed).length) tx.hset(DOCS(uid), sealed);
  if (removed.length) tx.hdel(DOCS(uid), ...removed);
  const [first, ...rest] = keys.map((member) => ({ score: rev, member }));
  tx.zadd(LOG(uid), first, ...rest);
  await tx.exec();
  return rev;
}

/**
 * Docs changed after revision `since` (0 = everything). `docs` holds current values, `removed` the keys deleted since.
 * When the answer would be too big, `more` is true and `rev` is where to continue from.
 */
export async function pullDocs(uid: string, since: number) {
  const top = Number((await db().get<number>(REV(uid))) ?? 0);
  if (since >= top) return { rev: top, docs: {}, removed: [] as string[], more: false };
  const entries = (await db().zrange<(string | number)[]>(LOG(uid), `(${since}`, "+inf", { byScore: true, withScores: true })) ?? [];
  const pairs: { key: string; score: number }[] = [];
  for (let i = 0; i < entries.length; i += 2) pairs.push({ key: String(entries[i]), score: Number(entries[i + 1]) });
  const docs: Record<string, string> = {};
  const removed: string[] = [];
  let size = 0;
  for (let i = 0; i < pairs.length; i += 200) {
    const chunk = pairs.slice(i, i + 200);
    const values = (await db().hmget<Record<string, string | null>>(DOCS(uid), ...chunk.map((p) => p.key))) ?? {};
    for (const p of chunk) {
      const v = values[p.key];
      if (v === null || v === undefined) {
        removed.push(p.key);
        continue;
      }
      const plain = unseal(String(v));
      if (size + plain.length > PULL_BUDGET && size > 0) {
        // Continue from just before this doc's revision next time (a few docs may come twice: harmless).
        return { rev: p.score - 1, docs, removed, more: true };
      }
      docs[p.key] = plain;
      size += plain.length;
    }
  }
  return { rev: top, docs, removed, more: false };
}

export async function dataStatus(uid: string) {
  const rev = Number((await db().get<number>(REV(uid))) ?? 0);
  const docs = await db().hlen(DOCS(uid));
  let contacts = 0;
  let cursor: string | number = 0;
  do {
    const [next, fields] = (await db().hscan(DOCS(uid), cursor, { match: "c:*", count: 1000 })) as [string | number, unknown[]];
    contacts += fields.length / 2;
    cursor = next;
  } while (String(cursor) !== "0");
  return { rev, docs, contacts };
}

/* ---------------- big files ---------------- */

export const BLOB_NAME = /^(workbook|snapshots|resume|logo|appresume:[A-Za-z0-9_-]{1,40})$/;
export const PART_BYTES = 3 * 1024 * 1024;
const blobStoreOn = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const folder = (uid: string) => `u/${createHash("sha256").update(uid).digest("hex").slice(0, 32)}`;
const blobPath = (uid: string, name: string, part: number) => `${folder(uid)}/${name.replace(":", "-")}.${part}`;
const REDIS_PART = (uid: string, name: string, part: number) => `ublob:${uid}:${name}:${part}`;

function checkName(name: string, part: number) {
  if (!BLOB_NAME.test(name)) throw new HttpError(400, "Unknown file name.");
  if (!Number.isInteger(part) || part < 0 || part > 40) throw new HttpError(400, "Bad file part.");
}

export async function putPart(uid: string, name: string, part: number, bytes: Uint8Array) {
  checkName(name, part);
  if (bytes.byteLength > PART_BYTES) throw new HttpError(413, "File part too big.");
  if (blobStoreOn()) await blobPut(blobPath(uid, name, part), Buffer.from(bytes), { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: "application/octet-stream" });
  else await db().set(REDIS_PART(uid, name, part), Buffer.from(bytes).toString("base64"));
}

export async function getPart(uid: string, name: string, part: number): Promise<Uint8Array | null> {
  checkName(name, part);
  if (blobStoreOn()) {
    const r = await blobGet(blobPath(uid, name, part), { access: "private", useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return new Uint8Array(await new Response(r.stream).arrayBuffer());
  }
  const b64 = await db().get<string>(REDIS_PART(uid, name, part));
  return b64 ? new Uint8Array(Buffer.from(b64, "base64")) : null;
}

/** Remove a file's parts from `from` on (all of them by default; a shorter new version drops its old tail). */
export async function deleteParts(uid: string, name: string, from = 0, upTo = 40) {
  checkName(name, from);
  if (blobStoreOn()) {
    const { blobs } = await blobList({ prefix: `${folder(uid)}/${name.replace(":", "-")}.` });
    const gone = blobs.filter((b) => Number(b.pathname.split(".").pop()) >= from).map((b) => b.url);
    if (gone.length) await blobDel(gone);
  } else {
    const keys = Array.from({ length: upTo - from + 1 }, (_, i) => REDIS_PART(uid, name, from + i));
    await db().del(...keys);
  }
}

/** Everything this user stored (account deletion). */
export async function deleteUserData(uid: string) {
  if (blobStoreOn()) {
    let cursor: string | undefined;
    do {
      const r = await blobList({ prefix: `${folder(uid)}/`, cursor });
      if (r.blobs.length) await blobDel(r.blobs.map((b) => b.url));
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
  } else {
    let cursor: string | number = 0;
    do {
      const [next, keys] = (await db().scan(cursor, { match: `ublob:${uid}:*`, count: 500 })) as [string | number, string[]];
      if (keys.length) await db().del(...keys);
      cursor = next;
    } while (String(cursor) !== "0");
  }
  await db().del(DOCS(uid), LOG(uid), REV(uid));
}

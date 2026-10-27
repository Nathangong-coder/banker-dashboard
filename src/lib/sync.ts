"use client";

import { create } from "zustand";
import { del as idbDel, get as idbGet, set as idbSet, keys as idbKeys } from "idb-keyval";
import { blobs, localKey, onBlobChange, persistedState, useStore, type BlobName } from "./store";
import { batches, diffDocs, fromDocs, serialize, toDocs } from "./syncDocs";

/**
 * Accounts (owner, 2026-10-25): keeps a signed-in user's dashboard in step with their account. The account is the
 * source of truth; this browser's IndexedDB copy is a cache that makes pages load instantly.
 * - Push: a few seconds after any change, the docs that differ from what the server last had (lib/syncDocs.ts).
 * - Pull: on start, on focus, every 30 s while visible, and right away when another tab in this browser pushed
 *   (BroadcastChannel). Only docs changed since the last revision come down.
 * - Conflicts: last write wins per doc. A doc edited here and not pushed yet keeps the local version.
 * - Big files (workbook, parsed sheets, resumes, logo) go up and down in 3 MB parts, described by `bm:<name>` docs.
 */

/** `hash` = SHA-256 of the uploaded bytes, so an identical rewrite isn't uploaded again. */
type BlobMeta = { parts: number; size: number; kind: "ab" | "json" | "file"; at: string; deleted?: boolean; hash?: string };
interface Meta {
  rev: number;
  /** Each doc as the server last had it (what a push is diffed against). */
  synced: Record<string, string>;
  blobs: Record<string, BlobMeta>;
}
export type SyncState = "off" | "starting" | "saved" | "saving" | "offline" | "error";
export const useSyncStatus = create<{ state: SyncState; at?: string; error?: string }>(() => ({ state: "off" }));

const PART = 3 * 1024 * 1024;
const PUSH_DELAY = 3000;
/**
 * Background pulls (owner, 2026-10-26: every-30-s polling used up the Upstash plan): every 2 min while the tab is
 * visible, stretching to 10 min after several pulls in a row brought nothing. Focus, another tab's push and your own
 * changes still sync right away.
 */
const POLL = 120_000;
const IDLE_POLL = 600_000;
let quietPulls = 0;
let lastPullAt = 0;
const META_KEY = (uid: string) => `sync:${uid}`;

let uid: string | null = null;
let meta: Meta = { rev: 0, synced: {}, blobs: {} };
let stopFns: (() => void)[] = [];
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let applying = false;
let chain: Promise<unknown> = Promise.resolve();
let channel: BroadcastChannel | null = null;
const dirtyBlobs = new Set<BlobName>();

/** Run sync steps one at a time (a pull never interleaves with a push). */
function queue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}
const saveMeta = () => (uid ? idbSet(META_KEY(uid), meta) : Promise.resolve());

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, cache: "no-store", headers: { ...(init?.body && !(init.body instanceof ArrayBuffer) && !(init.body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) } });
  if (res.status === 401) throw Object.assign(new Error("You were signed out. Sign in again to keep saving."), { signedOut: true });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `Server error ${res.status}`);
  }
  return (res.headers.get("content-type") ?? "").includes("json") ? ((await res.json()) as T) : ((await res.arrayBuffer()) as T);
}

function fail(e: unknown) {
  const err = e as Error & { signedOut?: boolean };
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  useSyncStatus.setState({ state: offline ? "offline" : "error", error: err.message });
  if (err.signedOut) window.dispatchEvent(new CustomEvent("coverage:signed-out"));
}

/* ---------------- docs ---------------- */

function localDocs() {
  return serialize(toDocs(persistedState()));
}

/**
 * Put docs from the server into the store, skipping ones edited here and not pushed yet. `force`: the server wins for
 * every doc (a browser opening an account for the first time has only empty defaults, which must not win).
 */
function applyRemote(docs: Record<string, string>, removed: string[], force = false) {
  const local = localDocs();
  const next: Record<string, string> = { ...local };
  let changed = false;
  for (const [k, v] of Object.entries(docs)) {
    if (k.startsWith("bm:")) continue;
    // Edited (or deleted) here and not pushed yet: this browser's version wins until it's pushed.
    const dirty = !force && local[k] !== meta.synced[k];
    if (dirty) continue;
    meta.synced[k] = v;
    if (local[k] !== v) {
      next[k] = v;
      changed = true;
    }
  }
  for (const k of removed) {
    if (k.startsWith("bm:")) continue;
    // Edited (or deleted) here and not pushed yet: this browser's version wins until it's pushed.
    const dirty = !force && local[k] !== meta.synced[k];
    if (dirty) continue;
    delete meta.synced[k];
    if (k in next) {
      delete next[k];
      changed = true;
    }
  }
  if (!changed) return;
  const parsed = fromDocs(Object.fromEntries(Object.entries(next).map(([k, v]) => [k, JSON.parse(v)])));
  const cur = useStore.getState() as unknown as Record<string, unknown>;
  // Fields that are gone everywhere (e.g. the workbook was removed) go back to empty.
  for (const k of Object.keys(persistedState())) if (!(k in parsed)) parsed[k] = Array.isArray(cur[k]) ? [] : undefined;
  const merge = useStore.persist.getOptions().merge;
  const state = merge ? merge(parsed, useStore.getState()) : { ...useStore.getState(), ...parsed };
  applying = true;
  try {
    useStore.setState(state as Partial<ReturnType<typeof useStore.getState>>);
  } finally {
    applying = false;
  }
}

type Pulled = { rev: number; docs: Record<string, string>; removed: string[]; more: boolean };

async function pullNow(force = false) {
  lastPullAt = Date.now();
  for (let guard = 0; guard < 50; guard++) {
    const r = await api<Pulled>(`/api/sync/pull?since=${meta.rev}`);
    quietPulls = Object.keys(r.docs).length || r.removed.length ? 0 : quietPulls + 1;
    applyRemote(r.docs, r.removed, force);
    for (const [k, v] of Object.entries(r.docs)) if (k.startsWith("bm:")) await receiveBlob(k.slice(3) as BlobName, JSON.parse(v) as BlobMeta);
    meta.rev = r.rev;
    await saveMeta();
    if (!r.more) break;
  }
}

async function pushNow() {
  const local = localDocs();
  const { changed, removed } = diffDocs(meta.synced, local);
  if (!Object.keys(changed).length && !removed.length) return false;
  useSyncStatus.setState({ state: "saving" });
  for (const b of batches(changed, removed)) {
    await api("/api/sync/push", { method: "POST", body: JSON.stringify(b) });
    Object.assign(meta.synced, b.changed);
    for (const k of b.removed) delete meta.synced[k];
    await saveMeta();
  }
  channel?.postMessage("pushed");
  return true;
}

/* ---------------- big files ---------------- */

const enc = new TextEncoder();
const dec = new TextDecoder();
function encodeBlob(v: unknown): { bytes: Uint8Array; kind: BlobMeta["kind"] } {
  if (v instanceof ArrayBuffer) return { bytes: new Uint8Array(v), kind: "ab" };
  const f = v as { name?: string; type?: string; data?: ArrayBuffer };
  if (f && typeof f === "object" && f.data instanceof ArrayBuffer) {
    const head = enc.encode(JSON.stringify({ name: f.name, type: f.type }));
    const out = new Uint8Array(4 + head.length + f.data.byteLength);
    new DataView(out.buffer).setUint32(0, head.length);
    out.set(head, 4);
    out.set(new Uint8Array(f.data), 4 + head.length);
    return { bytes: out, kind: "file" };
  }
  return { bytes: enc.encode(JSON.stringify(v)), kind: "json" };
}
function decodeBlob(bytes: Uint8Array, kind: BlobMeta["kind"]): unknown {
  if (kind === "ab") return bytes.slice().buffer;
  if (kind === "json") return JSON.parse(dec.decode(bytes));
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  const head = JSON.parse(dec.decode(bytes.subarray(4, 4 + n))) as { name: string; type: string };
  return { ...head, data: bytes.slice(4 + n).buffer };
}

async function sendBlob(name: BlobName) {
  const v = await blobs.raw(name);
  const q = (x: Record<string, string | number>) => new URLSearchParams(Object.entries(x).map(([k, val]) => [k, String(val)]));
  let m: BlobMeta;
  if (v === undefined) {
    if (!meta.blobs[name] || meta.blobs[name].deleted) return;
    await api(`/api/sync/blob?${q({ name })}`, { method: "DELETE" });
    m = { parts: 0, size: 0, kind: "ab", at: new Date().toISOString(), deleted: true };
  } else {
    const { bytes, kind } = encodeBlob(v);
    // Same bytes as last time (re-imports, format upgrades and bank-tab refreshes rewrite identical files): skip.
    // Each upload goes through a function (Vercel Fast Origin Transfer) and into Blob storage (operations).
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), (b) => b.toString(16).padStart(2, "0")).join("");
    if (meta.blobs[name]?.hash === hash && !meta.blobs[name]?.deleted) return;
    const parts = Math.max(1, Math.ceil(bytes.length / PART));
    for (let i = 0; i < parts; i++) await api(`/api/sync/blob?${q({ name, part: i })}`, { method: "PUT", body: bytes.slice(i * PART, (i + 1) * PART) });
    if ((meta.blobs[name]?.parts ?? 0) > parts) await api(`/api/sync/blob?${q({ name, from: parts })}`, { method: "DELETE" });
    m = { parts, size: bytes.length, kind, at: new Date().toISOString(), hash };
  }
  await api("/api/sync/push", { method: "POST", body: JSON.stringify({ changed: { [`bm:${name}`]: JSON.stringify(m) }, removed: [] }) });
  meta.blobs[name] = m;
  await saveMeta();
  channel?.postMessage("pushed");
}

async function receiveBlob(name: BlobName, m: BlobMeta) {
  if (meta.blobs[name]?.at === m.at) return;
  // Changed here and not uploaded yet: this browser's version wins (it goes up next).
  if (dirtyBlobs.has(name)) return;
  if (m.deleted) await blobs.putRaw(name, undefined);
  else {
    const out = new Uint8Array(m.size);
    let at = 0;
    for (let i = 0; i < m.parts; i++) {
      const part = new Uint8Array(await api<ArrayBuffer>(`/api/sync/blob?name=${encodeURIComponent(name)}&part=${i}`));
      out.set(part, at);
      at += part.length;
    }
    const value = decodeBlob(out, m.kind);
    await blobs.putRaw(name, value);
    if (name === "snapshots") {
      applying = true;
      try {
        useStore.getState().setSnapshots(value as never);
      } finally {
        applying = false;
      }
    }
  }
  meta.blobs[name] = m;
  await saveMeta();
}

/** Files stored here that the account doesn't have yet (first sign-in on a browser with data). */
async function localBlobNames(): Promise<BlobName[]> {
  const prefix = localKey("blob:");
  return ((await idbKeys()) as unknown[])
    .filter((k): k is string => typeof k === "string" && k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .filter((n): n is BlobName => /^(workbook|snapshots|resume|logo|appresume:.+)$/.test(n));
}

/* ---------------- running it ---------------- */

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncNow();
  }, PUSH_DELAY);
}

/** Push what changed here, upload changed files, then pull what changed elsewhere. */
const lastSent = new Map<string, number>();

export function syncNow(final = false) {
  return queue(async () => {
    if (!uid) return;
    try {
      await pushNow();
      for (const name of [...dirtyBlobs]) {
        // The workbook (2+ MB) and its parsed sheets (~1 MB) change on every save and every Excel autosave Coverage
        // picks up (it checks once a minute), and each upload passes through a function and Blob, then down to every
        // other signed-in browser. So they go up at most every 15 min (everything on sign-out / Download: `final`).
        if ((name === "snapshots" || name === "workbook") && !final && Date.now() - (lastSent.get(name) ?? 0) < 900_000) continue;
        dirtyBlobs.delete(name);
        lastSent.set(name, Date.now());
        try {
          await sendBlob(name);
        } catch (e) {
          dirtyBlobs.add(name);
          throw e;
        }
      }
      await pullNow();
      // A pull can bring docs a local merge then fills in (new settings defaults): push those back once.
      await pushNow();
      useSyncStatus.setState({ state: "saved", at: new Date().toISOString(), error: undefined });
    } catch (e) {
      fail(e);
      setTimeout(() => uid && void syncNow(), 15_000);
    }
  });
}

/** Wait until everything here is saved to the account (sign-out, Download, leaving). False = it couldn't. */
export async function flushSync() {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await syncNow(true);
  const s = useSyncStatus.getState().state;
  return s === "saved" && !dirtyBlobs.size;
}

/** Unsaved changes worth a "leave the page?" prompt. The workbook files waiting out their 15-min throttle don't count:
 * the file on your computer has them, and they're re-checked (and sent if changed) the next time Coverage opens. */
export const hasUnsaved = () => !!pushTimer || [...dirtyBlobs].some((n) => n !== "workbook" && n !== "snapshots") || useSyncStatus.getState().state === "saving";

/**
 * Start syncing `userId`'s data (the store must already show that user's namespace). Resolves after the first sync,
 * so a browser opening the account for the first time shows its data before the pages render.
 * `localWins` (moving this browser's old data in): what's here replaces what the account has, files included;
 * otherwise a first-time browser takes everything from the account.
 */
export async function startSync(userId: string, opts: { localWins?: boolean } = {}) {
  stopSync();
  uid = userId;
  const saved = await idbGet<Meta>(META_KEY(userId));
  meta = saved ?? { rev: 0, synced: {}, blobs: {} };
  useSyncStatus.setState({ state: "starting" });
  if (opts.localWins) await queue(() => replaceAccountWithLocal());
  else if (!saved) await queue(() => pullNow(true)).catch(fail);
  const unsub = useStore.subscribe(() => {
    if (applying) return;
    schedulePush();
  });
  // Files throttled in an earlier session may not have gone up: look again (unchanged bytes are skipped by hash).
  for (const n of await localBlobNames()) if (n === "workbook" || n === "snapshots") dirtyBlobs.add(n);
  const unBlob = onBlobChange((name) => {
    dirtyBlobs.add(name);
    schedulePush();
  });
  const onFocus = () => document.visibilityState === "visible" && void syncNow();
  const timer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (quietPulls >= 5 && Date.now() - lastPullAt < IDLE_POLL) return;
    void syncNow();
  }, POLL);
  const onLeave = (e: BeforeUnloadEvent) => {
    if (dirtyBlobs.size) void syncNow(true);
    if (!hasUnsaved()) return;
    e.preventDefault();
  };
  channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`coverage-sync:${userId}`) : null;
  if (channel) channel.onmessage = () => void syncNow();
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);
  window.addEventListener("beforeunload", onLeave);
  stopFns = [
    unsub,
    unBlob,
    () => clearInterval(timer),
    () => window.removeEventListener("focus", onFocus),
    () => document.removeEventListener("visibilitychange", onFocus),
    () => window.removeEventListener("beforeunload", onLeave),
    () => channel?.close(),
  ];
  await syncNow();
}

/** The account gets exactly this browser's data: everything here goes up, docs only the account had are removed. */
async function replaceAccountWithLocal() {
  const remote = new Set<string>();
  let since = 0;
  let top = 0;
  for (let guard = 0; guard < 50; guard++) {
    const r = await api<Pulled>(`/api/sync/pull?since=${since}`);
    Object.keys(r.docs).forEach((k) => remote.add(k));
    top = Math.max(top, r.rev);
    since = r.rev;
    if (!r.more) break;
  }
  const local = localDocs();
  const gone = [...remote].filter((k) => !k.startsWith("bm:") && !(k in local));
  meta = { rev: top, synced: {}, blobs: {} };
  for (const b of batches(local, gone)) await api("/api/sync/push", { method: "POST", body: JSON.stringify(b) });
  meta.synced = local;
  for (const n of await localBlobNames()) dirtyBlobs.add(n);
  // Files only the account had: mark them deleted so other browsers drop them too.
  for (const k of remote) if (k.startsWith("bm:") && !dirtyBlobs.has(k.slice(3) as BlobName)) await api("/api/sync/push", { method: "POST", body: JSON.stringify({ changed: { [k]: JSON.stringify({ parts: 0, size: 0, kind: "ab", at: new Date().toISOString(), deleted: true }) }, removed: [] }) });
  await saveMeta();
}

export function stopSync() {
  stopFns.forEach((f) => f());
  stopFns = [];
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  uid = null;
  channel = null;
  dirtyBlobs.clear();
  useSyncStatus.setState({ state: "off", error: undefined });
}

/** Forget this browser's sync bookkeeping for a user (sign-out drops the cache too). */
export async function dropSyncMeta(userId: string) {
  await idbDel(META_KEY(userId));
}

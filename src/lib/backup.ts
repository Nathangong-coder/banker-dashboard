"use client";

import { get as idbGet, keys as idbKeys, set as idbSet } from "idb-keyval";
import { localKey, storeKeyFor, type StoreNamespace } from "./store";

/**
 * Complete backups (owner, 2026-10-25): every saved field plus every file (workbook, parsed sheets, resumes, logo,
 * unsorted captures), as one JSON file. Made before a browser's old data moves into an account (it may be the only
 * copy), and from Settings → Account → Download everything. Settings → Backup's older export had only contacts,
 * templates, banks and part of settings.
 */

const toB64 = (buf: ArrayBuffer) => {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

/** ArrayBuffers anywhere in a value become {__b64}; everything else stays as is. */
function pack(v: unknown): unknown {
  if (v instanceof ArrayBuffer) return { __b64: toB64(v) };
  if (Array.isArray(v)) return v.map(pack);
  if (v && typeof v === "object" && !(v instanceof Blob)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]));
  return v;
}
function unpack(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(unpack);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.__b64 === "string" && Object.keys(o).length === 1) return fromB64(o.__b64);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, unpack(x)]));
  }
  return v;
}

export async function fullBackup(ns: StoreNamespace) {
  const raw = await idbGet<string>(storeKeyFor(ns));
  const files: Record<string, unknown> = {};
  const prefix = localKey("", ns);
  for (const k of (await idbKeys()) as unknown[]) {
    if (typeof k !== "string" || !k.startsWith(prefix)) continue;
    const name = k.slice(prefix.length);
    if (!/^(blob:(workbook|snapshots|resume|logo|appresume:.+)|infosessions:unsorted)$/.test(name)) continue;
    files[name] = pack(await idbGet(k));
  }
  return { kind: "coverage-full-backup", version: 1, exportedAt: new Date().toISOString(), store: raw ? JSON.parse(raw) : null, files };
}

export async function downloadFullBackup(ns: StoreNamespace) {
  const data = await fullBackup(ns);
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `coverage-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return data.store?.state?.contacts?.length ?? 0;
}

export const isFullBackup = (j: unknown): j is Awaited<ReturnType<typeof fullBackup>> => !!j && typeof j === "object" && (j as { kind?: string }).kind === "coverage-full-backup";

/**
 * Write a complete backup into a namespace (replacing what's saved there); the page reloads after so the store and
 * sync start from it. Returns the number of contacts restored.
 */
export async function restoreFullBackup(ns: StoreNamespace, data: Awaited<ReturnType<typeof fullBackup>>) {
  if (data.store) await idbSet(storeKeyFor(ns), JSON.stringify(data.store));
  for (const [name, v] of Object.entries(data.files ?? {})) await idbSet(localKey(name, ns), unpack(v));
  return data.store?.state?.contacts?.length ?? 0;
}

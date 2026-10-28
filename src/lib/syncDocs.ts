/**
 * Accounts (owner, 2026-10-25): the dashboard's saved state, cut into small JSON "docs" so the server can store it per
 * user and two tabs editing different things don't undo each other. Pure (no store, no browser), so check:sync can
 * run it. Last write wins per doc:
 * - one doc per contact (`c:`), job (`aj:`), found job (`af:`), info session (`is:`), tracked email (`tm:`), bank (`b:`), spreadsheet cell
 *   edit (`p:`), and per key of the coverage maps (`cm:`);
 * - the order of each list is its own small doc (`o:`), so adding a contact in one tab and another in a second tab
 *   keeps both (items missing from the order go at the end);
 * - everything else is one doc per top-level field (`s:`), plus `apply` and `cov` without their collections.
 */

export type Docs = Record<string, unknown>;

/** Lists stored one doc per item: state path → [doc prefix, id field]. */
const LISTS = [
  { path: ["contacts"], prefix: "c:", id: "id" },
  { path: ["apply", "jobs"], prefix: "aj:", id: "id" },
  { path: ["apply", "finder", "found"], prefix: "af:", id: "key" },
  { path: ["infoSessions"], prefix: "is:", id: "id" },
  { path: ["tracking", "messages"], prefix: "tm:", id: "id" },
] as const;

/** Coverage fields that are maps (canonBank key → value): one doc per key. */
export const COVERAGE_MAPS = ["officePick", "specialty", "ratings", "bankBriefs", "stages"] as const;

const SEP = "\u0000";
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function getPath(o: Obj, path: readonly string[]): unknown {
  let cur: unknown = o;
  for (const k of path) cur = isObj(cur) ? cur[k] : undefined;
  return cur;
}
function setPath(o: Obj, path: readonly string[], v: unknown) {
  let cur = o;
  for (const k of path.slice(0, -1)) {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k] as Obj;
  }
  cur[path[path.length - 1]] = v;
}
const listName = (path: readonly string[]) => path.join(".");

/** Plain data only: functions (store actions) and undefined are dropped, like JSON.stringify does. */
const plain = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function toDocs(stateIn: Obj): Docs {
  const state = plain(Object.fromEntries(Object.entries(stateIn).filter(([k, v]) => typeof v !== "function" && k !== "snapshots" && k !== "gridUndo"))) as Obj;
  const docs: Docs = {};
  for (const l of LISTS) {
    const list = getPath(state, l.path);
    if (!Array.isArray(list)) continue;
    const order: string[] = [];
    for (const item of list) {
      const id = isObj(item) ? String(item[l.id] ?? "") : "";
      if (!id || docs[l.prefix + id] !== undefined) continue;
      docs[l.prefix + id] = item;
      order.push(id);
    }
    docs[`o:${listName(l.path)}`] = order;
  }
  for (const [key, bank] of Object.entries(isObj(state.banks) ? state.banks : {})) docs[`b:${key}`] = bank;
  for (const [sheet, cells] of Object.entries(isObj(state.patches) ? state.patches : {}))
    for (const [addr, v] of Object.entries(isObj(cells) ? cells : {})) docs[`p:${sheet}${SEP}${addr}`] = v;
  if (isObj(state.coverage)) {
    const rest: Obj = { ...state.coverage };
    for (const f of COVERAGE_MAPS) {
      const m = rest[f];
      delete rest[f];
      if (isObj(m)) for (const [k, v] of Object.entries(m)) docs[`cm:${f}${SEP}${k}`] = v;
      else if (m !== undefined) docs[`cm:${f}`] = m;
    }
    docs.cov = rest;
  }
  if (isObj(state.apply)) {
    const a: Obj = { ...state.apply };
    delete a.jobs;
    if (isObj(a.finder)) {
      const f = { ...a.finder };
      delete f.found;
      a.finder = f;
    }
    docs.apply = a;
  }
  if (isObj(state.tracking)) {
    const t: Obj = { ...state.tracking };
    delete t.messages;
    docs["s:tracking"] = t;
  }
  for (const [k, v] of Object.entries(state)) {
    if (["contacts", "infoSessions", "banks", "patches", "coverage", "apply", "tracking"].includes(k) || v === undefined) continue;
    docs[`s:${k}`] = v;
  }
  return docs;
}

export function fromDocs(docs: Docs): Obj {
  const state: Obj = {};
  for (const [k, v] of Object.entries(docs)) {
    if (v === undefined || v === null) continue;
    // s:tracking gets its messages list put back below: copy it so the doc itself isn't changed.
    if (k.startsWith("s:")) state[k.slice(2)] = k === "s:tracking" ? plain(v) : v;
  }
  if (isObj(docs.apply)) state.apply = plain(docs.apply);
  if (isObj(docs.cov)) state.coverage = plain(docs.cov);
  const banks: Obj = {};
  const patches: Record<string, Obj> = {};
  const cov: Obj = isObj(state.coverage) ? state.coverage : {};
  for (const [k, v] of Object.entries(docs)) {
    if (v === undefined || v === null) continue;
    if (k.startsWith("b:")) banks[k.slice(2)] = v;
    else if (k.startsWith("p:")) {
      const [sheet, addr] = k.slice(2).split(SEP);
      (patches[sheet] ??= {})[addr] = v;
    } else if (k.startsWith("cm:")) {
      const [field, key] = k.slice(3).split(SEP);
      if (key === undefined) cov[field] = v;
      else ((cov[field] as Obj | undefined) ??= {})[key] = v;
    }
  }
  state.banks = banks;
  state.patches = patches;
  if (Object.keys(cov).length) state.coverage = cov;
  for (const l of LISTS) {
    const order = Array.isArray(docs[`o:${listName(l.path)}`]) ? (docs[`o:${listName(l.path)}`] as string[]) : [];
    const items = new Map<string, unknown>();
    for (const [k, v] of Object.entries(docs)) if (k.startsWith(l.prefix) && v !== undefined && v !== null) items.set(k.slice(l.prefix.length), v);
    const hasList = items.size > 0 || docs[`o:${listName(l.path)}`] !== undefined;
    if (!hasList) continue;
    const out: unknown[] = [];
    for (const id of order) {
      if (!items.has(id)) continue;
      out.push(items.get(id));
      items.delete(id);
    }
    // Added in another tab after this order was saved: keep them, at the end.
    for (const v of items.values()) out.push(v);
    setPath(state, l.path, out);
  }
  return state;
}
/** Stable JSON per doc (sorted object keys), so unchanged docs compare equal. */
export function serialize(docs: Docs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(docs)) if (v !== undefined) out[k] = stable(v);
  return out;
}
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

export function diffDocs(prev: Record<string, string>, next: Record<string, string>) {
  const changed: Record<string, string> = {};
  const removed: string[] = [];
  for (const [k, v] of Object.entries(next)) if (prev[k] !== v) changed[k] = v;
  for (const k of Object.keys(prev)) if (!(k in next)) removed.push(k);
  return { changed, removed };
}

/** Split a push into requests of at most `max` characters (the Vercel request cap is 4.5 MB). */
export function batches(changed: Record<string, string>, removed: string[], max = 500_000) {
  const out: { changed: Record<string, string>; removed: string[] }[] = [];
  let cur = { changed: {} as Record<string, string>, removed: [] as string[] };
  let size = 0;
  const flush = () => {
    if (Object.keys(cur.changed).length || cur.removed.length) out.push(cur);
    cur = { changed: {}, removed: [] };
    size = 0;
  };
  for (const [k, v] of Object.entries(changed)) {
    if (size + v.length + k.length > max && size > 0) flush();
    cur.changed[k] = v;
    size += v.length + k.length;
  }
  for (const k of removed) {
    if (size + k.length > max && size > 0) flush();
    cur.removed.push(k);
    size += k.length + 4;
  }
  flush();
  return out;
}

/** Doc keys must stay small and printable-ish for Redis hash fields. */
export const validDocKey = (k: string) => k.length > 0 && k.length <= 600 && /^(c:|aj:|af:|is:|tm:|b:|p:|cm:|o:|s:|bm:|apply$|cov$)/.test(k);

/**
 * Account sync docs (src/lib/syncDocs.ts): the saved state round-trips, one edit = one doc, deletes are tombstones,
 * two tabs adding different items keep both. No browser, no network.
 *   npm run check:sync
 */
import { batches, diffDocs, fromDocs, serialize, toDocs, validDocKey } from "../src/lib/syncDocs";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v;

const state = {
  settings: { profile: { name: "Alex Rivera" }, server: { id: "abc", token: "t" }, vault: { ai: [{ id: "k1", value: "sk-test" }] } },
  contacts: [
    { id: "s:GS:19", name: "Jordan Lee", status: "sent", history: [{ at: "2026-10-01", type: "status" }] },
    { id: "m_1", name: "Priya Shah", status: "new", history: [] },
  ],
  templates: [{ id: "tpl_a", name: "A" }],
  banks: { "GS|SF": { key: "GS|SF", status: "active" } },
  tables: [{ sheet: "GS", headerRow: 18 }],
  patches: { GS: { C20: "x@gs.com", H20: "Sent" }, MS: { B19: "Taylor" } },
  prospects: [],
  scheduled: { "whatsapp:2026-10-24": "2026-10-24T16:00:00Z" },
  targets: [],
  coverage: { hidden: ["Lazard"], added: [], includeStarter: true, stages: { gs: "chatted", ms: "emailed" }, ratings: { gs: { stars: 4 } } },
  sheetOps: { renames: [], replaces: [], clones: [], rowStyles: [] },
  aiCooldowns: {},
  infoSessions: [{ id: "ev1", title: "Barclays Info Session" }],
  offSheet: { seen: [], recipients: [], ignored: [] },
  apply: { jobs: [{ id: "j1", company: "Citi" }, { id: "j2", company: "BofA" }], profile: { firstName: "Alex" }, samples: [], library: [], resumes: [], finder: { found: [{ key: "k1", title: "SA" }], dismissed: [], boards: [] } },
  workbook: { name: "tracker.xlsx" },
  snapshots: [{ name: "GS", cells: {} }],
  gridUndo: [{}],
  setSettings: () => {},
};

const docs = toDocs(state);
const back = fromDocs(docs);
const persisted = Object.fromEntries(Object.entries(state).filter(([k]) => !["snapshots", "gridUndo", "setSettings"].includes(k)));
eq("round trip is exact (snapshots, undo and actions left out)", sorted(back), sorted(persisted));
eq("one doc per contact, job, found job, info session, bank, cell, coverage map key", ["c:s:GS:19", "c:m_1", "aj:j1", "af:k1", "is:ev1", "b:GS|SF", "p:GS\u0000C20", "cm:stages\u0000gs"].every((k) => k in docs), true);
eq("every key is a valid doc key", Object.keys(docs).every(validDocKey), true);

const base = serialize(docs);
const edited = serialize(toDocs({ ...state, contacts: [state.contacts[0], { ...state.contacts[1], status: "drafted" }] }));
eq("editing one contact changes exactly one doc", diffDocs(base, edited), { changed: { "c:m_1": edited["c:m_1"] }, removed: [] });

const noJob = serialize(toDocs({ ...state, apply: { ...state.apply, jobs: [state.apply.jobs[0]] } }));
const d2 = diffDocs(base, noJob);
eq("removing a job: its doc is removed and the order changes", [d2.removed, Object.keys(d2.changed)], [["aj:j2"], ["o:apply.jobs"]]);

const cell = serialize(toDocs({ ...state, patches: { ...state.patches, MS: { B19: "Taylor Kim" } } }));
eq("one cell edit = one doc", Object.keys(diffDocs(base, cell).changed), ["p:MS\u0000B19"]);

const undef = serialize(toDocs({ ...state, contacts: [{ ...state.contacts[0], email: undefined }, state.contacts[1]] }));
eq("undefined fields don't create a change", diffDocs(base, undef), { changed: {}, removed: [] });

// Two tabs each add a contact; tab B's order doc wins, tab A's contact is kept at the end.
const a = toDocs({ ...state, contacts: [...state.contacts, { id: "m_a", name: "From A", status: "new", history: [] }] });
const b = toDocs({ ...state, contacts: [...state.contacts, { id: "m_b", name: "From B", status: "new", history: [] }] });
const merged = fromDocs({ ...a, ...b, "c:m_a": a["c:m_a"] }) as { contacts: { id: string }[] };
eq("two tabs adding contacts keep both", merged.contacts.map((c) => c.id), ["s:GS:19", "m_1", "m_b", "m_a"]);
eq("a removed (tombstoned) doc doesn't come back", (fromDocs({ ...docs, "c:m_1": null }) as { contacts: { id: string }[] }).contacts.map((c) => c.id), ["s:GS:19"]);

const big = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`c:${i}`, "x".repeat(100_000)]));
const parts = batches(big, ["c:gone"], 500_000);
eq("pushes are split under the size cap", [parts.length, parts.every((p) => Object.values(p.changed).join("").length <= 500_000), parts.flatMap((p) => p.removed)], [8, true, ["c:gone"]]);

eq("unknown doc keys are refused", [validDocKey("x:1"), validDocKey(""), validDocKey("c:" + "a".repeat(700))], [false, false, false]);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);

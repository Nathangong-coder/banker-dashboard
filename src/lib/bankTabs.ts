/**
 * Every bank the dashboard tracks gets a proper tab and an OVERVIEW row:
 *  - banks on the lists (COVERAGE / OVERVIEW / WALL STREET, contacts, banks added on /coverage) with no tab get one: a
 *    copy of an existing bank tab's layout (title, banners, headers, "#" numbers, formatting, merges), no people,
 *    titled "X Application Tracker" (→ OVERVIEW) and named by a 3–4 letter ticker (KEY, GLE, TFC);
 *  - a malformed bank tab (no tracker title, e.g. a half-made "BNP" copy) is rebuilt the same way, its people moved
 *    into the Contact Information table;
 *  - tabs this app created with long names (KEYBANC) are renamed to tickers;
 *  - any bank tab not on OVERVIEW gets a linked row.
 * Everything is pending (cell patches + sheet ops) until the workbook is saved.
 *
 * OVERVIEW's own list is followed by merged banners and formulas, so new firms go in a "MORE FIRMS" block below
 * everything else instead of shifting rows (which would break those formulas and merges).
 */
import type { Contact, SheetSnapshot } from "./types";
import type { Application } from "./banks";
import { canonBank, cleanBankName } from "./banks";
import { draftFromRow, type ContactTable } from "./workbook";
import { findCoverageSheets, officeInfo, officeOf, type Office } from "./offices";
import { tabLink } from "./sheetLinks";
import { EMPTY_OPS, type SheetOps } from "./sheetOps";

export { EMPTY_OPS, type SheetOps };
export const IB_TIERS = ["Bulge Bracket", "Elite Boutique", "Middle Market", "Investment Bank"];
export const isPrivateEquity = (tier?: string) => tier === "Private Equity";

type Patch = { v: string; link?: string };
type Patches = Record<string, Record<string, Patch>>;
type Bank = { name: string; tier?: string; hidden?: boolean; applied?: Application[] };

const TRACKER = /application tracker/i;
const NON_BANK_TAB = /^(sheet\d*|overview|coverage|wall street|active bay|apps?\b.*|app \(.*|prospects)$/i;

/** canonBank key → tab name, for every tab that belongs to a bank (by its "X Application Tracker" title or its name). */
export function bankTabIndex(snaps: SheetSnapshot[]): Map<string, string> {
  const out = new Map<string, string>();
  // Main tabs first, legacy "(NY)" ones only as a fallback.
  const ordered = [...snaps].sort((a, b) => Number(/\(NY\)/i.test(a.name)) - Number(/\(NY\)/i.test(b.name)));
  for (const s of ordered) {
    const title = s.cells["1:1"]?.v ?? "";
    if (TRACKER.test(title)) {
      const key = canonBank(title.replace(/\s*application tracker.*$/i, "").replace(/\(NY\)/i, ""));
      if (!out.has(key)) out.set(key, s.name);
    }
  }
  // Tabs without a tracker title (e.g. a hand-made "BNP") count by their name. Titled tabs aren't indexed twice.
  const titled = new Set(snaps.filter((s) => TRACKER.test(s.cells["1:1"]?.v ?? "")).map((s) => s.name));
  for (const s of ordered) {
    if (titled.has(s.name) || NON_BANK_TAB.test(s.name.trim())) continue;
    const key = canonBank(s.name.replace(/\(NY\)/i, ""));
    if (key.length >= 2 && !out.has(key)) out.set(key, s.name);
  }
  return out;
}

/** The bank tab to copy: one with both tables and the fewest people in it. */
export function templateTab(snaps: SheetSnapshot[], tables: ContactTable[]): SheetSnapshot | undefined {
  const tabs = snaps.filter((s) => TRACKER.test(s.cells["1:1"]?.v ?? "") && !/\(NY\)/i.test(s.name) && tables.filter((t) => t.sheet === s.name).length >= 2);
  const filled = (s: SheetSnapshot) =>
    tables.filter((t) => t.sheet === s.name).reduce((n, t) => n + (t.lastRow - t.headerRow - t.emptyRows.length), 0);
  return tabs.sort((a, b) => filled(a) - filled(b))[0];
}

/* ---------------- tab names ---------------- */

/** Real tickers (or the street's usual short name) for firms without a tab yet. Owner-editable. */
const TICKERS: Record<string, string> = {
  keybanc: "KEY",
  "societe generale": "GLE",
  truist: "TFC",
  macquarie: "MQG",
  "brown brothers harriman": "BBH",
  scotiabank: "BNS",
  "bank of nova scotia": "BNS",
  hsbc: "HSBC",
  cibc: "CIBC",
  "credit agricole": "ACA",
  "bnp paribas": "BNP",
  smbc: "SMBC",
  mufg: "MUFG",
  stifel: "STFL",
  cowen: "COWN",
  "citizens jmp": "CFG",
  citizens: "CFG",
  canaccord: "CCG",
  "canaccord genuity": "CCG",
  needham: "NDHM",
  leerink: "LRNK",
  solomon: "SOL",
  allen: "ALLN",
  dc: "DCA",
  ducera: "DUC",
  "union square": "USQ",
  "marathon energy": "MAR",
  natixis: "KN",
  "deutsche bank": "DBK",
  "wells fargo": "WFC",
  "tudor pickering holt": "TPH",
  "goldman sachs": "GS",
  "morgan stanley": "MS",
};

/** A 3–4 letter tab name: the firm's ticker if known, else initials ("union square" → USQ) or the first 4 letters. */
export function tickerFor(bank: string, taken: Set<string>): string {
  const key = canonBank(bank);
  const words = key.split(" ").filter(Boolean);
  let base = TICKERS[key] ?? TICKERS[words[0]];
  if (!base) {
    if (words.length >= 3) base = words.map((w) => w[0]).join("").slice(0, 4);
    else if (words.length === 2) base = (words[0][0] + words[1].slice(0, 2)).slice(0, 4);
    else base = (words[0] ?? "BANK").slice(0, 4);
  }
  base = base.toUpperCase().replace(/[^A-Z0-9&]/g, "") || "BANK";
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}${i}`;
  return name;
}

/** The long name the first version gave new tabs ("KEYBANC", "SOCIETE GENERALE"), to recognize them for renaming. */
const legacyTabName = (bank: string) => (canonBank(bank) || bank).toUpperCase().replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28);

/* ---------------- copying a tab's layout ---------------- */

const mergedOver = (s: SheetSnapshot) => {
  const covered = new Set<string>();
  for (const [r1, c1, r2, c2] of s.format?.merges ?? []) for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`);
  return covered;
};

/** The template's cells for an empty copy: labels, headers and "#" numbers stay; people and merged-over cells don't. */
function emptyCopyCells(tpl: SheetSnapshot, tables: ContactTable[]): Record<string, Patch> {
  const out: Record<string, Patch> = {};
  const covered = mergedOver(tpl);
  const own = tables.filter((t) => t.sheet === tpl.name);
  for (const [key, cell] of Object.entries(tpl.cells)) {
    if (covered.has(key) || !cell.v || key === "1:1") continue;
    const [r, c] = key.split(":").map(Number);
    const t = own.find((x) => r > x.headerRow && r <= x.lastRow);
    if (t) {
      // A row whose "#" holds a number is a person slot: only the number stays. Banners ("Contact | Information") stay whole.
      const numCol = Array.from({ length: tpl.cols }, (_, i) => i + 1).find((cc) => (tpl.cells[`${t.headerRow}:${cc}`]?.v ?? "").trim() === "#");
      const slot = numCol !== undefined && /^\d+$/.test((tpl.cells[`${r}:${numCol}`]?.v ?? "").trim());
      if (slot && c !== numCol) continue;
    }
    out[key] = { v: cell.v };
  }
  return out;
}

/** Anyone in the tab's contact tables? (Merged banners repeat their text in every covered cell, so those don't count.) */
const peopleOn = (sheet: string, snaps: SheetSnapshot[], tables: ContactTable[]) => {
  const s = snaps.find((x) => x.name === sheet);
  if (!s) return false;
  const covered = mergedOver(s);
  return tables
    .filter((t) => t.sheet === sheet)
    .some((t) =>
      Object.keys(s.cells).some((k) => {
        const [r, c] = k.split(":").map(Number);
        return r > t.headerRow && r <= t.lastRow && c === t.cols.name && !covered.has(k) && !!s.cells[k].v.trim();
      }),
    );
};

/* ---------------- 1. fixes to existing tabs ---------------- */

export interface TabFixes {
  renames: { from: string; to: string; bank: string }[];
  /** Malformed tabs rebuilt from the template; people moved (old row → new row) into the Contact Information table. */
  repairs: {
    tab: string;
    bank: string;
    /** Old row → new row, with the person as read from the rebuilt row (their old record was read from the wrong columns). */
    moves: { from: number; to: number; person: { location: string; team: string; position: string; email: string; linkedin: string } }[];
    cols: ContactTable["cols"];
  }[];
  replaces: SheetOps["replaces"];
  patches: Patches;
  /** Replacement snapshots for repaired tabs (template look; values in `patches`). */
  snapshots: SheetSnapshot[];
}

const STATUS_CELL = /^(pending|sent|emailed|drafted|replied|done|followed up.*|call.*|scheduled.*|moved on|ignore.*)$/i;

export function planTabFixes(args: { snaps: SheetSnapshot[]; tables: ContactTable[]; banks: Bank[]; overviewName?: string }): TabFixes {
  const out: TabFixes = { renames: [], repairs: [], replaces: [], patches: {}, snapshots: [] };
  const { snaps, tables } = args;
  const tpl = templateTab(snaps, tables);
  if (!tpl) return out;
  const overview = snaps.find((s) => /^overview$/i.test(s.name.trim()));
  const taken = new Set(snaps.map((s) => s.name.toLowerCase()));
  const put = (sheet: string, key: string, p: Patch) => ((out.patches[sheet] ??= {})[key] = p);
  const nameFor = (key: string) => args.banks.find((b) => canonBank(b.name) === key)?.name;
  // A rebuilt tab moves next to the other bank tabs (after the last proper, non-PE one).
  const isPE = (title: string) => isPrivateEquity(args.banks.find((b) => canonBank(b.name) === canonBank(title.replace(/\s*application tracker.*$/i, "")))?.tier);
  const lastBankTab = [...snaps].reverse().find((x) => TRACKER.test(x.cells["1:1"]?.v ?? "") && !/\(NY\)/i.test(x.name) && !isPE(x.cells["1:1"]?.v ?? ""))?.name;

  for (const [key, tab] of bankTabIndex(snaps)) {
    const s = snaps.find((x) => x.name === tab)!;
    const title = s.cells["1:1"]?.v ?? "";

    // Renames: a tab this app made with a long name (title says "X Application Tracker", tab is X in capitals, no people).
    if (TRACKER.test(title)) {
      const bank = cleanBankName(title.replace(/\s*application tracker.*$/i, ""));
      if ((tab.length > 4 || tab.length < 3) && tab === legacyTabName(bank) && !peopleOn(tab, snaps, tables)) {
        taken.delete(tab.toLowerCase());
        const to = tickerFor(bank, taken);
        taken.add(to.toLowerCase());
        if (to !== tab) out.renames.push({ from: tab, to, bank });
        else taken.add(tab.toLowerCase());
      }
      continue;
    }

    // Repairs: a small bank tab with no tracker title (a half-made copy). Bigger ones are left alone.
    if (s.rows > 60) continue;
    const bank = cleanBankName(canonBank(title) === key ? title : (nameFor(key) ?? title) || tab);
    const info = tables.filter((t) => t.sheet === tpl.name).find((t) => t.cols.linkedin) ?? tables.find((t) => t.sheet === tpl.name)!;
    const own = tables.filter((t) => t.sheet === tab);
    const moves: TabFixes["repairs"][number]["moves"] = [];
    out.replaces.push({ name: tab, from: tpl.name, after: lastBankTab });
    out.snapshots.push({ name: tab, rows: tpl.rows, cols: tpl.cols, cells: {}, format: tpl.format });
    for (const [k, p] of Object.entries(emptyCopyCells(tpl, tables))) put(tab, k, p);
    put(tab, "1:1", { v: `${bank} Application Tracker`, link: overview ? tabLink(overview.name) : undefined });
    // People: any row that reads as a person, written into the Contact Information table's slots in order.
    const covered = mergedOver(s);
    let slot = info.headerRow + 1;
    for (let r = 2; r <= s.rows; r++) {
      const cell = (c: number) => (covered.has(`${r}:${c}`) ? undefined : s.cells[`${r}:${c}`]);
      // Read by content, not by the tab's own (wrong) headers: BNP's person sits under Conversation headers in Contact
      // Information order, so "Location" there is really the LinkedIn column.
      const d = draftFromRow(tab, r, s.cols, cell, []);
      if (!d || own.some((t) => t.headerRow === r)) continue;
      const texts = Array.from({ length: s.cols }, (_, i) => (cell(i + 1)?.v ?? "").trim());
      const status = texts.find((t) => STATUS_CELL.test(t)) ?? "";
      const used = new Set([d.name, d.email, d.linkedin, d.position, d.location, d.team, status, String(r - 5), ""].map((x) => x.trim()));
      const comment = d.comment || texts.filter((t) => !used.has(t) && !/^\d+$/.test(t) && !/linkedin\.com/i.test(t)).sort((a, b) => b.length - a.length)[0] || "";
      const c = info.cols;
      const set = (col: number | undefined, v: string, link?: string) => col && v && put(tab, `${slot}:${col}`, link ? { v, link } : { v });
      set(c.name, d.name);
      set(c.location, d.location);
      set(c.email, d.email, d.email ? `mailto:${d.email}` : undefined);
      set(c.position, d.position);
      set(c.linkedin, d.linkedin, d.linkedin || undefined);
      set(c.team, d.team);
      set(c.status, status);
      set(c.comment, comment);
      moves.push({ from: r, to: slot, person: { location: d.location, team: d.team, position: d.position, email: d.email, linkedin: d.linkedin } });
      slot++;
    }
    out.repairs.push({ tab, bank, moves, cols: info.cols });
  }
  return out;
}

/* ---------------- 2. new tabs + 3. OVERVIEW rows ---------------- */

export interface BankTabPlan {
  ops: SheetOps;
  patches: Patches;
  added: { bank: string; tab: string }[];
  /** Bank tabs given an OVERVIEW row (new and existing ones that weren't listed). */
  listed: string[];
  /** Banks with no tab that weren't given one, and why (shown on the Spreadsheet page). */
  skipped: { bank: string; why: string }[];
  /** Snapshots for the new tabs (template look, no values: those are in `patches`). */
  snapshots: SheetSnapshot[];
}

/**
 * Plan tabs for `banks` (name + tier) that have no tab, and OVERVIEW rows for every bank tab not listed there.
 * `snaps` = the sheets as the grid shows them (patches applied).
 */
export function planBankTabs(args: { snaps: SheetSnapshot[]; tables: ContactTable[]; banks: Bank[]; skip?: string[] }): BankTabPlan {
  const plan: BankTabPlan = { ops: { ...EMPTY_OPS, clones: [], rowStyles: [] }, patches: {}, added: [], listed: [], skipped: [], snapshots: [] };
  const { snaps, tables } = args;
  const tabs = bankTabIndex(snaps);
  const skip = new Set(args.skip ?? []);
  const seen = new Set<string>();
  const missing: Bank[] = [];
  for (const b of args.banks) {
    const k = canonBank(b.name);
    if (!k || seen.has(k) || tabs.has(k)) continue;
    seen.add(k);
    if (b.hidden) plan.skipped.push({ bank: b.name, why: "hidden on Bank coverage" });
    else if (isPrivateEquity(b.tier)) plan.skipped.push({ bank: b.name, why: "private equity" });
    else if (b.tier && !IB_TIERS.includes(b.tier)) plan.skipped.push({ bank: b.name, why: `tier "${b.tier}"` });
    else if (skip.has(k)) plan.skipped.push({ bank: b.name, why: "its new tab was undone" });
    else missing.push(b);
  }
  const tpl = templateTab(snaps, tables);
  const overview = snaps.find((s) => /^overview$/i.test(s.name.trim()));
  if (!tpl) {
    for (const b of missing) plan.skipped.push({ bank: b.name, why: "no bank tab to copy the layout from" });
    return plan;
  }

  const taken = new Set(snaps.map((s) => s.name.toLowerCase()));
  const copy = emptyCopyCells(tpl, tables);
  // After the last bank tab (not a PE one), in order.
  const tierOf = (key: string) => args.banks.find((b) => canonBank(b.name) === key)?.tier;
  const lastBankTab = [...snaps]
    .reverse()
    .find((s) => TRACKER.test(s.cells["1:1"]?.v ?? "") && !isPrivateEquity(tierOf(canonBank((s.cells["1:1"]?.v ?? "").replace(/\s*application tracker.*$/i, "")))))?.name;
  let after = lastBankTab;
  const put = (sheet: string, key: string, p: Patch) => ((plan.patches[sheet] ??= {})[key] = p);

  const newTabs: { key: string; bank: string; tab: string; tier?: string }[] = [];
  for (const b of missing) {
    const display = cleanBankName(b.name);
    const tab = tickerFor(display, taken);
    taken.add(tab.toLowerCase());
    plan.ops.clones.push({ name: tab, from: tpl.name, after, bank: display });
    after = tab;
    plan.snapshots.push({ name: tab, rows: tpl.rows, cols: tpl.cols, cells: {}, format: tpl.format });
    for (const [key, p] of Object.entries(copy)) put(tab, key, p);
    put(tab, "1:1", { v: `${display} Application Tracker`, link: overview ? tabLink(overview.name) : undefined });
    plan.added.push({ bank: display, tab });
    newTabs.push({ key: canonBank(display), bank: display, tab, tier: b.tier });
  }

  // OVERVIEW: every bank tab (new or existing, not a legacy "(NY)" one) is listed and linked.
  const head = overview && Object.entries(overview.cells).find(([, c]) => /^institution name$/i.test(c.v.trim()));
  if (!overview || !head) return plan;
  const header = Number(head[0].split(":")[0]);
  const cols: Record<string, number> = {};
  for (let c = 1; c <= overview.cols; c++) {
    const h = (overview.cells[`${header}:${c}`]?.v ?? "").trim().toLowerCase();
    if (h === "#") cols.num = c;
    else if (h === "institution name") cols.name = c;
    else if (h === "institution type") cols.type = c;
    else if (/target location/.test(h)) cols.loc = c;
  }
  if (!cols.name) return plan;
  let num = 0;
  let styleRow = header + 1;
  const listed = new Map<string, { key: string; v: string; link?: string }>();
  for (let r = header + 1; r <= overview.rows; r++) {
    const cell = overview.cells[`${r}:${cols.name}`];
    if (cell?.v.trim()) listed.set(canonBank(cleanBankName(cell.v)), { key: `${r}:${cols.name}`, v: cell.v, link: cell.link });
    const n = Number(overview.cells[`${r}:${cols.num ?? 1}`]?.v);
    if (Number.isFinite(n) && n > num && cell?.v.trim()) {
      num = n;
      styleRow = r;
    }
  }
  const linkedTabs = new Set(Object.values(overview.cells).map((c) => c.link).filter(Boolean));
  const block = Object.entries(overview.cells).find(([, c]) => /^more firms/i.test(c.v.trim()));
  let next = 0;
  const startBlock = () => {
    if (next) return;
    if (block) {
      next = Number(block[0].split(":")[0]) + 2;
      while (Object.keys(overview.cells).some((k) => k.startsWith(`${next}:`) && overview.cells[k].v.trim())) next++;
      return;
    }
    const start = overview.rows + 2;
    put(overview.name, `${start}:${cols.name}`, { v: "MORE FIRMS (added by Coverage)" });
    plan.ops.rowStyles.push({ sheet: overview.name, row: start, from: 1 });
    for (let c = 1; c <= overview.cols; c++) {
      const v = overview.cells[`${header}:${c}`]?.v;
      if (v) put(overview.name, `${start + 1}:${c}`, { v });
    }
    plan.ops.rowStyles.push({ sheet: overview.name, row: start + 1, from: header });
    next = start + 2;
  };

  const allTabs = [
    ...[...tabs].filter(([, t]) => !/\(NY\)/i.test(t)).map(([key, tab]) => {
      const s = snaps.find((x) => x.name === tab)!;
      const title = s.cells["1:1"]?.v ?? "";
      const bank = TRACKER.test(title) ? cleanBankName(title.replace(/\s*application tracker.*$/i, "")) : (args.banks.find((b) => canonBank(b.name) === key)?.name ?? title) || tab;
      return { key, bank: cleanBankName(bank), tab, tier: tierOf(key) };
    }),
    ...newTabs,
  ];
  for (const t of allTabs) {
    const link = tabLink(t.tab);
    if (linkedTabs.has(link)) continue;
    const row = listed.get(t.key);
    if (row) {
      // Listed by name but not linked (or linked to an old name): link it.
      if (row.link !== link) put(overview.name, row.key, { v: row.v, link });
      continue;
    }
    startBlock();
    const r = next++;
    num++;
    if (cols.num) put(overview.name, `${r}:${cols.num}`, { v: String(num) });
    put(overview.name, `${r}:${cols.name}`, { v: t.bank, link });
    if (cols.type && t.tier) put(overview.name, `${r}:${cols.type}`, { v: t.tier });
    const hires = (["SF", "LA", "NY", "TX"] as Office[]).filter((o) => officeInfo(t.bank, o)?.hires === true);
    if (cols.loc && hires.length) put(overview.name, `${r}:${cols.loc}`, { v: hires.map((o) => (o === "TX" ? "Texas" : o)).join(", ") });
    plan.ops.rowStyles.push({ sheet: overview.name, row: r, from: styleRow });
    plan.listed.push(t.tab);
  }
  return plan;
}

/* ---------------- 4. COVERAGE rows for firms you applied to ---------------- */

const TIER_ABBR: Record<string, string> = { "Bulge Bracket": "BB", "Elite Boutique": "EB", "Middle Market": "MM", "Investment Bank": "IB" };

/** Offices named in an application's "Target Location" ("SF/NY", "New York, San Francisco"). */
export function officesIn(location: string): Office[] {
  const found = location
    .split(/[/,&;+]|\band\b|\bor\b/i)
    .map((x) => officeOf(x.trim()))
    .filter((o): o is Office => !!o);
  return [...new Set(found)];
}

/**
 * A bank you submitted a summer analyst application to that isn't on the COVERAGE tab gets its SF / LA / NY rows there
 * (in its layout, after the last row): seats "Yes" where the application's target location says so, else "Unclear";
 * your contacts per office; a GAP / Thin / OK status like the rest of the tab; a note saying where the row came from.
 */
export function planCoverageRows(args: { snaps: SheetSnapshot[]; banks: Bank[]; contacts: Pick<Contact, "bank" | "location" | "region" | "name">[] }) {
  const out = { patches: {} as Patches, rowStyles: [] as SheetOps["rowStyles"], added: [] as string[] };
  const cov = findCoverageSheets(args.snaps)[0];
  if (!cov) return out;
  const s = args.snaps.find((x) => x.name === cov.sheet)!;
  const col = (k: string) => cov.cols.get(k);
  const listed = new Set<string>();
  // Rows this app added for an application (its note says so): kept in step with the application (office, contacts).
  const ours = new Map<string, number[]>();
  let last = cov.header;
  for (let r = cov.header + 1; r <= s.rows; r++) {
    const name = (s.cells[`${r}:${col("bank")}`]?.v ?? "").trim();
    if (name) {
      listed.add(canonBank(name));
      if (/^added by coverage from your/i.test(s.cells[`${r}:${col("notes")}`]?.v ?? "")) ours.set(canonBank(name), [...(ours.get(canonBank(name)) ?? []), r]);
      last = r;
    }
  }
  const styleRow = last > cov.header ? last : cov.header;
  let next = last + 1;
  const put = (r: number, k: string, v: string) => {
    const c = col(k);
    if (c && v) (out.patches[cov.sheet] ??= {})[`${r}:${c}`] = { v };
  };
  const seen = new Set<string>();
  const cellsFor = (b: Bank, office: Office) => {
    const key = canonBank(b.name);
    const here = args.contacts.filter((c) => canonBank(c.bank) === key && officeOf(c.location || (c.region !== "Other" ? c.region : "")) === office);
    const hires = new Set(b.applied!.flatMap((a) => officesIn(a.location))).has(office);
    return {
      hires: hires ? "Yes" : "Unclear",
      count: String(here.length),
      contacts: here.map((c) => c.name).join(", "),
      status: hires ? (here.length === 0 ? "GAP – 0 contacts" : here.length === 1 ? "Thin – 1 contact" : "OK") : "",
    };
  };
  for (const b of args.banks) {
    const key = canonBank(b.name);
    if (b.applied?.length && ours.has(key)) {
      for (const r of ours.get(key)!) {
        const office = officeOf(s.cells[`${r}:${col("office")}`]?.v ?? "");
        if (!office) continue;
        for (const [k, v] of Object.entries(cellsFor(b, office))) {
          const c = col(k);
          if (c && (s.cells[`${r}:${c}`]?.v ?? "") !== v) (out.patches[cov.sheet] ??= {})[`${r}:${c}`] = { v };
        }
      }
      continue;
    }
    if (!b.applied?.length || listed.has(key) || seen.has(key) || isPrivateEquity(b.tier)) continue;
    seen.add(key);
    const app = b.applied[0];
    for (const office of ["SF", "LA", "NY"] as Office[]) {
      const r = next++;
      const cells = cellsFor(b, office);
      put(r, "bank", cleanBankName(b.name));
      put(r, "tier", (b.tier && TIER_ABBR[b.tier]) ?? b.tier ?? "");
      put(r, "office", office);
      for (const [k, v] of Object.entries(cells)) put(r, k, v);
      put(r, "confidence", "low");
      put(r, "notes", `Added by Coverage from your ${app.program} application${app.submitted ? ` (submitted ${app.submitted})` : app.status ? ` (${app.status})` : ""}. Check which offices and teams take summer analysts.`);
      out.rowStyles.push({ sheet: cov.sheet, row: r, from: styleRow });
    }
    out.added.push(cleanBankName(b.name));
  }
  return out;
}

/**
 * Banks the dashboard knows about (COVERAGE / OVERVIEW / WALL STREET lists, contacts, banks added on /coverage) that
 * have no tab in the workbook get one: a copy of an existing bank tab's layout (title, banners, headers, "#" numbers,
 * formatting, merges) with no people in it, titled "X Application Tracker" and linked to OVERVIEW, plus a linked row
 * on OVERVIEW. Everything is pending (cell patches + sheet ops) until the workbook is saved.
 *
 * OVERVIEW's own list is followed by merged banners and formulas, so new firms go in a "MORE FIRMS" block below
 * everything else instead of shifting rows (which would break those formulas and merges).
 */
import type { SheetSnapshot } from "./types";
import { canonBank, cleanBankName } from "./banks";
import type { ContactTable } from "./workbook";
import { officeInfo, type Office } from "./offices";
import { tabLink } from "./sheetLinks";

export const IB_TIERS = ["Bulge Bracket", "Elite Boutique", "Middle Market", "Investment Bank"];
export const isPrivateEquity = (tier?: string) => tier === "Private Equity";

/** Structural changes that cell patches can't express. Applied by buildWorkbook on save. */
export interface SheetOps {
  /** New tabs: copy `from`'s layout (no values), placed after `after`. */
  clones: { name: string; from: string; after?: string; bank: string }[];
  /** Copy a row's look (styles, height) from another row on the same tab. */
  rowStyles: { sheet: string; row: number; from: number }[];
}
export const EMPTY_OPS: SheetOps = { clones: [], rowStyles: [] };

type Patch = { v: string; link?: string };
type Patches = Record<string, Record<string, Patch>>;

const TRACKER = /application tracker/i;

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
  const titled = new Set(out.values());
  for (const s of ordered) {
    if (titled.has(s.name)) continue;
    const key = canonBank(s.name.replace(/\(NY\)/i, ""));
    if (key.length >= 2 && !out.has(key) && !/^(sheet\d*|overview|coverage|wall street|active bay|apps?\b.*|prospects)$/i.test(s.name.trim())) out.set(key, s.name);
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

/** "KeyBanc Capital Markets" → "KEYBANC"; unique among existing tabs; Excel's 31-char limit and banned characters. */
export function tabNameFor(bank: string, taken: Set<string>): string {
  const base = (canonBank(bank) || bank).toUpperCase().replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "BANK";
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} ${i}`;
  return name;
}

/** The template's cells for an empty copy: labels, headers and "#" numbers stay; people and merged-over cells don't. */
function emptyCopyCells(tpl: SheetSnapshot, tables: ContactTable[]): Record<string, Patch> {
  const out: Record<string, Patch> = {};
  const covered = new Set<string>();
  for (const [r1, c1, r2, c2] of tpl.format?.merges ?? [])
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`);
  const own = tables.filter((t) => t.sheet === tpl.name);
  for (const [key, cell] of Object.entries(tpl.cells)) {
    if (covered.has(key) || !cell.v) continue;
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

export interface BankTabPlan {
  ops: SheetOps;
  patches: Patches;
  added: { bank: string; tab: string }[];
  /** Snapshots for the new tabs (template look, no values: those are in `patches`). */
  snapshots: SheetSnapshot[];
}

/**
 * Plan tabs for `banks` (name + tier) that have no tab. `snaps` = the sheets as the grid shows them (patches applied).
 */
export function planBankTabs(args: { snaps: SheetSnapshot[]; tables: ContactTable[]; banks: { name: string; tier?: string }[]; skip?: string[] }): BankTabPlan {
  const plan: BankTabPlan = { ops: { clones: [], rowStyles: [] }, patches: {}, added: [], snapshots: [] };
  const { snaps, tables } = args;
  const tabs = bankTabIndex(snaps);
  const skip = new Set(args.skip ?? []);
  const seen = new Set<string>();
  const missing = args.banks.filter((b) => {
    const k = canonBank(b.name);
    if (!k || seen.has(k) || tabs.has(k) || skip.has(k) || isPrivateEquity(b.tier) || (b.tier && !IB_TIERS.includes(b.tier))) return false;
    seen.add(k);
    return true;
  });
  const tpl = templateTab(snaps, tables);
  const overview = snaps.find((s) => /^overview$/i.test(s.name.trim()));
  if (!missing.length || !tpl) return plan;

  const taken = new Set(snaps.map((s) => s.name.toLowerCase()));
  const copy = emptyCopyCells(tpl, tables);
  // After the last bank tab, in order.
  const lastBankTab = [...snaps].reverse().find((s) => TRACKER.test(s.cells["1:1"]?.v ?? ""))?.name;
  let after = lastBankTab;
  const put = (sheet: string, key: string, p: Patch) => ((plan.patches[sheet] ??= {})[key] = p);

  // OVERVIEW: where its list is, and where the "MORE FIRMS" block goes.
  let ov: { header: number; cols: Record<string, number>; next: number; num: number; styleRow: number } | undefined;
  if (overview) {
    const head = Object.entries(overview.cells).find(([, c]) => /^institution name$/i.test(c.v.trim()));
    if (head) {
      const header = Number(head[0].split(":")[0]);
      const cols: Record<string, number> = {};
      for (let c = 1; c <= overview.cols; c++) {
        const h = (overview.cells[`${header}:${c}`]?.v ?? "").trim().toLowerCase();
        if (h === "#") cols.num = c;
        else if (h === "institution name") cols.name = c;
        else if (h === "institution type") cols.type = c;
        else if (/target location/.test(h)) cols.loc = c;
      }
      let num = 0;
      let styleRow = header + 1;
      for (let r = header + 1; r <= overview.rows; r++) {
        const n = Number(overview.cells[`${r}:${cols.num ?? 1}`]?.v);
        if (Number.isFinite(n) && n > num && (overview.cells[`${r}:${cols.name}`]?.v ?? "").trim()) {
          num = n;
          styleRow = r;
        }
      }
      // An existing block (from an earlier run) is extended; otherwise start one below everything.
      const block = Object.entries(overview.cells).find(([, c]) => /^more firms/i.test(c.v.trim()));
      let next: number;
      if (block) {
        next = Number(block[0].split(":")[0]) + 2;
        while (Object.keys(overview.cells).some((k) => k.startsWith(`${next}:`) && overview.cells[k].v.trim())) next++;
      } else {
        const start = overview.rows + 2;
        put(overview.name, `${start}:${cols.name}`, { v: "MORE FIRMS (added by Coverage)" });
        plan.ops.rowStyles.push({ sheet: overview.name, row: start, from: 1 });
        for (let c = 1; c <= overview.cols; c++) {
          const v = overview.cells[`${header}:${c}`]?.v;
          if (v) put(overview.name, `${start + 1}:${c}`, { v });
        }
        plan.ops.rowStyles.push({ sheet: overview.name, row: start + 1, from: header });
        next = start + 2;
      }
      ov = { header, cols, next, num, styleRow };
    }
  }

  for (const b of missing) {
    const display = cleanBankName(b.name);
    const tab = tabNameFor(display, taken);
    taken.add(tab.toLowerCase());
    plan.ops.clones.push({ name: tab, from: tpl.name, after, bank: display });
    after = tab;
    plan.snapshots.push({ name: tab, rows: tpl.rows, cols: tpl.cols, cells: {}, format: tpl.format });
    for (const [key, p] of Object.entries(copy)) put(tab, key, p);
    put(tab, "1:1", { v: `${display} Application Tracker`, link: overview ? tabLink(overview.name) : undefined });
    plan.added.push({ bank: display, tab });

    if (overview && ov) {
      // Already listed on OVERVIEW: just link it. Otherwise a new row in the MORE FIRMS block.
      const listed = Object.entries(overview.cells).find(
        ([k, c]) => Number(k.split(":")[1]) === ov!.cols.name && Number(k.split(":")[0]) > ov!.header && canonBank(cleanBankName(c.v)) === canonBank(display),
      );
      if (listed) {
        put(overview.name, listed[0], { v: listed[1].v, link: tabLink(tab) });
        continue;
      }
      const r = ov.next++;
      ov.num++;
      if (ov.cols.num) put(overview.name, `${r}:${ov.cols.num}`, { v: String(ov.num) });
      put(overview.name, `${r}:${ov.cols.name}`, { v: display, link: tabLink(tab) });
      if (ov.cols.type && b.tier) put(overview.name, `${r}:${ov.cols.type}`, { v: b.tier });
      const hires = (["SF", "LA", "NY", "TX"] as Office[]).filter((o) => officeInfo(display, o)?.hires === true);
      if (ov.cols.loc && hires.length) put(overview.name, `${r}:${ov.cols.loc}`, { v: hires.map((o) => (o === "TX" ? "Texas" : o)).join(", ") });
      plan.ops.rowStyles.push({ sheet: overview.name, row: r, from: ov.styleRow });
    }
  }
  return plan;
}

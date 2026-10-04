/**
 * The bank-tab upkeep as a pure function (the store action `actions.ts#ensureBankTabs` and the regression scripts
 * both run this): given the dashboard's view of the workbook, return it with
 *  1. tabs this app made with long names renamed to tickers, malformed bank tabs rebuilt (people kept),
 *  2. a new tab for every bank on the coverage list without one,
 *  3. every bank tab listed and linked on OVERVIEW,
 * plus the sheet ops buildWorkbook needs to write it. Pending changes a save rebase dropped are re-attached.
 */
import type { Contact, SheetSnapshot } from "./types";
import { canonBank } from "./banks";
import { planBankTabs, planCoverageRows, planTabFixes } from "./bankTabs";
import type { Application } from "./banks";
import { renameLink } from "./sheetLinks";
import { opsOf, type SheetOps } from "./sheetOps";
import { contactId } from "./util";
import { detectRegion } from "./region";
import { applyPatches, parseSnapshots, type ContactTable, type Patches } from "./workbook";

export interface TabChanges {
  added: { bank: string; tab: string }[];
  renamed: { from: string; to: string }[];
  repaired: string[];
  /** Bank tabs given an OVERVIEW row. */
  listed: string[];
  /** Firms you applied to, added to the COVERAGE tab. */
  coverageRows: string[];
  /** Banks with no tab that weren't given one, and why. */
  skipped: { bank: string; why: string }[];
}

export interface TabState {
  snapshots: SheetSnapshot[];
  patches: Patches;
  contacts: Contact[];
  tables: ContactTable[];
  ops: SheetOps;
}

export function insertAfter(list: SheetSnapshot[], item: SheetSnapshot, after?: string) {
  const i = after ? list.findIndex((x) => x.name === after) : -1;
  return i < 0 ? [...list, item] : [...list.slice(0, i + 1), item, ...list.slice(i + 1)];
}

/** Rename a tab in the dashboard's view of the workbook: its snapshot, patches, links to it, and contacts on it. */
function renameEverywhere(st: { snaps: SheetSnapshot[]; patches: Patches; contacts: Contact[] }, from: string, to: string) {
  const relink = (link?: string) => (link ? renameLink(link, from, to) : link);
  st.snaps = st.snaps.map((sn) => {
    const cells: SheetSnapshot["cells"] = {};
    for (const [k, c] of Object.entries(sn.cells)) cells[k] = c.link ? { ...c, link: relink(c.link) } : c;
    return { ...sn, name: sn.name === from ? to : sn.name, cells };
  });
  const patches: Patches = {};
  for (const [sheet, cells] of Object.entries(st.patches))
    patches[sheet === from ? to : sheet] = Object.fromEntries(Object.entries(cells).map(([k, p]) => [k, p.link ? { ...p, link: relink(p.link) } : p]));
  st.patches = patches;
  st.contacts = st.contacts.map((c) =>
    c.ref?.sheet === from ? { ...c, id: c.id === contactId(from, c.ref.row) ? contactId(to, c.ref.row) : c.id, ref: { ...c.ref, sheet: to } } : c,
  );
}

/** Show rows given another row's look (OVERVIEW rows added below its list) the way they'll look in Excel. */
function styleRows(snaps: SheetSnapshot[], rowStyles: SheetOps["rowStyles"]) {
  for (const x of rowStyles)
    snaps = snaps.map((sn) => {
      if (sn.name !== x.sheet || !sn.format) return sn;
      const cellStyle = { ...sn.format.cellStyle };
      for (let c = 1; c <= sn.cols; c++) {
        const st = sn.format.cellStyle[`${x.from}:${c}`];
        if (st !== undefined) cellStyle[`${x.row}:${c}`] = st;
      }
      const rowHeights = { ...sn.format.rowHeights };
      if (rowHeights[x.from]) rowHeights[x.row] = rowHeights[x.from];
      return { ...sn, format: { ...sn.format, cellStyle, rowHeights } };
    });
  return snaps;
}

/**
 * `banks` = the coverage list (name, tier, hidden). `skip` = banks whose new tab was undone. Returns the new state,
 * the cell patches for new tabs / OVERVIEW rows separately (`planPatches`, applied as grid edits so contacts sync),
 * what changed, and whether anything did.
 */
export function computeTabChanges(input: TabState, banks: { name: string; tier?: string; hidden?: boolean; applied?: Application[] }[], skip: string[] = []) {
  const ops = opsOf(structuredClone(input.ops));
  const st = { snaps: input.snapshots, patches: input.patches, contacts: input.contacts };
  const blank = (name: string, from: string) => {
    const tpl = st.snaps.find((x) => x.name === from);
    return tpl ? { name, rows: tpl.rows, cols: tpl.cols, cells: {}, format: tpl.format } : undefined;
  };

  // Pending changes the baseline lost (a save re-read the file from disk): renamed names, rebuilt tabs, new tabs.
  let reattached = false;
  for (const r of ops.renames)
    if (st.snaps.some((x) => x.name === r.from) && !st.snaps.some((x) => x.name === r.to)) {
      st.snaps = st.snaps.map((x) => (x.name === r.from ? { ...x, name: r.to } : x));
      reattached = true;
    }
  for (const r of ops.replaces) {
    const fresh = blank(r.name, r.from);
    const cur = st.snaps.find((x) => x.name === r.name);
    if (fresh && cur && Object.keys(cur.cells).length) {
      st.snaps = st.snaps.map((x) => (x.name === r.name ? fresh : x));
      reattached = true;
    }
  }
  for (const c of ops.clones)
    if (!st.snaps.some((x) => x.name === c.name)) {
      const fresh = blank(c.name, c.from);
      if (fresh) st.snaps = insertAfter(st.snaps, fresh, c.after);
      reattached = true;
    }

  // 1. Fixes to existing tabs.
  const fixes = planTabFixes({ snaps: applyPatches(st.snaps, st.patches), tables: input.tables, banks });
  for (const r of fixes.renames) {
    renameEverywhere(st, r.from, r.to);
    const pending = ops.clones.find((c) => c.name === r.from);
    if (pending) pending.name = r.to;
    else ops.renames.push({ from: r.from, to: r.to });
    for (const c of ops.clones) if (c.after === r.from) c.after = r.to;
  }
  for (const rep of fixes.repairs) {
    const fresh = fixes.snapshots.find((x) => x.name === rep.tab)!;
    const after = fixes.replaces.find((x) => x.name === rep.tab)?.after;
    st.snaps = insertAfter(st.snaps.filter((x) => x.name !== rep.tab), fresh, after);
    st.patches = { ...st.patches, [rep.tab]: fixes.patches[rep.tab] ?? {} };
    ops.replaces.push(...fixes.replaces.filter((x) => x.name === rep.tab));
    // People moved into the Contact Information table keep their dashboard history (new row = new id).
    st.contacts = st.contacts.map((c) => {
      const m = c.ref?.sheet === rep.tab ? rep.moves.find((x) => x.from === c.ref!.row) : undefined;
      if (!m) return c;
      const p = m.person;
      return {
        ...c,
        id: contactId(rep.tab, m.to),
        ref: { ...c.ref!, row: m.to, cols: rep.cols },
        location: p.location,
        team: p.team || undefined,
        region: p.location ? detectRegion(p.location) : c.region,
        position: p.position || c.position,
        email: c.email || p.email,
        linkedin: p.linkedin || c.linkedin,
      };
    });
  }
  const restructured = reattached || fixes.renames.length > 0 || fixes.repairs.length > 0;
  const tables = restructured ? parseSnapshots(applyPatches(st.snaps, st.patches)).tables : input.tables;

  // 2 + 3. New tabs and OVERVIEW rows.
  const plan = planBankTabs({ snaps: applyPatches(st.snaps, st.patches), tables, banks, skip });
  plan.ops.clones.forEach((c, i) => (st.snaps = insertAfter(st.snaps, plan.snapshots[i], c.after)));
  st.snaps = styleRows(st.snaps, plan.ops.rowStyles);
  ops.clones.push(...plan.ops.clones);
  ops.rowStyles.push(...plan.ops.rowStyles);

  // 4. Firms you submitted a summer analyst application to get rows on the COVERAGE tab.
  const cov = planCoverageRows({ snaps: applyPatches(st.snaps, st.patches), banks, contacts: st.contacts });
  for (const [sheet, cells] of Object.entries(cov.patches)) plan.patches[sheet] = { ...(plan.patches[sheet] ?? {}), ...cells };
  st.snaps = styleRows(st.snaps, cov.rowStyles);
  ops.rowStyles.push(...cov.rowStyles);

  const changes: TabChanges = {
    added: plan.added,
    renamed: fixes.renames,
    repaired: fixes.repairs.map((r) => r.tab),
    listed: plan.listed,
    coverageRows: cov.added,
    skipped: plan.skipped,
  };
  const changed = restructured || Object.keys(plan.patches).length > 0;
  return {
    changed,
    state: { snapshots: st.snaps, patches: st.patches, contacts: st.contacts, tables, ops } as TabState,
    planPatches: plan.patches,
    changes,
    /** Banks to skip next time if this change is undone. */
    undoSkip: plan.added.map((a) => canonBank(a.bank)),
  };
}

/** "Added 3 bank tabs (KEY, GLE, TFC) · renamed … · rebuilt BNP … · 4 new OVERVIEW rows" (or "" if nothing). */
export function describeTabChanges(t: TabChanges): string {
  const parts = [
    t.added.length && `added ${t.added.length} bank tab${t.added.length > 1 ? "s" : ""} (${t.added.slice(0, 5).map((a) => a.tab).join(", ")}${t.added.length > 5 ? "…" : ""})`,
    t.renamed.length && `renamed ${t.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}`,
    t.repaired.length && `rebuilt ${t.repaired.join(", ")} like the other bank tabs`,
    t.listed.length && `${t.listed.length} new OVERVIEW row${t.listed.length > 1 ? "s" : ""}`,
    t.coverageRows.length && `added ${t.coverageRows.join(", ")} to COVERAGE (you applied)`,
  ].filter(Boolean);
  if (!parts.length) return "";
  const text = parts.join(" · ");
  return `${text[0].toUpperCase()}${text.slice(1)}. Review on the Spreadsheet page, then save.`;
}

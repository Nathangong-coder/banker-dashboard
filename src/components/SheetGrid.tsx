"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import type { Contact, SheetSnapshot } from "@/lib/types";
import { draftFromRow, type Patches, type RowDraft } from "@/lib/workbook";
import { canonBank } from "@/lib/banks";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";
import { Card, toast } from "./ui";
import { AddContactModal } from "./AddContact";
import { useLocationTeamOptions } from "./LocationTeam";

const colName = (n: number) => {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const PAGE = 150;

export function SheetGrid({
  snapshots,
  extraSheets,
  patches,
  active,
  onSelectSheet,
  contacts,
}: {
  snapshots: SheetSnapshot[];
  extraSheets: string[];
  patches: Patches;
  active?: string;
  onSelectSheet: (s: string) => void;
  contacts: Contact[];
}) {
  const setCell = useStore((s) => s.setCell);
  const tables = useStore((s) => s.tables);
  const options = useLocationTeamOptions();
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [onlyContacts, setOnlyContacts] = useState(false);
  const [tabQuery, setTabQuery] = useState("");
  const [making, setMaking] = useState<RowDraft | null>(null);
  const hinted = useRef(false);

  const counts = useMemo(() => {
    const m = new Map<string, { n: number; missing: number }>();
    for (const c of contacts) {
      if (!c.ref) continue;
      const e = m.get(c.ref.sheet) ?? { n: 0, missing: 0 };
      e.n++;
      if (!c.email) e.missing++;
      m.set(c.ref.sheet, e);
    }
    return m;
  }, [contacts]);

  const snap = snapshots.find((s) => s.name === active);
  const sp = (active && patches[active]) || {};
  const contactRows = useMemo(
    () => new Map(contacts.filter((c) => c.ref?.sheet === active).map((c) => [c.ref!.row, c])),
    [contacts, active],
  );

  // Location / Team cells get a suggestion list while editing (pick one or type a new value).
  const sheetTables = useMemo(() => tables.filter((t) => t.sheet === active).sort((a, b) => b.headerRow - a.headerRow), [tables, active]);
  const suggestionsFor = (r: number, c: number) => {
    const t = sheetTables.find((x) => x.headerRow < r);
    if (!t) return undefined;
    if (c === t.cols.location && t.cols.team) return "grid-locations";
    if (c === t.cols.team) return "grid-teams";
    return undefined;
  };

  let rows = snap?.rows ?? 0;
  let cols = snap?.cols ?? 0;
  for (const k of Object.keys(sp)) {
    const [r, c] = k.split(":").map(Number);
    rows = Math.max(rows, r);
    cols = Math.max(cols, c);
  }
  cols = Math.max(cols, 6);
  const rowNums = Array.from({ length: rows }, (_, i) => i + 1).filter((r) => !onlyContacts || contactRows.has(r) || r === 1);

  const allTabs = [...snapshots.map((s) => s.name), ...extraSheets];
  // Tab search matches the tab name or its bank ("morgan" finds MS, "evercore" finds EVR and EVR (NY)).
  const tabBanks = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (sheet: string, bank: string) => {
      if (!m.has(sheet)) m.set(sheet, new Set());
      m.get(sheet)!.add(bank.toLowerCase());
    };
    for (const t of tables) add(t.sheet, t.bank);
    for (const c of contacts) if (c.ref) add(c.ref.sheet, c.bank);
    return m;
  }, [tables, contacts]);
  const q = tabQuery.trim().toLowerCase();
  const tabs = q
    ? allTabs.filter((name) => {
        if (name.toLowerCase().includes(q)) return true;
        const banks = [...(tabBanks.get(name) ?? [])];
        return banks.some((b) => b.includes(q) || (q.length >= 2 && canonBank(b) === canonBank(q)));
      })
    : allTabs;
  const openTab = (name: string) => {
    onSelectSheet(name);
    setLimit(PAGE);
  };

  // Rows that look like a person but aren't a contact yet get a "+" by the row number.
  const cellAt = (r: number, c: number) => sp[`${r}:${c}`] ?? snap?.cells[`${r}:${c}`];
  const known = useMemo(() => new Set(contacts.map((c) => `${c.name.toLowerCase()}|${c.bank.toLowerCase()}`)), [contacts]);
  /** The row read as a person: `draft` if it can become a contact, `linked` if that person is already one. */
  const rowPerson = (r: number): { draft?: RowDraft; linked: boolean } => {
    if (!active || contactRows.has(r)) return { linked: contactRows.has(r) };
    const d = draftFromRow(active, r, cols, (c) => cellAt(r, c), tables);
    if (!d) return { linked: false };
    return known.has(`${d.name.toLowerCase()}|${d.bank.toLowerCase()}`) ? { linked: true } : { draft: d, linked: false };
  };

  const commit = (r: number, key: string, value: string) => {
    const added = setCell(active!, key, value);
    if (added.length) {
      toast.ok(`${added.map((c) => c.name).join(", ")} ${added.length > 1 ? "are" : "is"} now a contact. Enrich can look up the email.`);
      return;
    }
    if (hinted.current || contactRows.has(r)) return;
    // Read the row as it is after the edit (the store has the new patch; this render's `sp` doesn't yet).
    const after = (c: number) => (`${r}:${c}` === key ? { v: value } : cellAt(r, c));
    const d = draftFromRow(active!, r, cols, after, tables);
    if (d && !known.has(`${d.name.toLowerCase()}|${d.bank.toLowerCase()}`)) {
      hinted.current = true;
      toast.info(`Row ${r} looks like a person but isn't a contact yet. Click the + next to its row number to add them.`);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line bg-[#faf9f5] px-2 py-1.5">
        <div className="relative w-44 shrink-0">
          <Search className="absolute top-2 left-2 size-3.5 text-muted" />
          <input
            value={tabQuery}
            onChange={(e) => setTabQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tabs[0]) openTab(tabs[0]);
              if (e.key === "Escape") setTabQuery("");
            }}
            placeholder="Find a tab or bank…"
            aria-label="Find a tab or bank"
            className="h-7 w-full rounded-md border border-line-2 bg-panel pr-6 pl-7 text-[12.5px] outline-none focus:border-navy"
          />
          {tabQuery && (
            <button aria-label="Clear tab search" className="absolute top-1.5 right-1.5 text-muted hover:text-ink" onClick={() => setTabQuery("")}>
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-1 gap-1 overflow-x-auto pb-0.5">
          {tabs.length === 0 && <span className="px-2 py-1 text-[12.5px] text-muted">No tab or bank matches &ldquo;{tabQuery}&rdquo;</span>}
          {tabs.map((name) => {
            const c = counts.get(name);
            return (
              <button
                key={name}
                onClick={() => openTab(name)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px]",
                  name === active ? "bg-navy text-white" : "text-ink-2 hover:bg-[#efede5]",
                )}
              >
                {name}
                {c && (
                  <span className={cn("num text-[10.5px]", name === active ? "text-white/70" : c.missing ? "text-red" : "text-muted")}>
                    {c.missing ? `${c.missing}/${c.n}` : c.n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <label className="flex shrink-0 items-center gap-1.5 px-2 text-[12px] text-ink-2">
          <input type="checkbox" className="accent-navy" checked={onlyContacts} onChange={(e) => setOnlyContacts(e.target.checked)} />
          Contact rows only
        </label>
      </div>

      <div className="max-h-[68vh] overflow-auto">
        <datalist id="grid-locations">
          {options.locations.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <datalist id="grid-teams">
          {options.teams.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <table className="grid-sheet">
          <thead>
            <tr>
              <th className="w-10" />
              {Array.from({ length: cols }, (_, i) => (
                <th key={i} style={{ minWidth: i === 0 ? 40 : 110 }}>
                  {colName(i + 1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowNums.slice(0, limit).map((r) => {
              const contact = contactRows.get(r);
              const { draft, linked } = rowPerson(r);
              return (
                <tr key={r} className={cn(contact && "hover:bg-[#fbfaf6]")} title={contact ? `${contact.name} · ${contact.status}` : undefined}>
                  <th className={cn("group", linked && "font-semibold text-navy")}>
                    {draft ? (
                      <button
                        className="flex w-full items-center justify-center rounded text-muted hover:bg-navy hover:text-white"
                        title={`Make ${draft.name || "this row"} a contact`}
                        aria-label={`Make row ${r} a contact`}
                        onClick={() => setMaking(draft)}
                      >
                        <span className="group-hover:hidden">{r}</span>
                        <Plus className="hidden size-3.5 group-hover:block" />
                      </button>
                    ) : (
                      r
                    )}
                  </th>
                  {Array.from({ length: cols }, (_, ci) => {
                    const c = ci + 1;
                    const key = `${r}:${c}`;
                    const patched = sp[key];
                    const cell = patched ?? snap?.cells[key];
                    const isEmail = patched && /@/.test(patched.v);
                    if (editing === key) {
                      return (
                        <td key={c} className="p-0!">
                          <input
                            autoFocus
                            list={suggestionsFor(r, c)}
                            defaultValue={cell?.v ?? ""}
                            className="h-[25px] w-full min-w-[160px] border-2 border-navy px-1.5 outline-none"
                            onBlur={(e) => {
                              if (e.target.value !== (cell?.v ?? "")) commit(r, key, e.target.value);
                              setEditing(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setEditing(null);
                            }}
                          />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={c}
                        onDoubleClick={() => setEditing(key)}
                        title={cell?.v}
                        className={cn(
                          patched && (isEmail ? "bg-green-soft text-green" : "bg-brass-soft"),
                          r === 1 && "font-semibold",
                        )}
                      >
                        {cell?.link && /^https?:/.test(cell.link) ? (
                          <a href={cell.link} target="_blank" rel="noreferrer" className="text-blue hover:underline">
                            {cell.v || cell.link}
                          </a>
                        ) : (
                          cell?.v
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rowNums.length > limit && (
          <div className="p-3 text-center">
            <button className="text-[12.5px] text-navy hover:underline" onClick={() => setLimit(limit + PAGE * 2)}>
              Show more rows ({rowNums.length - limit} hidden)
            </button>
          </div>
        )}
        {!snap && Object.keys(sp).length === 0 &&<div className="p-8 text-center text-muted">No data on this tab.</div>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-green-soft ring-1 ring-green/30" /> Email found by enrichment</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-brass-soft ring-1 ring-brass/30" /> Changed here, not saved yet</span>
        <span>Double-click a cell to edit it.</span>
        <span>
          <b className="text-navy">Bold blue</b> row numbers are contacts. Hover any other row number and click <Plus className="inline size-3" /> to make
          that row a contact.
        </span>
      </div>
      <AddContactModal
        open={!!making}
        onClose={() => setMaking(null)}
        row={making?.ref}
        initial={
          making
            ? {
                name: making.name,
                bank: making.bank,
                email: making.email,
                linkedin: making.linkedin,
                position: making.position,
                location: making.location,
                team: making.team,
                comment: making.comment,
              }
            : undefined
        }
      />
    </Card>
  );
}

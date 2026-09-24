"use client";

import { useMemo, useState } from "react";
import type { Contact, SheetSnapshot } from "@/lib/types";
import type { Patches } from "@/lib/workbook";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";
import { Card } from "./ui";

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
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [onlyContacts, setOnlyContacts] = useState(false);

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

  let rows = snap?.rows ?? 0;
  let cols = snap?.cols ?? 0;
  for (const k of Object.keys(sp)) {
    const [r, c] = k.split(":").map(Number);
    rows = Math.max(rows, r);
    cols = Math.max(cols, c);
  }
  cols = Math.max(cols, 6);
  const rowNums = Array.from({ length: rows }, (_, i) => i + 1).filter((r) => !onlyContacts || contactRows.has(r) || r === 1);

  const tabs = [...snapshots.map((s) => s.name), ...extraSheets];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line bg-[#faf9f5] px-2 py-1.5">
        <div className="flex flex-1 gap-1 overflow-x-auto pb-0.5">
          {tabs.map((name) => {
            const c = counts.get(name);
            return (
              <button
                key={name}
                onClick={() => {
                  onSelectSheet(name);
                  setLimit(PAGE);
                }}
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
              return (
                <tr key={r} className={cn(contact && "hover:bg-[#fbfaf6]")} title={contact ? `${contact.name} · ${contact.status}` : undefined}>
                  <th className={cn(contact && "text-navy")}>{r}</th>
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
                            defaultValue={cell?.v ?? ""}
                            className="h-[25px] w-full min-w-[160px] border-2 border-navy px-1.5 outline-none"
                            onBlur={(e) => {
                              if (e.target.value !== (cell?.v ?? "")) setCell(active!, key, e.target.value);
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
      <div className="flex gap-4 border-t border-line px-3 py-2 text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-green-soft ring-1 ring-green/30" /> Email found by enrichment</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-brass-soft ring-1 ring-brass/30" /> Changed here, not saved yet</span>
        <span>Double-click a cell to edit it.</span>
      </div>
    </Card>
  );
}

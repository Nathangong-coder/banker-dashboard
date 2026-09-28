"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCopy, Eraser, Plus, Rows3, Search, Trash2, Undo2, UserPlus, X } from "lucide-react";
import type { Contact, SheetSnapshot } from "@/lib/types";
import { draftFromRow, type CellPatch, type Patches, type RowDraft } from "@/lib/workbook";
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
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/** Anchor (where the selection started) and focus (the active cell), both as positions in the visible grid. */
type Sel = { ar: number; ac: number; fr: number; fc: number };
type Menu = { x: number; y: number; row: number };

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
  const applyCellEdits = useStore((s) => s.applyCellEdits);
  const shiftRows = useStore((s) => s.shiftRows);
  const undoGrid = useStore((s) => s.undoGrid);
  const canUndo = useStore((s) => s.gridUndo.length > 0);
  const tables = useStore((s) => s.tables);
  const options = useLocationTeamOptions();
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState<Sel | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; initial?: string } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [onlyContacts, setOnlyContacts] = useState(false);
  const [tabQuery, setTabQuery] = useState("");
  const [making, setMaking] = useState<RowDraft | null>(null);
  const hinted = useRef(false);
  const dragging = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const afterEdit = useRef<{ fr: number; fc: number } | null>(null);
  const cancelEdit = useRef(false);

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
  // A few blank rows past the end so there's always room to type the next person.
  const rowNums = Array.from({ length: rows + 5 }, (_, i) => i + 1).filter((r) => !onlyContacts || contactRows.has(r) || r === 1);
  const visible = rowNums.slice(0, limit);

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
    setSel(null);
    setEditing(null);
  };

  // Rows that look like a person but aren't a contact yet get a "+" by the row number.
  const cellAt = (r: number, c: number): CellPatch | undefined => sp[`${r}:${c}`] ?? snap?.cells[`${r}:${c}`];
  const text = (r: number, c: number) => cellAt(r, c)?.v ?? "";
  const known = useMemo(() => new Set(contacts.map((c) => `${c.name.toLowerCase()}|${c.bank.toLowerCase()}`)), [contacts]);
  /** The row read as a person: `draft` if it can become a contact, `linked` if that person is already one. */
  const rowPerson = (r: number): { draft?: RowDraft; linked: boolean } => {
    if (!active || contactRows.has(r)) return { linked: contactRows.has(r) };
    const d = draftFromRow(active, r, cols, (c) => cellAt(r, c), tables);
    if (!d) return { linked: false };
    return known.has(`${d.name.toLowerCase()}|${d.bank.toLowerCase()}`) ? { linked: true } : { draft: d, linked: false };
  };

  /* ---------- selection helpers (positions are indexes into `visible` rows and 1-based columns) ---------- */
  const range = sel && {
    r1: Math.min(sel.ar, sel.fr),
    r2: Math.max(sel.ar, sel.fr),
    c1: Math.min(sel.ac, sel.fc),
    c2: Math.max(sel.ac, sel.fc),
  };
  const inRange = (i: number, c: number) => !!range && i >= range.r1 && i <= range.r2 && c >= range.c1 && c <= range.c2;
  const selRows = range ? visible.slice(range.r1, range.r2 + 1) : [];
  const focusRow = sel ? visible[sel.fr] : undefined;
  const clampRow = (i: number) => Math.max(0, Math.min(visible.length - 1, i));
  const clampCol = (c: number) => Math.max(1, Math.min(cols, c));
  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });

  useEffect(() => {
    if (!sel) return;
    gridRef.current?.querySelector(`[data-pos="${sel.fr}:${sel.fc}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  /* ---------- edits ---------- */
  const announce = (added: Contact[], r?: number, after?: (c: number) => CellPatch | undefined) => {
    if (added.length) {
      toast.ok(`${added.map((c) => c.name).join(", ")} ${added.length > 1 ? "are" : "is"} now a contact. Enrich can look up the email.`);
      return;
    }
    if (hinted.current || r === undefined || contactRows.has(r) || !after) return;
    const d = draftFromRow(active!, r, cols, after, tables);
    if (d && !known.has(`${d.name.toLowerCase()}|${d.bank.toLowerCase()}`)) {
      hinted.current = true;
      toast.info(`Row ${r} looks like a person but isn't a contact yet. Click the + next to its row number to add them.`);
    }
  };

  const commit = (r: number, c: number, value: string) => {
    if (value === text(r, c)) return;
    const key = `${r}:${c}`;
    const added = applyCellEdits({ [active!]: { [key]: { v: value } } });
    // Read the row as it is after the edit (the store has the new patch; this render's `sp` doesn't yet).
    announce(added, r, (cc) => (cc === c ? { v: value } : cellAt(r, cc)));
  };

  const clearRange = () => {
    if (!range || !active) return;
    const edits: Record<string, CellPatch> = {};
    for (const r of selRows) for (let c = range.c1; c <= range.c2; c++) if (text(r, c) || cellAt(r, c)?.link) edits[`${r}:${c}`] = { v: "" };
    if (Object.keys(edits).length) applyCellEdits({ [active]: edits });
  };

  const copyText = () => {
    if (!range) return "";
    return selRows.map((r) => Array.from({ length: range.c2 - range.c1 + 1 }, (_, i) => text(r, range.c1 + i)).join("\t")).join("\n");
  };

  const paste = (raw: string) => {
    if (!range || !active) return;
    const grid = raw.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((line) => line.split("\t"));
    const edits: Record<string, CellPatch> = {};
    const single = grid.length === 1 && grid[0].length === 1;
    if (single) {
      // One value into a selected block fills the block, like Excel.
      for (const r of selRows) for (let c = range.c1; c <= range.c2; c++) edits[`${r}:${c}`] = { v: grid[0][0] };
    } else {
      grid.forEach((line, i) => {
        const r = visible[range.r1 + i] ?? visible[visible.length - 1] + (range.r1 + i - visible.length + 1);
        line.forEach((v, j) => {
          const c = range.c1 + j;
          if (c <= Math.max(cols, 40)) edits[`${r}:${c}`] = { v };
        });
      });
    }
    const added = applyCellEdits({ [active]: edits });
    announce(added);
    if (!single) setSel({ ar: range.r1, ac: range.c1, fr: clampRow(range.r1 + grid.length - 1), fc: clampCol(range.c1 + Math.max(...grid.map((l) => l.length)) - 1) });
  };

  const undo = () => {
    if (undoGrid()) toast.info("Undone.");
    else toast.info("Nothing to undo.");
  };

  const rowOp = (mode: "delete" | "insert-above" | "insert-below" | "clear", rowsArg?: number[]) => {
    if (!active) return;
    const target = rowsArg ?? (selRows.length ? selRows : focusRow ? [focusRow] : []);
    if (!target.length) return;
    const top = Math.min(...target);
    const bottom = Math.max(...target);
    const count = bottom - top + 1;
    setMenu(null);
    if (mode === "clear") {
      const edits: Record<string, CellPatch> = {};
      for (let r = top; r <= bottom; r++) for (let c = 1; c <= cols; c++) if (text(r, c) || cellAt(r, c)?.link) edits[`${r}:${c}`] = { v: "" };
      if (Object.keys(edits).length) applyCellEdits({ [active]: edits });
      return;
    }
    const res =
      mode === "delete"
        ? shiftRows(active, top, count, "delete")
        : shiftRows(active, mode === "insert-above" ? top : bottom + 1, count, "insert");
    if (res.error) return toast.err(res.error);
    const what = mode === "delete" ? `Deleted ${count > 1 ? `rows ${top}–${bottom}` : `row ${top}`}` : `Inserted ${count} row${count > 1 ? "s" : ""}`;
    const extra = [
      res.removed.length ? `Removed ${res.removed.join(", ")} from contacts.` : "",
      res.detached.length ? `Kept ${res.detached.join(", ")} as dashboard-only contacts (they have outreach history).` : "",
    ].filter(Boolean);
    toast.ok(`${what}. ${extra.join(" ")} ${isMac ? "⌘" : "Ctrl+"}Z undoes it.`);
  };

  /* ---------- keyboard ---------- */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || !sel) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !editing) {
        e.preventDefault();
        undo();
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const move = (dr: number, dc: number, extend = e.shiftKey) => {
      e.preventDefault();
      const fr = clampRow(sel.fr + dr);
      const fc = clampCol(sel.fc + dc);
      setSel(extend ? { ...sel, fr, fc } : { ar: fr, ac: fc, fr, fc });
    };
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      return undo();
    }
    if (mod && e.key === "-") {
      e.preventDefault();
      return rowOp("delete");
    }
    if (mod && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      return rowOp("insert-above");
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      return setSel({ ar: 0, ac: 1, fr: visible.length - 1, fc: cols });
    }
    switch (e.key) {
      case "ArrowUp":
        return move(mod ? -visible.length : -1, 0);
      case "ArrowDown":
        return move(mod ? visible.length : 1, 0);
      case "ArrowLeft":
        return move(0, mod ? -cols : -1);
      case "ArrowRight":
        return move(0, mod ? cols : 1);
      case "Tab":
        return move(0, e.shiftKey ? -1 : 1, false);
      case "PageDown":
        return move(20, 0);
      case "PageUp":
        return move(-20, 0);
      case "Home":
        return move(0, -cols);
      case "End":
        return move(0, cols);
      case "Enter":
      case "F2":
        e.preventDefault();
        return setEditing({ r: visible[sel.fr], c: sel.fc });
      case "Delete":
      case "Backspace":
        e.preventDefault();
        return clearRange();
      case "Escape":
        return setSel(null);
    }
    // Typing on a selected cell starts editing it with that character, like Excel.
    if (e.key.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      setEditing({ r: visible[sel.fr], c: sel.fc, initial: e.key });
    }
  };

  const selectCell = (i: number, c: number, extend: boolean) => {
    setSel((s) => (extend && s ? { ...s, fr: i, fc: c } : { ar: i, ac: c, fr: i, fc: c }));
    setEditing(null);
    focusGrid();
  };
  const selectRow = (i: number, extend: boolean) => {
    setSel((s) => (extend && s ? { ar: s.ar, ac: 1, fr: i, fc: cols } : { ar: i, ac: 1, fr: i, fc: cols }));
    setEditing(null);
    focusGrid();
  };

  const focusText = focusRow !== undefined && sel ? text(focusRow, sel.fc) : "";
  const focusAddr = focusRow !== undefined && sel ? `${colName(sel.fc)}${focusRow}` : "";
  const rangeLabel =
    range && (range.r1 !== range.r2 || range.c1 !== range.c2)
      ? `${colName(range.c1)}${visible[range.r1]}:${colName(range.c2)}${visible[range.r2]}`
      : focusAddr;
  const menuDraft = menu ? rowPerson(menu.row).draft : undefined;

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

      {/* Formula bar: the active cell's address and full text, editable. Row actions for the selection. */}
      <div className="flex items-center gap-2 border-b border-line px-2 py-1">
        <span className="num w-20 shrink-0 truncate rounded bg-[#efede5] px-1.5 py-0.5 text-center text-[11.5px] text-ink-2" title="Selected cell">
          {rangeLabel || "—"}
        </span>
        <input
          // Re-mount when the cell or its value changes (undo, paste, row shifts) so the bar never shows stale text.
          key={`${focusAddr}|${focusText}`}
          disabled={!sel}
          defaultValue={focusText}
          placeholder={sel ? "" : "Click a cell to select it"}
          aria-label="Cell contents"
          className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 text-[12.5px] outline-none focus:border-navy focus:bg-panel disabled:text-muted"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
              focusGrid();
            }
            if (e.key === "Escape") {
              (e.target as HTMLInputElement).value = focusText;
              focusGrid();
            }
          }}
          onBlur={(e) => focusRow !== undefined && sel && commit(focusRow, sel.fc, e.target.value)}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <ToolButton label="Insert row above" disabled={!sel} onClick={() => rowOp("insert-above")} icon={<Rows3 className="size-3.5" />} />
          <ToolButton label={selRows.length > 1 ? `Delete ${selRows.length} rows` : "Delete row"} disabled={!sel} onClick={() => rowOp("delete")} icon={<Trash2 className="size-3.5" />} />
          <ToolButton label="Clear selected cells" disabled={!sel} onClick={clearRange} icon={<Eraser className="size-3.5" />} />
          <ToolButton label="Undo" disabled={!canUndo} onClick={undo} icon={<Undo2 className="size-3.5" />} />
        </div>
      </div>

      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={(e) => {
          if (editing || !range) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", copyText());
        }}
        onCut={(e) => {
          if (editing || !range) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", copyText());
          clearRange();
        }}
        onPaste={(e) => {
          if (editing || !range) return;
          e.preventDefault();
          paste(e.clipboardData.getData("text/plain"));
        }}
        className="max-h-[68vh] overflow-auto outline-none select-none"
      >
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
                <th key={i} style={{ minWidth: i === 0 ? 40 : 110 }} className={cn(range && i + 1 >= range.c1 && i + 1 <= range.c2 && "bg-[#e3e0d4]! text-ink!")}>
                  {colName(i + 1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const contact = contactRows.get(r);
              const { draft, linked } = rowPerson(r);
              const rowSelected = !!range && i >= range.r1 && i <= range.r2;
              return (
                <tr key={r} title={contact ? `${contact.name} · ${contact.status}` : undefined}>
                  <th
                    className={cn("group cursor-pointer", linked && "font-semibold text-navy", rowSelected && "bg-[#e3e0d4]!")}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      selectRow(i, e.shiftKey);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (!rowSelected) selectRow(i, false);
                      setMenu({ x: e.clientX, y: e.clientY, row: r });
                    }}
                  >
                    {draft ? (
                      <button
                        className="flex w-full items-center justify-center rounded text-muted hover:bg-navy hover:text-white"
                        title={`Make ${draft.name || "this row"} a contact`}
                        aria-label={`Make row ${r} a contact`}
                        onMouseDown={(e) => e.stopPropagation()}
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
                    const focused = sel?.fr === i && sel.fc === c;
                    if (editing?.r === r && editing.c === c) {
                      return (
                        <td key={c} className="p-0!">
                          <input
                            autoFocus
                            list={suggestionsFor(r, c)}
                            defaultValue={editing.initial ?? cell?.v ?? ""}
                            onFocus={(e) => {
                              const n = e.target.value.length;
                              e.target.setSelectionRange(n, n);
                            }}
                            className="h-[25px] w-full min-w-[160px] border-2 border-navy px-1.5 outline-none"
                            onBlur={(e) => {
                              // Escape sets `cancelEdit`; Enter/Tab set where to go next. Either way blur is the one commit point.
                              if (!cancelEdit.current) commit(r, c, e.target.value);
                              cancelEdit.current = false;
                              setEditing(null);
                              const next = afterEdit.current;
                              afterEdit.current = null;
                              if (next) {
                                setSel({ ar: next.fr, ac: next.fc, ...next });
                                focusGrid();
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Tab") {
                                e.preventDefault();
                                afterEdit.current = e.key === "Enter" ? { fr: clampRow(i + (e.shiftKey ? -1 : 1)), fc: c } : { fr: i, fc: clampCol(c + (e.shiftKey ? -1 : 1)) };
                                (e.target as HTMLInputElement).blur();
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEdit.current = true;
                                afterEdit.current = { fr: i, fc: c };
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                          />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={c}
                        data-pos={`${i}:${c}`}
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          dragging.current = true;
                          selectCell(i, c, e.shiftKey);
                        }}
                        onMouseEnter={() => dragging.current && setSel((s) => (s ? { ...s, fr: i, fc: c } : s))}
                        onDoubleClick={() => setEditing({ r, c })}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (!inRange(i, c)) selectCell(i, c, false);
                          setMenu({ x: e.clientX, y: e.clientY, row: r });
                        }}
                        title={cell?.v}
                        className={cn(
                          "cursor-cell",
                          patched && (isEmail ? "bg-green-soft text-green" : "bg-brass-soft"),
                          r === 1 && "font-semibold",
                          inRange(i, c) && !focused && "bg-blue-soft/70!",
                          focused && "outline-2 -outline-offset-2 outline-navy",
                        )}
                      >
                        {cell?.link && /^https?:/.test(cell.link) ? (
                          <a href={cell.link} target="_blank" rel="noreferrer" className="text-blue hover:underline" onMouseDown={(e) => e.stopPropagation()}>
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
        {!snap && Object.keys(sp).length === 0 && <div className="p-8 text-center text-muted">No data on this tab.</div>}
      </div>

      {menu && (
        <div
          role="menu"
          className="fixed z-50 min-w-52 rounded-lg border border-line bg-panel py-1 text-[12.5px] shadow-xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 260) }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem icon={<Rows3 className="size-3.5" />} label="Insert row above" hint={`${isMac ? "⌘" : "Ctrl"} +`} onClick={() => rowOp("insert-above")} />
          <MenuItem icon={<Rows3 className="size-3.5" />} label="Insert row below" onClick={() => rowOp("insert-below")} />
          <MenuItem
            icon={<Trash2 className="size-3.5" />}
            label={selRows.length > 1 ? `Delete ${selRows.length} rows` : "Delete row"}
            hint={`${isMac ? "⌘" : "Ctrl"} −`}
            danger
            onClick={() => rowOp("delete")}
          />
          <MenuItem icon={<Eraser className="size-3.5" />} label="Clear row contents" onClick={() => rowOp("clear")} />
          <div className="my-1 border-t border-line" />
          <MenuItem
            icon={<ClipboardCopy className="size-3.5" />}
            label="Copy"
            hint={`${isMac ? "⌘" : "Ctrl+"}C`}
            onClick={() => {
              navigator.clipboard?.writeText(copyText()).catch(() => toast.err("Couldn't copy. Use Ctrl+C instead."));
              setMenu(null);
            }}
          />
          {menuDraft && (
            <MenuItem
              icon={<UserPlus className="size-3.5" />}
              label={`Make ${menuDraft.name || "row"} a contact`}
              onClick={() => {
                setMaking(menuDraft);
                setMenu(null);
              }}
            />
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-green-soft ring-1 ring-green/30" /> Email found by enrichment</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-brass-soft ring-1 ring-brass/30" /> Changed here, not saved yet</span>
        <span>
          Click to select, drag or Shift for a range, type or double-click to edit. Copy/paste works with Excel. Right-click a row for insert/delete.
        </span>
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

function ToolButton({ label, icon, onClick, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1.5 text-ink-2 hover:bg-[#efede5] hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {icon}
    </button>
  );
}

function MenuItem({ icon, label, hint, onClick, danger }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#f0eee7]", danger && "text-red")}>
      <span className="text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="num text-[11px] text-muted">{hint}</span>}
    </button>
  );
}

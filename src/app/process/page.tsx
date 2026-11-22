"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronRight, EyeOff, Plus, Search, Settings2, Star, Trash2, Undo2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { tierRank } from "@/lib/coverage";
import { canonBank } from "@/lib/banks";
import { healthColor } from "@/lib/bankHealth";
import { PROCESS_COLUMNS, columnsOf, type ProcessColumn } from "@/lib/processTracker";
import { cn, fmtDate } from "@/lib/util";
import { Button, Card, Empty, Input, Menu, Modal, PageHeader, Segmented, Select, toast } from "@/components/ui";
import { BankDetail, NextStep } from "@/components/BankDetail";
import { moveToColumn, setColor, setFirmKind, setTarget, toggleStar, useBankViews, type BankView } from "@/components/useBankViews";
import type { Cycle } from "@/lib/processTracker";

/**
 * Process tracker (owner, 2026-11-21): every bank on your list as a card on a left-to-right process (a flowchart of
 * steps), dragged to the step it's at. A card's color is how it's going (white = not started, red = going badly,
 * green = chats / a referral); its foot sums up chats, emails vs. your target and the application; opening it shows
 * the relationship and urgency scores out of 100. Stars mark the banks you track most (first in each step, and in
 * the 9 PM text). Bank coverage keeps the outreach to-dos, analytics and settings.
 */
type Show = "all" | "starred" | "active";
const SHOW_KEY = "process:show";

function loadShow(): Show {
  try {
    const v = localStorage.getItem(SHOW_KEY);
    return v === "starred" || v === "all" ? v : "active";
  } catch {
    return "active";
  }
}

export default function ProcessPage() {
  const router = useRouter();
  // Summer 2028 (junior, the one you're recruiting for) by default; 2027 programs are their own board.
  const [cycleYear, setCycleYear] = useState<number | undefined>(undefined);
  const { views: all, cycle } = useBankViews(false, cycleYear);
  const [showOther, setShowOther] = useState(false);
  const otherCount = all.filter((v) => v.other && v.inCycle).length;
  const views = useMemo(() => all.filter((v) => v.inCycle && (showOther || !v.other)), [all, showOther]);
  const coverage = useStore((s) => s.coverage);
  const setCoverage = useStore((s) => s.setCoverage);
  const workbook = useStore((s) => s.workbook);
  const cols = columnsOf(coverage);
  const [show, setShowState] = useState<Show>(loadShow);
  const setShow = (v: Show) => {
    setShowState(v);
    try {
      localStorage.setItem(SHOW_KEY, v);
    } catch {}
  };
  const [tier, setTier] = useState("");
  const [kind, setKind] = useState<"ib" | "pe" | "">("");
  const [q, setQ] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<BankView | null>(null);
  const [editCols, setEditCols] = useState(false);
  const [moreIn, setMoreIn] = useState<Set<string>>(new Set());

  const tiers = useMemo(() => [...new Set(views.map((v) => v.r.tier).filter(Boolean) as string[])].sort((a, b) => tierRank(a) - tierRank(b)), [views]);
  const ql = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      views.filter((v) => {
        if (ql) return v.r.name.toLowerCase().includes(ql) || v.r.key.includes(canonBank(ql));
        if (show === "starred" && !v.starred) return false;
        // "Active": something has happened (any column past the first), you starred it, or it's a top-tier bank.
        if (show === "active" && !v.starred && v.column.id === cols[0].id && tierRank(v.r.tier) > 1 && !v.health.emailed) return false;
        if (tier && v.r.tier !== tier) return false;
        if (kind && (kind === "pe") !== v.pe) return false;
        return true;
      }),
    [views, ql, show, tier, kind, cols],
  );
  const sortIn = (list: BankView[]) =>
    [...list].sort(
      (a, b) => Number(b.starred) - Number(a.starred) || (b.health.score ?? -1) - (a.health.score ?? -1) || tierRank(a.r.tier) - tierRank(b.r.tier) || a.r.name.localeCompare(b.r.name),
    );
  const byCol = (id: string) => sortIn(shown.filter((v) => v.column.id === id));
  const starredCount = views.filter((v) => v.starred).length;
  const hiddenMatch = ql ? coverage.hidden.filter((k) => k.includes(canonBank(ql))) : [];

  const drop = (column: ProcessColumn, key: string) => {
    const v = views.find((x) => x.r.key === key);
    if (!v || v.column.id === column.id) return;
    moveToColumn(key, column.id, cycle);
    toast.ok(`${v.r.name} → ${column.label}${cycle.cycle !== cycle.target ? ` (Summer ${cycle.cycle})` : ""}.`);
  };

  if (!views.length && !workbook)
    return (
      <>
        <PageHeader title="Process tracker" />
        <Card>
          <Empty title="No banks yet">
            Upload your spreadsheet or add banks on Bank coverage → Settings, then drag them through your process here.
            <div className="mt-4">
              <Link href="/coverage?tab=settings" className="inline-flex items-center gap-1.5 rounded-lg bg-brass-strong px-3.5 py-2 text-[13.5px] font-medium text-white hover:bg-brass-hover">
                Add banks
              </Link>
            </div>
          </Empty>
        </Card>
      </>
    );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <PageHeader
        title="Process tracker"
        sub="Every bank you're working on, from first email to offer. Drag a bank to the step it's at; the color shows how it's going."
        right={
          <Menu
            items={[
              { label: "Edit steps", hint: "Rename, add or remove columns", icon: <Settings2 />, onClick: () => setEditCols(true) },
              { label: "Bank coverage", hint: "Offices to fill, analytics, settings", onClick: () => router.push("/coverage") },
            ]}
          />
        }
      />

      <Legend />

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Segmented
          value={String(cycle.cycle)}
          onChange={(v) => setCycleYear(Number(v) === cycle.target ? undefined : Number(v))}
          options={[
            [String(cycle.target), `Summer ${cycle.target}`],
            [String(cycle.target - 1), `Summer ${cycle.target - 1}`],
          ]}
        />
        <Segmented
          value={show}
          onChange={setShow}
          options={[
            ["active", "Active"],
            ["starred", `Starred ${starredCount}`],
            ["all", `All ${views.length}`],
          ]}
        />
        {tiers.length > 1 && (
          <Select className="h-8" value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Tier">
            <option value="">All tiers</option>
            {tiers.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        )}
        {views.some((v) => v.pe) && (
          <Select className="h-8" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Firm type">
            <option value="">Banks + PE</option>
            <option value="ib">Investment banks</option>
            <option value="pe">Private equity</option>
          </Select>
        )}
        {otherCount > 0 && (
          <button
            type="button"
            aria-pressed={showOther}
            onClick={() => setShowOther((v) => !v)}
            className={cn("rounded-full border px-2.5 py-1 text-[12px]", showOther ? "border-navy bg-navy text-white" : "border-line-2 text-ink-2 hover:border-navy/50")}
            title="Firms that aren't banks by your lists (e.g. a consultancy). Mark one as a bank from its ⋯ menu."
          >
            Other firms {otherCount}
          </button>
        )}
        <div className="flex-1" />
        <div className="relative w-56 max-sm:w-full">
          <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted" />
          <Input className="h-8 pl-8" placeholder="Find any bank on your list…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a bank" />
        </div>
      </Card>

      {ql && !shown.length && (
        <Card className="px-4 py-3 text-[13px] text-ink-2">
          {hiddenMatch.length ? (
            <span>
              &quot;{q}&quot; is hidden from your list.{" "}
              <button className="font-medium text-navy hover:underline" onClick={() => setCoverage((c) => ({ ...c, hidden: c.hidden.filter((k) => !hiddenMatch.includes(k)) }))}>
                Show it again
              </button>
            </span>
          ) : (
            <span>
              No bank called &quot;{q}&quot; on your list.{" "}
              <button
                className="font-medium text-navy hover:underline"
                onClick={() => {
                  setCoverage((c) => ({ ...c, added: [...c.added, { name: q.trim(), tier: "Elite Boutique", source: "manual" }] }));
                  toast.ok(`Added ${q.trim()}. Set its tier on Bank coverage → Settings.`);
                }}
              >
                Add {q.trim()}
              </button>
            </span>
          )}
        </Card>
      )}

      {/* The process, left to right: each step a lane, an arrow to the next. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-2" style={{ scrollSnapType: "x proximity" }}>
        <ol className="flex min-w-max items-stretch gap-0">
          {cols.map((col, i) => {
            const list = byCol(col.id);
            const limit = moreIn.has(col.id) ? list.length : 14;
            return (
              <li key={col.id} className="flex items-stretch" style={{ scrollSnapAlign: "start" }}>
                <section
                  aria-label={col.label}
                  className={cn("flex w-[248px] flex-col rounded-xl border bg-subtle/60 p-2 transition-colors", over === col.id ? "border-navy bg-blue-soft/40" : "border-line")}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes("text/x-bank")) return;
                    e.preventDefault();
                    setOver(col.id);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(null);
                    drop(col, e.dataTransfer.getData("text/x-bank"));
                  }}
                >
                  <header className="mb-2 rounded-lg border border-line bg-panel px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="num grid size-5 shrink-0 place-items-center rounded-full bg-navy text-[11px] font-medium text-white">{i + 1}</span>
                      <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{col.label}</h2>
                      <span className="num text-[12.5px] text-muted">{list.length}</span>
                    </div>
                    {col.hint && <p className="mt-0.5 pl-7 text-[11.5px] leading-snug text-muted">{col.hint}</p>}
                  </header>
                  <ul className="flex flex-1 flex-col gap-2">
                    {list.slice(0, limit).map((v) => (
                      <BankCard
                        key={v.r.key}
                        v={v}
                        cycle={cycle}
                        cols={cols}
                        open={open === v.r.key}
                        onToggle={() => setOpen(open === v.r.key ? null : v.r.key)}
                        onDetail={() => setDetail(v)}
                        onHide={() => setCoverage((c) => ({ ...c, hidden: [...new Set([...c.hidden, v.r.key])] }))}
                      />
                    ))}
                    {list.length > limit && (
                      <li>
                        <button className="w-full rounded-lg border border-dashed border-line-2 px-2 py-1.5 text-[12px] text-navy hover:bg-panel" onClick={() => setMoreIn(new Set([...moreIn, col.id]))}>
                          Show {list.length - limit} more
                        </button>
                      </li>
                    )}
                    {!list.length && <li className="rounded-lg border border-dashed border-line-2 px-3 py-6 text-center text-[12px] text-muted">Drop a bank here</li>}
                  </ul>
                </section>
                {i < cols.length - 1 && (
                  <div className="flex w-6 shrink-0 items-start justify-center pt-5 text-line-2" aria-hidden>
                    <ChevronRight className="size-5" />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <p className="-mt-1 text-[12px] text-muted">
        A bank sits where you dragged it; until then it goes by what&apos;s known: an interview → First round, an application in → Applied, anyone emailed → Networking.
        Relationship = 30 once you&apos;ve emailed, more for replies and chats (your ratings count), 88+ with a referral, 100 from a VP or above.
      </p>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? detail.r.name : ""} wide>
        {detail && <BankDetail x={detail} />}
      </Modal>
      <ColumnsEditor open={editCols} onClose={() => setEditCols(false)} />
    </div>
  );
}

/** White → red (going badly) / neutral (emailed, no chat yet) → green (chats, a referral). */
function Legend() {
  const stops = [null, 5, 18, 30, 50, 75, 100] as const;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="flex overflow-hidden rounded-md border border-line">
          {stops.map((s, i) => (
            <span key={i} className="h-3.5 w-6" style={{ background: healthColor(s).bg }} />
          ))}
        </span>
        <span>
          <b className="font-medium text-ink-2">Not started</b> · <span className="text-red">going badly</span> · emailed, no chat yet · <span className="text-green">chats / referral</span>
        </span>
      </span>
      <span className="flex items-center gap-1">
        <Star className="size-3.5 fill-brass text-brass" /> most tracked
      </span>
    </div>
  );
}

/** A score out of 100 as a filled ring with the number in the middle (on the card's own color). */
function ScorePie({ value, label, sub }: { value: number | null; label: string; sub: string }) {
  const pct = value === null ? 0 : value / 100;
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 text-center">
      <div
        className="grid size-[62px] place-items-center rounded-full"
        style={{ background: `conic-gradient(currentColor ${pct * 360}deg, color-mix(in srgb, currentColor 18%, transparent) 0)` }}
        role="img"
        aria-label={`${label}: ${value ?? "not started"} of 100`}
      >
        <div className="num grid size-[46px] place-items-center rounded-full bg-panel text-[14px] font-semibold text-ink">{value ?? "—"}</div>
      </div>
      <div className="text-[11px] font-medium">{label}</div>
      <div className="text-[10.5px] leading-tight opacity-80">{sub}</div>
    </div>
  );
}

/** Your own read on a bank, as a health score: dark red → dark green (owner: a chat that went badly). */
const SWATCHES: { score: number; label: string }[] = [
  { score: 4, label: "Going badly" },
  { score: 20, label: "Not great" },
  { score: 30, label: "Neutral" },
  { score: 45, label: "OK" },
  { score: 70, label: "Good" },
  { score: 95, label: "Great" },
];

function BankCard({ v, cycle, cols, open, onToggle, onDetail, onHide }: { v: BankView; cycle: Cycle; cols: ProcessColumn[]; open: boolean; onToggle: () => void; onDetail: () => void; onHide: () => void }) {
  const color = healthColor(v.color);
  const app = v.app === "applied" ? "Applied" : v.app === "open" ? "Open" : v.app === "closed" ? "Closed" : "—";
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-bank", v.r.key);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab rounded-lg border border-black/10 shadow-[0_1px_0_rgba(0,0,0,0.04)] active:cursor-grabbing"
      style={{ background: color.bg, color: color.fg }}
    >
      <div className="flex items-start gap-1 px-2.5 pt-2">
        <button
          type="button"
          onClick={() => toggleStar(v.r.key)}
          className="mt-px shrink-0 rounded p-0.5 hover:bg-black/10"
          aria-pressed={v.starred}
          aria-label={v.starred ? `Unstar ${v.r.name}` : `Star ${v.r.name}`}
          title={v.starred ? "Starred: tracked most (listed first, and in the 9 PM text)" : "Star: track this bank most"}
        >
          <Star className={cn("size-3.5", v.starred ? "fill-brass text-brass" : "opacity-50")} />
        </button>
        <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[13.5px] font-semibold">{v.r.name}</div>
          <div className="truncate text-[11px] opacity-75">
            {[v.r.tier, v.health.why, v.column.set ? "placed by you" : "", v.colorSet ? "your color" : ""].filter(Boolean).join(" · ")}
          </div>
        </button>
        <Menu
          label={`Move ${v.r.name}`}
          items={[
            ...cols.map((c) => ({ label: c.id === v.column.id ? `In ${c.label}` : `Move to ${c.label}`, disabled: c.id === v.column.id, onClick: () => moveToColumn(v.r.key, c.id, cycle) })),
            v.column.set && "divider",
            v.column.set && { label: "Back to automatic", icon: <Undo2 />, onClick: () => moveToColumn(v.r.key, null, cycle) },
            "divider",
            { label: "Open details", onClick: onDetail },
            v.other
              ? { label: "This is a bank", hint: "Show it with the banks", onClick: () => setFirmKind(v.r.key, "bank") }
              : { label: "Not a bank", hint: "Move to Other firms", onClick: () => setFirmKind(v.r.key, "other") },
            { label: "Hide this bank", hint: "Not recruiting here", icon: <EyeOff />, onClick: onHide },
          ]}
        />
      </div>
      {/* The foot: chats, emails vs. the target, the application. */}
      <div className="num mt-1.5 grid grid-cols-3 gap-px border-t border-black/10 text-center text-[11px]">
        <span className="px-1 py-1" title={`Chats where your calendar and a thank-you email agree, or you logged / confirmed them${v.health.toCheck ? `. ${v.health.toCheck} more to confirm on Things to think about` : ""}`}>
          <b className="block text-[13px] font-semibold">
            {v.health.chats}
            {v.health.toCheck > 0 && <span className="font-normal opacity-70">+{v.health.toCheck}?</span>}
          </b>
          chats
        </span>
        <span className="px-1 py-1" title={`${v.emailed} emailed of your target of ${v.target} contacts here`}>
          <b className="block text-[13px] font-semibold">
            {v.emailed}/{v.target}
          </b>
          emailed
        </span>
        <span className="px-1 py-1" title={v.deadline ? `Deadline ${fmtDate(v.deadline)}` : "From Applications and your applications tab"}>
          <b className="block text-[13px] font-semibold">{app}</b>
          application
        </span>
      </div>
      {open && (
        <div className="rounded-b-lg bg-panel px-2.5 pt-2.5 pb-2 text-ink">
          <div className="grid grid-cols-2 gap-2" style={{ color: color.tone === "none" ? "var(--chart)" : color.tone === "bad" ? "var(--red)" : "var(--green)" }}>
            <ScorePie value={v.health.score} label="Relationship" sub={v.health.score === null ? "not started" : v.health.why} />
            <div style={{ color: "var(--brass)" }}>
              <ScorePie value={v.u.score} label="Urgency" sub={v.deadline ? `deadline ${fmtDate(v.deadline)}` : v.u.parts.slice().sort((a, b) => b.points - a.points)[0]?.label ?? ""} />
            </div>
          </div>
          <div className="mt-2.5 space-y-1.5 text-[12px]">
            <div className="flex items-center gap-1.5">
              <span className="text-muted">Next:</span>
              <NextStep t={v.w.next} />
            </div>
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Your color for ${v.r.name}`}>
              <span className="mr-0.5 text-muted">Color</span>
              {SWATCHES.map((sw) => (
                <button
                  key={sw.score}
                  type="button"
                  title={sw.label}
                  aria-label={sw.label}
                  aria-pressed={v.colorSet && v.color === sw.score}
                  onClick={() => setColor(v.r.key, sw.score)}
                  className={cn("size-4 rounded-full border border-black/15", v.colorSet && v.color === sw.score && "ring-2 ring-navy ring-offset-1")}
                  style={{ background: healthColor(sw.score).bg }}
                />
              ))}
              <button type="button" className={cn("ml-1 text-[11px] hover:underline", v.colorSet ? "text-navy" : "text-muted")} onClick={() => setColor(v.r.key, null)} disabled={!v.colorSet}>
                auto
              </button>
            </div>
            <label className="flex items-center gap-1.5 text-muted">
              Target contacts
              <input
                type="number"
                min={0}
                max={50}
                className="num h-7 w-14 rounded-md border border-line-2 bg-panel px-1.5 text-[12px] text-ink focus:border-brass-strong focus:outline-none"
                value={v.target}
                onChange={(e) => setTarget(v.r.key, e.target.value === "" ? null : Number(e.target.value))}
              />
              {v.targetSet && (
                <button className="text-[11px] text-navy hover:underline" onClick={() => setTarget(v.r.key, null)}>
                  reset
                </button>
              )}
            </label>
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
              <button className="font-medium text-navy hover:underline" onClick={onDetail}>
                People &amp; to-dos
              </button>
              <Link href={`/find?banks=${encodeURIComponent(v.r.name)}`} className="font-medium text-navy hover:underline">
                Find people
              </Link>
              <Link href={`/drafts?bank=${encodeURIComponent(v.r.name)}`} className="font-medium text-navy hover:underline">
                Drafts
              </Link>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

/** Rename, add, reorder-by-removal or reset the steps. Banks in a removed step go back to their automatic step. */
function ColumnsEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const coverage = useStore((s) => s.coverage);
  const setCoverage = useStore((s) => s.setCoverage);
  const [list, setList] = useState<ProcessColumn[]>(() => columnsOf(coverage));
  const [name, setName] = useState("");
  const save = () => {
    const clean = list.map((c) => ({ ...c, label: c.label.trim() || c.id })).filter((c) => c.label);
    if (!clean.length) return toast.err("Keep at least one step.");
    setCoverage((c) => ({ ...c, processColumns: clean }));
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Process steps">
      <p className="mb-3 text-[12.5px] text-muted">The columns, left to right. Removing one sends its banks back to the step their activity suggests.</p>
      <ul className="space-y-1.5">
        {list.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2">
            <span className="num w-5 text-right text-[12px] text-muted">{i + 1}</span>
            <Input className="h-8" value={c.label} onChange={(e) => setList(list.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))} aria-label={`Step ${i + 1} name`} />
            <Button size="sm" variant="ghost" aria-label={`Remove ${c.label}`} onClick={() => setList(list.filter((x) => x.id !== c.id))}>
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setList([...list, { id: `c_${Date.now().toString(36)}`, label: name.trim() }]);
          setName("");
        }}
      >
        <Input className="h-8" placeholder="Add a step (e.g. HireVue)" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" type="submit" icon={<Plus className="size-3.5" />}>
          Add
        </Button>
      </form>
      <div className="mt-4 flex items-center justify-between">
        <button className="text-[12.5px] text-navy hover:underline" onClick={() => setList(PROCESS_COLUMNS)}>
          Reset to the default steps
        </button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save steps
          </Button>
        </div>
      </div>
    </Modal>
  );
}

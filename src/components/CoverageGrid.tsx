"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import Link from "@/components/Link";
import { Building2, ChevronDown, ChevronRight, LayoutGrid, List, Pin, Search, SlidersHorizontal, Star } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";
import { DEFAULT_TEAMS } from "@/lib/locationTeam";
import { STATUS_LABEL, type Contact } from "@/lib/types";
import { ALL_VIEW, GRID_OFFICES, LEVEL_LABEL, gridCell, teamSourceLabel, viewOffices, viewSummary, viewsOf, type CoverageView, type GridCell } from "@/lib/coverageGrid";
import { IconToggleGroup, MenuRow, NeutralButton, ObjectHeader, ViewSwitcher } from "./crm";
import { toast } from "./ui";
import type { BankView } from "./useBankViews";

/**
 * Bank coverage, CRM style (owner, 2026-11-22; docs/DESIGN.md L-1 + L-4 + D-2): saved views pick the offices, the grid
 * shows each bank × office as a square that darkens with progress plus the team (amber "Tech?" = only guessed), and a
 * bank opens inline with why it's ranked, its next steps and its people with where each team came from.
 */

const LAST = "coverage:lastView";
const FILL = ["", "bg-step-1", "bg-step-2", "bg-step-3", "bg-step-4"];

function readLast() {
  try {
    return localStorage.getItem(LAST) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveViews(fn: (m: Record<string, CoverageView>) => Record<string, CoverageView>) {
  useStore.getState().setCoverage((c) => ({ ...c, views: fn({ ...(c.views ?? {}) }) }));
}

export function CoverageGrid({ views, list, menu }: { views: BankView[]; list: (shown: BankView[]) => ReactNode; menu: ReactNode }) {
  const mine = useStore((s) => s.coverage.views);
  const { list: allViews, open } = useMemo(() => viewsOf(mine, readLast()), [mine]);
  const [viewId, setViewId] = useState(open.id);
  const saved = allViews.find((v) => v.id === viewId) ?? ALL_VIEW;
  const [draft, setDraft] = useState<CoverageView | null>(null);
  const view = draft ?? saved;
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const [onlyGuessed, setOnlyGuessed] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const display = view.display ?? "grid";
  const offices = viewOffices(view);

  const pick = (v: CoverageView) => {
    setViewId(v.id);
    setDraft(null);
    setEditing(false);
    try {
      localStorage.setItem(LAST, v.id);
    } catch {}
  };

  const rows = useMemo(() => {
    const out = views
      .filter((v) => (view.banksOnly === false ? true : !v.pe && !v.other))
      .filter((v) => !q.trim() || v.r.name.toLowerCase().includes(q.trim().toLowerCase()))
      .map((v) => ({ v, cells: offices.map((o) => gridCell(v.r.name, o, v.people, v.slots.find((s) => s.office === o))) }))
      .filter(({ cells }) => cells.some((c) => c.inPlan || c.people.length))
      .filter(({ cells }) => !view.startedOnly || cells.some((c) => c.level > 0))
      .sort((a, b) => Number(b.v.starred) - Number(a.v.starred) || b.v.u.score - a.v.u.score);
    return onlyGuessed ? out.filter(({ cells }) => cells.some((c) => c.guessed.length)) : out;
  }, [views, view, offices, q, onlyGuessed]);

  const guessedCount = new Set(rows.flatMap(({ cells }) => cells.flatMap((c) => c.guessed.map((p) => p.id)))).size;
  const officeSum = offices.map((o, i) => {
    const plan = rows.filter(({ cells }) => cells[i].inPlan && cells[i].hires);
    return { o, started: plan.filter(({ cells }) => cells[i].level > 0).length, total: plan.length };
  });

  return (
    <div className="grid gap-3">
      <ObjectHeader
        icon={<Building2 className="size-5" />}
        eyebrow="Bank coverage"
        title={
          <ViewSwitcher
            views={allViews}
            current={saved}
            onPick={pick}
            footer={(close) => (
              <>
                <MenuRow
                  onClick={() => {
                    setDraft({ id: `v_${Date.now().toString(36)}`, name: "New view", offices: [...offices], banksOnly: true, display });
                    setEditing(true);
                    close();
                  }}
                >
                  New view…
                </MenuRow>
                {saved.id !== "all" && (
                  <MenuRow
                    onClick={() => {
                      setDraft({ ...saved });
                      setEditing(true);
                      close();
                    }}
                  >
                    Edit “{saved.name}”…
                  </MenuRow>
                )}
              </>
            )}
          />
        }
        actions={menu}
        meta={
          <>
            {rows.length} bank{rows.length === 1 ? "" : "s"} · Ranked by urgency · {viewSummary(view)}
            {draft && !editing && <span className="ml-1 text-amber">· unsaved changes</span>}
            {guessedCount > 0 && (
              <>
                {" · "}
                <button type="button" onClick={() => setOnlyGuessed((x) => !x)} className="text-brass-ink underline-offset-2 hover:underline">
                  {onlyGuessed ? "Show all banks" : `${guessedCount} team${guessedCount === 1 ? "" : "s"} only guessed`}
                </button>
              </>
            )}
          </>
        }
        controls={
          <>
            <label className="relative">
              <span className="sr-only">Search banks</span>
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search banks" className="h-8 w-[200px] rounded border border-line-2 bg-panel pr-2 pl-7 text-[13px] focus:border-brass-strong focus:outline-none" />
            </label>
            <IconToggleGroup
              label="Display as"
              value={display}
              onChange={(d) => setDraft({ ...view, display: d })}
              options={[
                { id: "grid", icon: <LayoutGrid className="size-4" />, label: "Grid by office" },
                { id: "list", icon: <List className="size-4" />, label: "List of offices to fill" },
              ]}
            />
            <NeutralButton onClick={() => (editing ? setEditing(false) : (setDraft(draft ?? { ...view }), setEditing(true)))} aria-expanded={editing}>
              <SlidersHorizontal className="size-3.5" />
              Edit view
            </NeutralButton>
          </>
        }
      />

      {editing && draft && (
        <ViewEditor
          draft={draft}
          setDraft={setDraft}
          isNew={!allViews.some((v) => v.id === draft.id)}
          originalName={allViews.find((v) => v.id === draft.id)?.name ?? ""}
          onCancel={() => {
            setDraft(null);
            setEditing(false);
          }}
          onSaved={(v) => {
            setDraft(null);
            setEditing(false);
            pick(v);
          }}
        />
      )}

      {display === "list" ? (
        list(rows.map((r) => r.v))
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-subtle text-left">
                <th scope="col" className="w-[34%] px-3 py-2 text-[12px] font-semibold text-muted">
                  Bank
                </th>
                {officeSum.map((s) => (
                  <th key={s.o} scope="col" className="px-3 py-2 align-bottom">
                    <div className="text-[12px] font-semibold text-ink-2">{s.o}</div>
                    <div className="text-[11.5px] font-normal text-muted">{s.total ? `${s.started} of ${s.total} started` : "not in your plan"}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ v, cells }, i) => {
                const isOpen = openKey === v.r.key;
                return (
                  <Fragment key={v.r.key}>
                    <tr className={cn("border-b border-line hover:bg-subtle", isOpen && "bg-brass-soft/40 shadow-[inset_2px_0_0_var(--brass-strong)]")}>
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <button type="button" onClick={() => setOpenKey(isOpen ? null : v.r.key)} aria-expanded={isOpen} className="flex w-full items-start gap-2 text-left">
                          {isOpen ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted" /> : <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted" />}
                          <span className="num w-6 shrink-0 pt-px text-right text-[12px] text-muted">{i + 1}</span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1 font-semibold text-ink">
                              {v.r.name}
                              {v.starred && <Star className="size-3 fill-current text-amber" aria-label="Starred" />}
                            </span>
                            <span className={cn("block truncate text-[12px]", v.w.next?.outstanding ? "text-red" : "text-muted")}>{v.w.next?.label ?? (v.r.tier || "No next step")}</span>
                          </span>
                        </button>
                      </th>
                      {cells.map((c) => (
                        <td key={c.office} className="px-3 py-2">
                          <Cell c={c} />
                        </td>
                      ))}
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line bg-panel">
                        <td colSpan={offices.length + 1} className="px-3 pt-1 pb-4">
                          <BankRowDetail v={v} rank={i + 1} cells={cells} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={offices.length + 1} className="px-3 py-10 text-center text-muted">
                    No banks in this view. Edit the view or clear the search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[12px] text-muted">
            {LEVEL_LABEL.map((l, i) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className={cn("inline-block size-3 rounded-[3px]", i === 0 ? "border border-line-2" : FILL[i])} aria-hidden="true" />
                {l}
              </span>
            ))}
            <span>
              <em className="text-amber">Tech?</em> = team only guessed from the office
            </span>
            <span>— = that office doesn&apos;t hire summer analysts</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ c }: { c: GridCell }) {
  if (!c.hires)
    return (
      <span className="text-muted" title="This office doesn't hire summer analysts">
        —
      </span>
    );
  if (!c.inPlan && !c.people.length)
    return (
      <span className="text-[12px] text-muted/70" title="Not one of your offices at this bank">
        ·
      </span>
    );
  return (
    <div className="flex items-center gap-2.5" title={`${LEVEL_LABEL[c.level]}${c.team ? ` · ${c.team}` : ""}`}>
      <span className={cn("block size-6 shrink-0 rounded-[5px]", c.level === 0 ? "border-[1.5px] border-line-2" : FILL[c.level])} aria-hidden="true" />
      <span className="min-w-0 leading-tight">
        <span className={cn("block truncate", c.teamConfirmed ? "text-ink" : "text-amber italic")}>{c.team ? `${c.team}${c.teamConfirmed ? "" : "?"}` : "Any team"}</span>
        <span className="block text-[12px] text-muted">{c.note}</span>
      </span>
    </div>
  );
}

/** A's expanded row: why it's ranked, next steps, and the people with where each one's team came from. */
function BankRowDetail({ v, rank, cells }: { v: BankView; rank: number; cells: GridCell[] }) {
  const people = v.people.filter((c) => c.status !== "ignored" || c.referral).slice(0, 12);
  const open = cells.find((c) => c.inPlan && c.hires && c.level <= 1);
  const enc = encodeURIComponent;
  return (
    <div className="grid gap-6 pl-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <div className="grid content-start gap-4">
        <section>
          <h3 className="mb-2 text-[12px] font-semibold text-muted">Why it&apos;s #{rank}</h3>
          <div className="grid gap-2">
            {v.u.parts.map((p) => (
              <div key={p.id} className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 text-[12.5px]">
                <span className="text-ink-2">{p.label}</span>
                <span className="flex items-center gap-2">
                  <span className="block h-1 flex-1 overflow-hidden rounded bg-track">
                    <span className="block h-1 rounded bg-brass-strong" style={{ width: `${Math.round((p.points / Math.max(1, p.max)) * 100)}%` }} />
                  </span>
                  <span className="w-[150px] truncate text-[12px] text-muted" title={p.detail}>
                    {p.detail}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
        {v.w.todos.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-[12px] font-semibold text-muted">Next steps</h3>
            <ul className="grid gap-1 text-[13px]">
              {v.w.todos.slice(0, 4).map((t, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", t.outstanding ? "bg-red" : "bg-line-2")} aria-hidden="true" />
                  {t.href ? (
                    <Link href={t.href} className="text-brass-ink hover:underline">
                      {t.label}
                    </Link>
                  ) : (
                    <span className="text-ink-2">{t.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <section>
        <h3 className="mb-1.5 text-[12px] font-semibold text-muted">People there ({people.length})</h3>
        {!people.length ? (
          <p className="text-[13px] text-muted">Nobody found yet.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {people.map((c) => (
              <PersonRow key={c.id} c={c} />
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <Link href={`/bank?key=${enc(v.r.key)}`} className="font-medium text-brass-ink hover:underline">
            Open bank page
          </Link>
          <Link href={`/drafts?bank=${enc(v.r.name)}`} className="font-medium text-brass-ink hover:underline">
            Draft emails here
          </Link>
          {open && (
            <Link href={`/find?banks=${enc(v.r.name)}&desk=${enc(`${open.office}|${open.team}`)}`} className="text-brass-ink hover:underline">
              Find people for {open.office} {open.team}
            </Link>
          )}
          <Link href="/process" className="text-ink-2 hover:underline">
            Process tracker
          </Link>
        </div>
      </section>
    </div>
  );
}

function PersonRow({ c }: { c: Contact }) {
  const t = teamSourceLabel(c);
  const [changing, setChanging] = useState(false);
  const setTeam = (team: string) => {
    useStore.getState().updateContact(c.id, { team, teamSource: "manual" }, { at: new Date().toISOString(), type: "note", note: `Team set to ${team} (Bank coverage)` });
    toast.ok(`${c.name}: ${team}.`);
    setChanging(false);
  };
  return (
    <li className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.9fr)] items-baseline gap-3 py-1.5 text-[13px]">
      <span className="min-w-0 truncate">
        <Link href={`/person?id=${encodeURIComponent(c.id)}`} className="font-medium text-brass-ink hover:underline">
          {c.name}
        </Link>{" "}
        <span className="text-muted">{c.position}</span>
      </span>
      <span className="min-w-0">
        {changing ? (
          <select autoFocus defaultValue={t.team} onChange={(e) => e.target.value && setTeam(e.target.value)} onBlur={() => setChanging(false)} className="h-7 rounded border border-line-2 bg-panel px-1 text-[12.5px]">
            <option value="">Pick a team</option>
            {DEFAULT_TEAMS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        ) : (
          <>
            <span className={t.confirmed ? "text-ink" : "text-amber italic"}>{t.team ? `${t.team}${t.confirmed ? "" : "?"}` : "No team"}</span>{" "}
            <span className="text-[12px] text-muted">{c.location || c.region} · {t.source}</span>
            {!t.confirmed && t.team && (
              <button type="button" onClick={() => setTeam(t.team)} className="ml-2 text-[12px] font-medium text-brass-ink hover:underline">
                Confirm
              </button>
            )}
            <button type="button" onClick={() => setChanging(true)} className="ml-2 text-[12px] text-muted hover:text-ink hover:underline">
              Change
            </button>
          </>
        )}
      </span>
      <span className="truncate text-[12.5px] text-ink-2">{c.outcome?.kind === "no_reply" ? "Moved on" : STATUS_LABEL[c.status]}</span>
    </li>
  );
}

/** Edit a view (P-3, inline): name, offices, filters; save / save as new / delete / pin. */
function ViewEditor({
  draft,
  setDraft,
  isNew,
  originalName,
  onCancel,
  onSaved,
}: {
  draft: CoverageView;
  setDraft: (v: CoverageView) => void;
  isNew: boolean;
  originalName: string;
  onCancel: () => void;
  onSaved: (v: CoverageView) => void;
}) {
  const toggle = (o: string) => {
    const cur = draft.offices.length ? draft.offices : [...GRID_OFFICES];
    const next = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o];
    setDraft({ ...draft, offices: next.length === GRID_OFFICES.length ? [] : next });
  };
  const shown = draft.offices.length ? draft.offices : [...GRID_OFFICES];
  const save = (asNew: boolean) => {
    const v: CoverageView = { ...draft, id: asNew || draft.id === "all" ? `v_${Date.now().toString(36)}` : draft.id, name: draft.name.trim() || "My view" };
    // "Save as new" on a view you didn't rename: don't end up with two views of the same name.
    if (asNew && !isNew && draft.id !== "all" && v.name === originalName) v.name = `${v.name} (copy)`;
    saveViews((m) => {
      if (v.pinned) for (const k of Object.keys(m)) m[k] = { ...m[k], pinned: false };
      m[v.id] = v;
      return m;
    });
    toast.ok(`Saved the view "${v.name}".`);
    onSaved(v);
  };
  return (
    <div className="rounded-lg border border-line bg-panel p-4 shadow-[0_0_7px_rgba(0,0,0,0.1),0_5px_5px_rgba(0,0,0,0.08)]">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <label className="grid gap-1 text-[12px] text-muted">
          View name
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-8 w-[220px] rounded border border-line-2 bg-panel px-2 text-[13px] text-ink focus:border-brass-strong focus:outline-none" />
        </label>
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-[12px] text-muted">Offices to show</legend>
          <div className="flex flex-wrap gap-3 text-[13px]">
            {GRID_OFFICES.map((o) => (
              <label key={o} className="flex items-center gap-1.5">
                <input type="checkbox" checked={shown.includes(o)} onChange={() => toggle(o)} className="size-4 accent-[var(--brass-strong)]" />
                {o}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-1 text-[13px]">
          <legend className="mb-1 text-[12px] text-muted">Banks</legend>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!draft.startedOnly} onChange={(e) => setDraft({ ...draft, startedOnly: e.target.checked })} className="size-4 accent-[var(--brass-strong)]" />
            Only banks I&apos;ve started at these offices
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={draft.banksOnly === false} onChange={(e) => setDraft({ ...draft, banksOnly: !e.target.checked })} className="size-4 accent-[var(--brass-strong)]" />
            Include private equity and other firms
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} className="size-4 accent-[var(--brass-strong)]" />
            <Pin className="size-3.5 text-muted" /> Open this view by default
          </label>
        </fieldset>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button type="button" onClick={() => save(isNew || draft.id === "all")} className="h-8 rounded bg-brass-strong px-3 text-[13px] font-medium text-white hover:bg-brass-hover">
          {isNew || draft.id === "all" ? "Save view" : "Save"}
        </button>
        {!isNew && draft.id !== "all" && <NeutralButton onClick={() => save(true)}>Save as new view</NeutralButton>}
        <NeutralButton onClick={onCancel}>Cancel</NeutralButton>
        {!isNew && draft.id !== "all" && (
          <button
            type="button"
            onClick={() => {
              saveViews((m) => {
                delete m[draft.id];
                return m;
              });
              toast.ok(`Deleted "${draft.name}".`);
              onSaved(ALL_VIEW);
            }}
            className="ml-auto h-8 rounded px-3 text-[13px] text-red hover:bg-red-soft"
          >
            Delete view
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Columns3, EyeOff, Lightbulb, List, ListChecks, Plus, Search, Undo2, X } from "lucide-react";
import { blobs, useStore } from "@/lib/store";
import { buildCoverage, tierRank, type CoverageRow, type FirmRating } from "@/lib/coverage";
import { DESK_PRESETS, activeDesks, targetLabel } from "@/lib/desks";
import {
  BANK_STAGES,
  bankStage,
  bankUrgency,
  bankWork,
  isLive,
  offeredAt,
  onDesk,
  stageKey,
  talkedTo,
  wasEmailed,
  type BankStage,
  type BankTodo,
  type BankWork,
  type DeskFilter,
  type Urgency,
} from "@/lib/bankWork";
import { coverageInsights, type Insight } from "@/lib/insights";
import { STARTER_TARGETS } from "@/lib/banks";
import { regionInfo, type Contact } from "@/lib/types";
import { DEFAULT_TEAMS, teamOf } from "@/lib/locationTeam";
import { parseWorkbook } from "@/lib/workbook";
import { ensureBankTabs } from "@/lib/actions";
import { isPrivateEquity } from "@/lib/bankTabs";
import { cn, fmtDate, relDays } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Input, Kpi, Menu, PageHeader, Segmented, Select, StatusBadge, toast } from "@/components/ui";
import { DeskChecklist, DeskChips, OfficePicker, RecruitingPlan, SpecialtyPicker } from "@/components/RecruitingPlan";

type Layout = "board" | "list";
type Show = "all" | "todo" | "applied";
type Sort = "urgency" | "todo" | "contacts" | "name";
const SORTS: { id: Sort; label: string }[] = [
  { id: "urgency", label: "Urgency" },
  { id: "todo", label: "Most to do" },
  { id: "contacts", label: "Contacts" },
  { id: "name", label: "Name" },
];

const STAGES: { id: BankStage; title: string; sub: string; dot: string }[] = [
  { id: "referral", title: "Referrals", sub: "Someone referred you. Keep them posted.", dot: "bg-green" },
  { id: "chatted", title: "Chatted", sub: "They replied, a call is booked, or you've talked.", dot: "bg-navy" },
  { id: "emailed", title: "Emailed", sub: "Emailed, waiting on replies.", dot: "bg-blue" },
  { id: "outreach", title: "Outreach", sub: "People found, nothing sent yet (drafts and queued emails).", dot: "bg-brass" },
  { id: "cold", title: "Cold", sub: "Nobody found yet.", dot: "bg-line-2" },
];
const stageTitle = (s: BankStage) => STAGES.find((x) => x.id === s)!.title;

const OFFICES = ["SF", "LA", "NY", "Chicago", "Texas"];

/**
 * One bank, seen through the office / group filter: `people` are the contacts on it, `unsorted` have no team set.
 * `stage` = your hand-set stage when there is one (`manual`), else `auto` (what the contacts imply).
 */
type Row = { r: CoverageRow; w: BankWork; u: Urgency; people: Contact[]; unsorted: Contact[]; stage: BankStage; auto: BankStage; manual: boolean; stageKey: string };

/** Move a bank to a stage by hand; picking the stage its contacts already imply (or null) goes back to automatic. */
function setStage(x: Row, to: BankStage | null) {
  useStore.getState().setCoverage((c) => {
    const stages = { ...(c.stages ?? {}) };
    if (!to || to === x.auto) delete stages[x.stageKey];
    else stages[x.stageKey] = to;
    return { ...c, stages };
  });
}

const NO_RATINGS: Record<string, FirmRating> = {};
const PREFS = "coverage:board";

function urgencyTone(n: number) {
  if (n >= 65) return "red" as const;
  if (n >= 45) return "brass" as const;
  return "neutral" as const;
}

/** Board / list and the office / group filter, remembered per browser (render fine without it). */
function loadPrefs(): { layout: Layout; desk: DeskFilter } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
    return { layout: p.layout === "list" ? "list" : "board", desk: { office: p.desk?.office ?? "", team: p.desk?.team ?? "" } };
  } catch {
    return { layout: "board", desk: { office: "", team: "" } };
  }
}

export default function CoveragePage() {
  const { contacts, tables, targets, coverage, banks, settings, workbook, setCoverage } = useStore();
  const ratings = coverage.ratings ?? NO_RATINGS;
  const [prefs, setPrefs] = useState(loadPrefs);
  const { layout, desk } = prefs;
  const savePrefs = (p: Partial<typeof prefs>) =>
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      try {
        localStorage.setItem(PREFS, JSON.stringify(next));
      } catch {}
      return next;
    });
  const setDesk = (d: DeskFilter) => savePrefs({ desk: d });
  const [tier, setTier] = useState("");
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [stageFilter, setStageFilter] = useState<BankStage | "">("");
  const [sort, setSort] = useState<Sort>("urgency");
  const [open, setOpen] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<BankStage | null>(null);
  const [collapsed, setCollapsed] = useState<Set<BankStage>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [newBank, setNewBank] = useState("");
  const [newTier, setNewTier] = useState("Elite Boutique");

  // Workbooks imported before target-list parsing existed: re-read the stored file once to pick up bank lists.
  useEffect(() => {
    if (targets.length || !workbook) return;
    let live = true;
    blobs.workbook().then(async (buf) => {
      if (!buf || !live) return;
      const parsed = await parseWorkbook(buf);
      if (live && parsed.targets.length) useStore.setState({ targets: parsed.targets });
    });
    return () => {
      live = false;
    };
  }, [targets.length, workbook]);

  // Investment banks and private equity are separate views: desks (office × team) only mean something at a bank.
  const [segment, setSegment] = useState<"ib" | "pe">("ib");
  const pe = segment === "pe";
  const rows = useMemo(
    () =>
      buildCoverage({ contacts, tables, targets, coverage: pe ? { ...coverage, plan: undefined } : coverage, banks, followUp: settings.followUp }).filter(
        (r) => isPrivateEquity(r.tier) === pe,
      ),
    [contacts, tables, targets, coverage, banks, settings.followUp, pe],
  );
  const peCount = useMemo(() => targets.filter((t) => isPrivateEquity(t.tier)).length + coverage.added.filter((t) => isPrivateEquity(t.tier)).length, [targets, coverage.added]);
  // The desks checked in the plan pick which banks are listed; the office / group filter picks whose numbers count.
  const active = useMemo(() => (pe ? [] : activeDesks(coverage.plan)), [coverage.plan, pe]);
  const visible = useMemo(() => rows.filter((r) => r.bucket !== "hidden" && !r.notOffered), [rows]);
  const filtering = !pe && !!(desk.office || desk.team);

  const ranked: Row[] = useMemo(() => {
    const f = pe ? { office: "", team: "" } : desk;
    const out: Row[] = [];
    for (const r of visible) {
      const { matched, unsorted } = onDesk(r.allContacts, f);
      // A bank that doesn't hire into this office / group leaves the view (unless you already have someone there).
      if (!matched.length && !offeredAt(r.name, f, r.specialty?.teams)) continue;
      const empty = f.office && f.team ? { location: f.office, team: f.team } : !f.office && !f.team ? r.desks.find((d) => d.state === "empty")?.target : undefined;
      const w = bankWork({ name: r.name, contacts: matched, allContacts: contacts, banks, followUp: settings.followUp, emptyDesk: empty });
      const auto = bankStage(matched);
      const key = stageKey(r.key, f);
      const set = coverage.stages?.[key] as BankStage | undefined;
      const manual = !!set && BANK_STAGES.includes(set) && set !== auto;
      out.push({ r, w, u: bankUrgency(r, w, { stars: ratings[r.key]?.stars }), people: matched, unsorted, stage: manual ? set! : auto, auto, manual, stageKey: key });
    }
    return out;
  }, [visible, desk, pe, contacts, banks, settings.followUp, ratings, coverage.stages]);

  const tiers = [...new Set(visible.map((r) => r.tier).filter(Boolean) as string[])].sort((a, b) => tierRank(a) - tierRank(b));
  const teams = useMemo(() => [...new Set([...DEFAULT_TEAMS, ...contacts.map((c) => teamOf(c)).filter(Boolean)])].sort(), [contacts]);
  const quick = useMemo(() => {
    const plan = (coverage.plan ?? []).length ? coverage.plan! : DESK_PRESETS;
    const seen = new Set<string>();
    return plan.map((t) => ({ office: t.location, team: t.team })).filter((d) => !seen.has(`${d.office}|${d.team}`) && !!seen.add(`${d.office}|${d.team}`));
  }, [coverage.plan]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return ranked.filter(
      (x) =>
        (!tier || x.r.tier === tier) &&
        (!ql || x.r.name.toLowerCase().includes(ql)) &&
        (show === "all" || (show === "todo" && x.w.outstanding > 0) || (show === "applied" && !!x.r.applied?.length)),
    );
  }, [ranked, tier, q, show]);
  const sorted = useMemo(() => {
    const byName = (a: Row, b: Row) => a.r.name.localeCompare(b.r.name);
    const cmp: Record<Sort, (a: Row, b: Row) => number> = {
      urgency: (a, b) => b.u.score - a.u.score || b.w.outstanding - a.w.outstanding || tierRank(a.r.tier) - tierRank(b.r.tier) || byName(a, b),
      todo: (a, b) => b.w.outstanding - a.w.outstanding || b.u.score - a.u.score || byName(a, b),
      contacts: (a, b) => b.w.contacts - a.w.contacts || byName(a, b),
      name: byName,
    };
    return [...filtered].sort(cmp[sort]);
  }, [filtered, sort]);
  const byStage = (s: BankStage) => sorted.filter((x) => x.stage === s);

  const totals = useMemo(() => {
    const people = ranked.flatMap((x) => x.people);
    return {
      banks: ranked.length,
      reached: ranked.filter((x) => x.w.emailed > 0).length,
      live: people.filter(isLive).length,
      drafts: ranked.reduce((n, x) => n + x.w.drafts, 0),
      outstanding: ranked.reduce((n, x) => n + x.w.outstanding, 0),
      owed: ranked.reduce((n, x) => n + x.w.todos.filter((t) => t.kind === "reply" || t.kind === "thank").reduce((m, t) => m + t.people.length, 0), 0),
      referrals: ranked.reduce((n, x) => n + x.w.referrals, 0),
      referralFirms: ranked.filter((x) => x.w.referrals > 0).length,
    };
  }, [ranked]);

  const insights = useMemo(
    () =>
      coverageInsights(rows, pe ? [] : (coverage.plan ?? []), rows.flatMap((r) => r.contacts), settings.followUp.livePerBank).filter(
        (i) => !pe || i.kind === "quiet" || i.kind === "applied",
      ),
    [rows, coverage.plan, settings.followUp.livePerBank, pe],
  );
  const clearDesks = () => setCoverage((c) => ({ ...c, plan: (c.plan ?? []).map((t) => ({ ...t, enabled: false })) }));
  const hide = (key: string) => setCoverage((c) => ({ ...c, hidden: [...new Set([...c.hidden, key])] }));
  const unhide = (key: string) => setCoverage((c) => ({ ...c, hidden: c.hidden.filter((k) => k !== key) }));

  if (!rows.length && !workbook)
    return (
      <>
        <PageHeader title="Bank coverage" />
        <Card>
          <Empty title="No banks yet">
            Upload your spreadsheet: any bank tab, or a list of firms (like an “Institution Name” column), shows up here.
            <div className="mt-4 flex flex-col items-center gap-2">
              <Link href="/" className="inline-flex items-center gap-1.5 rounded-lg bg-brass-strong px-3.5 py-2 text-[13.5px] font-medium text-white hover:bg-brass-hover">
                Upload your spreadsheet
              </Link>
              <button className="text-[12.5px] text-navy underline" onClick={() => setCoverage((c) => ({ ...c, includeStarter: true }))}>
                or start from a standard IB target list
              </button>
            </div>
          </Empty>
        </Card>
      </>
    );

  const noun = pe ? "firm" : "bank";
  const deskLabel = filtering ? [desk.office, desk.team].filter(Boolean).join(" · ") : "";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Bank coverage"
        sub={
          pe
            ? "Private equity firms on your lists: who referred you, who you've talked to, who you're waiting on, and where you haven't started."
            : "Every bank you're recruiting at: who referred you, who you've talked to, who you're waiting on, and where you haven't started. Pick an office or group to see just that desk."
        }
        right={
          peCount > 0 ? (
            <Segmented
              value={segment}
              onChange={(v) => {
                setSegment(v);
                setOpen(null);
              }}
              options={[
                ["ib", "Investment banks"],
                ["pe", "Private equity"],
              ]}
            />
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label={`${pe ? "Firms" : "Banks"} reached${deskLabel ? ` · ${deskLabel}` : ""}`}
          value={totals.reached}
          ring={totals.banks ? totals.reached / totals.banks : 0}
          sub={`of ${totals.banks} ${deskLabel ? "that hire there" : "you're tracking"}`}
        />
        <Kpi label="Live contacts" value={totals.live} sub={totals.drafts ? `emailed, waiting on a reply · ${totals.drafts} draft${totals.drafts > 1 ? "s" : ""} not sent` : "emailed, waiting on a reply"} />
        <Kpi
          label="Outstanding"
          value={totals.outstanding}
          sub={totals.owed ? `${totals.owed} repl${totals.owed > 1 ? "ies / thank-yous" : "y / thank-you"} owed` : totals.outstanding ? "follow-ups and drafts" : "nothing waiting on you"}
          tone={totals.owed ? "bad" : totals.outstanding ? undefined : "good"}
        />
        <Kpi label="Referrals" value={totals.referrals} sub={totals.referrals ? `at ${totals.referralFirms} ${noun}${totals.referralFirms > 1 ? "s" : ""}` : "none yet"} tone={totals.referrals ? "good" : undefined} />
      </div>

      <Insights items={insights} scoped={active.length > 0} />

      {/* Office / group filter: one click for your usual desks, or any office × group. */}
      <Card className="p-3">
        {!pe && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12px] font-medium text-muted">Desk</span>
            <DeskChip on={!filtering} onClick={() => setDesk({ office: "", team: "" })}>
              Everything
            </DeskChip>
            {quick.map((d) => (
              <DeskChip key={`${d.office}|${d.team}`} on={desk.office === d.office && desk.team === d.team} onClick={() => setDesk(d)}>
                {d.office} · {d.team}
              </DeskChip>
            ))}
            <span className="mx-1 h-5 w-px bg-line" />
            <Select className="h-8" value={desk.office} onChange={(e) => setDesk({ ...desk, office: e.target.value })} aria-label="Office">
              <option value="">Any office</option>
              {OFFICES.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
            <Select className="h-8" value={desk.team} onChange={(e) => setDesk({ ...desk, team: e.target.value })} aria-label="Group">
              <option value="">Any group</option>
              {teams.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
            {active.length > 0 && (
              <span className="ml-auto flex items-center gap-1 text-[12px] text-muted">
                Banks for {active.map(targetLabel).join(", ")}
                <button onClick={clearDesks} className="flex items-center gap-0.5 text-navy hover:underline" title="Uncheck every desk in the plan and list every bank">
                  <X className="size-3" /> clear
                </button>
              </span>
            )}
          </div>
        )}
        <div className={cn("flex flex-wrap items-center gap-2", !pe && "mt-2.5 border-t border-line pt-2.5")}>
          <Segmented
            value={layout}
            onChange={(v) => savePrefs({ layout: v })}
            options={[
              [
                "board",
                <span key="b" className="flex items-center gap-1.5">
                  <Columns3 className="size-3.5" /> Board
                </span>,
              ],
              [
                "list",
                <span key="l" className="flex items-center gap-1.5">
                  <List className="size-3.5" /> Ranked list
                </span>,
              ],
            ]}
          />
          {layout === "list" && (
            <Select className="h-8" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as BankStage | "")} aria-label="Stage">
              <option value="">Every stage</option>
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({ranked.filter((x) => x.stage === s.id).length})
                </option>
              ))}
            </Select>
          )}
          <Select className="h-8" value={show} onChange={(e) => setShow(e.target.value as Show)} aria-label="Show">
            <option value="all">All {noun}s</option>
            <option value="todo">Something to do ({ranked.filter((x) => x.w.outstanding > 0).length})</option>
            <option value="applied">Applied ({ranked.filter((x) => x.r.applied?.length).length})</option>
          </Select>
          {tiers.length > 1 && (
            <Select className="h-8" value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Tier">
              <option value="">All tiers</option>
              {tiers.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          )}
          <div className="flex-1" />
          <div className="relative w-48">
            <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted" />
            <Input className="h-8 pl-8" placeholder={`Search ${noun}s…`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="h-8" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                Sort: {s.label}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {layout === "board" ? (
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="grid grid-cols-[repeat(5,minmax(250px,1fr))] gap-3">
            {STAGES.map((s) => {
              const list = byStage(s.id);
              return (
                <section
                  key={s.id}
                  className={cn("min-w-0 rounded-lg p-1 transition-colors", dragOver === s.id && "bg-blue-soft/50 ring-2 ring-navy/30")}
                  // Drop a card here to move the bank to this stage by hand.
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes("text/x-bank")) return;
                    e.preventDefault();
                    setDragOver(s.id);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(null);
                    const x = ranked.find((y) => y.r.key === e.dataTransfer.getData("text/x-bank"));
                    if (x && x.stage !== s.id) {
                      setStage(x, s.id);
                      toast.ok(`${x.r.name} → ${s.title}${deskLabel ? ` (${deskLabel})` : ""}. Undo from the card's ⋯ menu.`);
                    }
                  }}
                >
                  <header className="mb-1 flex items-center gap-2 px-1">
                    <span className={cn("size-2.5 rounded-full", s.dot)} />
                    <h2 className="text-[14px] font-semibold">{s.title}</h2>
                    <span className="num text-[13px] text-muted">{list.length}</span>
                  </header>
                  <p className="mb-2 min-h-[2.4em] px-1 text-[12px] leading-snug text-muted">{s.sub}</p>
                  <ul className="space-y-2">
                    {list.map((x) => (
                      <BoardCard key={x.r.key} x={x} desk={deskLabel} open={open === x.r.key} onToggle={() => setOpen(open === x.r.key ? null : x.r.key)} onHide={() => hide(x.r.key)} />
                    ))}
                    {!list.length && <li className="rounded-lg border border-dashed border-line-2 px-3 py-6 text-center text-[12.5px] text-muted">Nothing here</li>}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <Card>
          {sorted.length === 0 ? (
            <Empty title={`No ${noun}s here`}>Nothing matches these filters.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-[13px]">
                <thead className="bg-subtle text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-medium">{pe ? "Firm" : "Bank"}</th>
                    <th className="px-2 py-2 font-medium" title="0–100: prestige, applications, coverage gap and to-dos">
                      Urgency
                    </th>
                    <th className="px-2 py-2 text-right font-medium">Contacts</th>
                    <th className="px-2 py-2 text-right font-medium">Emailed</th>
                    <th className="px-2 py-2 text-right font-medium" title="Emailed, no reply yet (drafts don't count)">
                      Live
                    </th>
                    <th className="px-2 py-2 text-right font-medium">Replied</th>
                    <th className="px-2 py-2 text-right font-medium">Referrals</th>
                    <th className="px-2 py-2 font-medium">Outstanding</th>
                    <th className="px-4 py-2 font-medium">Next step</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                {/* One section per stage, furthest along first; urgency orders the banks inside each. */}
                {STAGES.filter((s) => !stageFilter || s.id === stageFilter).map((s) => {
                  const list = byStage(s.id);
                  const folded = collapsed.has(s.id);
                  return (
                    <tbody key={s.id}>
                      <tr className="border-b border-line bg-subtle/70">
                        <td colSpan={10} className="px-4 py-2">
                          <button
                            type="button"
                            className="flex items-center gap-2 text-left"
                            aria-expanded={!folded}
                            onClick={() =>
                              setCollapsed((cur) => {
                                const next = new Set(cur);
                                if (next.has(s.id)) next.delete(s.id);
                                else next.add(s.id);
                                return next;
                              })
                            }
                          >
                            {folded ? <ChevronRight className="size-3.5 text-muted" /> : <ChevronDown className="size-3.5 text-muted" />}
                            <span className={cn("size-2.5 rounded-full", s.dot)} />
                            <span className="text-[13px] font-semibold text-ink">{s.title}</span>
                            <span className="num text-[12.5px] text-muted">{list.length}</span>
                            <span className="text-[12px] text-muted">· {s.sub}</span>
                          </button>
                        </td>
                      </tr>
                      {!folded &&
                        list.map((x) => {
                          const isOpen = open === x.r.key;
                          return (
                            <Fragment key={x.r.key}>
                              <BankRow x={x} open={isOpen} onToggle={() => setOpen(isOpen ? null : x.r.key)} onHide={() => hide(x.r.key)} />
                              {isOpen && (
                                <tr className="border-b border-line bg-subtle">
                                  <td colSpan={10} className="px-4 py-4">
                                    <BankDetail x={x} />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      {!folded && !list.length && (
                        <tr className="border-b border-line">
                          <td colSpan={10} className="px-4 py-3 text-[12.5px] text-muted">
                            Nothing here
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
              </table>
            </div>
          )}
        </Card>
      )}
      <p className="-mt-2 text-[12px] text-muted">
        Urgency = prestige (25: tier, or your stars on Firms) + applications (25: full while one is in) + coverage gap (30: nobody found = full, waiting at your
        cap = little) + to-dos (20: replies and thank-yous owed count double). Application timelines will join it once they&apos;re tracked.
        {filtering && " With a desk picked, every number counts only the people on it; banks that don't hire there are left out."}
      </p>

      {!pe && (
        <details className="group rounded-lg border border-line bg-panel">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13.5px] font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" />
            <ListChecks className="size-4 text-brass" /> Recruiting plan (desks)
            <span className="text-[12px] font-normal text-muted">
              {active.length ? `${active.length} desk${active.length > 1 ? "s" : ""} checked` : "Check desks to list only the banks they apply to"}
            </span>
          </summary>
          <div className="border-t border-line p-4">
            <RecruitingPlan rows={rows} />
            <DeskChecklist rows={rows} />
          </div>
        </details>
      )}

      {/* Manage list */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newBank.trim();
              if (!name) return;
              setCoverage((c) => ({ ...c, added: [...c.added, { name, tier: newTier, source: "manual" }] }));
              setNewBank("");
              // A bank added here gets its own tab (and OVERVIEW row) in the spreadsheet too.
              const tabs = ensureBankTabs();
              if (tabs.added.length) toast.ok(`Added a "${tabs.added[0].tab}" tab and an OVERVIEW row for ${name}. Save the spreadsheet to write them.`);
            }}
          >
            <Input className="h-8 w-56" placeholder="Add a bank to track…" value={newBank} onChange={(e) => setNewBank(e.target.value)} />
            <Select className="h-8" value={newTier} onChange={(e) => setNewTier(e.target.value)} aria-label="Tier">
              {["Bulge Bracket", "Elite Boutique", "Middle Market", "Private Equity", "Other"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
            <Button size="sm" type="submit" icon={<Plus className="size-3.5" />}>
              Add
            </Button>
          </form>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <Checkbox checked={coverage.includeStarter} onChange={(v) => setCoverage((c) => ({ ...c, includeStarter: v }))} />
            Include a standard IB target list ({STARTER_TARGETS.length} banks)
          </label>
          <div className="flex-1" />
          {rows.some((r) => r.bucket === "hidden") && (
            <button className="text-[12.5px] text-navy hover:underline" onClick={() => setShowHidden(!showHidden)}>
              {showHidden ? "Hide" : "Show"} {rows.filter((r) => r.bucket === "hidden").length} hidden banks
            </button>
          )}
        </div>
        {rows.some((r) => r.notOffered && r.specialty && r.bucket !== "hidden") && (
          <div className="mt-3 rounded-md border border-line bg-subtle px-3 py-2 text-[12px] text-ink-2">
            <div className="mb-1 font-medium">Specialists outside your desks (left out of the list)</div>
            <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
              {rows
                .filter((r) => r.notOffered && r.specialty && r.bucket !== "hidden")
                .map((r) => (
                  <li key={r.key} className="flex items-center gap-1">
                    {r.name}
                    <SpecialtyPicker r={r} compact />
                  </li>
                ))}
            </ul>
          </div>
        )}
        {showHidden && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {rows
              .filter((r) => r.bucket === "hidden")
              .map((r) => (
                <li key={r.key}>
                  <button onClick={() => unhide(r.key)} className="flex items-center gap-1 rounded-full border border-line-2 px-2.5 py-1 text-[12px] text-ink-2 hover:border-navy/50" title="Show again">
                    <Undo2 className="size-3" /> {r.name}
                  </button>
                </li>
              ))}
          </ul>
        )}
        <p className="mt-3 text-[11.5px] text-muted">
          Banks come from your contacts, your bank tabs, and any list of firms in the spreadsheet (e.g. an OVERVIEW tab with “Institution Name / Institution Type”).
          Hide banks you’re not recruiting for.
        </p>
      </Card>
    </div>
  );
}

function DeskChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn("rounded-full border px-2.5 py-1 text-[12px]", on ? "border-navy bg-navy text-white" : "border-line-2 bg-panel text-ink-2 hover:border-navy/50")}
    >
      {children}
    </button>
  );
}

const md = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
const first = (c: Contact) => c.firstName || c.name;

/** The few lines that say where a bank stands, by column: who referred you, who you talked to, who you're waiting on. */
function storyLines(x: Row): string[] {
  const { people, stage, w } = x;
  const now = Date.now();
  if (stage === "referral")
    return people
      .filter((c) => c.referral)
      .map((c) => `${c.name} referred you${c.referral!.to?.length ? ` to ${c.referral!.to.map((t) => t.name).join(", ")}` : ""} · ${md(c.referral!.at)}`);
  if (stage === "chatted")
    return people
      .filter(talkedTo)
      .slice(0, 4)
      .map((c) => {
        const chat = [...(c.chats ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0];
        if (chat) return `Chatted with ${c.name} ${md(chat.at)}${chat.grade ? ` · ${chat.grade.letter}` : ""}`;
        if (c.call) return Date.parse(c.call.at) > now ? `Call with ${c.name} ${new Date(c.call.at).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" })}` : `Call with ${c.name} ${md(c.call.at)}`;
        return `${c.name} replied${c.repliedAt ? ` ${md(c.repliedAt)}` : ""}: book a call`;
      });
  if (stage === "emailed") {
    const live = people.filter(isLive);
    const last = live.map((c) => c.lastEmailedAt ?? c.lastTouchAt ?? c.sentAt).filter((d): d is string => !!d).sort().pop();
    return live.length ? [`Waiting on ${live.slice(0, 3).map(first).join(", ")}${live.length > 3 ? ` +${live.length - 3}` : ""}${last ? ` · last email ${md(last)}` : ""}`] : ["Emailed before; nobody live now"];
  }
  if (!people.length) return [x.manual ? "Moved here by you" : "Nobody found yet"];
  const queued = w.queued ? ` · ${w.queued} queued` : "";
  const drafts = w.drafts ? ` · ${w.drafts} draft${w.drafts > 1 ? "s" : ""}` : "";
  return [`${people.length} found, none emailed${drafts}${queued}${w.needEmail ? ` · ${w.needEmail} without an email` : ""}`];
}

function ManualBadge({ x }: { x: Row }) {
  return (
    <span title={`You moved it here. Its contacts say ${stageTitle(x.auto)}.`}>
      <Badge tone="navy" className="px-1.5 py-0 text-[10.5px]">
        set by you
      </Badge>
    </span>
  );
}

/** ⋯ on a bank: move it to another stage by hand (or back to automatic), or hide it. */
function StageMenu({ x, onHide }: { x: Row; onHide: () => void }) {
  return (
    <Menu
      label={`Move ${x.r.name} to another stage`}
      trigger={(toggle, isOpen) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          aria-label={`Move ${x.r.name} to another stage`}
          aria-expanded={isOpen}
          title="Move to another stage, or hide"
          className="rounded px-1 text-[15px] leading-none text-muted hover:bg-hover hover:text-ink"
        >
          ⋯
        </button>
      )}
      items={[
        ...STAGES.map((s) => ({
          label: (
            <span className="flex items-center gap-2">
              <span className={cn("size-2 rounded-full", s.dot)} />
              {s.id === x.stage ? <b className="font-medium">{s.title}</b> : `Move to ${s.title}`}
              {s.id === x.auto && <span className="text-[11.5px] text-muted">automatic</span>}
            </span>
          ),
          disabled: s.id === x.stage,
          onClick: () => setStage(x, s.id),
        })),
        x.manual && "divider",
        x.manual && { label: "Back to automatic", hint: `Its contacts say ${stageTitle(x.auto)}`, icon: <Undo2 />, onClick: () => setStage(x, null) },
        "divider",
        { label: "Hide this bank", hint: "Not recruiting here", icon: <EyeOff />, onClick: onHide },
      ]}
    />
  );
}

function BoardCard({ x, desk, open, onToggle, onHide }: { x: Row; desk: string; open: boolean; onToggle: () => void; onHide: () => void }) {
  const { r, w, u, people, unsorted } = x;
  const offices = w.offices.filter((o) => o.region !== "Other");
  const elsewhere = r.allContacts.filter((c) => c.status !== "ignored").length - w.contacts;
  const chips = outstandingChips(w);
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-bank", r.key);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "group cursor-grab rounded-lg border bg-panel px-3 py-2.5 active:cursor-grabbing",
        w.todos.some((t) => t.kind === "reply" || t.kind === "thank") ? "border-red/40" : "border-line",
      )}
    >
      <div className="flex items-start gap-1.5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{r.name}</span>
            {r.applied?.length ? (
              <span title={r.applied.map((a) => `${a.program}${a.submitted ? ` · submitted ${a.submitted}` : ""}${a.status ? ` · ${a.status}` : ""}`).join("\n")}>
                <Badge tone="green" className="px-1.5 py-0 text-[10.5px]">
                  Applied{r.applied.length > 1 ? ` ×${r.applied.length}` : ""}
                </Badge>
              </span>
            ) : null}
            {x.manual && <ManualBadge x={x} />}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
            {r.tier && <span>{r.tier}</span>}
            {offices.map((o) => (
              <span key={o.region} className="num" title={`${o.contacts} contact${o.contacts > 1 ? "s" : ""} in ${regionInfo(o.region).label}, ${o.emailed} emailed`}>
                <b className="font-medium text-ink-2">{regionInfo(o.region).short}</b> {o.emailed}/{o.contacts}
              </span>
            ))}
          </div>
        </button>
        <span title={u.parts.map((p) => `${p.label}: ${p.points}/${p.max}`).join("\n")}>
          <Badge tone={urgencyTone(u.score)} className="num text-[11.5px]">
            {u.score}
          </Badge>
        </span>
        <StageMenu x={x} onHide={onHide} />
      </div>

      <div className="num mt-1.5 grid grid-cols-4 gap-1 rounded-md bg-subtle px-2 py-1 text-center text-[11px] text-muted">
        <span>
          <b className="block text-[13px] font-medium text-ink">{w.contacts}</b>people
        </span>
        <span>
          <b className="block text-[13px] font-medium text-ink">{w.emailed}</b>emailed
        </span>
        <span>
          <b className={cn("block text-[13px] font-medium", w.replied ? "text-green" : "text-ink")}>{w.replied}</b>replied
        </span>
        <span>
          <b className={cn("block text-[13px] font-medium", w.referrals ? "text-green" : "text-ink")}>{w.referrals}</b>referral{w.referrals === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-2">
        {(storyLines(x).length ? storyLines(x) : [`Moved here by you (its contacts say ${stageTitle(x.auto)})`]).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {desk && elsewhere > 0 && <div className="mt-0.5 text-[11.5px] text-muted">+{elsewhere} elsewhere at {r.name}</div>}
      {unsorted.length > 0 && (
        <Link href={`/sheet?view=contacts&filter=noteam&bank=${encodeURIComponent(r.name)}`} className="mt-0.5 block text-[11.5px] text-amber hover:underline">
          {unsorted.length} here with no team set ({unsorted.slice(0, 2).map(first).join(", ")}
          {unsorted.length > 2 ? "…" : ""}){unsorted.some(wasEmailed) ? `, ${unsorted.filter(wasEmailed).length} emailed` : ""}: set their team
        </Link>
      )}

      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chips.map((c, i) => (
            <Badge key={i} tone={c.tone} className="px-1.5 py-0 text-[10.5px]">
              {c.text}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex min-w-0 items-center gap-2">
        <NextStep t={w.next} />
        <div className="flex-1" />
        <button onClick={onToggle} className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[11.5px] text-muted hover:text-ink" aria-expanded={open}>
          {open ? "Less" : `People${people.length ? ` (${people.length})` : ""}`}
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
      </div>
      {open && (
        <div className="mt-2 border-t border-line pt-2">
          {w.todos.length > 1 && (
            <ul className="mb-2 space-y-0.5 text-[12px]">
              {w.todos.slice(1).map((t, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className={cn("size-1.5 shrink-0 rounded-full", t.kind === "reply" || t.kind === "thank" ? "bg-red" : t.outstanding ? "bg-brass" : "bg-line-2")} />
                  {t.href ? (
                    <Link href={t.href} className="text-navy hover:underline">
                      {t.label}
                    </Link>
                  ) : (
                    <span className="text-muted">{t.label}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {people.length ? (
            <ul className="divide-y divide-line text-[12px]">
              {[...people].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).map((c) => (
                <li key={c.id} className={cn("flex items-center gap-2 py-1", c.status === "ignored" && "opacity-55")}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {c.name}
                      {c.referral && <span className="ml-1 text-[10.5px] text-green">referral</span>}
                    </div>
                    <div className="truncate text-[11px] text-muted">
                      {[c.region !== "Other" ? regionInfo(c.region).short : c.location, teamOf(c), lastTouch(c)].filter((s) => s && s !== "—").join(" · ")}
                    </div>
                  </div>
                  <StatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-muted">Nobody here yet.</p>
          )}
          {(r.desks.length > 0 || r.offices.all.length > r.offices.cap) && (
            <div className="mt-2">
              <DeskChips r={r} />
              <OfficePicker r={r} />
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-3 text-[11.5px]">
            <Link href={`/find?banks=${encodeURIComponent(r.name)}`} className="font-medium text-navy hover:underline">
              Find people
            </Link>
            <Link href={`/drafts?bank=${encodeURIComponent(r.name)}`} className="font-medium text-navy hover:underline">
              Draft emails
            </Link>
            <Link href={`/sheet?view=contacts&bank=${encodeURIComponent(r.name)}`} className="font-medium text-navy hover:underline">
              Spreadsheet
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

function outstandingChips(w: BankWork) {
  return [
    ...w.todos.filter((t) => t.kind === "reply" || t.kind === "thank").map((t) => ({ text: `${t.people.length} ${t.kind === "reply" ? "reply" : "thank-you"} owed`, tone: "red" as const })),
    ...w.todos.filter((t) => t.kind === "follow_up").map((t) => ({ text: `${t.people.length} follow-up${t.people.length > 1 ? "s" : ""} due`, tone: "brass" as const })),
    ...(w.drafts ? [{ text: `${w.drafts} draft${w.drafts > 1 ? "s" : ""} to send`, tone: "brass" as const }] : []),
    ...w.todos.filter((t) => t.kind === "referral" || t.kind === "confirm").map((t) => ({ text: t.kind === "confirm" ? "intro to confirm" : "referral step", tone: "green" as const })),
    ...w.todos.filter((t) => t.kind === "check_in" || t.kind === "move_on").map((t) => ({ text: t.kind === "check_in" ? `${t.people.length} check-in` : `${t.people.length} move on?`, tone: "neutral" as const })),
    ...(w.queued ? [{ text: `${w.queued} queued`, tone: "blue" as const }] : []),
  ];
}

function BankRow({ x, open, onToggle, onHide }: { x: Row; open: boolean; onToggle: () => void; onHide: () => void }) {
  const { r, w, u } = x;
  const offices = w.offices.filter((o) => o.region !== "Other");
  const chips = outstandingChips(w);
  return (
    <tr className={cn("group cursor-pointer border-b border-line hover:bg-subtle", open && "bg-subtle")} onClick={onToggle}>
      <td className="px-4 py-2.5">
        <button
          type="button"
          className="flex items-center gap-1.5 text-left font-medium text-ink"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {open ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}
          {r.name}
          {r.applied?.length ? (
            <span title={r.applied.map((a) => `${a.program}${a.submitted ? ` · submitted ${a.submitted}` : ""}${a.status ? ` · ${a.status}` : ""}`).join("\n")}>
              <Badge tone="green" className="px-1.5 py-0 text-[10.5px]">
                Applied{r.applied.length > 1 ? ` ×${r.applied.length}` : ""}
              </Badge>
            </span>
          ) : null}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 pl-5 text-[11.5px] text-muted">
          {r.tier && <span>{r.tier}</span>}
          {x.manual && <ManualBadge x={x} />}
          {offices.map((o) => (
            <span key={o.region} className="num" title={`${o.contacts} contact${o.contacts > 1 ? "s" : ""} in ${regionInfo(o.region).label}, ${o.emailed} emailed`}>
              <b className="font-medium text-ink-2">{regionInfo(o.region).short}</b> {o.emailed}/{o.contacts}
            </span>
          ))}
        </div>
      </td>
      <td className="px-2 py-2.5">
        <span title={u.parts.map((p) => `${p.label}: ${p.points}/${p.max}`).join("\n")}>
          <Badge tone={urgencyTone(u.score)} className="num text-[12.5px]">
            {u.score}
          </Badge>
        </span>
      </td>
      <td className="num px-2 py-2.5 text-right">{w.contacts || <span className="text-muted">0</span>}</td>
      <td className="num px-2 py-2.5 text-right">{w.emailed}</td>
      <td className="num px-2 py-2.5 text-right">{w.live}</td>
      <td className={cn("num px-2 py-2.5 text-right", w.replied && "text-green")}>{w.replied}</td>
      <td className={cn("num px-2 py-2.5 text-right", w.referrals && "font-medium text-green")}>{w.referrals}</td>
      <td className="px-2 py-2.5">
        <div className="flex max-w-[230px] flex-wrap gap-1">
          {chips.length ? (
            chips.map((c, i) => (
              <Badge key={i} tone={c.tone} className="px-1.5 py-0 text-[10.5px]">
                {c.text}
              </Badge>
            ))
          ) : (
            <span className="text-[12px] text-muted">—</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <NextStep t={w.next} />
      </td>
      <td className="pr-3 text-right" onClick={(e) => e.stopPropagation()}>
        <StageMenu x={x} onHide={onHide} />
      </td>
    </tr>
  );
}

function NextStep({ t }: { t?: BankTodo }) {
  if (!t) return <span className="text-[12px] text-muted">—</span>;
  if (!t.href) return <span className="text-[12.5px] text-muted">{t.label}</span>;
  return (
    <Link
      href={t.href}
      onClick={(e) => e.stopPropagation()}
      className={cn("inline-flex max-w-[260px] min-w-0 items-center gap-1 text-[12.5px] font-medium hover:underline", t.outstanding ? "text-brass-ink" : "text-navy")}
    >
      <span className="truncate">{t.label}</span> <ArrowRight className="size-3 shrink-0" />
    </Link>
  );
}

function BankDetail({ x }: { x: Row }) {
  const { r, w, u } = x;
  const people = [...x.people].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
        <div>
          <h4 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">What to do here</h4>
          {w.todos.length ? (
            <ul className="divide-y divide-line rounded-md border border-line bg-panel">
              {w.todos.map((t, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                  <span className={cn("size-1.5 shrink-0 rounded-full", t.kind === "reply" || t.kind === "thank" ? "bg-red" : t.outstanding ? "bg-brass" : "bg-line-2")} />
                  <span className="min-w-0 flex-1 text-ink">{t.label}</span>
                  {t.href && (
                    <Link href={t.href} className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-navy hover:underline">
                      Open <ArrowRight className="size-3" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted">Nothing to do here right now.</p>
          )}
        </div>
        <div>
          <h4 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Why urgency {u.score}</h4>
          <ul className="grid gap-2">
            {u.parts.map((p) => (
              <li key={p.id}>
                <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="font-medium text-ink">{p.label}</span>
                  <span className="num text-ink-2">
                    {p.points} / {p.max}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-track">
                  <div className="h-full rounded-full bg-brass" style={{ width: `${(p.points / p.max) * 100}%` }} />
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted">{p.detail}</div>
              </li>
            ))}
            <li className="text-[11.5px] text-muted">Timeline: not tracked yet (it will count once application dates are in).</li>
          </ul>
        </div>
        {(r.desks.length > 0 || r.offices.all.length > r.offices.cap) && (
          <div>
            <h4 className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Desks in your plan</h4>
            <DeskChips r={r} />
            <OfficePicker r={r} />
          </div>
        )}
        <SpecialtyPicker r={r} />
      </div>
      <div className="min-w-0">
        <h4 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">People ({people.length})</h4>
        {people.length ? (
          <div className="max-h-80 overflow-auto rounded-md border border-line bg-panel">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-subtle text-left text-[10.5px] uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-1.5 font-medium">Name</th>
                  <th className="px-2 py-1.5 font-medium">Office · team</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5 font-medium">Last</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {people.map((c) => (
                  <tr key={c.id} className={cn(c.status === "ignored" && "opacity-55")}>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{c.name}</span>
                        {c.referral && (
                          <Badge tone="green" className="px-1 py-0 text-[10px]">
                            Referral
                          </Badge>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-muted">{c.position || (c.email ? c.email : "no email")}</div>
                    </td>
                    <td className="px-2 py-1.5 text-ink-2">{[c.region !== "Other" ? regionInfo(c.region).short : c.location, teamOf(c)].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-2 py-1.5">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-3 py-1.5 text-[11.5px] text-muted">{lastTouch(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">Nobody found here yet.</p>
        )}
        {x.unsorted.length > 0 && <p className="mt-1.5 text-[11.5px] text-muted">{x.unsorted.length} more at this office with no team set: {x.unsorted.map((c) => c.name).join(", ")}.</p>}
        <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
          <Link href={`/find?banks=${encodeURIComponent(r.name)}`} className="font-medium text-navy hover:underline">
            Find people
          </Link>
          <Link href={`/drafts?bank=${encodeURIComponent(r.name)}`} className="font-medium text-navy hover:underline">
            Draft emails
          </Link>
          <Link href={`/sheet?view=contacts&bank=${encodeURIComponent(r.name)}`} className="font-medium text-navy hover:underline">
            Open in spreadsheet
          </Link>
          {w.lastActivity && <span className="text-muted">Last activity {relDays(w.lastActivity)}</span>}
        </div>
      </div>
    </div>
  );
}

function lastTouch(c: Contact) {
  if (c.repliedAt) return `replied ${fmtDate(c.repliedAt)}`;
  const last = c.lastEmailedAt ?? c.lastTouchAt ?? c.sentAt;
  if (last) return `${c.followUps ? `follow-up ${c.followUps} · ` : ""}${fmtDate(last)}`;
  if (c.status === "drafted") return "draft ready";
  return wasEmailed(c) ? "emailed" : "—";
}

const ORDER: Record<Contact["status"], number> = { call_scheduled: 0, replied: 1, done: 2, followed_up: 3, sent: 4, drafted: 5, new: 6, ignored: 7 };
const order = (c: Contact) => ORDER[c.status];

function Insights({ items, scoped }: { items: Insight[]; scoped: boolean }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const list = all ? items : items.slice(0, 3);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Lightbulb className="size-4 text-brass" /> What am I missing
          </span>
        }
        sub={scoped ? "for the checked desks" : "for your usual desks (Tech in SF / LA, Generalist in NY / LA, Energy in Texas)"}
      />
      <ul className="space-y-1.5 px-4 pb-3 text-[13px]">
        {list.map((i, n) => (
          <li key={n} className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn("size-1.5 shrink-0 -translate-y-0.5 rounded-full", i.kind === "uncovered" ? "bg-red" : i.kind === "not_offered" ? "bg-line-2" : "bg-brass")} />
            <span className="min-w-0 flex-1 text-ink-2">{i.text}</span>
            {i.href && (
              <Link href={i.href} className="flex items-center gap-1 text-[12px] font-medium text-navy hover:underline">
                {i.cta} <ArrowRight className="size-3" />
              </Link>
            )}
          </li>
        ))}
        {items.length > 3 && (
          <li>
            <button className="text-[12px] text-navy hover:underline" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${items.length}`}
            </button>
          </li>
        )}
      </ul>
    </Card>
  );
}

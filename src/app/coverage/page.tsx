"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Lightbulb, ListChecks, Plus, Undo2 } from "lucide-react";
import { blobs, useStore } from "@/lib/store";
import { tierRank } from "@/lib/coverage";
import { activeDesks } from "@/lib/desks";
import { isLive, liveKind, wasEmailed, type OfficeSlot } from "@/lib/bankWork";
import { coverageInsights, type Insight } from "@/lib/insights";
import { STARTER_TARGETS } from "@/lib/banks";
import { officeInfo } from "@/lib/offices";
import { columnsOf } from "@/lib/processTracker";
import { locationMatches } from "@/lib/desks";
import type { Contact } from "@/lib/types";
import { parseWorkbook } from "@/lib/workbook";
import { ensureBankTabs } from "@/lib/actions";
import { cn } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Input, Kpi, PageHeader, Segmented, Select, toast } from "@/components/ui";
import { DeskChecklist, RecruitingPlan, SpecialtyPicker } from "@/components/RecruitingPlan";
import { NextStep } from "@/components/BankDetail";
import { FirmsRanking } from "@/components/FirmsRanking";
import { DuplicatesNotice, OffSheetNotice } from "@/components/TrackerHygiene";
import { useBankViews, type BankView } from "@/components/useBankViews";

/**
 * Bank coverage (owner, 2026-11-21: "axe the current info", three tabs):
 * - Offices to fill: the outreach to-do list. Every office you recruit for that isn't maxed out (fewer than the cap
 *   awaiting a reply and nobody live / referral there), as nodes per bank that open to what the office is (seats,
 *   teams, notes from your COVERAGE tab), who's out there, and who to email next.
 * - Analytics: banks reached, live banks, outstanding emails, awaiting replies, where your banks are in the process,
 *   "what am I missing", and the firm ranking that used to be /firms.
 * - Settings: the recruiting plan (desks), the bank list (add, hide, starter list, specialists).
 * The board of banks moved to the Process tracker (/process).
 */
type Tab = "offices" | "analytics" | "settings";
const TABS: Tab[] = ["offices", "analytics", "settings"];

function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get("tab");
  return TABS.includes(t as Tab) ? (t as Tab) : "offices";
}

export default function CoveragePage() {
  const [tab, setTabState] = useState<Tab>(initialTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, "", t === "offices" ? "/coverage" : `/coverage?tab=${t}`);
  };
  const { views, rows } = useBankViews(true);
  const targets = useStore((s) => s.targets);
  const workbook = useStore((s) => s.workbook);
  const setCoverage = useStore((s) => s.setCoverage);
  const cap = useStore((s) => Math.max(1, s.settings.followUp.livePerBank));
  const ib = useMemo(() => views.filter((v) => !v.pe && !v.other), [views]);
  const toFill = useMemo(() => ib.filter((v) => v.slots.some((o) => !o.full)), [ib]);

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

  const openOffices = toFill.reduce((n, v) => n + v.slots.filter((o) => !o.full).length, 0);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Bank coverage"
        sub={
          tab === "offices"
            ? `Your outreach to-do list: offices with fewer than ${cap} waiting on a reply and nobody live there. Open one to see what the office is and who to email next.`
            : tab === "analytics"
              ? "How coverage is going across your banks, and every firm ranked on replies, calls, referrals and how your chats went."
              : "Which desks you're recruiting for and which banks are on your list."
        }
        right={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              ["offices", <span key="o">Offices to fill <span className="num text-muted">{openOffices}</span></span>],
              ["analytics", "Analytics"],
              ["settings", "Settings"],
            ]}
          />
        }
      />
      {tab === "offices" && <OfficesTab views={toFill} cap={cap} total={ib.length} />}
      {tab === "analytics" && <AnalyticsTab views={views} />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

/* ---------------- Offices to fill ---------------- */

const OFFICE_ORDER = ["SF", "NY", "LA", "Chicago", "Texas"];

function OfficesTab({ views, cap, total }: { views: BankView[]; cap: number; total: number }) {
  const [office, setOffice] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const offices = useMemo(() => [...new Set(views.flatMap((v) => v.slots.filter((o) => !o.full).map((o) => o.office)))].sort((a, b) => OFFICE_ORDER.indexOf(a) - OFFICE_ORDER.indexOf(b)), [views]);
  const list = useMemo(
    () =>
      views
        .filter((v) => !office || v.slots.some((o) => !o.full && o.office === office))
        .sort((a, b) => Number(b.app === "applied") - Number(a.app === "applied") || Number(b.starred) - Number(a.starred) || b.u.score - a.u.score || a.r.name.localeCompare(b.r.name)),
    [views, office],
  );
  const shown = all ? list : list.slice(0, 15);
  return (
    <>
      <DuplicatesNotice />
      <OffSheetNotice />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-[12px] font-medium text-muted">Office</span>
          {["", ...offices].map((o) => (
            <button
              key={o || "all"}
              type="button"
              aria-pressed={office === o}
              onClick={() => setOffice(o)}
              className={cn("rounded-full border px-2.5 py-1 text-[12px]", office === o ? "border-navy bg-navy text-white" : "border-line-2 bg-panel text-ink-2 hover:border-navy/50")}
            >
              {o || "All"}
            </button>
          ))}
          <span className="ml-auto text-[12px] text-muted">
            {list.length} of {total} banks have an office to fill · applications first, then urgency
          </span>
        </div>
        {!list.length ? (
          <Empty title="Every office is maxed out">Someone live or referral at each office you recruit for, or {cap} awaiting a reply. Nice.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((v) => (
              <OfficeBank key={v.r.key} v={v} cap={cap} open={open} setOpen={setOpen} filter={office} />
            ))}
          </ul>
        )}
        {list.length > 15 && (
          <button type="button" className="w-full border-t border-line px-4 py-2 text-left text-[12.5px] text-navy hover:underline" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${list.length} banks`}
          </button>
        )}
      </Card>
      <p className="-mt-2 text-[12px] text-muted">
        Maxed out = someone referral or live there (a chat, or a reply in the last 7 days), or {cap} people awaiting a reply. People who didn&apos;t answer your last
        follow-up by the end of that week move on by themselves, which frees their slot.
      </p>
    </>
  );
}

/** One bank: a node per office (open ones first), and the opened office's story. */
function OfficeBank({ v, cap, open, setOpen, filter }: { v: BankView; cap: number; open: string | null; setOpen: (k: string | null) => void; filter: string }) {
  const nodes = [...v.slots].sort((a, b) => Number(a.full) - Number(b.full) || OFFICE_ORDER.indexOf(a.office) - OFFICE_ORDER.indexOf(b.office));
  const openSlot = nodes.find((o) => open === `${v.r.key}|${o.office}`);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-[180px] flex-1 basis-[180px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-ink">{v.r.name}</span>
            {v.app === "applied" ? <Badge tone="green" className="px-1.5 py-0 text-[10.5px]">Applied</Badge> : null}
            {v.starred && <Badge tone="brass" className="px-1.5 py-0 text-[10.5px]">★</Badge>}
          </div>
          <div className="text-[11.5px] text-muted">{[v.r.tier, `urgency ${v.u.score}`, v.deadline ? `deadline ${new Date(v.deadline).toLocaleDateString()}` : ""].filter(Boolean).join(" · ")}</div>
        </div>
        {/* The offices as steps you can open. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {nodes.map((o, i) => {
            const key = `${v.r.key}|${o.office}`;
            const on = open === key;
            const dim = o.full || (filter && o.office !== filter);
            return (
              <span key={o.office} className="flex items-center gap-1.5">
                {i > 0 && <span className="h-px w-3 bg-line-2" aria-hidden />}
                <button
                  type="button"
                  aria-expanded={on}
                  onClick={() => setOpen(on ? null : key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px]",
                    on ? "border-navy bg-navy text-white" : o.full ? "border-green/40 bg-green-soft/40 text-ink-2" : "border-red/40 bg-red-soft/30 text-ink hover:border-red",
                    dim && !on && "opacity-60",
                  )}
                  title={o.full ? `${o.office} is maxed out` : `${o.office}: ${o.awaiting.length} of ${cap} awaiting, nobody live`}
                >
                  <b className="font-medium">{o.office}</b>
                  <span className="num">{o.full ? (o.referral.length ? "referral" : o.live.length ? "live" : `${o.awaiting.length}/${cap}`) : `${o.awaiting.length}/${cap}`}</span>
                  {on ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                </button>
              </span>
            );
          })}
        </div>
        <div className="basis-full sm:ml-auto sm:basis-auto">
          <NextStep t={v.w.next} />
        </div>
      </div>
      {openSlot && <OfficePanel v={v} o={openSlot} cap={cap} />}
    </li>
  );
}

const first = (c: Contact) => c.firstName || c.name;

/** What the office is, who's out there, who to email next, and the actions. */
function OfficePanel({ v, o, cap }: { v: BankView; o: OfficeSlot; cap: number }) {
  const info = officeInfo(v.r.name, o.office);
  const here = v.r.allContacts.filter((c) => locationMatches(o.office, c));
  const ready = here.filter((c) => !wasEmailed(c) && c.status === "new" && c.email);
  const needEmail = here.filter((c) => !wasEmailed(c) && c.status === "new" && !c.email);
  const movedOn = here.filter((c) => c.status === "ignored" && wasEmailed(c));
  const desk = encodeURIComponent(`${o.office}|${o.team}`);
  const name = encodeURIComponent(v.r.name);
  const notes = info?.notes?.split(" | ")[0];
  return (
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4 rounded-lg border border-line bg-subtle p-3.5 md:grid-cols-2">
      <div className="min-w-0 space-y-1.5 text-[12.5px]">
        <h4 className="text-[11.5px] font-medium tracking-[0.06em] text-muted uppercase">
          {v.r.name} · {o.office}
        </h4>
        <p className="text-ink-2">
          {info?.hires === false
            ? "Your lists say this office doesn't hire summer analysts. It's listed because you have people here."
            : info?.teams
              ? `Summer analysts here: ${info.teams}.`
              : `You recruit ${o.team} here.`}
          {info?.confidence ? <span className="text-muted"> ({info.confidence} confidence)</span> : null}
        </p>
        {notes && <p className="text-muted">{notes.length > 320 ? `${notes.slice(0, 320)}…` : notes}</p>}
        <p className="text-ink-2">
          <b className="font-medium text-ink">Why it&apos;s open:</b>{" "}
          {o.awaiting.length
            ? `${o.awaiting.length} of ${cap} awaiting a reply (${o.awaiting.map(first).join(", ")}), nobody live.`
            : movedOn.length
              ? `Everyone you emailed here moved on (${movedOn.slice(0, 3).map(first).join(", ")}${movedOn.length > 3 ? "…" : ""}). Start again with someone new.`
              : "Nobody emailed here yet."}
        </p>
      </div>
      <div className="min-w-0 space-y-2 text-[12.5px]">
        <div>
          <b className="font-medium text-ink">Email next:</b>{" "}
          {ready.length ? (
            <span className="text-ink-2">
              {ready.slice(0, 4).map((c) => `${c.name}${c.position ? ` (${c.position})` : ""}`).join(", ")}
              {ready.length > 4 ? ` +${ready.length - 4}` : ""}
            </span>
          ) : needEmail.length ? (
            <span className="text-ink-2">
              {needEmail.length} found without an email ({needEmail.slice(0, 3).map(first).join(", ")}): find their emails first.
            </span>
          ) : (
            <span className="text-ink-2">nobody found yet at this office.</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {ready.length > 0 && (
            <Link href={`/drafts?bank=${name}`} className="inline-flex items-center gap-1 rounded-lg bg-brass-strong px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-brass-hover">
              Draft {Math.min(ready.length, Math.max(1, cap - o.awaiting.length))} email{Math.min(ready.length, cap - o.awaiting.length) === 1 ? "" : "s"} <ArrowRight className="size-3" />
            </Link>
          )}
          {needEmail.length > 0 && (
            <Link href={`/sheet?view=contacts&filter=noemail&bank=${name}`} className="inline-flex items-center gap-1 rounded-lg border border-line-2 bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink hover:border-brass-strong">
              Find emails
            </Link>
          )}
          <Link href={`/find?banks=${name}&desk=${desk}`} className="inline-flex items-center gap-1 rounded-lg border border-line-2 bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink hover:border-brass-strong">
            Find {o.office} {o.team} people
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Analytics ---------------- */

function AnalyticsTab({ views }: { views: BankView[] }) {
  const [segment, setSegment] = useState<"ib" | "pe">("ib");
  const coverage = useStore((s) => s.coverage);
  const followUp = useStore((s) => s.settings.followUp);
  const { rows } = useBankViews(true);
  const pe = segment === "pe";
  const list = views.filter((v) => v.pe === pe);
  const cols = columnsOf(coverage);
  const t = useMemo(() => {
    const people = list.flatMap((v) => v.r.allContacts);
    const kinds = people.map((c) => liveKind(c));
    const owed = list.reduce((n, v) => n + v.w.todos.filter((x) => x.kind === "reply" || x.kind === "thank").reduce((m, x) => m + x.people.length, 0), 0);
    const followUps = list.reduce((n, v) => n + v.w.todos.filter((x) => x.kind === "follow_up").reduce((m, x) => m + x.people.length, 0), 0);
    const drafts = list.reduce((n, v) => n + v.w.drafts, 0);
    return {
      banks: list.length,
      reached: list.filter((v) => v.emailed > 0).length,
      liveBanks: list.filter((v) => v.r.allContacts.some((c) => liveKind(c) === "live" || liveKind(c) === "referral")).length,
      awaiting: kinds.filter((k) => k === "awaiting").length,
      livePeople: kinds.filter((k) => k === "live").length,
      outstanding: owed + followUps + drafts,
      owed,
      followUps,
      drafts,
      live: people.filter(isLive).length,
    };
  }, [list]);
  const byCol = cols.map((c) => ({ c, n: list.filter((v) => v.column.id === c.id).length }));
  const maxCol = Math.max(1, ...byCol.map((x) => x.n));
  const insights = useMemo(
    () => coverageInsights(rows, pe ? [] : (coverage.plan ?? []), rows.flatMap((r) => r.contacts), followUp.livePerBank).filter((i) => !pe || i.kind === "quiet" || i.kind === "applied"),
    [rows, coverage.plan, followUp.livePerBank, pe],
  );
  return (
    <>
      {views.some((v) => v.pe) && (
        <Segmented
          className="justify-self-start"
          value={segment}
          onChange={setSegment}
          options={[
            ["ib", "Investment banks"],
            ["pe", "Private equity"],
          ]}
        />
      )}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={pe ? "Firms reached" : "Banks reached"} value={t.reached} ring={t.banks ? t.reached / t.banks : 0} sub={`of ${t.banks} you're tracking`} />
        <Kpi label={pe ? "Live firms" : "Live banks"} value={t.liveBanks} sub={`a referral or someone live · ${t.livePeople} ${t.livePeople === 1 ? "person" : "people"} live`} tone={t.liveBanks ? "good" : undefined} />
        <Kpi
          label="Outstanding emails"
          value={t.outstanding}
          sub={[t.owed && `${t.owed} replies / thank-yous`, t.followUps && `${t.followUps} follow-ups`, t.drafts && `${t.drafts} drafts`].filter(Boolean).join(" · ") || "nothing waiting on you"}
          tone={t.owed ? "bad" : t.outstanding ? undefined : "good"}
        />
        <Kpi label="Awaiting replies" value={t.awaiting} sub="emailed, no reply yet, not moved on" />
      </div>

      <Card>
        <CardHeader
          title="Where your banks are"
          sub="By Process tracker step."
          right={
            <Link href="/process" className="flex items-center gap-1 text-[12.5px] font-medium text-navy hover:underline">
              Open the Process tracker <ArrowRight className="size-3" />
            </Link>
          }
        />
        <ul className="space-y-2 px-5 py-4">
          {byCol.map(({ c, n }) => (
            <li key={c.id} className="grid grid-cols-[140px_minmax(0,1fr)_40px] items-center gap-3 text-[12.5px]">
              <span className="truncate text-ink-2">{c.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-track">
                <span className="block h-full rounded-full bg-chart" style={{ width: `${(n / maxCol) * 100}%` }} />
              </span>
              <span className="num text-right text-ink">{n}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Insights items={insights} />

      <FirmsRanking />
    </>
  );
}

function Insights({ items }: { items: Insight[] }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const list = all ? items : items.slice(0, 4);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Lightbulb className="size-4 text-brass" /> What am I missing
          </span>
        }
        sub="For the desks in your plan (Settings tab), or your usual desks."
      />
      <ul className="space-y-1.5 px-5 py-3 text-[13px]">
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
        {items.length > 4 && (
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

/* ---------------- Settings ---------------- */

function SettingsTab() {
  const coverage = useStore((s) => s.coverage);
  const setCoverage = useStore((s) => s.setCoverage);
  const { rows } = useBankViews(true);
  const [newBank, setNewBank] = useState("");
  const [newTier, setNewTier] = useState("Elite Boutique");
  const active = activeDesks(coverage.plan);
  const hidden = rows.filter((r) => r.bucket === "hidden");
  const specialists = rows.filter((r) => r.notOffered && r.specialty && r.bucket !== "hidden");
  return (
    <>
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <ListChecks className="size-4 text-brass" /> Recruiting plan (desks)
            </span>
          }
          sub={active.length ? `${active.length} desk${active.length > 1 ? "s" : ""} checked: only the banks they apply to are listed under Offices to fill and Analytics.` : "Check desks to list only the banks they apply to. Nothing checked = every bank."}
        />
        <div className="p-5">
          <RecruitingPlan rows={rows} />
          <DeskChecklist rows={rows} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Your bank list" sub="Banks come from your contacts, your bank tabs, and any list of firms in the spreadsheet (e.g. an OVERVIEW tab with “Institution Name / Institution Type”)." />
        <div className="space-y-4 p-5">
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
              toast.ok(tabs.added.length ? `Added ${name}, with a "${tabs.added[0].tab}" tab and an OVERVIEW row. Save the spreadsheet to write them.` : `Added ${name}.`);
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
          {specialists.length > 0 && (
            <div className="rounded-md border border-line bg-subtle px-3 py-2 text-[12px] text-ink-2">
              <div className="mb-1 font-medium">Specialists outside your desks (left out of the lists; still on the Process tracker)</div>
              <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
                {specialists.map((r) => (
                  <li key={r.key} className="flex items-center gap-1">
                    {r.name}
                    <SpecialtyPicker r={r} compact />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="mb-1.5 text-[12.5px] font-medium text-ink">Hidden banks ({hidden.length})</div>
            {hidden.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {hidden
                  .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name))
                  .map((r) => (
                    <li key={r.key}>
                      <button
                        onClick={() => setCoverage((c) => ({ ...c, hidden: c.hidden.filter((k) => k !== r.key) }))}
                        className="flex items-center gap-1 rounded-full border border-line-2 px-2.5 py-1 text-[12px] text-ink-2 hover:border-navy/50"
                        title="Show again"
                      >
                        <Undo2 className="size-3" /> {r.name}
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-[12px] text-muted">None. Hide a bank from its ⋯ menu on the Process tracker when you&apos;re not recruiting there.</p>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}

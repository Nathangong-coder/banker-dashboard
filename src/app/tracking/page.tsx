"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, CheckCheck, Forward, MailCheck, Search, Settings2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { readingHeatmap } from "@/lib/opens";
import { dimensionOf, TIME_BUCKETS } from "@/lib/segments";
import {
  durationLabel,
  hourDayIn,
  kindLabel,
  openRateBy,
  silentFirms,
  trackedRows,
  trackingKpis,
  tzFor,
  whenIn,
  whenMine,
  type RateRow,
  type TrackedRow,
} from "@/lib/trackingView";
import type { Contact } from "@/lib/types";
import { cn } from "@/lib/util";
import { Badge, Card, CardHeader, Checkbox, Empty, Input, Kpi, Menu, PageHeader, Segmented, Select } from "@/components/ui";
import { TrackingDetail } from "@/components/TrackingDetail";
import { ContactModal } from "@/components/ContactModal";

export default function TrackingPage() {
  return (
    <Suspense>
      <TrackingInner />
    </Suspense>
  );
}

type Filter = "all" | "opened" | "not" | "replied" | "forwarded";
type View = "emails" | "insights";

const FAMILY: Record<string, string> = { outlook: "Outlook", gmail: "Gmail", "apple-mail": "Apple Mail", other: "Mail app" };
const pct = (x?: number) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const dayOf = (r: TrackedRow) => (r.m.sentAt ?? r.m.createdAt).slice(0, 10);

function TrackingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const view: View = params.get("view") === "insights" ? "insights" : "emails";
  const deep = params.get("id");
  const tracking = useStore((s) => s.tracking);
  const contacts = useStore((s) => s.contacts);
  const on = useStore((s) => !!s.settings.tracking?.on);

  const [open, setOpen] = useState<string | null>(deep);
  const [prevDeep, setPrevDeep] = useState(deep);
  if (deep !== prevDeep) {
    setPrevDeep(deep);
    setOpen(deep);
  }
  const [contact, setContact] = useState<Contact | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [firm, setFirm] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showOther, setShowOther] = useState(false);

  const rows = useMemo(() => trackedRows(tracking.messages, contacts, tracking.mx), [tracking, contacts]);
  const kpis = useMemo(() => trackingKpis(rows, tracking.mx), [rows, tracking.mx]);
  const firms = useMemo(() => [...new Set(rows.map((r) => r.firm).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows]);

  const base = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (firm && r.firm !== firm) return false;
      const d = dayOf(r);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (!needle) return true;
      return [r.c?.name, r.firm, r.m.subject, ...r.m.to].some((x) => x?.toLowerCase().includes(needle));
    });
  }, [rows, q, firm, from, to]);
  const counts = useMemo(
    () => ({
      opened: base.filter((r) => r.s.opens > 0).length,
      not: base.filter((r) => r.m.sentAt && !r.s.opens).length,
      replied: base.filter((r) => r.replied).length,
      forwarded: base.filter((r) => r.s.forwarded).length,
    }),
    [base],
  );
  const shown = base.filter((r) =>
    filter === "opened" ? r.s.opens > 0 : filter === "not" ? !!r.m.sentAt && !r.s.opens : filter === "replied" ? r.replied : filter === "forwarded" ? r.s.forwarded : true,
  );
  const selected = open ? rows.find((r) => r.m.id === open) : undefined;

  const setView = (v: View) => router.replace(v === "insights" ? "/tracking?view=insights" : "/tracking");
  const n = (label: string, x: number) => (
    <span>
      {label} <span className="num text-muted">{x}</span>
    </span>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Email tracking"
        sub="Which emails were opened, when, and on what, in the recipient's time zone. Scanners, Apple's privacy proxy and your own views aren't counted."
        right={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                ["emails", "Emails"],
                ["insights", "Insights"],
              ]}
            />
            <Menu items={[{ label: "Open tracking settings", hint: "Settings → Email → Sending → Track opens", icon: <Settings2 />, onClick: () => router.push("/settings?tab=email&sub=sending") }]} />
          </>
        }
      />

      {!on && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-panel px-4 py-2.5 text-[13px] text-ink-2">
          <MailCheck className="size-4 shrink-0 text-brass" />
          {tracking.messages.length ? "Open tracking is off: new emails go out without it (emails already tracked keep reporting)." : "Open tracking is off. Turn it on to see who opens your emails."}
          <Link href="/settings?tab=email&sub=sending" className="font-medium text-navy hover:underline">
            Turn it on
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Tracked emails sent" value={kpis.sent} sub={`${rows.length - kpis.sent} not sent yet`} />
        <Kpi label="Opened at least once" value={kpis.opened} ring={kpis.share} sub={kpis.sent ? `at least ${pct(kpis.share)}` : "nothing sent yet"} />
        <Kpi label="Replied" value={kpis.replied} sub={kpis.sent ? `${pct(kpis.replied / kpis.sent)} of tracked` : "–"} tone={kpis.replied ? "good" : undefined} />
        <Kpi label="Median time to first open" value={durationLabel(kpis.medianToOpen)} sub="after it was sent" />
        <Kpi label="Possibly forwarded" value={kpis.forwarded} sub="opened in a second place" />
      </div>

      {view === "insights" ? (
        <Insights rows={rows} />
      ) : (
        <div className={cn("grid grid-cols-[minmax(0,1fr)] items-start gap-4", selected && "xl:grid-cols-[minmax(0,1fr)_440px]")}>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  ["all", n("All", base.length)],
                  ["opened", n("Opened", counts.opened)],
                  ["not", n("Not opened", counts.not)],
                  ["replied", n("Replied", counts.replied)],
                  ["forwarded", n("Possibly forwarded", counts.forwarded)],
                ]}
              />
              <div className="ml-auto flex w-full flex-wrap items-center gap-2 lg:w-auto">
                <label className="flex h-8 w-full items-center gap-2 rounded-lg border border-line-2 bg-panel px-2.5 text-[13px] text-muted sm:w-52">
                  <Search className="size-3.5 shrink-0" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, subject, address…" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" aria-label="Search tracked emails" />
                </label>
                <Select className="h-8" value={firm} onChange={(e) => setFirm(e.target.value)} aria-label="Firm">
                  <option value="">All firms</option>
                  {firms.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
                <Input type="date" className="h-8 w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Sent from" title="Sent from" />
                <Input type="date" className="h-8 w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Sent until" title="Sent until" />
                <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                  <Checkbox checked={showOther} onChange={setShowOther} label="Show scanner and your own views" />
                  Show scanner / your own views
                </label>
              </div>
            </div>
            {shown.length === 0 ? (
              <Empty icon={<MailCheck className="size-6" />} title={rows.length ? "No emails match" : "No tracked emails yet"}>
                {rows.length ? "Try another filter." : on ? "Emails Coverage makes from now on carry an invisible image, and opens show up here." : "Turn on open tracking in Settings → Email → Sending."}
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-subtle text-left text-[11px] font-medium tracking-[0.06em] text-muted uppercase">
                      <th className="px-4 py-2.5 font-medium">Recipient</th>
                      <th className="px-3 py-2.5 font-medium">Email</th>
                      <th className="px-3 py-2.5 font-medium">Sent</th>
                      <th className="px-3 py-2.5 text-right font-medium">Opens</th>
                      <th className="px-3 py-2.5 font-medium">First / last open</th>
                      <th className="px-3 py-2.5 font-medium">Last seen on</th>
                      <th className="px-3 py-2.5 font-medium">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <EmailRow key={r.m.id} r={r} showOther={showOther} selected={r.m.id === open} onOpen={() => setOpen(r.m.id === open ? null : r.m.id)} onContact={() => r.c && setContact(r.c)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {selected && (
            <>
              <div className="fixed inset-0 z-40 bg-ink/25 xl:hidden" onClick={() => setOpen(null)} />
              <Card className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col overflow-hidden rounded-none border-y-0 border-r-0 shadow-2xl xl:sticky xl:top-[4.5rem] xl:z-auto xl:max-h-[calc(100vh-6rem)] xl:w-auto xl:max-w-none xl:rounded-xl xl:border xl:shadow-none">
                <TrackingDetail row={selected} onClose={() => setOpen(null)} onOpenContact={selected.c ? () => setContact(selected.c!) : undefined} />
              </Card>
            </>
          )}
        </div>
      )}

      <ContactModal contact={contact} onClose={() => setContact(null)} />
    </div>
  );
}

function EmailRow({ r, showOther, selected, onOpen, onContact }: { r: TrackedRow; showOther: boolean; selected: boolean; onOpen: () => void; onContact: () => void }) {
  const { m, c, s } = r;
  const tz = tzFor(c);
  const who = c?.name ?? (m.to[0] || "Unknown recipient");
  return (
    <tr onClick={onOpen} className={cn("group cursor-pointer border-b border-line last:border-b-0", selected ? "bg-brass-soft/50" : "hover:bg-subtle")}>
      <td className="px-4 py-2.5">
        <div className="max-w-[220px] min-w-0">
          {c ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onContact();
              }}
              className="block max-w-full truncate font-medium text-ink hover:underline"
            >
              {who}
            </button>
          ) : (
            <div className="truncate font-medium text-ink" title={m.to.join(", ")}>
              {who}
            </div>
          )}
          <div className="truncate text-[12px] text-muted">{c ? r.firm : [r.firm, "Not in tracker"].filter(Boolean).join(" · ")}</div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="max-w-[260px] min-w-0">
          <div className="text-[12px] text-muted">{kindLabel(m)}</div>
          <div className="truncate text-ink" title={m.subject}>
            {m.subject || "(no subject)"}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {m.sentAt ? (
          <span className="inline-flex items-center gap-1.5" title={`Your time: ${whenMine(m.sentAt)}`}>
            {s.opens ? <CheckCheck className="size-4 text-green" aria-label="Opened" /> : <Check className="size-4 text-muted" aria-label="Sent" />}
            <span className="num text-[12.5px] text-ink-2">{whenIn(m.sentAt, tz)}</span>
          </span>
        ) : (
          <Badge>Not sent yet</Badge>
        )}
      </td>
      <td className="num px-3 py-2.5 text-right whitespace-nowrap text-ink">
        {s.opens || <span className="text-muted">0</span>}
        {showOther && r.other > 0 && <span className="ml-1 text-[11.5px] text-muted">+{r.other} other</span>}
      </td>
      <td className="px-3 py-2.5 text-[12.5px] whitespace-nowrap text-ink-2">
        {s.firstAt ? (
          <>
            <div title={`Your time: ${whenMine(s.firstAt)}`}>{whenIn(s.firstAt, tz)}</div>
            {s.lastAt && s.lastAt !== s.firstAt && (
              <div className="text-muted" title={`Your time: ${whenMine(s.lastAt)}`}>
                {whenIn(s.lastAt, tz)}
              </div>
            )}
          </>
        ) : (
          <span className="text-muted">–</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-[12.5px] whitespace-nowrap text-ink-2">
        {s.lastClient ? [FAMILY[s.lastClient] ?? s.lastClient, s.lastCity].filter(Boolean).join(" · ") : <span className="text-muted">–</span>}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          {s.forwarded && (
            <Badge tone="amber">
              <Forward className="size-3" /> Forwarded?
            </Badge>
          )}
          {r.replied && <Badge tone="blue">Replied</Badge>}
        </div>
      </td>
    </tr>
  );
}

/* ---------------- insights ---------------- */

type By = "template" | "hook" | "hour" | "day" | "firm";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Insights({ rows }: { rows: TrackedRow[] }) {
  const mx = useStore((s) => s.tracking.mx);
  const messages = useStore((s) => s.tracking.messages);
  const contacts = useStore((s) => s.contacts);
  const settings = useStore((s) => s.settings);
  const templates = useStore((s) => s.templates);
  const [by, setBy] = useState<By>("hour");

  const rates = useMemo(() => {
    const ctx = { settings, templates };
    const keyOf = (r: TrackedRow): { key: string; label: string } | undefined => {
      if (by === "firm") return r.firm ? { key: r.firm, label: r.firm } : undefined;
      if (by === "hour" || by === "day") {
        if (!r.m.sentAt) return undefined;
        const { hour, day } = hourDayIn(r.m.sentAt, tzFor(r.c));
        if (by === "day") return { key: day, label: day };
        const b = TIME_BUCKETS.find((x) => hour >= x.from && hour < x.to);
        return b && { key: b.id, label: b.label };
      }
      // template / hook describe the first email's draft
      if (!r.c || r.m.kind !== "first") return undefined;
      return dimensionOf(r.c, by, ctx);
    };
    const order = by === "day" ? DAYS : by === "hour" ? TIME_BUCKETS.map((b) => b.id) : undefined;
    return openRateBy(rows, mx, keyOf, order);
  }, [rows, mx, by, settings, templates]);

  const heat = useMemo(() => {
    const byId = new Map(contacts.map((c) => [c.id, c]));
    return readingHeatmap(messages, mx, (m) => tzFor(m.contactId ? byId.get(m.contactId) : undefined));
  }, [messages, mx, contacts]);
  const silent = useMemo(() => silentFirms(rows), [rows]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
      <Card className="overflow-hidden">
        <CardHeader
          title="Open rate"
          sub="Share of tracked emails seen opened at least once, with its 95% range. Send hour and day are in the recipient's time zone."
          right={
            <Select className="h-8" value={by} onChange={(e) => setBy(e.target.value as By)} aria-label="Open rate by">
              <option value="hour">By send time</option>
              <option value="day">By day sent</option>
              <option value="template">By template (first emails)</option>
              <option value="hook">By hook (first emails)</option>
              <option value="firm">By firm</option>
            </Select>
          }
        />
        {rates.length === 0 ? <Empty title="Nothing to compare yet">Open rates appear once tracked emails have gone out.</Empty> : <RateTable list={rates} />}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="When bankers read" sub="Real opens by weekday and hour, in each recipient's time zone. Darker = more opens." />
        <Heatmap heat={heat} />
      </Card>

      <Card className="overflow-hidden xl:col-span-2">
        <CardHeader title="Firms that may block images" sub="3 or more tracked emails and not one open seen. Their mail likely hides images, so “not opened” there means unknown, not ignored." />
        {silent.length === 0 ? (
          <p className="px-5 py-4 text-[12.5px] text-muted">None so far.</p>
        ) : (
          <ul className="flex flex-wrap gap-2 px-5 py-4">
            {silent.map((f) => (
              <li key={f.firm}>
                <Badge>
                  {f.firm} · {f.sent} sent
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RateTable({ list }: { list: RateRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-[13px]">
        <thead>
          <tr className="border-b border-line bg-subtle text-left text-[11px] font-medium tracking-[0.06em] text-muted uppercase">
            <th className="px-4 py-2.5 font-medium">Group</th>
            <th className="px-3 py-2.5 font-medium">Opened</th>
            <th className="px-3 py-2.5 text-right font-medium">Sent</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const rate = r.sent ? r.opened / r.sent : 0;
            return (
              <tr key={r.key} className="border-b border-line last:border-b-0">
                <td className="max-w-[220px] truncate px-4 py-2 text-ink" title={r.label}>
                  {r.label}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2" title={`${r.opened} of ${r.sent} opened · 95% range ${pct(r.low)}–${pct(r.high)}`}>
                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-chart-soft">
                      <div className="h-full rounded-full bg-chart" style={{ width: `${rate * 100}%` }} />
                    </div>
                    <span className={cn("num text-[12.5px]", r.sent < 5 ? "text-muted" : "text-ink")}>{pct(rate)}</span>
                    <span className="num text-[11.5px] text-muted">
                      {pct(r.low)}–{pct(r.high)}
                    </span>
                  </div>
                </td>
                <td className="num px-3 py-2 text-right text-ink-2">{r.sent}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** readingHeatmap rows are Sun..Sat; shown Mon..Sun. */
function Heatmap({ heat }: { heat: number[][] }) {
  const max = Math.max(0, ...heat.flat());
  if (!max) return <Empty title="No opens yet">The chart fills in as people open your tracked emails.</Empty>;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
  return (
    <div className="overflow-x-auto px-4 py-4">
      <div className="grid min-w-[560px] grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[2px] text-[10.5px] text-muted">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center">
            {h % 3 === 0 ? hourLabel(h) : ""}
          </span>
        ))}
        {order.map((d, i) => (
          <HeatRow key={d} label={DAYS[i]} values={heat[d]} max={max} hourLabel={hourLabel} />
        ))}
      </div>
    </div>
  );
}

function HeatRow({ label, values, max, hourLabel }: { label: string; values: number[]; max: number; hourLabel: (h: number) => string }) {
  return (
    <>
      <span className="self-center">{label}</span>
      {values.map((v, h) => (
        <span
          key={h}
          className="aspect-square rounded-[3px] bg-chart-soft"
          style={v ? { background: `color-mix(in srgb, var(--chart) ${Math.round(25 + (v / max) * 75)}%, var(--chart-soft))` } : undefined}
          title={`${label} ${hourLabel(h)}: ${v} open${v === 1 ? "" : "s"}`}
        />
      ))}
    </>
  );
}

"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Mail, Search } from "lucide-react";
import { useStore } from "@/lib/store";
import { nextAction } from "@/lib/followups";
import { buildCoverage } from "@/lib/coverage";
import { relationshipItem } from "@/lib/reminders";
import { LABELS } from "@/lib/digestFormat";
import type { Contact } from "@/lib/types";
import { DAY, cn, fmtDate, relDays } from "@/lib/util";
import { Badge, Card, CardHeader, Kpi, PageHeader } from "@/components/ui";
import { WorkbookEmpty } from "@/components/WorkbookControls";

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = name.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Tone = "green" | "blue" | "brass" | "amber" | "neutral" | "red";
interface TonightRow {
  c: Contact;
  label: string;
  tone: Tone;
  href: string;
  rank: number;
  when?: Date;
}

/** Relationship items first (same order as the 9 PM text), then follow-ups, then drafts waiting to go out. */
const RELATIONSHIP: Record<string, { tone: Tone; href: string }> = {
  [LABELS.thankToday]: { tone: "green", href: "/followups" },
  [LABELS.infoSession]: { tone: "brass", href: "/info-sessions" },
  [LABELS.thankOwed]: { tone: "green", href: "/followups" },
  [LABELS.replyOwed]: { tone: "blue", href: "/followups" },
  [LABELS.checkIn]: { tone: "neutral", href: "/followups" },
};
const RANK = Object.keys(RELATIONSHIP);

const REPLIED = new Set(["replied", "call_scheduled", "done"]);
const EMAILED = new Set(["sent", "followed_up", ...REPLIED]);

export default function Overview() {
  const contacts = useStore((s) => s.contacts);
  const banks = useStore((s) => s.banks);
  const fu = useStore((s) => s.settings.followUp);
  const meta = useStore((s) => s.workbook);
  const profileName = useStore((s) => s.settings.profile.name);
  const tables = useStore((s) => s.tables);
  const targets = useStore((s) => s.targets);
  const coverage = useStore((s) => s.coverage);

  const tonight = useMemo(() => {
    const now = new Date();
    const day = localDay(now);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const rows: TonightRow[] = [];
    for (const c of contacts) {
      const it = relationshipItem(c, day, end);
      if (it && RELATIONSHIP[it.label]) {
        rows.push({ c, label: it.label, ...RELATIONSHIP[it.label], rank: RANK.indexOf(it.label) });
        continue;
      }
      const a = nextAction(c, fu, banks[`${c.bank}|${c.region}`]);
      if (!a.isDue) continue;
      if (a.kind === "follow_up") rows.push({ c, label: a.label, tone: "amber", href: "/followups", rank: 10, when: a.due });
      else if (a.kind === "move_on") rows.push({ c, label: a.label, tone: "neutral", href: "/followups", rank: 11, when: a.due });
      else if (a.kind === "send") rows.push({ c, label: a.label, tone: "brass", href: "/drafts", rank: 12 });
    }
    return rows.sort((x, y) => x.rank - y.rank || (x.when?.getTime() ?? 0) - (y.when?.getTime() ?? 0));
  }, [contacts, banks, fu]);

  const stats = useMemo(() => {
    const now = new Date().getTime();
    const weekAgo = now - 7 * DAY;
    const reachedList = contacts.filter((c) => c.sentAt || EMAILED.has(c.status));
    const reached = reachedList.length;
    const replied = contacts.filter((c) => REPLIED.has(c.status)).length;
    const calls = contacts.filter((c) => c.call || c.status === "call_scheduled" || c.chats?.length).length;
    const upcomingCalls = contacts.filter((c) => c.call && new Date(c.call.at).getTime() > now).length;
    const referrals = contacts.filter((c) => c.referral).length;
    const noEmail = contacts.filter((c) => !c.email && c.status !== "ignored").length;

    // Every email we know a date for: the first one, plus the latest follow-up when it's a different day.
    const sends: number[] = [];
    let emails = 0;
    for (const c of reachedList) {
      emails += 1 + (c.followUps || 0);
      if (c.sentAt) sends.push(new Date(c.sentAt).getTime());
      const last = c.lastEmailedAt ?? c.lastTouchAt;
      if (last && c.followUps > 0 && (!c.sentAt || localDay(new Date(last)) !== localDay(new Date(c.sentAt)))) sends.push(new Date(last).getTime());
    }
    const thisWeek = sends.filter((t) => t >= weekAgo && t <= now).length;
    const perDay = new Map<string, number>();
    for (const t of sends) if (t <= now) perDay.set(localDay(new Date(t)), (perDay.get(localDay(new Date(t))) ?? 0) + 1);
    const days = [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-10);
    return { reached, replied, calls, upcomingCalls, referrals, noEmail, emails, thisWeek, days };
  }, [contacts]);

  const cov = useMemo(() => {
    const rows = buildCoverage({ contacts, tables, targets, coverage: { ...coverage, plan: undefined }, banks, followUp: fu }).filter((r) => r.bucket !== "hidden");
    return { total: rows.length, reached: rows.filter((r) => r.bucket === "reached").length, cold: rows.filter((r) => r.bucket === "cold").length };
  }, [contacts, tables, targets, coverage, banks, fu]);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const title = greeting(profileName);

  if (!meta && contacts.length === 0) {
    return (
      <>
        <PageHeader title={title} sub={`${today} · Your IB networking pipeline in one place.`} />
        <WorkbookEmpty />
      </>
    );
  }

  const n = tonight.length;
  const replyRate = stats.reached ? stats.replied / stats.reached : 0;
  const maxDay = Math.max(1, ...stats.days.map(([, v]) => v));
  const funnel = [
    { label: "Contacts", value: contacts.filter((c) => c.status !== "ignored" || c.sentAt).length },
    { label: "Emailed", value: stats.reached },
    { label: "Replied", value: stats.replied },
    { label: "Calls", value: stats.calls },
    { label: "Referrals", value: stats.referrals },
  ];
  const funnelMax = Math.max(1, funnel[0].value);

  return (
    <>
      <PageHeader
        title={title}
        sub={
          <>
            {today} · {n ? `${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you tonight` : "Nothing needs you tonight"}
          </>
        }
        right={
          <>
            <Link
              href="/find"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-2 bg-panel px-3.5 text-[13.5px] font-medium whitespace-nowrap text-ink hover:border-muted/60 hover:bg-subtle"
            >
              <Search className="size-3.5" /> Find people
            </Link>
            <Link
              href="/drafts"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brass-strong px-3.5 text-[13.5px] font-medium whitespace-nowrap text-white hover:bg-brass-hover"
            >
              <Mail className="size-3.5" /> Draft emails
            </Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Emails sent" value={stats.emails} sub={stats.thisWeek ? `+${stats.thisWeek} this week` : "None this week"} tone={stats.thisWeek ? "good" : undefined} />
        <Kpi label="Reply rate" value={stats.reached ? `${Math.round(replyRate * 100)}%` : "—"} sub={`${stats.replied} of ${stats.reached} replied`} ring={replyRate} />
        <Kpi label="Calls booked" value={stats.calls} sub={stats.upcomingCalls ? `${stats.upcomingCalls} coming up` : `${stats.referrals} referral${stats.referrals === 1 ? "" : "s"}`} />
        <Kpi
          label="Banks reached"
          value={`${cov.reached}/${cov.total}`}
          sub={
            <Link href="/coverage" className="underline decoration-line-2 underline-offset-2 hover:text-ink">
              {cov.cold} cold · coverage
            </Link>
          }
          ring={cov.total ? cov.reached / cov.total : 0}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader
            title="Tonight"
            sub="Thank-yous, replies you owe, follow-ups due and drafts waiting to go out"
            right={
              <Link href="/followups" className="text-[12.5px] font-medium text-brass-ink hover:underline">
                All follow-ups
              </Link>
            }
          />
          {n === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-muted">
              Nothing due tonight.{" "}
              <Link href="/find" className="font-medium text-brass-ink hover:underline">
                Find more people
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {tonight.slice(0, 8).map(({ c, label, tone, href, when }) => (
                <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge tone={tone}>{label}</Badge>
                      <span className="truncate text-[13.5px] font-medium text-ink">{c.name}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-muted">
                      {[c.position, c.bank && `${c.bank}${c.region !== "Other" ? ` (${c.region})` : ""}`, when && `due ${relDays(when)}`].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <Link
                    href={href}
                    className="inline-flex h-7 shrink-0 items-center rounded-lg border border-line-2 bg-panel px-2.5 text-[12.5px] font-medium text-ink hover:border-muted/60 hover:bg-subtle"
                  >
                    Open
                  </Link>
                </li>
              ))}
              {n > 8 && (
                <li className="px-5 py-2.5 text-[12.5px] text-muted">
                  <Link href="/followups" className="font-medium text-brass-ink hover:underline">
                    {n - 8} more
                  </Link>
                </li>
              )}
            </ul>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Emails per send day" sub={stats.days.length ? `Last ${stats.days.length} days you sent anything` : "No send dates yet"} />
            {stats.days.length ? (
              <div className="px-5 pt-4 pb-3">
                <div className="flex h-28 items-end gap-1.5" role="img" aria-label={stats.days.map(([d, v]) => `${fmtDate(`${d}T12:00:00`)}: ${v}`).join(", ")}>
                  {stats.days.map(([d, v], i) => (
                    <div key={d} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${fmtDate(`${d}T12:00:00`)}: ${v} email${v === 1 ? "" : "s"}`}>
                      <span className="num text-[10.5px] text-muted">{v}</span>
                      <div className={cn("w-full rounded-t-[4px]", i === stats.days.length - 1 ? "bg-brass" : "bg-chart")} style={{ height: `${Math.max(4, (v / maxDay) * 100)}%` }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  {stats.days.map(([d]) => (
                    <span key={d} className="num min-w-0 flex-1 truncate text-center text-[10.5px] text-muted">
                      {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-5 py-8 text-center text-[12.5px] text-muted">Sync with Gmail or fill the Contacted column to see this.</div>
            )}
          </Card>

          <Card>
            <CardHeader title="Funnel" sub="From everyone on your list to referrals" />
            <div className="space-y-2.5 px-5 py-4">
              {funnel.map((f) => (
                <div key={f.label} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-[12.5px] text-ink-2">{f.label}</span>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-track">
                    <div className="h-full rounded-full bg-chart" style={{ width: `${(f.value / funnelMax) * 100}%`, minWidth: f.value ? 4 : 0 }} />
                  </div>
                  <span className="num w-10 shrink-0 text-right text-[12.5px] text-ink">{f.value}</span>
                </div>
              ))}
            </div>
            {stats.noEmail > 0 && (
              <div className="border-t border-line px-5 py-2.5 text-[12.5px] text-muted">
                {stats.noEmail} contact{stats.noEmail === 1 ? "" : "s"} missing an email ·{" "}
                <Link href="/sheet?view=contacts&filter=noemail" className="font-medium text-brass-ink hover:underline">
                  Find emails
                </Link>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, BellRing, Mail, Search, Sparkles } from "lucide-react";
import { useStore } from "@/lib/store";
import { nextAction, rollupBanks } from "@/lib/followups";
import { buildCoverage } from "@/lib/coverage";
import { STATUS_LABEL, type Status } from "@/lib/types";
import { fmtDate, relDays } from "@/lib/util";
import { Badge, Card, CardHeader, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { UploadButton, WorkbookEmpty } from "@/components/WorkbookControls";

function greeting(name: string) {
  if (!name) return "Overview";
  const h = new Date().getHours();
  const part = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
  return `${part}, ${name.split(" ")[0]}.`;
}

const FUNNEL: Status[] = ["new", "drafted", "sent", "followed_up", "replied", "call_scheduled", "done"];

export default function Overview() {
  const contacts = useStore((s) => s.contacts);
  const banks = useStore((s) => s.banks);
  const fu = useStore((s) => s.settings.followUp);
  const meta = useStore((s) => s.workbook);
  const profileName = useStore((s) => s.settings.profile.name);

  const stats = useMemo(() => {
    const noEmail = contacts.filter((c) => !c.email && c.status !== "ignored").length;
    const reached = contacts.filter((c) => !["new", "drafted"].includes(c.status)).length;
    const replied = contacts.filter((c) => ["replied", "call_scheduled", "done"].includes(c.status)).length;
    const due = contacts
      .map((c) => ({ c, a: nextAction(c, fu, banks[`${c.bank}|${c.region}`]) }))
      .filter(({ a }) => a.isDue && (a.kind === "follow_up" || a.kind === "move_on" || a.kind === "send"))
      .sort((x, y) => (x.a.due?.getTime() ?? 0) - (y.a.due?.getTime() ?? 0));
    const byStatus = Object.fromEntries(FUNNEL.map((s) => [s, contacts.filter((c) => c.status === s).length]));
    return { noEmail, reached, replied, due, byStatus };
  }, [contacts, banks, fu]);

  const rollups = useMemo(() => rollupBanks(contacts, banks, fu), [contacts, banks, fu]);
  const tables = useStore((s) => s.tables);
  const targets = useStore((s) => s.targets);
  const coverage = useStore((s) => s.coverage);
  const cov = useMemo(() => {
    const rows = buildCoverage({ contacts, tables, targets, coverage, banks, followUp: fu }).filter((r) => r.bucket !== "hidden");
    return { total: rows.length, reached: rows.filter((r) => r.bucket === "reached").length, cold: rows.filter((r) => r.bucket === "cold").length };
  }, [contacts, tables, targets, coverage, banks, fu]);

  if (!meta && contacts.length === 0) {
    return (
      <>
        <PageHeader title={greeting(profileName)} sub="Your IB networking pipeline in one place." />
        <WorkbookEmpty />
      </>
    );
  }

  const maxFunnel = Math.max(1, ...Object.values(stats.byStatus));

  return (
    <>
      <PageHeader
        title={greeting(profileName)}
        sub={
          meta ? (
            <>
              Working from <span className="font-medium">{meta.fileName}</span> · imported {fmtDate(meta.loadedAt)}
            </>
          ) : (
            "Your IB networking pipeline"
          )
        }
        right={<UploadButton />}
      />

      <Card className="mb-6 grid grid-cols-2 divide-line md:grid-cols-5 md:divide-x">
        <Stat
          label="Banks reached"
          value={`${cov.reached}/${cov.total}`}
          sub={
            <Link href="/coverage" className="underline decoration-line-2 underline-offset-2 hover:text-ink">
              {cov.cold} cold · see coverage →
            </Link>
          }
        />
        <Stat label="Missing email" value={stats.noEmail} sub={<Link href="/sheet?view=contacts&filter=noemail" className="underline decoration-line-2 underline-offset-2 hover:text-ink">Enrich these →</Link>} />
        <Stat label="Reached out" value={stats.reached} />
        <Stat label="Response rate" value={stats.reached ? `${Math.round((stats.replied / stats.reached) * 100)}%` : "—"} sub={`${stats.replied} replied`} tone="green" />
        <Stat label="Due today" value={stats.due.length} tone={stats.due.length ? "red" : undefined} sub="follow-ups & sends" />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader
            title="Today's follow-ups"
            sub="Bankers who've gone quiet past your follow-up window"
            right={
              <Link href="/followups" className="text-[12.5px] font-medium text-navy hover:underline">
                Open tracker →
              </Link>
            }
          />
          {stats.due.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-muted">Nothing due. Go find more people.</div>
          ) : (
            <ul className="divide-y divide-line">
              {stats.due.slice(0, 8).map(({ c, a }) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="truncate text-[12px] text-muted">
                      {c.position || "—"} · {c.bank} {c.region !== "Other" && `(${c.region})`}
                    </div>
                  </div>
                  <StatusBadge status={c.status} />
                  <Badge tone={a.kind === "move_on" ? "neutral" : "red"}>{a.label}</Badge>
                  <span className="num w-16 text-right text-[12px] text-muted">{a.unknownDate ? "?" : relDays(a.due)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Pipeline" sub="Where every contact sits right now" />
          <div className="space-y-2 px-4 py-4">
            {FUNNEL.map((s) => (
              <div key={s} className="flex items-center gap-3">
                <span className="w-28 text-[12.5px] text-ink-2">{STATUS_LABEL[s]}</span>
                <div className="h-5 flex-1 rounded-sm bg-[#f0eee6]">
                  <div
                    className="h-full rounded-sm bg-navy/85"
                    style={{ width: `${(stats.byStatus[s] / maxFunnel) * 100}%`, minWidth: stats.byStatus[s] ? 3 : 0 }}
                  />
                </div>
                <span className="num w-8 text-right text-[12.5px]">{stats.byStatus[s]}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          { href: "/sheet?view=contacts&filter=noemail", icon: Sparkles, title: "Enrich contact info", body: "Fill in blank emails from LinkedIn and name with Apollo or Hunter." },
          { href: "/find", icon: Search, title: "Find more people", body: "Search LinkedIn profiles and let AI keep only the ones that fit your criteria." },
          { href: "/drafts", icon: Mail, title: "Draft emails", body: "Pick a template for each contact, have AI fill it in, and send drafts to Gmail with your resume attached." },
        ].map(({ href, icon: Icon, title, body }) => (
          <Link key={href} href={href} className="group rounded-lg border border-line bg-panel p-4 transition-colors hover:border-brass/60">
            <Icon className="size-4 text-brass" />
            <div className="mt-2 flex items-center gap-1 font-medium">
              {title} <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <p className="mt-1 text-[12.5px] text-muted">{body}</p>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {(["SF", "NY"] as const).map((region) => {
          const rows = rollups.filter((r) => r.meta.region === region).sort((a, b) => b.due - a.due || b.total - a.total);
          return (
            <Card key={region}>
              <CardHeader
                title={region === "SF" ? "San Francisco / West Coast" : "New York"}
                sub={`${rows.length} banks · ${rows.reduce((n, r) => n + r.total, 0)} contacts`}
                right={<BellRing className="size-4 text-muted" />}
              />
              <table className="w-full text-[12.5px]">
                <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Bank</th>
                    <th className="px-2 py-2 text-right font-medium">Contacts</th>
                    <th className="px-2 py-2 text-right font-medium">Reached</th>
                    <th className="px-2 py-2 text-right font-medium">Replies</th>
                    <th className="px-4 py-2 text-right font-medium">Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.slice(0, 10).map((r) => (
                    <tr key={r.meta.key}>
                      <td className="px-4 py-2 font-medium">{r.meta.name}</td>
                      <td className="num px-2 text-right">{r.total}</td>
                      <td className="num px-2 text-right">{r.reached}</td>
                      <td className="num px-2 text-right">{r.replied}</td>
                      <td className="num px-4 text-right">{r.due ? <span className="text-red">{r.due}</span> : "·"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          );
        })}
      </div>
    </>
  );
}

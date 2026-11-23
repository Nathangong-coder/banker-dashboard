"use client";

import Link from "@/components/Link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { BookOpen, Briefcase, Building2, ExternalLink, Globe, MessageSquareText, Pencil, Search, Star } from "lucide-react";
import { useStore } from "@/lib/store";
import { columnsOf } from "@/lib/processTracker";
import { chatCount, chatsToCheck } from "@/lib/chatEvidence";
import { BankDetail } from "@/components/BankDetail";
import { moveToColumn, toggleStar, useBankViews } from "@/components/useBankViews";
import { Path, RecordHeader, RelatedCard } from "@/components/crm";
import { Button, Card, Empty } from "@/components/ui";
import { cn } from "@/lib/util";
import { careersFor, hostOf } from "@/lib/firmProfile";
import { FirmEditor, fetchFirmInfo, saveFirm } from "@/components/FirmEditor";

/**
 * A bank (docs/DESIGN.md L-2): highlights + the Process tracker's steps as a Path (one click sets the step), the people
 * and what to do in the main column, why it's ranked and chats to confirm in the rail. `?key=<canonBank key>`.
 */
export default function BankPage() {
  return (
    <Suspense>
      <Bank />
    </Suspense>
  );
}

const APP_WORD = { applied: "Applied", open: "Posting tracked", closed: "Closed" } as const;

function Bank() {
  const params = useSearchParams();
  const key = params.get("key") ?? "";
  const [editing, setEditing] = useState(() => params.get("edit") === "1");
  const boards = useStore((s) => s.apply.finder.boards);
  const jobs = useStore((s) => s.apply.jobs);
  const { views, cycle } = useBankViews(false);
  const coverage = useStore((s) => s.coverage);
  const v = views.find((x) => x.r.key === key);
  const [now] = useState(() => Date.now());
  const profile = v ? coverage.firms?.[v.r.key] : undefined;
  const needsInfo = !!v && !profile?.source;
  const name = v?.r.name;
  // The first visit looks the firm up on Wikipedia once (marked as from Wikipedia; Edit to change it).
  useEffect(() => {
    if (!needsInfo || !name) return;
    let off = false;
    void fetchFirmInfo(name)
      .then((w) => {
        if (off) return;
        const at = new Date().toISOString();
        if (!w.found) return saveFirm(key, { source: { kind: "none", at } });
        const cur = useStore.getState().coverage.firms?.[key] ?? {};
        saveFirm(key, { about: w.about, website: cur.website ?? w.website, hq: cur.hq ?? w.hq, founded: cur.founded ?? w.founded, employees: cur.employees ?? w.employees, source: { kind: "wikipedia", url: w.url, at } });
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [needsInfo, name, key]);
  const checks = useMemo(() => (v ? v.r.allContacts.flatMap((c) => chatsToCheck(c, now).map((r) => ({ c, r }))) : []), [v, now]);
  const talked = useMemo(
    () => (v ? v.r.allContacts.map((c) => ({ c, n: chatCount(c, now), q: chatsToCheck(c, now).length })).filter((x) => x.n || x.q).sort((a, b) => b.n - a.n) : []),
    [v, now],
  );

  if (!v)
    return (
      <Card>
        <Empty icon={<Building2 className="size-6" />} title="Bank not found">
          It may be hidden on Bank coverage. Search for a bank in the bar at the top.
        </Empty>
      </Card>
    );

  const careers = careersFor(v.r.key, v.r.name, profile, boards, jobs);
  const steps = columnsOf(coverage).map((c) => ({ id: c.id, label: c.label }));
  const enc = encodeURIComponent;
  const offices = v.slots.map((s) => `${s.office}${s.full ? " ✓" : ""}`).join(" · ");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <RecordHeader
        icon={<Building2 className="size-5" />}
        eyebrow="Bank"
        title={v.r.name}
        actions={
          <>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button icon={<Star className={cn("size-4", v.starred && "fill-current")} />} onClick={() => toggleStar(v.r.key)} aria-pressed={v.starred}>
              {v.starred ? "Starred" : "Star"}
            </Button>
            <Link href={`/drafts?bank=${enc(v.r.name)}`} className="inline-flex h-8 items-center gap-1.5 rounded border border-line-2 bg-panel px-3 text-[13px] font-medium text-brass-ink hover:bg-hover">
              Drafts
            </Link>
            <Link href={`/find?banks=${enc(v.r.name)}`} className="inline-flex h-8 items-center gap-1.5 rounded bg-brass-strong px-3 text-[13px] font-medium text-white hover:bg-brass-hover">
              <Search className="size-4" /> Find people
            </Link>
          </>
        }
        fields={[
          { label: "Tier", value: v.r.tier || "—" },
          {
            label: "Website",
            value: profile?.website ? (
              <a href={profile.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brass-ink hover:underline">
                {hostOf(profile.website)} <ExternalLink className="size-3" />
              </a>
            ) : (
              "—"
            ),
          },
          {
            label: "Job portal",
            value: (
              <a href={careers.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brass-ink hover:underline" title={careers.source === "search" ? "No portal saved yet: Edit to add it" : undefined}>
                {careers.label} <ExternalLink className="size-3" />
              </a>
            ),
          },
          { label: "Offices", value: offices || "—" },
          { label: `Summer ${cycle.cycle}`, value: v.app ? APP_WORD[v.app] : "No application yet" },
          { label: "Emailed", value: `${v.emailed} of ${v.target}` },
          { label: "Chats", value: <>{v.health.chats}{v.health.toCheck > 0 && <span className="text-amber"> (+{v.health.toCheck} to confirm)</span>}</> },
          { label: "How it's going", value: v.health.why },
        ]}
      >
        <Path steps={steps} current={v.column.id} onPick={(id) => moveToColumn(v.r.key, id === v.column.id ? null : id, cycle)} label="Process step" />
        <div className="mt-1.5 text-[12px] text-muted">
          {v.column.set ? (
            <>
              Step set by you.{" "}
              <button type="button" className="text-brass-ink hover:underline" onClick={() => moveToColumn(v.r.key, null, cycle)}>
                Use the automatic step
              </button>
            </>
          ) : (
            "Step guessed from your applications and emails. Click a step to set it."
          )}
        </div>
      </RecordHeader>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 p-4">
          <BankDetail x={v} />
        </Card>
        <div className="grid content-start gap-3">
          <RelatedCard
            title="About"
            icon={<BookOpen />}
            actions={
              <button type="button" onClick={() => setEditing(true)} className="text-[12px] text-brass-ink hover:underline">
                Edit
              </button>
            }
          >
            {profile?.about ? (
              <>
                <p className="text-[13px] whitespace-pre-line text-ink-2">{profile.about}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                  {profile.hq && <Fact label="Headquarters" value={profile.hq} />}
                  {profile.founded && <Fact label="Founded" value={profile.founded} />}
                  {profile.employees && <Fact label="Employees" value={profile.employees} />}
                </dl>
                <p className="mt-2 text-[12px] text-muted">
                  {profile.source?.kind === "wikipedia" ? (
                    <>
                      From{" "}
                      <a href={profile.source.url} target="_blank" rel="noreferrer" className="text-brass-ink hover:underline">
                        Wikipedia
                      </a>
                    </>
                  ) : (
                    "Written by you"
                  )}
                </p>
              </>
            ) : (
              <p className="text-[13px] text-muted">{needsInfo ? "Looking it up on Wikipedia…" : "Nothing yet. Edit to add what the firm does."}</p>
            )}
            {profile?.notes && <p className="mt-2 border-t border-line pt-2 text-[13px] whitespace-pre-line text-ink">{profile.notes}</p>}
            <div className="mt-2 flex flex-wrap gap-x-3 text-[12px]">
              <a href={careers.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brass-ink hover:underline">
                <Briefcase className="size-3.5" /> Apply / careers
              </a>
              {profile?.website && (
                <a href={profile.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brass-ink hover:underline">
                  <Globe className="size-3.5" /> Website
                </a>
              )}
            </div>
          </RelatedCard>
          <RelatedCard title="Chats here" icon={<MessageSquareText />} count={v.health.chats}>
            {talked.length ? (
              <ul className="grid gap-1.5 text-[13px]">
                {talked.map(({ c, n, q }) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-2">
                    <Link href={`/person?id=${enc(c.id)}`} className="truncate text-brass-ink hover:underline">
                      {c.name}
                    </Link>
                    <span className="shrink-0 text-[12px] text-muted">
                      {n} chat{n === 1 ? "" : "s"}
                      {q > 0 && <span className="text-amber"> +{q} to confirm</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">No chats here yet.</p>
            )}
            <p className="mt-2 text-[12px] text-muted">Counted when your calendar and a thank-you email agree, or you logged / confirmed it.</p>
          </RelatedCard>
          {checks.length > 0 && (
            <RelatedCard title="Chats to confirm" icon={<MessageSquareText />} count={checks.length} footer={<Link href="/think?tab=chats" className="text-brass-ink hover:underline">Confirm them</Link>}>
              <ul className="grid gap-1.5 text-[13px]">
                {checks.map(({ c, r }) => (
                  <li key={`${c.id}|${r.day}`}>
                    <Link href={`/person?id=${enc(c.id)}`} className="text-brass-ink hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-muted"> · {new Date(`${r.day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    <div className="text-[12px] text-muted">{r.why}</div>
                  </li>
                ))}
              </ul>
            </RelatedCard>
          )}
        </div>
      </div>
      {editing && <FirmEditor r={v.r} open onClose={() => setEditing(false)} />}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

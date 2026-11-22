"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Building2, MessageSquareText, Search, Star } from "lucide-react";
import { useStore } from "@/lib/store";
import { columnsOf } from "@/lib/processTracker";
import { chatCount, chatsToCheck } from "@/lib/chatEvidence";
import { BankDetail } from "@/components/BankDetail";
import { moveToColumn, toggleStar, useBankViews } from "@/components/useBankViews";
import { Path, RecordHeader, RelatedCard } from "@/components/crm";
import { Button, Card, Empty } from "@/components/ui";
import { cn } from "@/lib/util";

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
  const key = useSearchParams().get("key") ?? "";
  const { views, cycle } = useBankViews(false);
  const coverage = useStore((s) => s.coverage);
  const v = views.find((x) => x.r.key === key);
  const [now] = useState(() => Date.now());
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
    </div>
  );
}

"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { useStore } from "@/lib/store";
import { experimentResults, verdict, type Arm } from "@/lib/experiments";
import { ExperimentsResults } from "@/components/SelfExperiments";
import { Explorer, SentEmails } from "@/components/LabResults";
import { Card, CardHeader, PageHeader } from "@/components/ui";

export default function LabPage() {
  return (
    <Suspense>
      <LabInner />
    </Suspense>
  );
}

function LabInner() {
  const params = useSearchParams();
  const router = useRouter();
  const settings = useStore((s) => s.settings);
  const contacts = useStore((s) => s.contacts);
  const templates = useStore((s) => s.templates);
  const results = useMemo(() => experimentResults(contacts, settings, templates), [contacts, settings, templates]);
  // Setup moved to Settings → Email → Experiments; old links (/lab, /lab?view=setup) still land somewhere useful.
  const legacySetup = params.get("view") === "setup";
  useEffect(() => {
    if (legacySetup) router.replace("/settings?tab=email&sub=experiments");
  }, [legacySetup, router]);

  return (
    <>
      <PageHeader
        title="Email lab"
        sub="What gets replies: experiment results, and a breakdown by bank type, team and location."
        right={
          <Link href="/settings?tab=email&sub=experiments" className="inline-flex items-center gap-1.5 rounded-md bg-navy px-3.5 py-2 text-[13.5px] font-medium text-white hover:bg-[#1c3259]">
            Set up an experiment
          </Link>
        }
      />
      <div className="space-y-6">
        <ExperimentsResults />
        <Explorer />
        <Results results={results} />
        <SentEmails />
      </div>
    </>
  );
}

/* ---------------- results ---------------- */

function RateBar({ a }: { a: Arm }) {
  return (
    <div
      className="relative h-2 w-40 rounded-full bg-[#ecebe4]"
      title={`95% range ${Math.round(a.lo * 100)}–${Math.round(a.hi * 100)}%`}
    >
      <div
        className="absolute h-2 rounded-full bg-green/25"
        style={{
          left: `${a.lo * 100}%`,
          width: `${Math.max((a.hi - a.lo) * 100, 1)}%`,
        }}
      />
      {a.sent > 0 && (
        <div
          className="absolute top-[-2px] h-3 w-0.5 bg-green"
          style={{ left: `${a.rate * 100}%` }}
        />
      )}
    </div>
  );
}

function ArmTable({ arms, empty }: { arms: Arm[]; empty: string }) {
  if (!arms.length)
    return <p className="px-4 py-3 text-[12.5px] text-muted">{empty}</p>;
  return (
    <table className="w-full text-[12.5px]">
      <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
        <tr>
          <th className="px-4 py-1.5 font-medium">Variant</th>
          <th className="px-2 py-1.5 text-right font-medium">Drafted</th>
          <th className="px-2 py-1.5 text-right font-medium">Sent</th>
          <th className="px-2 py-1.5 text-right font-medium">Replied</th>
          <th className="px-2 py-1.5 text-right font-medium">Rate</th>
          <th className="px-2 py-1.5 font-medium">Likely range</th>
          <th className="px-4 py-1.5 text-right font-medium">Days to reply</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {arms.map((a) => (
          <tr key={a.id}>
            <td className="px-4 py-1.5 font-medium">{a.label}</td>
            <td className="num px-2 text-right">{a.drafted}</td>
            <td className="num px-2 text-right">{a.sent}</td>
            <td className="num px-2 text-right text-green">{a.replied}</td>
            <td className="num px-2 text-right font-medium">
              {a.sent ? `${Math.round(a.rate * 100)}%` : "—"}
            </td>
            <td className="px-2">
              <RateBar a={a} />
            </td>
            <td className="num px-4 text-right text-muted">
              {a.medianDays ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Results({
  results,
}: {
  results: ReturnType<typeof experimentResults>;
}) {
  const templates = useStore((s) => s.templates);
  const settings = useStore((s) => s.settings);
  const activeIds = (settings.emailBases ?? [])
    .filter((b) => b.active)
    .map((b) => b.id);
  const baseArms = results.byBase;
  const liveBases = baseArms.filter((a) => activeIds.includes(a.id));
  const groups = [
    ...new Set(
      templates.map((t) => t.variantGroup).filter((g): g is string => !!g),
    ),
  ]
    .map((g) =>
      results.byTemplate.filter(
        (a) => templates.find((t) => t.id === a.id)?.variantGroup === g,
      ),
    )
    .filter((arms) => arms.length >= 2);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <FlaskConical className="size-4 text-brass" /> Wording &amp;
            template results
          </span>
        }
        sub="Reply rate = replied ÷ sent. The bar shows the likely range; overlapping ranges mean it's too early to pick a winner."
      />
      <div className="border-b border-line px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted">
        Shared wording versions
      </div>
      <ArmTable
        arms={baseArms}
        empty="No tracked drafts yet. Every draft made from now on records its wording version and template."
      />
      {liveBases.length === 2 && (
        <p className="px-4 pb-3 text-[12.5px] text-ink-2">
          {verdict(liveBases[0], liveBases[1])}
        </p>
      )}
      {groups.map((arms) => (
        <div key={arms[0].id} className="border-t border-line">
          <div className="px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted">
            Template A/B: {arms.map((a) => a.label).join(" vs ")}
          </div>
          <ArmTable arms={arms} empty="" />
          <p className="px-4 pb-3 text-[12.5px] text-ink-2">
            {verdict(arms[0], arms[1])}
          </p>
        </div>
      ))}
      <div className="border-t border-line px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted">
        All templates
      </div>
      <ArmTable arms={results.byTemplate} empty="No first emails yet." />
      <p className="px-4 py-2.5 text-[11.5px] text-muted">
        Change one thing per test (subject, hook, or ask) so you know what made
        the difference. Replies are picked up by Gmail sync.
      </p>
    </Card>
  );
}


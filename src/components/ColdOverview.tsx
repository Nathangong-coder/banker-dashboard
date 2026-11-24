"use client";

import { useMemo } from "react";
import Link from "@/components/Link";
import { Card, Empty } from "@/components/ui";
import { FollowupCalendar } from "@/components/FollowupCalendar";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";
import { coldByBank, type ColdBankRow } from "@/lib/followupsOverview";
import { scheduledRows } from "@/lib/scheduledRows";

/**
 * Cold outreach → Overview (owner, 2026-11-23: "list each bank and how many people I need to follow up with so I know
 * what is contributing to the outstanding number"). docs/DESIGN.md L-3 + D-1: one table, totals in its last row, no
 * tiles. "Follow-ups due" adds up to the Cold outreach number in the nav. Every count opens that list for that bank.
 */
type Col = { k: keyof Omit<ColdBankRow, "key" | "bank" | "total">; label: string; view: "due" | "drafted" | "scheduled"; hint: string };
const COLS: Col[] = [
  { k: "due", label: "Follow-ups due", view: "due", hint: "Emailed, no reply, follow-up due now" },
  { k: "drafted", label: "Drafted", view: "drafted", hint: "First emails written, not sent or scheduled" },
  { k: "scheduled", label: "Scheduled", view: "scheduled", hint: "In Gmail's Scheduled folder or Coverage's queue" },
  { k: "cold", label: "Went cold", view: "due", hint: "Follow-up more than a week overdue; move them on or follow up anyway" },
];

export function ColdOverview({ onOpen }: { onOpen: (view: "due" | "drafted" | "scheduled", bank?: string) => void }) {
  const contacts = useStore((s) => s.contacts);
  const banks = useStore((s) => s.banks);
  const fu = useStore((s) => s.settings.followUp);
  const gmailScheduled = useStore((s) => s.offSheet.scheduled);
  const { rows, totals } = useMemo(() => coldByBank(contacts, banks, fu, scheduledRows(gmailScheduled, contacts)), [contacts, banks, fu, gmailScheduled]);
  const shown = rows.filter((r) => r.total > 0);
  const num = (n: number, view: Col["view"], bank?: string, tone?: "red") =>
    n ? (
      <button type="button" onClick={() => onOpen(view, bank)} className={cn("num font-medium hover:underline", tone === "red" ? "text-red" : "text-brass-ink")} title="Open this list">
        {n}
      </button>
    ) : (
      <span className="num text-line-2">0</span>
    );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-2.5">
          <h3 className="text-[14px] font-semibold text-ink">By bank</h3>
          <p className="text-[12px] text-muted">
            {totals.due} follow-up{totals.due === 1 ? "" : "s"} due across {shown.filter((r) => r.due).length} bank{shown.filter((r) => r.due).length === 1 ? "" : "s"} · {totals.scheduled} scheduled · {totals.cold} went cold
          </p>
        </div>
        {!shown.length ? (
          <Empty title="Nothing waiting on you">Banks show up here once you&apos;ve emailed someone there.</Empty>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead className="sticky top-0 z-10 bg-subtle text-left text-[12px] text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-semibold">Bank</th>
                  {COLS.map((c) => (
                    <th key={c.k} className="px-3 py-2 text-right font-semibold" title={c.hint}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => (
                  <tr key={r.key} className="h-9 hover:bg-subtle">
                    <td className="max-w-[240px] truncate px-4">
                      <Link href={`/bank?key=${encodeURIComponent(r.key)}`} className="font-semibold text-ink hover:text-brass-ink hover:underline">
                        {r.bank}
                      </Link>
                    </td>
                    {COLS.map((c) => (
                      <td key={c.k} className="px-3 text-right">
                        {num(r[c.k], c.view, r.key, c.k === "due" ? "red" : undefined)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-subtle text-[13px]">
                <tr className="h-9 border-t border-line-2">
                  <td className="px-4 font-semibold text-ink">Total</td>
                  {COLS.map((c) => (
                    <td key={c.k} className="px-3 text-right">
                      {num(totals[c.k], c.view, undefined, c.k === "due" ? "red" : undefined)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <FollowupCalendar contacts={contacts} />
    </div>
  );
}

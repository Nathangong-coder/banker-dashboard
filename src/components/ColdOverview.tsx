"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "@/components/Link";
import { Card, Empty } from "@/components/ui";
import { PersonLinks } from "@/components/PersonLinks";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";
import { coldBankPeople, type ColdPerson } from "@/lib/followupsOverview";

/**
 * Cold outreach → by bank (owner, 2026-11-24: "should look more like the dropdown list in Bank coverage, with each
 * team and who I've messaged"; "follow-ups due is misleading"). One row per bank: how many you emailed, still
 * waiting, replied. Open it for office · team and each person's latest email (or reply / scheduled send).
 */
const md = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const TONE: Record<ColdPerson["tone"], string> = { waiting: "text-ink-2", replied: "text-green", scheduled: "text-blue", done: "text-muted" };

export function ColdOverview() {
  const contacts = useStore((s) => s.contacts);
  const [now] = useState(() => Date.now());
  const banks = useMemo(() => coldBankPeople(contacts, now), [contacts, now]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((x) => {
      const n = new Set(x);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  if (!banks.length) return <Empty title="Nobody emailed yet">Banks show up here once you&apos;ve emailed someone there.</Empty>;
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line bg-subtle px-4 py-1.5 text-[12px] font-semibold text-muted sm:grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)_6rem]">
        <span>Bank</span>
        <span className="hidden text-right sm:block">Emailed</span>
        <span className="hidden text-right sm:block">Waiting</span>
        <span className="hidden text-right sm:block">Replied</span>
        <span className="text-right">Last email</span>
      </div>
      <ul className="max-h-[70vh] divide-y divide-line overflow-auto">
        {banks.map((b) => {
          const isOpen = open.has(b.key);
          return (
            <li key={b.key}>
              <button
                type="button"
                onClick={() => toggle(b.key)}
                aria-expanded={isOpen}
                className="grid h-9 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 text-left text-[13px] hover:bg-subtle sm:grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)_6rem]"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {isOpen ? <ChevronDown className="size-4 shrink-0 text-muted" /> : <ChevronRight className="size-4 shrink-0 text-muted" />}
                  <span className="truncate font-semibold text-ink">{b.bank}</span>
                  <span className="text-[12px] text-muted sm:hidden">
                    · {b.emailed} emailed{b.replied ? ` · ${b.replied} replied` : ""}
                  </span>
                </span>
                <span className="num hidden text-right sm:block">{b.emailed}</span>
                <span className="num hidden text-right text-ink-2 sm:block">{b.waiting || <span className="text-line-2">0</span>}</span>
                <span className="num hidden text-right sm:block">{b.replied ? <span className="text-green">{b.replied}</span> : <span className="text-line-2">0</span>}</span>
                <span className="num text-right text-[12px] text-muted">{md(b.lastAt)}</span>
              </button>
              {isOpen && (
                <div className="border-t border-line bg-subtle/60 pb-2">
                  <div className="flex items-center gap-2 px-10 pt-2 text-[12px]">
                    <Link href={`/bank?key=${encodeURIComponent(b.key)}`} className="font-medium text-brass-ink hover:underline">
                      Open {b.bank}
                    </Link>
                  </div>
                  {b.teams.map((t) => (
                    <div key={t.label} className="px-10 pt-2">
                      <div className="text-[12px] font-semibold text-muted">{t.label}</div>
                      <ul>
                        {t.people.map((p) => (
                          <li key={p.c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1 text-[13px]">
                            <Link href={`/person?id=${encodeURIComponent(p.c.id)}`} className="min-w-[140px] font-medium text-ink hover:text-brass-ink hover:underline">
                              {p.c.name}
                            </Link>
                            <span className="min-w-[90px] text-[12px] text-muted">{p.c.position || ""}</span>
                            <span className={cn("min-w-[150px] text-[12px]", TONE[p.tone])}>{p.state}</span>
                            <PersonLinks c={p.c} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

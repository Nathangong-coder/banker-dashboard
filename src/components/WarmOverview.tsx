"use client";

import { useMemo, useState } from "react";
import { MailPlus } from "lucide-react";
import Link from "@/components/Link";
import { Badge, Button, Card, Empty, Select } from "@/components/ui";
import { FollowupCalendar } from "@/components/FollowupCalendar";
import { PersonLinks } from "@/components/PersonLinks";
import { RowCheckbox } from "@/components/FollowupsUi";
import { useStore } from "@/lib/store";
import { DAY } from "@/lib/util";
import { warmByBank, type WarmPerson } from "@/lib/followupsOverview";
import type { TodoKind } from "@/lib/thinkAbout";
import type { Contact } from "@/lib/types";

/**
 * Warm follow-ups → Overview (owner, 2026-11-23: "lists out everyone at each bank so I know who to email over
 * Thanksgiving"). Everyone you're in a conversation with, grouped by bank: how you know them, when you last emailed
 * either way, what you owe them. Tick people → "Draft check-ins" (a holiday check-in into Gmail, then scheduled).
 */
const OWED: Record<TodoKind, string> = { thank: "Thank-you owed", reply: "Reply owed", quiet: "Nudge", check_in: "Check in" };
const FILTERS = [
  ["0", "Everyone"],
  ["14", "Not heard from in 14+ days"],
  ["30", "Not heard from in 30+ days"],
] as const;

const ago = (iso?: string) => {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - Date.parse(iso)) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

export function WarmOverview({ onDraft }: { onDraft?: (people: Contact[]) => Promise<void> }) {
  const contacts = useStore((s) => s.contacts);
  const [days, setDays] = useState<string>("0");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => {
    const min = Number(days) * DAY;
    return warmByBank(contacts)
      .map((g) => ({ ...g, people: g.people.filter((p) => !min || !p.lastAt || Date.now() - Date.parse(p.lastAt) >= min) }))
      .filter((g) => g.people.length);
  }, [contacts, days]);
  const people = groups.flatMap((g) => g.people);
  const picked = contacts.filter((c) => sel.has(c.id));
  const toggle = (id: string) =>
    setSel((x) => {
      const n = new Set(x);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleGroup = (list: WarmPerson[]) => {
    const all = list.every((p) => sel.has(p.c.id));
    setSel((x) => {
      const n = new Set(x);
      for (const p of list) if (all) n.delete(p.c.id);
      else n.add(p.c.id);
      return n;
    });
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="min-w-0 flex-1 basis-[220px]">
            <h3 className="text-[14px] font-semibold text-ink">Everyone you&apos;re in touch with</h3>
            <p className="text-[12px] text-muted">
              {people.length} people at {groups.length} bank{groups.length === 1 ? "" : "s"} · {people.filter((p) => p.owed).length} waiting on you
            </p>
          </div>
          <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Who to show" className="h-8 w-auto">
            {FILTERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          {onDraft && (
            <Button
              size="sm"
              variant="primary"
              icon={<MailPlus className="size-3.5" />}
              disabled={!picked.length}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onDraft(picked);
                  setSel(new Set());
                } finally {
                  setBusy(false);
                }
              }}
              title="Writes a check-in for each (your Holiday check-in template) into Gmail, then puts them on your list to schedule"
            >
              Draft check-ins{picked.length ? ` (${picked.length})` : ""}
            </Button>
          )}
        </div>
        {!groups.length ? (
          <Empty title="Nobody here yet">People show up once they reply, meet you or refer you.</Empty>
        ) : (
          <div className="max-h-[75vh] overflow-auto">
            {groups.map((g) => (
              <section key={g.key} className="border-b border-line last:border-b-0">
                <div className="sticky top-0 z-10 flex items-center gap-2 bg-subtle px-4 py-1.5">
                  <RowCheckbox label={`Select everyone at ${g.bank}`} checked={g.people.every((p) => sel.has(p.c.id))} onChange={() => toggleGroup(g.people)} />
                  <Link href={`/bank?key=${encodeURIComponent(g.key)}`} className="text-[13px] font-semibold text-ink hover:text-brass-ink hover:underline">
                    {g.bank}
                  </Link>
                  <span className="num text-[12px] text-muted">{g.people.length}</span>
                </div>
                <ul className="divide-y divide-line">
                  {g.people.map((p) => (
                    <li key={p.c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2" data-selected={sel.has(p.c.id) || undefined}>
                      <RowCheckbox label={`Select ${p.c.name}`} checked={sel.has(p.c.id)} onChange={() => toggle(p.c.id)} />
                      <span className="min-w-0 flex-1 basis-[200px] text-[13px]">
                        <Link href={`/person?id=${encodeURIComponent(p.c.id)}`} className="font-semibold text-brass-ink hover:underline">
                          {p.c.name}
                        </Link>
                        {p.c.position && <span className="text-muted"> · {p.c.position}</span>}
                        <span className="block text-[12px] text-muted">
                          {p.how} · last email {ago(p.lastAt)}
                        </span>
                      </span>
                      {p.owed && <Badge tone={p.owed === "reply" || p.owed === "thank" ? "red" : "amber"}>{OWED[p.owed]}</Badge>}
                      <PersonLinks c={p.c} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
      <FollowupCalendar contacts={contacts} />
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, MailPlus } from "lucide-react";
import Link from "@/components/Link";
import { Badge, Button, Card, Empty, Select } from "@/components/ui";
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
const OWED: Record<TodoKind, string> = {
  thank: "Thank-you owed",
  reply: "Reply owed",
  quiet: "Nudge",
  check_in: "Check in",
};
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

export function WarmOverview({
  onDraft,
}: {
  onDraft?: (people: Contact[]) => Promise<void>;
}) {
  const contacts = useStore((s) => s.contacts);
  const [days, setDays] = useState<string>("0");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Banks are folded (owner, 2026-11-24: "only show bank & # of contacts; people is a dropdown").
  const [open, setOpen] = useState<Set<string>>(new Set());
  const flip = (k: string) =>
    setOpen((x) => {
      const n = new Set(x);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const groups = useMemo(() => {
    const min = Number(days) * DAY;
    return warmByBank(contacts)
      .map((g) => ({
        ...g,
        people: g.people.filter(
          (p) => !min || !p.lastAt || Date.now() - Date.parse(p.lastAt) >= min,
        ),
      }))
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
      for (const p of list)
        if (all) n.delete(p.c.id);
        else n.add(p.c.id);
      return n;
    });
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1 basis-[220px]">
          <h3 className="text-[14px] font-semibold text-ink">By bank</h3>
          <p className="text-[12px] text-muted">
            {people.length} people at {groups.length} bank
            {groups.length === 1 ? "" : "s"} ·{" "}
            {people.filter((p) => p.owed).length} waiting on you
          </p>
        </div>
        <Select
          value={days}
          onChange={(e) => setDays(e.target.value)}
          aria-label="Who to show"
          className="h-8 w-auto"
        >
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
        <Empty title="Nobody here yet">
          People show up once they reply, meet you or refer you.
        </Empty>
      ) : (
        <div className="max-h-[75vh] overflow-auto">
          {groups.map((g) => (
            <section
              key={g.key}
              className="border-b border-line last:border-b-0"
            >
              <div className="flex h-9 items-center gap-2 px-4 hover:bg-subtle">
                <RowCheckbox
                  label={`Select everyone at ${g.bank}`}
                  checked={g.people.every((p) => sel.has(p.c.id))}
                  onChange={() => toggleGroup(g.people)}
                />
                <button
                  type="button"
                  onClick={() => flip(g.key)}
                  aria-expanded={open.has(g.key)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px]"
                >
                  {open.has(g.key) ? (
                    <ChevronDown className="size-4 shrink-0 text-muted" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted" />
                  )}
                  <span className="truncate font-semibold text-ink">
                    {g.bank}
                  </span>
                  <span className="num text-[12px] text-muted">
                    {g.people.length}{" "}
                    {g.people.length === 1 ? "person" : "people"}
                  </span>
                  {g.people.some((p) => p.owed) && (
                    <span className="ml-auto text-[12px] text-red">
                      {g.people.filter((p) => p.owed).length} waiting on you
                    </span>
                  )}
                </button>
              </div>
              {open.has(g.key) && (
                <ul className="divide-y divide-line border-t border-line bg-subtle/60">
                  {g.people.map((p) => (
                    <li
                      key={p.c.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 pr-4 pl-10"
                      data-selected={sel.has(p.c.id) || undefined}
                    >
                      <RowCheckbox
                        label={`Select ${p.c.name}`}
                        checked={sel.has(p.c.id)}
                        onChange={() => toggle(p.c.id)}
                      />
                      <span className="min-w-0 flex-1 basis-[200px] text-[13px]">
                        <Link
                          href={`/person?id=${encodeURIComponent(p.c.id)}`}
                          className="font-semibold text-brass-ink hover:underline"
                        >
                          {p.c.name}
                        </Link>
                        {p.c.position && (
                          <span className="text-muted"> · {p.c.position}</span>
                        )}
                        <span className="block text-[12px] text-muted">
                          {p.how} · last email {ago(p.lastAt)}
                        </span>
                      </span>
                      {p.owed && (
                        <Badge
                          tone={
                            p.owed === "reply" || p.owed === "thank"
                              ? "red"
                              : "amber"
                          }
                        >
                          {OWED[p.owed]}
                        </Badge>
                      )}
                      <PersonLinks c={p.c} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

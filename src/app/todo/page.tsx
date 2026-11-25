"use client";

import { useMemo, useState } from "react";
import { Bell, Check, Coffee, CornerUpLeft, Handshake, ListTodo, Mail, MessageCircle, Send, Undo2, X } from "lucide-react";
import Link from "@/components/Link";
import { ObjectHeader } from "@/components/crm";
import { Button, Card, Empty, toast } from "@/components/ui";
import { PersonLinks } from "@/components/PersonLinks";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";
import { reminderRows } from "@/lib/thinkAbout";
import { todoGroup, todoItems, type TodoGroup, type TodoItem, type TodoItemKind } from "@/lib/todoList";
import { chatVerdict, dismissNudge, reminderDone } from "@/lib/nudgeActions";
import { AddReminder } from "@/components/AddReminder";

/**
 * To-do (owner, 2026-11-24: "a new section that just has the to-do list, master set of things"): every nudge, cold and
 * warm, by when it's due (docs/DESIGN.md L-3). Each row: what to do, why, links to check it in Gmail, and a way to say
 * it's wrong (Dismiss) or done.
 */
const GROUPS: [TodoGroup, string][] = [
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["week", "This week"],
];
const ICON: Record<TodoItemKind, typeof Mail> = {
  reply: CornerUpLeft,
  thank: Coffee,
  check_in: MessageCircle,
  quiet: MessageCircle,
  follow_up: Send,
  reminder: Bell,
  chat: Coffee,
  referral: Handshake,
};

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });

export default function TodoPage() {
  const contacts = useStore((s) => s.contacts);
  const banks = useStore((s) => s.banks);
  const fu = useStore((s) => s.settings.followUp);
  const reminders = useStore((s) => s.coverage.reminders);
  const [now] = useState(() => Date.now());
  const items = useMemo(() => todoItems(contacts, banks, fu, reminders, now), [contacts, banks, fu, reminders, now]);
  // The last thing taken off the list here, so it can be put back in place.
  const [undo, setUndo] = useState<{ text: string; run: () => void } | null>(null);
  const grouped = GROUPS.map(([g, label]) => [label, items.filter((i) => todoGroup(i.due, now) === g)] as const).filter(([, list]) => list.length);
  const dueNow = items.filter((i) => ["overdue", "today"].includes(todoGroup(i.due, now))).length;

  const take = (text: string, run: () => () => void) => setUndo({ text, run: run() });
  // "+ New → Reminder" in the header opens /todo?new=reminder.
  const [adding, setAdding] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "reminder");

  const row = (i: TodoItem) => {
    const Icon = ICON[i.kind];
    const rem = i.reminderId ? reminderRows(contacts, reminders).find((r) => r.id === i.reminderId) : undefined;
    return (
      <li key={i.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-subtle text-muted" aria-hidden="true">
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 basis-[240px]">
          <span className="block truncate text-[13px] font-semibold text-ink">
            {i.c ? (
              <Link href={`/person?id=${encodeURIComponent(i.c.id)}`} className="hover:text-brass-ink hover:underline">
                {i.title}
              </Link>
            ) : (
              i.title
            )}
          </span>
          <span className="block truncate text-[12px] text-muted">
            {[i.c?.bank, i.why].filter(Boolean).join(" · ")}
          </span>
        </span>
        {i.c && i.kind !== "reminder" && <PersonLinks c={i.c} />}
        <span className="num w-20 text-right text-[12px] whitespace-nowrap text-muted">{when(i.due)}</span>
        <span className="flex items-center gap-1">
          {i.kind === "chat" && i.c && i.chatDay && (
            <>
              <Button size="sm" variant="secondary" onClick={() => (chatVerdict(i.c!, i.chatDay!, "yes"), toast.ok(`Counted the chat with ${i.c!.name}.`))}>
                Yes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => (chatVerdict(i.c!, i.chatDay!, "no"), toast.ok("Won't count that one."))}>
                No
              </Button>
            </>
          )}
          {rem && (
            <Button size="sm" variant="secondary" icon={<Check className="size-3.5" />} onClick={() => take(`"${rem.note}" done.`, () => reminderDone(rem))}>
              Done
            </Button>
          )}
          {i.dismissKey && i.c && (
            <button
              type="button"
              onClick={() => take(`${i.c!.name}: dismissed. It comes back after the next email either way.`, () => dismissNudge(i.c!, i.dismissKey!))}
              className="grid size-7 place-items-center rounded text-muted hover:bg-hover hover:text-ink"
              aria-label={`Dismiss: ${i.title} isn't needed`}
              title="Not needed / wrong: take it off (here, the lists and the 9 PM text)"
            >
              <X className="size-4" />
            </button>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <ObjectHeader
        icon={<ListTodo className="size-5" />}
        title="To-do"
        meta={items.length ? `${dueNow} due now · ${items.length - dueNow} later this week` : undefined}
        actions={
          <Button icon={<Bell className="size-3.5" />} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            Add reminder
          </Button>
        }
      />
      {adding && <AddReminder contacts={contacts} />}
      {undo && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2 text-[12.5px] text-ink-2">
          {undo.text}
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 font-medium text-brass-ink hover:underline"
            onClick={() => {
              undo.run();
              setUndo(null);
            }}
          >
            <Undo2 className="size-3.5" /> Undo
          </button>
        </div>
      )}
      <Card className="overflow-hidden">
        {!grouped.length ? (
          <Empty icon={<Check className="size-6" />} title="Nothing needs you right now">
            Replies, thank-yous, follow-ups and reminders show up here when they&apos;re due.
          </Empty>
        ) : (
          grouped.map(([label, list]) => (
            <section key={label} className="border-b border-line last:border-b-0">
              <h2 className={cn("flex items-baseline gap-1.5 bg-subtle px-4 py-1.5 text-[13px] font-semibold", label === "Overdue" ? "text-red" : "text-ink")}>
                {label} <span className="num text-[12px] font-normal text-muted">({list.length})</span>
              </h2>
              <ul className="divide-y divide-line">{list.map(row)}</ul>
            </section>
          ))
        )}
      </Card>
    </div>
  );
}

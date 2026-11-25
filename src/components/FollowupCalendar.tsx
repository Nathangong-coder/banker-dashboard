"use client";

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, ExternalLink, Undo2 } from "lucide-react";
import Link from "@/components/Link";
import { Button, Card } from "@/components/ui";
import { PersonLinks } from "@/components/PersonLinks";
import { cn } from "@/lib/util";
import { calendarDays, dayKey } from "@/lib/followupsOverview";
import { todoFor } from "@/lib/thinkAbout";
import { dismissNudge } from "@/lib/nudgeActions";
import { dayLinks } from "@/lib/gmailLinks";
import type { Contact } from "@/lib/types";

/**
 * Which days need you (owner, 2026-11-23): green = you emailed people that day who haven't written back; red = someone
 * wrote that day and you haven't answered. Click a day for its people, a one-click "No reply needed", and the day's
 * emails in Gmail. Shared by the Cold outreach and Warm follow-ups overviews (lib/followupsOverview.ts#calendarDays).
 */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function FollowupCalendar({ contacts, mode = "cold" }: { contacts: Contact[]; mode?: "cold" | "warm" }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [picked, setPicked] = useState<string | null>(null);
  const days = useMemo(() => calendarDays(contacts, month, undefined, mode), [contacts, month, mode]);
  const today = dayKey(new Date());

  // The grid: from the Sunday on or before the 1st to the Saturday on or after the last day.
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + (6 - last.getDay()));
    const out: Date[] = [];
    for (let d = first; d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push(d);
    return out;
  }, [month]);

  const step = (n: number) => {
    setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
    setPicked(null);
  };
  const sel = picked ? days.get(picked) : undefined;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-[14px] font-semibold text-ink">{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} className="grid size-7 place-items-center rounded border border-line-2 text-ink-2 hover:bg-hover" aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" onClick={() => step(1)} className="grid size-7 place-items-center rounded border border-line-2 text-ink-2 hover:bg-hover" aria-label="Next month">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="flex basis-full flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-green-soft ring-1 ring-green/40" aria-hidden="true" /> {mode === "warm" ? "You had a chat" : "Your latest email, no reply yet"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-red-soft ring-1 ring-red/40" aria-hidden="true" /> {mode === "warm" ? "No follow-up yet / needs a check-in" : "They wrote, you haven't answered"}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px bg-line p-px text-[12px]" role="grid" aria-label="Follow-up calendar">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-subtle px-1.5 py-1 text-center font-semibold text-muted" role="columnheader">
            {w}
          </div>
        ))}
        {cells.map((d) => {
          const k = dayKey(d);
          const v = days.get(k);
          const g = v?.green.length ?? 0;
          const r = v?.red.length ?? 0;
          const out = d.getMonth() !== month.getMonth();
          return (
            <button
              key={k}
              type="button"
              role="gridcell"
              aria-selected={picked === k}
              aria-label={`${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}: ${g} emailed with no reply, ${r} waiting on you`}
              onClick={() => setPicked(picked === k ? null : k)}
              disabled={!g && !r}
              className={cn(
                "flex min-h-11 flex-col items-start gap-0.5 px-1.5 py-1 text-left transition-colors",
                r ? "bg-red-soft" : g ? "bg-green-soft" : "bg-panel",
                (g || r) && "hover:brightness-95",
                picked === k && "outline-2 -outline-offset-2 outline-brass-strong",
                out && "opacity-50",
              )}
            >
              <span className={cn("num text-[12px]", k === today ? "rounded-sm bg-ink px-1 font-semibold text-panel" : "text-ink-2")}>{d.getDate()}</span>
              {g > 0 && <span className="num text-[11px] font-medium text-green">{g} {mode === "warm" ? (g === 1 ? "chat" : "chats") : "sent"}</span>}
              {r > 0 && <span className="num text-[11px] font-medium text-red">{r} {mode === "warm" ? "to follow up" : "to answer"}</span>}
            </button>
          );
        })}
      </div>
      {picked && sel && <DayPanel day={picked} v={sel} mode={mode} />}
    </Card>
  );
}

function DayPanel({ day, v, mode }: { day: string; v: { green: Contact[]; red: Contact[] }; mode: "cold" | "warm" }) {
  // The last "Not needed" here, so it can be undone in place.
  const [undo, setUndo] = useState<{ name: string; run: () => void } | null>(null);
  const date = new Date(`${day}T12:00:00`);
  const links = dayLinks(date, { to: v.green.map((c) => c.email).filter(Boolean), from: v.red.map((c) => c.email).filter(Boolean) });
  // Same as everywhere: dismisses this exact nudge (lib/nudgeActions.ts); it comes back after the next email either way.
  const noReply = (c: Contact) => {
    const t = todoFor(c, Date.now());
    if (!t) return;
    setUndo({ name: c.name, run: dismissNudge(c, t.key) });
  };
  const person = (c: Contact, red: boolean) => (
    <li key={`${red ? "r" : "g"}${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
      <span className={cn("grid size-5 shrink-0 place-items-center rounded-full", red ? "bg-red-soft text-red" : "bg-green-soft text-green")} aria-hidden="true">
        {red ? <ArrowDownLeft className="size-3" /> : <ArrowUpRight className="size-3" />}
      </span>
      <span className="min-w-0 flex-1 basis-[180px] text-[13px]">
        <Link href={`/person?id=${encodeURIComponent(c.id)}`} className="font-semibold text-brass-ink hover:underline">
          {c.name}
        </Link>
        <span className="text-muted"> · {c.bank}</span>
        <span className="block text-[12px] text-muted">
          {mode === "warm" ? (red ? "Talked; no follow-up yet, or time to check in" : "You talked") : red ? "Wrote you; you haven't answered" : "Your latest email; no reply yet"}
        </span>
      </span>
      <PersonLinks c={c} />
      {red && (
        <Button size="sm" variant="secondary" onClick={() => noReply(c)} title="Off the red days, the lists and the 9 PM text until the next email either way">
          Not needed
        </Button>
      )}
    </li>
  );
  return (
    <div className="border-t border-line">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <h4 className="text-[13px] font-semibold text-ink">{date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h4>
        <div className="ml-auto flex flex-wrap gap-2">
          {links.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded border border-line-2 bg-panel px-2.5 text-[12px] font-medium text-brass-ink hover:bg-hover">
              <ExternalLink className="size-3.5" aria-hidden="true" />
              {links.length > 1 ? `Open in Gmail (${i + 1} of ${links.length})` : "Open this day in Gmail"}
            </a>
          ))}
        </div>
      </div>
      {undo && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded bg-subtle px-3 py-1.5 text-[12px] text-ink-2">
          {undo.name}: dismissed.
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
      <ul className="divide-y divide-line border-t border-line">
        {v.red.map((c) => person(c, true))}
        {v.green.map((c) => person(c, false))}
      </ul>
    </div>
  );
}

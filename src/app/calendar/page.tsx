"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, CalendarSync, Coffee, ExternalLink, NotebookPen, Presentation, Video } from "lucide-react";
import { useStore } from "@/lib/store";
import { chatsIn, linkedinFor, needsLog, type CalendarChat } from "@/lib/calendarDay";
import { cn } from "@/lib/util";
import type { Contact, InfoSession } from "@/lib/types";
import { Badge, Button, Card, Empty, Kpi, PageHeader, Segmented, toast } from "@/components/ui";
import { serverOn } from "@/components/InfoSessionActions";
import { BACK, AHEAD, syncCalendar, useCal } from "@/components/CalendarActions";

const DAY = 86_400_000;

type Item = { kind: "chat"; at: string; end: string; chat: CalendarChat; c?: Contact } | { kind: "session"; at: string; end: string; s: InfoSession };
type When = "upcoming" | "past" | "all";
type Show = "all" | "chat" | "session";

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const dayLabel = (iso: string, now: number) => {
  const d = new Date(iso);
  const t = new Date(now);
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / DAY);
  const date = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return diff === 0 ? `Today · ${date}` : diff === 1 ? `Tomorrow · ${date}` : diff === -1 ? `Yesterday · ${date}` : date;
};
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const ymd = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function CalendarPage() {
  const settings = useStore((s) => s.settings);
  const contacts = useStore((s) => s.contacts);
  const sessions = useStore((s) => s.infoSessions);
  const { events, syncedAt, calendar } = useCal();
  const connected = serverOn({ settings });
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState<When>("upcoming");
  const [show, setShow] = useState<Show>("all");
  const [now, setNow] = useState(() => Date.now());

  const sync = useCallback(async (quiet: boolean) => {
    setBusy(true);
    try {
      const r = await syncCalendar();
      if (!quiet)
        toast.ok(r.calendar ? `Synced: ${r.chats} coffee chat${r.chats === 1 ? "" : "s"}${r.updated ? `, ${r.updated} ${r.updated === 1 ? "person" : "people"} updated` : ""}.` : "The server can't read your calendar yet.");
    } catch (e) {
      if (!quiet) toast.err((e as Error).message);
    } finally {
      setBusy(false);
      setNow(Date.now());
    }
  }, []);

  // Read it on open (unless it was read in the last 5 minutes).
  useEffect(() => {
    if (!connected || (syncedAt && Date.now() - syncedAt < 5 * 60_000)) return;
    const t = setTimeout(() => void sync(true), 0);
    return () => clearTimeout(t);
  }, [connected, syncedAt, sync]);

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const items = useMemo<Item[]>(() => {
    const chats = chatsIn(events, contacts, settings.profile.name.trim().split(/\s+/)[0]).map((chat): Item => ({ kind: "chat", at: chat.start, end: chat.end, chat, c: chat.contactId ? byId.get(chat.contactId) : undefined }));
    const ss = sessions
      .filter((s) => Date.parse(s.start) >= now - BACK && Date.parse(s.start) <= now + AHEAD)
      .map((s): Item => ({ kind: "session", at: s.start, end: s.end, s }));
    return [...chats, ...ss].sort((a, b) => a.at.localeCompare(b.at));
  }, [events, contacts, sessions, byId, settings.profile.name, now]);

  const stats = useMemo(() => {
    const t = new Date(now);
    const today = items.filter((i) => dayKey(i.at) === dayKey(t.toISOString()));
    const weekEnd = now + 7 * DAY;
    const ahead = items.filter((i) => Date.parse(i.at) >= now && Date.parse(i.at) <= weekEnd);
    const toLog = items.filter((i) => i.kind === "chat" && needsLog(i.chat, i.c, now));
    return {
      today: today.length,
      todayChats: today.filter((i) => i.kind === "chat").length,
      chats: ahead.filter((i) => i.kind === "chat").length,
      sessions: ahead.filter((i) => i.kind === "session").length,
      toLog: toLog.length,
    };
  }, [items, now]);

  const shown = items.filter(
    (i) =>
      (show === "all" || i.kind === show) &&
      (when === "all" || (when === "upcoming" ? Date.parse(i.end) >= new Date(now).setHours(0, 0, 0, 0) : Date.parse(i.end) < now)),
  );
  const list = when === "past" ? [...shown].reverse() : shown;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Calendar"
        sub="Coffee chats and info sessions from your Google Calendar. After each chat: log how it went and connect on LinkedIn."
        right={
          connected && (
            <Button variant="primary" icon={<CalendarSync className="size-4" />} loading={busy} onClick={() => sync(false)}>
              Sync Google Calendar
            </Button>
          )
        }
      />

      {(!connected || calendar === false) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-panel px-4 py-2.5 text-[13px] text-ink-2">
          <CalendarSync className="size-4 shrink-0 text-brass" />
          {calendar === false ? "Your Google connection doesn't include Calendar yet: reconnect with Calendar ticked." : "To read Google Calendar, turn on automatic sending with Calendar ticked."}
          <Link href="/followups?tab=reminders" className="font-medium text-navy hover:underline">
            Open Reminders
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Today" value={stats.today} sub={stats.todayChats ? `${stats.todayChats} coffee chat${stats.todayChats === 1 ? "" : "s"}` : "nothing to prep"} />
        <Kpi label="Coffee chats" value={stats.chats} sub="next 7 days" />
        <Kpi label="Info sessions" value={stats.sessions} sub="next 7 days" />
        <Kpi label="To log" value={stats.toLog} sub={stats.toLog ? "chats without notes yet" : "all caught up"} tone={stats.toLog ? "bad" : "good"} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Segmented
            value={when}
            onChange={setWhen}
            options={[
              ["upcoming", "Upcoming"],
              ["past", "Past 3 weeks"],
              ["all", "All"],
            ]}
          />
          <Segmented
            className="ml-auto"
            value={show}
            onChange={setShow}
            options={[
              ["all", "All"],
              ["chat", "Coffee chats"],
              ["session", "Info sessions"],
            ]}
          />
        </div>
        {list.length === 0 ? (
          <Empty icon={<CalendarDays className="size-7" />} title={when === "past" ? "Nothing in the last 3 weeks" : "Nothing coming up"}>
            {connected ? "Coffee chats show up when the title looks like one (\"Coffee chat\", \"Nathan<>Elixa\", \"Call w/ …\") or a contact is invited." : "Connect Google Calendar on Follow-ups → Reminders."}
          </Empty>
        ) : (
          <ul>
            {list.map((i, n) => {
              const head = n === 0 || dayKey(list[n - 1].at) !== dayKey(i.at);
              return (
                <Fragment key={i.kind === "chat" ? i.chat.id : i.s.id}>
                  {head && <li className="border-b border-line bg-subtle px-4 py-1.5 text-[11.5px] font-medium tracking-wide text-muted uppercase">{dayLabel(i.at, now)}</li>}
                  {i.kind === "chat" ? <ChatRow item={i} now={now} /> : <SessionRow s={i.s} now={now} />}
                </Fragment>
              );
            })}
          </ul>
        )}
      </Card>
      {syncedAt && <p className="-mt-2 text-[12px] text-muted">Last synced {new Date(syncedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.</p>}
    </div>
  );
}

const rowCls = "group flex items-center gap-3 border-b border-line px-4 py-2.5 hover:bg-subtle";
const actionCls = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-ink-2 hover:bg-hover hover:text-ink";

function ChatRow({ item, now }: { item: Extract<Item, { kind: "chat" }>; now: number }) {
  const { chat, c } = item;
  const done = Date.parse(chat.end) <= now;
  const log = needsLog(chat, c, now);
  return (
    <li className={rowCls}>
      <span className="num w-[72px] shrink-0 text-[12.5px] text-muted">{time(chat.start)}</span>
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brass-soft text-brass-ink">
        <Coffee className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-ink">{c ? c.name : chat.title || "Untitled"}</div>
        <div className="truncate text-[12px] text-muted">{c ? [c.position, c.bank, chat.title].filter(Boolean).join(" · ") : "Not in your tracker"}</div>
      </div>
      <span className="flex shrink-0 items-center gap-1">
        {log && <Badge tone="amber">Log it</Badge>}
        {!done && chat.link && (
          <a href={chat.link} target="_blank" rel="noreferrer" className={actionCls} title="Join link">
            <Video className="size-3.5" />
          </a>
        )}
        {c && !done && (
          <Link href={`/prep?id=${encodeURIComponent(c.id)}`} className={actionCls}>
            Prep
          </Link>
        )}
        {done && (
          <Link
            href={c ? `/log?log=${encodeURIComponent(c.id)}&kind=coffee_chat&date=${ymd(chat.start)}` : "/log"}
            className={cn(actionCls, log && "text-brass-ink")}
            title="Notes, doc link and an AI grade; fills their Conversation row in the tracker"
          >
            <NotebookPen className="size-3.5" /> Log how it went
          </Link>
        )}
        {c && (
          <a href={linkedinFor(c)} target="_blank" rel="noreferrer" className={actionCls} title={c.linkedin ? "Open their profile to connect" : "Search LinkedIn for them"}>
            LinkedIn <ExternalLink className="size-3" />
          </a>
        )}
      </span>
    </li>
  );
}

function SessionRow({ s, now }: { s: InfoSession; now: number }) {
  const done = Date.parse(s.end) <= now;
  return (
    <li className={rowCls}>
      <span className="num w-[72px] shrink-0 text-[12.5px] text-muted">{s.allDay ? "All day" : time(s.start)}</span>
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-chart-soft text-ink-2">
        <Presentation className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-ink">{s.title.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() || s.firm}</div>
        <div className="truncate text-[12px] text-muted">{["Info session", s.firm, s.location].filter(Boolean).join(" · ")}</div>
      </div>
      <span className="flex shrink-0 items-center gap-1">
        {!done && s.link && (
          <a href={s.link} target="_blank" rel="noreferrer" className={actionCls} title="Join link">
            <Video className="size-3.5" />
          </a>
        )}
        <Link href={`/info-sessions?id=${encodeURIComponent(s.id)}`} className={actionCls}>
          {done ? "Who you met" : "Open"}
        </Link>
      </span>
    </li>
  );
}

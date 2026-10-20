"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarSync, ExternalLink, Link2, Plus, Presentation, RotateCw, Search, Smartphone, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { canonBank } from "@/lib/banks";
import { cn } from "@/lib/util";
import type { Contact, InfoSession } from "@/lib/types";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Kpi, Menu, Modal, PageHeader, Segmented, Select, toast } from "@/components/ui";
import { FirmMark, InfoSessionDetail, sessionWhen } from "@/components/InfoSessionDetail";
import {
  addManualSession,
  assignUnsorted,
  isClubSession,
  knownBanks,
  loadCalendarSessions,
  loadUnsorted,
  peopleOf,
  pullCaptures,
  retryUnsorted,
  serverOn,
  setUnsorted,
  timingOf,
  useUnsorted,
  type UnsortedCapture,
} from "@/components/InfoSessionActions";

export default function InfoSessionsPage() {
  return (
    <Suspense>
      <InfoSessionsInner />
    </Suspense>
  );
}

type Kind = "all" | "firm" | "club";
type When = "all" | "up" | "past";
const AHEAD = 60 * 86_400_000;
const REPLIED = new Set(["replied", "call_scheduled", "done"]);

function InfoSessionsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const deep = params.get("id");
  const sessions = useStore((s) => s.infoSessions);
  const contacts = useStore((s) => s.contacts);
  const targets = useStore((s) => s.targets);
  const coverage = useStore((s) => s.coverage);
  const settings = useStore((s) => s.settings);
  const unsorted = useUnsorted((s) => s.list);
  const connected = serverOn({ settings });

  const [open, setOpen] = useState<string | null>(deep);
  // A new ?id= (client navigation) opens that session.
  const [prevDeep, setPrevDeep] = useState(deep);
  if (deep !== prevDeep) {
    setPrevDeep(deep);
    setOpen(deep);
  }
  const [kind, setKind] = useState<Kind>("all");
  const [when, setWhen] = useState<When>("all");
  const [q, setQ] = useState("");
  const [calendar, setCalendar] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [adding, setAdding] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const banks = useMemo(() => knownBanks({ targets, coverage, contacts }), [targets, coverage, contacts]);

  const refresh = useCallback(async (quiet: boolean) => {
    setLoading(true);
    try {
      const r = await loadCalendarSessions();
      setCalendar(r.calendar);
      if (!quiet) toast.ok(r.calendar ? `${r.count} info sessions on your calendar (last 6 months, next 2).` : "The server can't read your calendar yet.");
    } catch (e) {
      if (!quiet) toast.err((e as Error).message);
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  const pull = useCallback(async (quiet: boolean) => {
    setPulling(true);
    try {
      const r = await pullCaptures();
      if (r.items) toast.ok(`${r.items} phone capture${r.items === 1 ? "" : "s"} read: ${r.added} ${r.added === 1 ? "person" : "people"} to review${r.unsorted ? `, ${r.unsorted} unsorted` : ""}.`);
      else if (!quiet) toast.info("No new phone captures.");
    } catch (e) {
      if (!quiet) toast.err((e as Error).message);
    } finally {
      setPulling(false);
    }
  }, []);

  useEffect(() => {
    void loadUnsorted();
  }, []);

  // Calendar + phone inbox on open; the inbox again every 2 minutes while the page is visible.
  useEffect(() => {
    if (!connected) return;
    const first = setTimeout(() => {
      void refresh(true);
      void pull(true);
    }, 0);
    const tick = () => {
      if (document.visibilityState === "visible") void pull(true);
    };
    const t = setInterval(tick, 120_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [connected, refresh, pull]);

  // ?id=<session> (the reminder texts link here): scroll its row into view once it's loaded.
  useEffect(() => {
    if (!deep) return;
    document.getElementById(`session-${deep}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [deep, sessions.length]);

  const isUpcoming = useCallback((s: InfoSession) => new Date(s.end).getTime() > now, [now]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = sessions.filter(
      (s) =>
        (kind === "all" || (kind === "club") === isClubSession(s, banks)) &&
        (!term || `${s.firm} ${s.title} ${s.host ?? ""}`.toLowerCase().includes(term)) &&
        new Date(s.start).getTime() <= now + AHEAD,
    );
    // Upcoming soonest first, then past newest first.
    const up = list.filter(isUpcoming).sort((a, b) => a.start.localeCompare(b.start));
    const past = list.filter((s) => !isUpcoming(s)).sort((a, b) => b.start.localeCompare(a.start));
    return { up, past, shown: when === "up" ? up : when === "past" ? past : [...up, ...past] };
  }, [sessions, kind, banks, q, now, when, isUpcoming]);

  const stats = useMemo(() => {
    const met = contacts.filter((c) => c.metAt?.length);
    const cold = contacts.filter((c) => !c.metAt?.length && c.sentAt);
    const metSent = met.filter((c) => c.sentAt);
    const repliedOf = (l: Contact[]) => l.filter((c) => c.repliedAt || REPLIED.has(c.status)).length;
    const firms = new Map<string, { name: string; n: number }>();
    for (const c of met) {
      const k = canonBank(c.bank);
      firms.set(k, { name: firms.get(k)?.name ?? c.bank, n: (firms.get(k)?.n ?? 0) + 1 });
    }
    const attended = sessions.filter((s) => s.attended === true).length;
    const skipped = sessions.filter((s) => s.attended === false).length;
    const owed = sessions.reduce((n, s) => n + (s.pending?.length ?? 0), 0);
    return {
      upcoming: sessions.filter((s) => new Date(s.end).getTime() > now && new Date(s.start).getTime() <= now + 7 * 86_400_000).length,
      attended,
      decided: attended + skipped,
      met: met.length,
      emails: met.filter((c) => c.email).length,
      thanked: metSent.length,
      unthanked: met.filter((c) => !c.sentAt && !c.serverSend && (c.status === "new" || c.status === "drafted")).length,
      replies: repliedOf(met),
      calls: met.filter((c) => c.call || c.chats?.length || c.status === "call_scheduled").length,
      rate: metSent.length ? repliedOf(metSent) / metSent.length : undefined,
      coldRate: cold.length ? repliedOf(cold) / cold.length : undefined,
      top: [...firms.values()].sort((a, b) => b.n - a.n)[0],
      owed,
    };
  }, [contacts, sessions, now]);

  const selected = sessions.find((s) => s.id === open) ?? null;
  const pct = (x?: number) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Info sessions"
        sub={
          connected && calendar !== false
            ? `From your Google Calendar${loading ? " · syncing…" : pulling ? " · checking your phone…" : ""}`
            : "Firm info sessions, who you met at each, and thank-yous the same night."
        }
        right={
          <>
            <Menu
              items={[
                connected && { label: "Sync calendar now", hint: "Reads 6 months back, 2 ahead", icon: <CalendarSync />, onClick: () => refresh(false), disabled: loading },
                connected && { label: "Check phone captures", hint: "Also runs every 2 minutes on this page", icon: <Smartphone />, onClick: () => pull(false), disabled: pulling },
                connected && "divider",
                { label: "Phone capture link & texting", hint: "Follow-ups → Reminders", icon: <Link2 />, onClick: () => router.push("/followups?tab=reminders") },
              ]}
            />
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Add session
            </Button>
          </>
        }
      />

      {(!connected || calendar === false) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-panel px-4 py-2.5 text-[13px] text-ink-2">
          <CalendarSync className="size-4 shrink-0 text-brass" />
          {calendar === false ? "Your Google connection doesn't include Calendar yet: reconnect with Calendar ticked." : "Read sessions from Google Calendar: turn on automatic sending with Calendar ticked."}
          <Link href="/followups?tab=reminders" className="font-medium text-navy hover:underline">
            Open Reminders
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Attended"
          value={
            <>
              {stats.attended}
              {stats.decided > stats.attended && <span className="text-[15px] font-normal text-muted"> of {stats.decided}</span>}
            </>
          }
          ring={stats.decided ? stats.attended / stats.decided : undefined}
          sub={stats.upcoming ? `${stats.upcoming} coming up this week` : "Nothing this week"}
        />
        <Kpi label="People met" value={stats.met} sub={`${stats.emails} with an email${stats.top ? ` · most at ${stats.top.name}` : ""}`} />
        <Kpi
          label="Thank-yous sent"
          value={stats.thanked}
          tone={stats.unthanked ? "bad" : stats.calls ? "good" : undefined}
          sub={stats.unthanked ? `${stats.unthanked} still owed` : stats.calls ? `${stats.calls} led to a call` : `${stats.replies} replied`}
        />
        <Kpi label="Reply rate" value={pct(stats.rate)} ring={stats.rate} tone={stats.rate !== undefined && stats.coldRate !== undefined && stats.rate > stats.coldRate ? "good" : undefined} sub={`vs ${pct(stats.coldRate)} for cold emails`} />
      </div>

      {unsorted.length > 0 && <UnsortedCard list={unsorted} sessions={sessions} />}

      <div className={cn("grid grid-cols-[minmax(0,1fr)] items-start gap-4", selected && "xl:grid-cols-[minmax(0,1fr)_420px]")}>
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <Segmented
              value={when}
              onChange={setWhen}
              options={[
                ["all", "All"],
                ["up", <span key="u">Upcoming <span className="num text-muted">{rows.up.length}</span></span>],
                ["past", <span key="p">Past <span className="num text-muted">{rows.past.length}</span></span>],
              ]}
            />
            <Segmented
              value={kind}
              onChange={setKind}
              options={[
                ["all", "All hosts"],
                ["firm", "Firms"],
                ["club", "Clubs"],
              ]}
            />
            <label className="ml-auto flex h-8 w-full items-center gap-2 rounded-lg border border-line-2 bg-panel px-2.5 text-[13px] text-muted sm:w-56">
              <Search className="size-3.5 shrink-0" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by firm…" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" aria-label="Filter by firm" />
            </label>
          </div>
          {rows.shown.length === 0 ? (
            <Empty icon={<Presentation className="size-6" />} title={sessions.length ? "No sessions match" : "No info sessions yet"}>
              {sessions.length
                ? "Try another filter."
                : connected
                  ? "Nothing on your calendar looks like an info session in the last 6 months or the next 2."
                  : "Connect your calendar (above) or add a session by hand."}
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-subtle text-left text-[11px] font-medium tracking-[0.06em] text-muted uppercase">
                    <th className="px-4 py-2.5 font-medium">Session</th>
                    <th className="px-3 py-2.5 font-medium">When</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 text-right font-medium">Met</th>
                    <th className="px-3 py-2.5 font-medium">Thank-yous</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.shown.map((s) => (
                    <SessionRow key={s.id} session={s} club={isClubSession(s, banks)} selected={s.id === open} onOpen={() => setOpen(s.id === open ? null : s.id)} contacts={contacts} now={now} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {selected && (
          <>
            {/* Below xl the panel slides over the page; at xl it's a sticky column next to the table. */}
            <div className="fixed inset-0 z-40 bg-ink/25 xl:hidden" onClick={() => setOpen(null)} />
            <Card className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col overflow-hidden rounded-none border-y-0 border-r-0 shadow-2xl xl:sticky xl:top-[4.5rem] xl:z-auto xl:max-h-[calc(100vh-6rem)] xl:w-auto xl:max-w-none xl:rounded-xl xl:border xl:shadow-none">
              <InfoSessionDetail session={selected} onClose={() => setOpen(null)} />
            </Card>
          </>
        )}
      </div>

      <AddSessionModal open={adding} onClose={() => setAdding(false)} onAdded={(id) => setOpen(id)} />
    </div>
  );
}

/** Where the thank-yous stand, as the row's status pill. */
function statusOf(s: InfoSession, people: Contact[], upcoming: boolean, now: number): { text: string; tone: "green" | "blue" | "amber" | "brass" | "neutral" } {
  const pending = s.pending?.length ?? 0;
  if (upcoming) {
    const start = new Date(s.start).getTime();
    if (start <= now) return { text: "Happening now", tone: "brass" };
    const days = Math.round((new Date(s.start).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
    return { text: days === 0 ? "Today" : days === 1 ? "Tomorrow" : "Upcoming", tone: days <= 1 ? "blue" : "neutral" };
  }
  if (pending) return { text: `${pending} to review`, tone: "brass" };
  if (s.attended === false) return { text: "Skipped", tone: "neutral" };
  if (!people.length) return { text: s.attended ? "No one added" : "Did you go?", tone: "neutral" };
  const sent = people.filter((c) => c.sentAt).length;
  const queued = people.filter((c) => !c.sentAt && c.serverSend).length;
  const drafted = people.filter((c) => !c.sentAt && !c.serverSend && c.status === "drafted").length;
  const left = people.filter((c) => !c.sentAt && !c.serverSend && (c.status === "new" || c.status === "drafted")).length;
  if (sent === people.length) return { text: "Followed up", tone: "green" };
  if (queued) return { text: `${queued} queued`, tone: "blue" };
  if (drafted) return { text: `${drafted} in Gmail drafts`, tone: "brass" };
  if (left && timingOf(s) === "choose" && !s.followUp) return { text: "Tonight or next week?", tone: "amber" };
  if (left) return { text: `${left} to thank`, tone: "amber" };
  return { text: `${sent} thanked`, tone: "neutral" };
}

function SessionRow({ session: s, club, selected, onOpen, contacts, now }: { session: InfoSession; club: boolean; selected: boolean; onOpen: () => void; contacts: Contact[]; now: number }) {
  const update = useStore((st) => st.updateInfoSession);
  const people = useMemo(() => peopleOf(s, contacts), [s, contacts]);
  const upcoming = new Date(s.end).getTime() > now;
  const status = statusOf(s, people, upcoming, now);
  const thanked = people.filter((c) => c.sentAt || c.serverSend).length;
  const { day, time } = sessionWhen(s);
  const second = [club ? "Club" : "", s.host ? `Hosted by ${s.host}` : "", s.group, s.titleNote ? `“${s.titleNote}”` : s.link ? "Zoom / online" : s.location].filter(Boolean).join(" · ");
  return (
    <tr id={`session-${s.id}`} onClick={onOpen} className={cn("group cursor-pointer border-b border-line last:border-b-0", selected ? "bg-brass-soft/50" : "hover:bg-subtle")}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-3">
          <FirmMark firm={s.firm} />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{s.firm}</div>
            {second && <div className="max-w-[300px] truncate text-[12px] text-muted">{second}</div>}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div className="text-ink">{day}</div>
        <div className="text-[12px] text-muted">{time}</div>
      </td>
      <td className="px-3 py-2.5">
        <Badge tone={status.tone}>{status.text}</Badge>
      </td>
      <td className="num px-3 py-2.5 text-right text-ink">{people.length || <span className="text-muted">–</span>}</td>
      <td className="px-3 py-2.5">
        {people.length ? (
          <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-track">
              <div className="h-full rounded-full bg-brass" style={{ width: `${(thanked / people.length) * 100}%` }} />
            </div>
            <span className="num">
              {thanked}/{people.length}
            </span>
          </div>
        ) : (
          <span className="text-muted">–</span>
        )}
      </td>
      <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
        <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Menu
            items={[
              !upcoming && { label: s.attended === true ? "✓ Went" : "Mark as went", onClick: () => update(s.id, { attended: s.attended === true ? undefined : true }) },
              !upcoming && { label: s.attended === false ? "✓ Skipped" : "Mark as skipped", onClick: () => update(s.id, { attended: s.attended === false ? undefined : false }) },
              !!s.link && { label: "Open join link", icon: <ExternalLink />, onClick: () => window.open(s.link, "_blank", "noreferrer") },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}

function UnsortedCard({ list, sessions }: { list: UnsortedCapture[]; sessions: InfoSession[] }) {
  const options = useMemo(() => [...sessions].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 60), [sessions]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title={`Unsorted captures (${list.length})`} sub="Sent from your phone without a session that had just ended. Pick the session they belong to." />
      <ul className="divide-y divide-line">
        {list.map((u) => {
          const target = pick[u.id] ?? "";
          return (
            <li key={u.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-[13px]">
              {u.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.image} alt="Capture from your phone" className="h-20 w-20 shrink-0 rounded border border-line object-cover" />
              )}
              <div className="min-w-0 flex-1 basis-[200px]">
                <div className="text-[12px] text-muted">
                  {new Date(u.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {u.via === "twilio" ? "text message" : "phone"}
                </div>
                {u.people.length > 0 ? (
                  <div className="mt-0.5 text-ink">{u.people.map((p) => p.name).join(", ")}</div>
                ) : (
                  <div className="mt-0.5 text-muted">{u.error ? `Couldn't read it: ${u.error}` : "No names found."}</div>
                )}
                {u.text && <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">{u.text}</div>}
              </div>
              <div className="flex max-w-full flex-wrap items-center gap-2">
                <Select value={target} onChange={(e) => setPick((p) => ({ ...p, [u.id]: e.target.value }))} className="h-8 max-w-[240px]" aria-label="Session">
                  <option value="">Pick a session…</option>
                  {options.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.firm} · {new Date(s.start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </option>
                  ))}
                </Select>
                {u.error && (
                  <Button
                    size="sm"
                    icon={<RotateCw className="size-3.5" />}
                    loading={busy === u.id}
                    onClick={async () => {
                      setBusy(u.id);
                      try {
                        await retryUnsorted(u.id, target || undefined);
                        toast.ok("Read again.");
                      } catch (e) {
                        toast.err((e as Error).message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    Read again
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!target || !u.people.length}
                  onClick={async () => {
                    const n = await assignUnsorted(u.id, target);
                    toast.ok(`${n} ${n === 1 ? "person" : "people"} added to that session's review list.`);
                  }}
                >
                  Add to session
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label="Discard capture" onClick={() => setUnsorted((l) => l.filter((x) => x.id !== u.id))} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function AddSessionModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const [firm, setFirm] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState("18:00");
  const [to, setTo] = useState("19:00");
  const [where, setWhere] = useState("");
  const start = new Date(`${date}T${from || "00:00"}`);
  const end = new Date(`${date}T${to || from || "00:00"}`);
  const error = !firm.trim() ? "Which firm (or club) hosted it?" : isNaN(start.getTime()) ? "Pick a date." : end <= start ? "The end has to be after the start." : "";
  return (
    <Modal open={open} onClose={onClose} title="Add an info session">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <Field label="Firm or club">
          <Input value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="Evercore" autoFocus />
        </Field>
        <Field label="Title" hint="Optional">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${firm || "Evercore"} Info Session`} />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Starts">
            <Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Ends">
            <Input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Where" hint="A room, or a Zoom link">
            <Input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Ackerman Grand Ballroom" />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {error && firm && <span className="mr-auto text-[12.5px] text-red">{error}</span>}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!!error}
          onClick={() => {
            const id = addManualSession({ firm, title, start, end, location: where });
            toast.ok("Session added.");
            onAdded(id);
            setFirm("");
            setTitle("");
            setWhere("");
            onClose();
          }}
        >
          Add session
        </Button>
      </div>
    </Modal>
  );
}

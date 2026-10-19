"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarSync, ChevronDown, ChevronRight, ExternalLink, Inbox, MapPin, Plus, Presentation, RotateCw, Smartphone, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { canonBank } from "@/lib/banks";
import { cn } from "@/lib/util";
import type { Contact, InfoSession } from "@/lib/types";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Modal, PageHeader, Select, Stat, toast } from "@/components/ui";
import { InfoSessionDetail } from "@/components/InfoSessionDetail";
import {
  addManualSession,
  assignUnsorted,
  cleanTitle,
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
const AHEAD = 60 * 86_400_000;
const REPLIED = new Set(["replied", "call_scheduled", "done"]);

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");

function InfoSessionsInner() {
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
    const onVis = tick;
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [connected, refresh, pull]);

  // ?id=<session> (the reminder texts link here): open it and scroll to it once it's loaded.
  useEffect(() => {
    if (!deep) return;
    const el = document.getElementById(`session-${deep}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [deep, sessions.length]);

  const shown = useMemo(
    () => sessions.filter((s) => kind === "all" || (kind === "club") === isClubSession(s, banks)),
    [sessions, kind, banks],
  );
  const upcoming = useMemo(
    () => shown.filter((s) => new Date(s.end).getTime() > now && new Date(s.start).getTime() <= now + AHEAD).sort((a, b) => a.start.localeCompare(b.start)),
    [shown, now],
  );
  const past = useMemo(() => shown.filter((s) => new Date(s.end).getTime() <= now).sort((a, b) => b.start.localeCompare(a.start)), [shown, now]);

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
    return {
      upcoming: sessions.filter((s) => new Date(s.end).getTime() > now).length,
      attended: sessions.filter((s) => s.attended === true).length,
      skipped: sessions.filter((s) => s.attended === false).length,
      met: met.length,
      emails: met.filter((c) => c.email).length,
      thanked: metSent.length,
      replies: repliedOf(met),
      calls: met.filter((c) => c.call || c.chats?.length || c.status === "call_scheduled").length,
      metRate: pct(repliedOf(metSent), metSent.length),
      coldRate: pct(repliedOf(cold), cold.length),
      top: [...firms.values()].sort((a, b) => b.n - a.n).slice(0, 5),
    };
  }, [contacts, sessions, now]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Info sessions"
        sub="Every firm info session on your calendar, who you met at each, and thank-you emails the same night."
        right={
          <>
            {connected && (
              <>
                <Button icon={<CalendarSync className="size-4" />} loading={loading} onClick={() => refresh(false)}>
                  Refresh from calendar
                </Button>
                <Button icon={<Smartphone className="size-4" />} loading={pulling} onClick={() => pull(false)}>
                  Check phone captures
                </Button>
              </>
            )}
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Add session
            </Button>
          </>
        }
      />

      {(!connected || calendar === false) && (
        <Card className="border-brass/40 bg-brass-soft/40 px-4 py-3 text-[13px] text-ink-2">
          <strong className="font-semibold text-ink">Read sessions from Google Calendar:</strong> Turn on automatic sending and tick Calendar (Follow-ups → Reminders).{" "}
          {calendar === false && "Your connection doesn't include the calendar yet, so reconnect with Calendar ticked. "}
          <Link href="/followups?tab=reminders" className="font-medium text-navy hover:underline">
            Open Reminders
          </Link>
          <span className="text-muted"> · Sessions you add by hand work without it.</span>
        </Card>
      )}

      <Card>
        <div className="grid grid-cols-2 divide-line md:grid-cols-5 md:divide-x">
          <Stat label="Sessions" value={stats.attended} sub={`attended · ${stats.upcoming} upcoming · ${stats.skipped} skipped`} />
          <Stat label="People met" value={stats.met} sub={`${stats.emails} with an email`} />
          <Stat label="Thank-yous sent" value={stats.thanked} sub={`${stats.replies} replied`} />
          <Stat label="Calls" value={stats.calls} tone={stats.calls ? "green" : undefined} />
          <Stat label="Reply rate" value={stats.metRate} sub={`vs ${stats.coldRate} for cold emails`} />
        </div>
        {stats.top.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
            Most people met:
            {stats.top.map((f) => (
              <Badge key={f.name} tone="brass">
                {f.name} · {f.n}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {unsorted.length > 0 && <UnsortedCard list={unsorted} sessions={sessions} />}

      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        Show
        <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="h-8" aria-label="Which sessions">
          <option value="all">All sessions</option>
          <option value="firm">Firm sessions</option>
          <option value="club">Club sessions</option>
        </Select>
      </div>

      {sessions.length === 0 ? (
        <Card>
          <Empty icon={<Presentation className="size-6" />} title="No info sessions yet">
            {connected ? "Nothing on your calendar looks like an info session in the last 6 months or the next 2." : "Connect your calendar (above) or add a session by hand."}
          </Empty>
        </Card>
      ) : (
        <>
          <SessionList title="Upcoming" sub="The next 60 days." list={upcoming} banks={banks} open={open} setOpen={setOpen} contacts={contacts} now={now} />
          <SessionList title="Past" sub="Newest first. Open one to mark it, add who you met and send thank-yous." list={past} banks={banks} open={open} setOpen={setOpen} contacts={contacts} now={now} />
        </>
      )}

      <AddSessionModal open={adding} onClose={() => setAdding(false)} onAdded={(id) => setOpen(id)} />
    </div>
  );
}

function SessionList(props: { title: string; sub: string; list: InfoSession[]; banks: Set<string>; open: string | null; setOpen: (id: string | null) => void; contacts: Contact[]; now: number }) {
  const { title, sub, list } = props;
  return (
    <Card>
      <CardHeader title={`${title} (${list.length})`} sub={sub} />
      {list.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-muted">None.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((s) => (
            <SessionRow key={s.id} session={s} club={isClubSession(s, props.banks)} isOpen={props.open === s.id} onToggle={() => props.setOpen(props.open === s.id ? null : s.id)} contacts={props.contacts} now={props.now} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function when(s: InfoSession) {
  const start = new Date(s.start);
  const day = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (s.allDay) return `${day} · time TBD`;
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${t(start)}–${t(new Date(s.end))}`;
}

/** Where the thank-yous stand for a past session. */
function followUpState(s: InfoSession, people: Contact[]): { text: string; tone: "green" | "blue" | "amber" | "brass" | "neutral" } | null {
  if (!people.length) return null;
  const sent = people.filter((c) => c.sentAt).length;
  const queued = people.filter((c) => !c.sentAt && c.serverSend).length;
  const drafted = people.filter((c) => !c.sentAt && !c.serverSend && c.status === "drafted").length;
  const left = people.filter((c) => !c.sentAt && !c.serverSend && (c.status === "new" || c.status === "drafted")).length;
  if (sent === people.length) return { text: "Thanked ✓", tone: "green" };
  if (queued) return { text: `${queued} queued${sent ? ` · ${sent} sent` : ""}`, tone: "blue" };
  if (drafted) return { text: `${drafted} in Gmail drafts`, tone: "brass" };
  if (left && timingOf(s) === "choose" && !s.followUp) return { text: "Thank-yous: tonight or next week?", tone: "amber" };
  if (left) return { text: `${left} to thank`, tone: "amber" };
  return { text: `${sent} sent`, tone: "neutral" };
}

function SessionRow({ session: s, club, isOpen, onToggle, contacts, now }: { session: InfoSession; club: boolean; isOpen: boolean; onToggle: () => void; contacts: Contact[]; now: number }) {
  const update = useStore((st) => st.updateInfoSession);
  const people = useMemo(() => peopleOf(s, contacts), [s, contacts]);
  const isPast = new Date(s.start).getTime() <= now;
  const state = isPast ? followUpState(s, people) : null;
  const pending = s.pending?.length ?? 0;
  const mustGo = s.titleNote && /must|peep|important|go\b/i.test(s.titleNote);
  return (
    <li id={`session-${s.id}`} className="scroll-mt-4">
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3", isOpen && "bg-[#f7f6f1]")}>
        <button type="button" onClick={onToggle} aria-expanded={isOpen} className="flex min-w-0 flex-1 basis-[260px] items-start gap-2 text-left">
          {isOpen ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted" /> : <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted" />}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-ink">{s.firm}</span>
              {club && <Badge>club</Badge>}
              {s.host && <Badge tone="blue">by {s.host}</Badge>}
              {s.group && <Badge>{s.group}</Badge>}
              {s.titleNote && <Badge tone={mustGo ? "amber" : "neutral"}>{s.titleNote}</Badge>}
              {s.source === "manual" && <Badge tone="neutral">added by hand</Badge>}
            </span>
            <span className="mt-0.5 block text-[12.5px] text-muted">{when(s)}</span>
            {cleanTitle(s) !== s.firm && <span className="block truncate text-[12px] text-muted">{cleanTitle(s)}</span>}
          </span>
        </button>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px]">
          {s.link ? (
            <a href={s.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-navy hover:underline">
              <ExternalLink className="size-3.5" /> Join link
            </a>
          ) : s.location ? (
            <span className="inline-flex max-w-[220px] items-center gap-1 truncate text-muted" title={s.location}>
              <MapPin className="size-3.5 shrink-0" /> <span className="truncate">{s.location}</span>
            </span>
          ) : null}
          <span className="num text-muted">
            {people.length} met
          </span>
          {pending > 0 && (
            <Badge tone="amber">
              <Inbox className="size-3" /> {pending} to review
            </Badge>
          )}
          {state && <Badge tone={state.tone}>{state.text}</Badge>}
          {isPast && (
            <span className="inline-flex overflow-hidden rounded-md border border-line-2" role="group" aria-label="Did you go?">
              <button
                type="button"
                onClick={() => update(s.id, { attended: s.attended === true ? undefined : true })}
                className={cn("px-2 py-0.5 text-[12px]", s.attended === true ? "bg-navy text-white" : "bg-panel text-ink-2 hover:bg-[#f0eee7]")}
                aria-pressed={s.attended === true}
              >
                Went
              </button>
              <button
                type="button"
                onClick={() => update(s.id, { attended: s.attended === false ? undefined : false })}
                className={cn("border-l border-line-2 px-2 py-0.5 text-[12px]", s.attended === false ? "bg-navy text-white" : "bg-panel text-ink-2 hover:bg-[#f0eee7]")}
                aria-pressed={s.attended === false}
              >
                Skipped
              </button>
            </span>
          )}
        </div>
      </div>
      {isOpen && <InfoSessionDetail session={s} />}
    </li>
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

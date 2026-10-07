"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CalendarPlus, Clock, ExternalLink, MailPlus, RefreshCw } from "lucide-react";
import { useStore } from "@/lib/store";
import { callApi } from "@/lib/api";
import { aiReady, googleClientId } from "@/lib/keys";
import { connectGmail, gmailConnected, latestFrom, upsertDraft, type TheirMessage } from "@/lib/gmail";
import { busyTimes, calendarConnected, createCallEvent } from "@/lib/gcal";
import { COMMON_ZONES, dateTimeLabel, formatWindows, freeWindows, narrowTo, phonesIn, tzLabel, ymdIn, type AskedFor, type Window } from "@/lib/availability";
import { fillScheduling, schedulingOf } from "@/lib/scheduling";
import { recipientTz, zonedDate } from "@/lib/sendWindow";
import { withSignature } from "@/lib/emailFormat";
import { EMAIL_FONTS, type Contact } from "@/lib/types";
import { cn, relDays } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, Modal, Select, Textarea, toast } from "./ui";

/* ---------------- reading their reply ---------------- */

type Parsed = {
  timezone: string;
  timezoneEvidence: string;
  asksForAvailability: boolean;
  fromDate: string | null;
  toDate: string | null;
  weekdays: number[];
  earliest: string | null;
  latest: string | null;
  proposed: { date: string; time: string }[];
  phone: string | null;
  summary: string;
};

const hm = (s: string | null) => {
  const m = s?.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

/** Their latest email + what it asks for (AI if configured; otherwise the office time zone and their phone from the signature). */
function useTheirReply(c: Contact) {
  const settings = useStore((s) => s.settings);
  const [state, setState] = useState<{ loading: boolean; msg?: TheirMessage | null; parsed?: Parsed; error?: string }>({ loading: false });
  const clientId = googleClientId(settings);

  const load = async () => {
    setState({ loading: true });
    try {
      await connectGmail(clientId);
      const msg = c.email ? await latestFrom(clientId, c.email) : null;
      const guess = recipientTz(c);
      let parsed: Parsed | undefined;
      if (msg && aiReady(settings)) {
        const today = new Date();
        parsed = await callApi<Parsed>(
          "/api/scheduling/parse",
          {
            message: msg.text || msg.full.slice(0, 3000),
            signature: msg.full.slice(msg.text.length, msg.text.length + 3000),
            theirName: c.name,
            theirTzGuess: guess,
            today: `${ymdIn(today, guess)} (${today.toLocaleDateString("en-US", { timeZone: guess, weekday: "long" })})`,
            myPhone: settings.profile.phone,
          },
          settings,
        );
      }
      const phone = parsed?.phone ?? (msg ? phonesIn(msg.full, [settings.profile.phone])[0] : undefined) ?? null;
      parsed ??= { timezone: guess, timezoneEvidence: "office guess", asksForAvailability: true, fromDate: null, toDate: null, weekdays: [], earliest: null, latest: null, proposed: [], phone, summary: "" };
      if (!parsed.phone && phone) parsed.phone = phone;
      setState({ loading: false, msg, parsed });
    } catch (e) {
      setState({ loading: false, error: (e as Error).message });
    }
  };
  // Read automatically when Gmail is already connected this session (no popup); otherwise wait for a click.
  useEffect(() => {
    if (!gmailConnected(clientId)) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  return { ...state, load, clientId };
}

function TheirEmail({ r }: { r: ReturnType<typeof useTheirReply> }) {
  if (r.loading) return <div className="flex items-center gap-2 text-[12.5px] text-muted"><RefreshCw className="size-3.5 animate-spin" /> Reading their latest email…</div>;
  if (r.error) return <div className="text-[12.5px] text-red">{r.error}</div>;
  if (r.msg === undefined)
    return (
      <Button size="sm" icon={<MailPlus className="size-3.5" />} onClick={r.load}>
        Read their reply from Gmail
      </Button>
    );
  if (!r.msg) return <div className="text-[12.5px] text-muted">No email from them found in Gmail. You can still pick times below.</div>;
  return (
    <div className="rounded-md border border-line bg-[#fbfaf6] p-3 text-[12.5px]">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-muted">
        <span className="font-medium text-ink-2">{r.msg.subject}</span> · {relDays(r.msg.date)}
      </div>
      <p className="line-clamp-6 whitespace-pre-wrap text-ink-2">{r.msg.text}</p>
      {r.parsed?.summary && <p className="mt-2 text-[12px] text-navy">→ {r.parsed.summary}</p>}
    </div>
  );
}

function ZoneSelect({ value, onChange, evidence }: { value: string; onChange: (tz: string) => void; evidence?: string }) {
  const zones = COMMON_ZONES.some(([z]) => z === value) ? COMMON_ZONES : [[value, value] as [string, string], ...COMMON_ZONES];
  return (
    <Field label="Their time zone" hint={evidence ? `From: ${evidence}` : undefined}>
      <Select className="w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        {zones.map(([z, label]) => (
          <option key={z} value={z}>
            {label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/* ---------------- reply with availability ---------------- */

export function AvailabilityReply({ c, onClose }: { c: Contact; onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const updateContact = useStore((s) => s.updateContact);
  const sch = schedulingOf(settings);
  const r = useTheirReply(c);
  const [tz, setTz] = useState<string | null>(null);
  const [ask, setAsk] = useState<AskedFor | null>(null);
  const [busy, setBusy] = useState<Window[] | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [body, setBody] = useState<string | null>(null);
  const [signature, setSignature] = useState(true);
  const [saving, setSaving] = useState(false);

  const theirTz = tz ?? r.parsed?.timezone ?? recipientTz(c);
  const parsed = r.parsed;
  const asked: AskedFor = useMemo(
    () =>
      ask ?? {
        fromDate: parsed?.fromDate ?? undefined,
        toDate: parsed?.toDate ?? undefined,
        weekdays: parsed?.weekdays ?? [],
        earliest: hm(parsed?.earliest ?? null),
        latest: hm(parsed?.latest ?? null),
      },
    [ask, parsed],
  );

  // Free times in your zone → what they asked for in theirs → one line per day.
  const lines = useMemo(() => {
    const now = new Date();
    const to = asked.toDate ? zonedDate(...(asked.toDate.split("-").map(Number) as [number, number, number]), 23, 59, theirTz) : new Date(now.getTime() + sch.availability.horizonDays * 86_400_000);
    const from = asked.fromDate ? zonedDate(...(asked.fromDate.split("-").map(Number) as [number, number, number]), 0, 0, theirTz) : now;
    const free = narrowTo(freeWindows(sch.availability, busy ?? [], from, to, now), asked, theirTz);
    return formatWindows(free, theirTz, { maxDays: 5 });
  }, [asked, busy, theirTz, sch.availability]);
  const chosen = lines.filter((l) => !skip.has(l));

  const generated = fillScheduling(sch.replyTemplate, c, settings.profile, { theirTz, availability: chosen });
  const text = body ?? generated;
  const mineVsTheirs = sch.availability.tz !== theirTz ? `Your hours are in ${tzLabel(sch.availability.tz)}; shown to ${c.firstName || c.name} in ${tzLabel(theirTz)}.` : "";

  const checkCalendar = async () => {
    try {
      const now = new Date();
      setBusy(await busyTimes(r.clientId, now, new Date(now.getTime() + 21 * 86_400_000)));
    } catch (e) {
      toast.err((e as Error).message);
    }
  };
  // Calendar already connected this session: subtract your events right away.
  useEffect(() => {
    if (!calendarConnected(r.clientId)) return;
    const t = setTimeout(() => void checkCalendar(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createDraft = async () => {
    if (!c.email) return toast.err(`${c.name} has no email.`);
    if (!chosen.length) return toast.err("No times to offer. Widen the dates or check your availability in Settings → Email → Scheduling.");
    setSaving(true);
    try {
      const subject = r.msg?.subject ? (/^re:/i.test(r.msg.subject) ? r.msg.subject : `Re: ${r.msg.subject}`) : `Re: ${c.draft?.subject ?? "Coffee chat"}`;
      await upsertDraft(r.clientId, undefined, {
        to: c.email,
        subject,
        body: signature ? withSignature(text, settings.profile) : text,
        threadId: r.msg?.threadId ?? c.threadId,
        inReplyTo: r.msg?.messageId ?? c.lastMessageId,
        font: EMAIL_FONTS[c.trial?.font ?? settings.emailStyle.font]?.css,
      });
      updateContact(
        c.id,
        { ...(r.parsed?.phone && !c.phone ? { phone: r.parsed.phone } : {}) },
        { at: new Date().toISOString(), type: "note", note: `Availability reply drafted (${chosen.length} day${chosen.length > 1 ? "s" : ""}, ${tzLabel(theirTz)})` },
      );
      toast.ok(`Reply drafted in the same Gmail thread as their email (${chosen.length} day${chosen.length > 1 ? "s" : ""} of times, ${tzLabel(theirTz)}). Review it in Gmail Drafts and send.`);
      onClose();
    } catch (e) {
      toast.err((e as Error).message);
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <TheirEmail r={r} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <ZoneSelect value={theirTz} onChange={(z) => (setTz(z), setBody(null))} evidence={tz ? undefined : r.parsed?.timezoneEvidence} />
        <Field label="From">
          <Input type="date" value={asked.fromDate ?? ""} onChange={(e) => (setAsk({ ...asked, fromDate: e.target.value || undefined }), setBody(null))} />
        </Field>
        <Field label="To">
          <Input type="date" value={asked.toDate ?? ""} onChange={(e) => (setAsk({ ...asked, toDate: e.target.value || undefined }), setBody(null))} />
        </Field>
      </div>
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] font-medium text-ink-2">
          Times to offer ({tzLabel(theirTz)})
          {busy ? <Badge tone="green">your calendar checked</Badge> : <button className="font-normal text-navy underline" onClick={checkCalendar}>Leave out my calendar events</button>}
        </div>
        {mineVsTheirs && <p className="mb-1 text-[11.5px] text-muted">{mineVsTheirs}</p>}
        {lines.length ? (
          <ul className="space-y-1 text-[13px]">
            {lines.map((l) => (
              <li key={l} className="flex items-center gap-2">
                <Checkbox checked={!skip.has(l)} onChange={(on) => (setSkip((s) => { const n = new Set(s); if (on) n.delete(l); else n.add(l); return n; }), setBody(null))} />
                <span className="num">{l}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-amber">Nothing free in that range. Widen the dates, or update your hours in Settings → Email → Scheduling.</p>
        )}
      </div>
      <Field label="Reply" hint={body !== null ? "Edited by you: changing times above resets it." : "From your template (Settings → Email → Scheduling)."}>
        <Textarea rows={11} value={text} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox checked={signature} onChange={setSignature} label="Add my signature" />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} icon={<MailPlus className="size-4" />} onClick={createDraft}>
            Draft reply in Gmail
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- calendar invite ---------------- */

export function CallInvite({ c, onClose }: { c: Contact; onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const updateContact = useStore((s) => s.updateContact);
  const sch = schedulingOf(settings);
  const r = useTheirReply(c);
  const [tz, setTz] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(sch.availability.meetingMinutes);
  const [phone, setPhone] = useState<string | null>(null);
  const [notify, setNotify] = useState(sch.inviteNotify);
  const [saving, setSaving] = useState(false);

  const theirTz = tz ?? r.parsed?.timezone ?? recipientTz(c);
  const proposed = r.parsed?.proposed?.[0];
  const d = date ?? proposed?.date ?? "";
  const t = time ?? proposed?.time ?? "";
  const ph = phone ?? c.phone ?? r.parsed?.phone ?? "";
  const at = d && t ? zonedDate(...(d.split("-").map(Number) as [number, number, number]), Number(t.split(":")[0]), Number(t.split(":")[1]), theirTz) : null;
  const who = { ...c, phone: ph };
  const title = fillScheduling(sch.inviteTitle, who, settings.profile, { theirTz, at: at ?? undefined });
  const description = fillScheduling(sch.inviteDescription, who, settings.profile, { theirTz, at: at ?? undefined });

  const create = async () => {
    if (!at) return toast.err("Pick the date and time of the call.");
    if (notify && !c.email) return toast.err(`${c.name} has no email to invite. Untick "Email them the invite" to just add it to your calendar.`);
    setSaving(true);
    try {
      const ev = await createCallEvent(r.clientId, { title, description, start: at, minutes, tz: theirTz, guest: c.email || undefined, notify });
      updateContact(
        c.id,
        { status: "call_scheduled", phone: ph || c.phone, call: { at: at.toISOString(), eventId: ev.id, link: ev.htmlLink, invited: notify } },
        { at: new Date().toISOString(), type: "status", note: `Call ${dateTimeLabel(at, theirTz)}${notify ? ", invite sent" : ", on your calendar"}` },
      );
      toast.ok(notify ? `Invite sent to ${c.email} for ${dateTimeLabel(at, theirTz)}.` : `Added to your calendar for ${dateTimeLabel(at, theirTz)} (no invite sent).`);
      onClose();
    } catch (e) {
      toast.err((e as Error).message);
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <TheirEmail r={r} />
      {proposed && !date && <p className="text-[12.5px] text-green">They suggested {dateTimeLabel(at!, theirTz)}. Filled in below.</p>}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <ZoneSelect value={theirTz} onChange={setTz} evidence={tz ? undefined : r.parsed?.timezoneEvidence} />
        <Field label="Their phone" hint={!ph ? "Not found in their email. Type it if you have it." : undefined}>
          <Input type="tel" value={ph} placeholder="415-555-0123" onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={`Date (${tzLabel(theirTz)})`}>
          <Input type="date" value={d} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={`Time (${tzLabel(theirTz)})`} hint={at && sch.availability.tz !== theirTz ? `= ${at.toLocaleString("en-US", { timeZone: sch.availability.tz, weekday: "short", hour: "numeric", minute: "2-digit" })} ${tzLabel(sch.availability.tz)} for you` : undefined}>
          <Input type="time" step={900} value={t} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Length">
          <Select className="w-full" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[15, 20, 30, 45, 60].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="rounded-md border border-line bg-[#fbfaf6] p-3 text-[13px]">
        <div className="font-medium text-ink">{title}</div>
        <div className="mt-1 text-ink-2">{description}</div>
        <div className="mt-1 text-[12px] text-muted">{at ? dateTimeLabel(at, theirTz) : "Pick a date and time"} · guest: {c.email || "none"}</div>
        <p className="mt-1 text-[11.5px] text-muted">Title and description come from your templates in Settings → Email → Scheduling.</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox checked={notify} onChange={setNotify} label="Email them the invite now" />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} icon={<CalendarPlus className="size-4" />} onClick={create} disabled={!at}>
            {notify ? "Send invite" : "Add to my calendar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- the list on Follow-ups ---------------- */

const WAITING = new Set(["replied", "call_scheduled"]);

/** People who replied: offer times (in their zone) or send the invite, one click each. */
export function ScheduleCallsCard({ onOpen }: { onOpen: (c: Contact) => void }) {
  const contacts = useStore((s) => s.contacts);
  const [modal, setModal] = useState<{ c: Contact; kind: "reply" | "invite" } | null>(null);
  const list = useMemo(
    () =>
      contacts
        .filter((c) => WAITING.has(c.status) && !(c.call && new Date(c.call.at) < new Date()))
        .sort((a, b) => (b.repliedAt ?? "").localeCompare(a.repliedAt ?? "")),
    [contacts],
  );
  if (!list.length) return null;
  return (
    <Card>
      <CardHeader title={`Replied: schedule calls · ${list.length}`} sub="Offer your free times in their time zone, then send the calendar invite." right={<Clock className="size-4 text-muted" />} />
      <ul className="divide-y divide-line">
        {list.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <button onClick={() => onOpen(c)} className="min-w-[200px] flex-1 text-left">
              <div className="font-medium hover:underline">{c.name}</div>
              <div className="text-[12px] text-muted">
                {c.position || "—"} · {c.bank} · {tzLabel(recipientTz(c))}
                {c.repliedAt && ` · replied ${relDays(c.repliedAt)}`}
              </div>
            </button>
            {c.call ? (
              <a href={c.call.link} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1")}>
                <Badge tone="green">
                  <CalendarCheck className="size-3" /> {dateTimeLabel(new Date(c.call.at), recipientTz(c))}
                  <ExternalLink className="size-3" />
                </Badge>
              </a>
            ) : null}
            <div className="flex gap-1">
              <Button size="sm" variant="brass" icon={<MailPlus className="size-3.5" />} onClick={() => setModal({ c, kind: "reply" })}>
                Reply with times
              </Button>
              <Button size="sm" icon={<CalendarPlus className="size-3.5" />} onClick={() => setModal({ c, kind: "invite" })}>
                {c.call ? "New invite" : "Send invite"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal ? `${modal.kind === "reply" ? "Reply with your availability" : "Calendar invite"}: ${modal.c.name}` : ""} wide>
        {modal?.kind === "reply" && <AvailabilityReply c={modal.c} onClose={() => setModal(null)} />}
        {modal?.kind === "invite" && <CallInvite c={modal.c} onClose={() => setModal(null)} />}
      </Modal>
    </Card>
  );
}

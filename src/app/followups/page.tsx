"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CalendarPlus, Check, Clock, MailPlus, MessageSquare, RefreshCw, Smartphone, UserX } from "lucide-react";
import { blobs, bankKey, useStore } from "@/lib/store";
import { liveByBank, nextAction, nextUp, rollupBanks, type BankRollup } from "@/lib/followups";
import { connectGmail, createDraft } from "@/lib/gmail";
import { describeSync, syncAllWithGmail } from "@/lib/gmailSync";
import { callApi } from "@/lib/api";
import { buildIcs } from "@/lib/ics";
import { digestText, upcomingDigests } from "@/lib/reminders";
import { fillPlaceholders, followUpTemplate, hasAiSlots, missingPlaceholders, AI_SLOT } from "@/lib/template";
import type { BankStatus, Contact, Region } from "@/lib/types";
import { addDays, cn, download, fmtDate, relDays } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Progress, Select, StatusBadge, toast } from "@/components/ui";
import { ContactModal } from "@/components/ContactModal";
import { FilterBar, useContactFilter, type Filters } from "@/components/ContactsTable";
import { aiReady, googleClientId } from "@/lib/keys";
import { bodyToPlain, withSignature } from "@/lib/emailFormat";

type Tab = "due" | "bankers" | "banks" | "reminders";

export default function FollowupsPage() {
  const [tab, setTab] = useState<Tab>("due");
  const [open, setOpen] = useState<Contact | null>(null);
  const [sync, setSync] = useState<{ done: number; total: number } | null>(null);
  const s = useStore();

  const runSync = async () => {
    setSync({ done: 0, total: 1 });
    try {
      await connectGmail(googleClientId(s.settings));
      const r = await syncAllWithGmail({ interactive: true, onProgress: (done, total) => setSync({ done, total }) });
      toast.ok(describeSync(r));
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setSync(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Follow-ups"
        sub={`Follow up ${s.settings.followUp.firstAfterDays} days after the first email, up to ${s.settings.followUp.maxFollowUps} times, then move on. Tracked per banker and per bank, split by SF and NY.`}
        right={
          sync ? (
            <div className="w-64">
              <Progress value={sync.done} max={sync.total} label={`${sync.done}/${sync.total} checked`} />
            </div>
          ) : (
            <Button icon={<RefreshCw className="size-3.5" />} onClick={runSync} title="Reads Sent mail and your inbox to fill in dates and replies">
              Sync with Gmail
            </Button>
          )
        }
      />

      <div className="mb-5 inline-flex rounded-md border border-line-2 bg-panel p-0.5">
        {(
          [
            ["due", "Due now"],
            ["bankers", "By banker"],
            ["banks", "By bank"],
            ["reminders", "Reminders & alerts"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn("rounded px-3.5 py-1.5 text-[13px]", tab === t ? "bg-navy text-white" : "text-ink-2 hover:bg-[#f0eee7]")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "due" && <DueList onOpen={setOpen} onSync={runSync} syncing={!!sync} />}
      {tab === "bankers" && <BankerTable onOpen={setOpen} />}
      {tab === "banks" && <BankBoard onOpen={setOpen} />}
      {tab === "reminders" && <Reminders />}

      <ContactModal contact={open} onClose={() => setOpen(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ */

function useActions() {
  const s = useStore();
  const now = () => new Date().toISOString();

  const followUpDraft = async (c: Contact) => {
    const t = followUpTemplate(c, s.templates);
    if (!t) return toast.err("Create a follow-up template on the Drafts page first.");
    if (!c.email) return toast.err(`${c.name} has no email yet.`);
    let subject = fillPlaceholders(t.subject, c, s.settings);
    // In-thread replies keep the original subject; without one, fall back to a neutral subject.
    if (/\{\{\s*original_subject\s*\}\}/.test(subject)) subject = c.threadId ? "Re:" : `Following up: ${s.settings.profile.school || "networking"}`;
    let body = fillPlaceholders(t.body, c, s.settings);
    if (hasAiSlots(body) || missingPlaceholders(body).length) {
      if (aiReady(s.settings)) {
        try {
          const r = await callApi<{ subject: string; body: string }>(
            "/api/draft",
            {
              mode: "fill",
              contact: { id: c.id, name: c.name, bank: c.bank, position: c.position, location: c.location, region: c.region, school: c.school, comment: c.comment },
              sender: { name: s.settings.profile.name, school: s.settings.profile.school },
              subject,
              body,
            },
            s.settings,
          );
          body = r.body;
        } catch (e) {
          return toast.err((e as Error).message);
        }
      } else body = body.replace(new RegExp(AI_SLOT.source, "g"), "");
    }
    body = withSignature(body, s.settings.profile);
    if (!googleClientId(s.settings)) {
      window.location.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyToPlain(body))}`;
      return;
    }
    try {
      await connectGmail(googleClientId(s.settings));
      const resume = t.attachResume ? await blobs.resume() : undefined;
      await createDraft(googleClientId(s.settings), {
        to: c.email,
        subject,
        body,
        threadId: c.threadId,
        inReplyTo: c.lastMessageId,
        attachment: resume,
      });
      toast.ok(`Follow-up draft for ${c.name} is in Gmail${c.threadId ? " (same thread)" : ""}. Mark it followed up once it's sent.`);
    } catch (e) {
      toast.err((e as Error).message);
    }
  };

  return {
    followUpDraft,
    markFollowed: (c: Contact) => s.setStatus([c.id], "followed_up", `Follow-up #${c.followUps + 1} sent`),
    markSent: (c: Contact) => s.setStatus([c.id], "sent"),
    replied: (c: Contact) => s.setStatus([c.id], "replied"),
    moveOn: (c: Contact) => s.setStatus([c.id], "ignored", "Moved on"),
    snooze: (c: Contact, days: number) =>
      s.updateContact(c.id, { snoozeUntil: addDays(new Date(), days).toISOString() }, { at: now(), type: "note", note: `Snoozed ${days}d` }),
  };
}

function DueList({ onOpen, onSync, syncing }: { onOpen: (c: Contact) => void; onSync: () => void; syncing: boolean }) {
  const { contacts, banks, settings } = useStore();
  const act = useActions();
  const [busy, setBusy] = useState<string | null>(null);
  const { due, upcoming } = useMemo(() => {
    const all = contacts
      .map((c) => ({ c, a: nextAction(c, settings.followUp, banks[bankKey(c.bank, c.region)]) }))
      .filter(({ a }) => ["follow_up", "move_on", "send"].includes(a.kind));
    const sorted = all.sort((x, y) => (x.a.due?.getTime() ?? 0) - (y.a.due?.getTime() ?? 0));
    return { due: sorted.filter((x) => x.a.isDue), upcoming: sorted.filter((x) => !x.a.isDue).slice(0, 15) };
  }, [contacts, banks, settings.followUp]);

  if (!due.length && !upcoming.length)
    return (
      <Card>
        <Empty icon={<Check className="size-6" />} title="No follow-ups pending">
          Once you mark people as sent (or sync with Gmail), reminders show up here {settings.followUp.firstAfterDays} days later.
        </Empty>
      </Card>
    );

  const unknown = due.filter(({ a }) => a.unknownDate).length;

  return (
    <div className="space-y-6">
      {unknown > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber/30 bg-amber-soft/50 px-4 py-3 text-[13px]">
          <span className="flex-1">
            <b>{unknown}</b> contact{unknown > 1 ? "s are" : " is"} marked sent without a date. Gmail can fill in when you actually emailed them,
            how many follow-ups went out, and whether they replied.
          </span>
          <Button size="sm" variant="primary" loading={syncing} onClick={onSync}>
            Fill in from Gmail
          </Button>
        </div>
      )}
      <Card>
        <CardHeader title={`Due now · ${due.length}`} sub="Overdue first" />
        {due.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-muted">You’re caught up.</div>
        ) : (
          <ul className="divide-y divide-line">
            {due.map(({ c, a }) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <button onClick={() => onOpen(c)} className="min-w-[220px] flex-1 text-left">
                  <div className="font-medium hover:underline">{c.name}</div>
                  <div className="text-[12px] text-muted">
                    {c.position || "—"} · {c.bank} {c.region !== "Other" && `(${c.region})`} · emailed {c.sentAt ? fmtDate(c.sentAt) : "date unknown"}
                    {c.followUps > 0 && ` · ${c.followUps} follow-up${c.followUps > 1 ? "s" : ""}`}
                  </div>
                </button>
                <StatusBadge status={c.status} />
                <Badge tone={a.kind === "move_on" ? "neutral" : "red"}>
                  {a.label} {!a.unknownDate && a.due && `· ${relDays(a.due)}`}
                </Badge>
                <div className="flex gap-1">
                  {a.kind === "send" ? (
                    <Button size="sm" onClick={() => act.markSent(c)} icon={<Check className="size-3.5" />}>
                      Mark sent
                    </Button>
                  ) : a.kind === "follow_up" ? (
                    <>
                      <Button
                        size="sm"
                        variant="brass"
                        loading={busy === c.id}
                        icon={<MailPlus className="size-3.5" />}
                        onClick={async () => {
                          setBusy(c.id);
                          await act.followUpDraft(c);
                          setBusy(null);
                        }}
                      >
                        Draft follow-up
                      </Button>
                      <Button size="sm" onClick={() => act.markFollowed(c)} icon={<Check className="size-3.5" />}>
                        Followed up
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => act.moveOn(c)} icon={<UserX className="size-3.5" />}>
                      Move on
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => act.replied(c)} icon={<MessageSquare className="size-3.5" />}>
                    Replied
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => act.snooze(c, 3)} icon={<Clock className="size-3.5" />}>
                    3d
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {upcoming.length > 0 && (
        <Card>
          <CardHeader title="Coming up" />
          <ul className="divide-y divide-line">
            {upcoming.map(({ c, a }) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <button onClick={() => onOpen(c)} className="flex-1 text-left hover:underline">
                  {c.name} <span className="text-muted">· {c.bank}</span>
                </button>
                <span className="text-ink-2">{a.label}</span>
                <span className="num w-20 text-right text-muted">{relDays(a.due)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function BankerTable({ onOpen }: { onOpen: (c: Contact) => void }) {
  const { contacts, banks, settings } = useStore();
  const [f, setF] = useState<Filters>({ q: "", bank: "", region: "", status: "", email: "" });
  const rows = useContactFilter(
    contacts.filter((c) => c.status !== "new"),
    f,
  );
  return (
    <Card className="overflow-hidden">
      <FilterBar f={f} setF={setF} contacts={contacts} extra={<span className="text-[12px] text-muted">{rows.length} people contacted</span>} />
      {rows.length === 0 ? (
        <Empty title="Nobody contacted yet">Draft emails, then mark them sent or sync with Gmail.</Empty>
      ) : (
        <div className="max-h-[68vh] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-[#faf9f5] text-left text-[11px] uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Banker</th>
                <th className="px-2 py-2 font-medium">Bank</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 text-right font-medium">First email</th>
                <th className="px-2 py-2 text-right font-medium">Last touch</th>
                <th className="px-2 py-2 text-right font-medium">F/U</th>
                <th className="px-4 py-2 font-medium">Next</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => {
                const a = nextAction(c, settings.followUp, banks[bankKey(c.bank, c.region)]);
                return (
                  <tr key={c.id} onClick={() => onOpen(c)} className="cursor-pointer hover:bg-[#fbfaf6]">
                    <td className="px-4 py-2 font-medium">{c.name}</td>
                    <td className="px-2 py-2">
                      {c.bank} <span className="text-[11px] text-muted">{c.region}</span>
                    </td>
                    <td className="px-2 py-2">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="num px-2 py-2 text-right text-[12px]">{fmtDate(c.sentAt)}</td>
                    <td className="num px-2 py-2 text-right text-[12px]">{fmtDate(c.lastTouchAt)}</td>
                    <td className="num px-2 py-2 text-right text-[12px]">{c.followUps}</td>
                    <td className="px-4 py-2 text-[12px]">
                      {a.kind !== "none" && a.label ? (
                        <span className={cn(a.isDue && "font-medium text-red")}>
                          {a.label}
                          {a.due && !a.unknownDate && <span className="text-muted"> · {relDays(a.due)}</span>}
                        </span>
                      ) : (
                        <span className="text-muted">{a.label || "—"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const BANK_STATUS: Record<BankStatus, string> = {
  active: "Active",
  applied: "Applied",
  paused: "Paused",
  offer: "Offer / Superday",
  moved_on: "Moved on",
};

function BankBoard({ onOpen }: { onOpen: (c: Contact) => void }) {
  const { contacts, banks, settings, upsertBank, setStatus } = useStore();
  const rollups = useMemo(() => rollupBanks(contacts, banks, settings.followUp), [contacts, banks, settings.followUp]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const live = useMemo(() => liveByBank(contacts), [contacts]);
  const cap = settings.followUp.livePerBank;
  const regions: Region[] = ["SF", "NY", ...(rollups.some((r) => r.meta.region === "Other") ? (["Other"] as Region[]) : [])];

  const row = (r: BankRollup) => {
    const isOpen = expanded === r.meta.key;
    const liveN = live.get(r.meta.name) ?? 0;
    const upNext = liveN < cap && r.meta.status === "active" ? nextUp(contacts.filter((c) => c.bank === r.meta.name)) : undefined;
    return (
      <li key={r.meta.key} className={cn(r.meta.status === "moved_on" && "opacity-60")}>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button onClick={() => setExpanded(isOpen ? null : r.meta.key)} className="min-w-0 flex-1 text-left">
            <div className="font-medium">{r.meta.name}</div>
            <div className="num text-[11.5px] text-muted">
              {r.reached}/{r.total} reached · {r.replied} replied · {Math.round(r.responseRate * 100)}%
              {r.nextDue && ` · next ${relDays(r.nextDue)}`}
            </div>
            {upNext && (
              <div className="mt-0.5 text-[11.5px] text-green">
                Open slot → next up: {upNext.name}
                {!upNext.email && " (needs email)"}
              </div>
            )}
          </button>
          <Badge tone={liveN >= cap ? "amber" : "neutral"}>
            <span className="num">
              {liveN}/{cap} live
            </span>
          </Badge>
          {r.due > 0 && <Badge tone="red">{r.due} due</Badge>}
          <Select
            className="h-7 text-[12px]"
            value={r.meta.status}
            aria-label={`${r.meta.name} status`}
            onChange={(e) => {
              const status = e.target.value as BankStatus;
              upsertBank({ ...r.meta, status });
              if (status === "moved_on") {
                const ids = r.contacts.filter((c) => ["sent", "followed_up", "new", "drafted"].includes(c.status)).map((c) => c.id);
                if (ids.length && confirmMoveOn(r.meta.name, ids.length)) setStatus(ids, "ignored", "Bank moved on");
              }
            }}
          >
            {Object.entries(BANK_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        {isOpen && (
          <div className="border-t border-dashed border-line bg-[#fbfaf6] px-4 py-3">
            <div className="mb-3 grid grid-cols-2 gap-3">
              <Field label="Application deadline">
                <Input type="date" className="h-8" value={r.meta.deadline ?? ""} onChange={(e) => upsertBank({ ...r.meta, deadline: e.target.value })} />
              </Field>
              <Field label="Email domain (for enrichment)">
                <Input className="h-8" placeholder="e.g. gs.com" value={r.meta.domain ?? ""} onChange={(e) => upsertBank({ ...r.meta, domain: e.target.value.trim() })} />
              </Field>
            </div>
            <ul className="space-y-1">
              {r.contacts.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-[12.5px]">
                  <button onClick={() => onOpen(c)} className="flex-1 truncate text-left hover:underline">
                    {c.name} <span className="text-muted">· {c.position}</span>
                  </button>
                  <StatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {regions.map((region) => {
        const list = rollups.filter((r) => r.meta.region === region).sort((a, b) => b.due - a.due || a.meta.name.localeCompare(b.meta.name));
        const totals = list.reduce((t, r) => ({ reached: t.reached + r.reached, replied: t.replied + r.replied }), { reached: 0, replied: 0 });
        return (
          <Card key={region}>
            <CardHeader
              title={region === "SF" ? "San Francisco / West Coast" : region === "NY" ? "New York" : "Unassigned region"}
              sub={`${list.length} banks · ${totals.reached} reached · ${totals.replied} replies`}
            />
            {list.length ? <ul className="divide-y divide-line">{list.map(row)}</ul> : <div className="p-6 text-center text-[13px] text-muted">No banks here yet.</div>}
          </Card>
        );
      })}
    </div>
  );
}

function confirmMoveOn(bank: string, n: number) {
  // Inline confirm is acceptable here: it's a deliberate bulk status change.
  return window.confirm(`Also mark ${n} un-replied contact${n > 1 ? "s" : ""} at ${bank} as "Moved on"?`);
}

function Reminders() {
  const { contacts, banks, settings, scheduled, markScheduled } = useStore();
  const k = settings.keys;
  const [busy, setBusy] = useState<string | null>(null);
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const digests = useMemo(() => upcomingDigests(contacts, banks, settings.followUp, 35), [contacts, banks, settings.followUp]);
  const todayDigest = digests[0]?.date === new Date().toLocaleDateString("en-CA") ? digests[0] : undefined;

  const send = async (channel: "ntfy" | "twilio" | "whatsapp", message: string, at?: Date, title = "Follow-ups due") =>
    callApi(
      "/api/notify",
      {
        channel,
        title,
        message,
        at: at?.toISOString(),
        ntfy: k.ntfyTopic ? { server: k.ntfyServer || "https://ntfy.sh", topic: k.ntfyTopic } : undefined,
        twilio: k.twilioSid
          ? { sid: k.twilioSid, token: k.twilioToken, from: k.twilioFrom || undefined, messagingServiceSid: k.twilioMessagingServiceSid || undefined, to: k.twilioTo }
          : undefined,
        whatsapp: k.whatsappPhone && k.whatsappApiKey ? { phone: k.whatsappPhone, apiKey: k.whatsappApiKey } : undefined,
      },
      settings,
    );

  const schedule = async (channel: "ntfy" | "twilio") => {
    const maxDays = channel === "ntfy" ? 3 : 35;
    const horizon = Date.now() + maxDays * 86_400_000;
    const list = digests.filter((d) => d.when.getTime() <= horizon && !scheduled[`${channel}:${d.date}`]);
    if (!list.length) return toast.info("Nothing new to schedule in that window.");
    setBusy(channel);
    let n = 0;
    for (const d of list) {
      try {
        const at = d.when.getTime() < Date.now() + 20 * 60_000 ? undefined : d.when;
        await send(channel, digestText(d), at, `${d.items.length} follow-up${d.items.length > 1 ? "s" : ""} due`);
        markScheduled(`${channel}:${d.date}`, new Date().toISOString());
        n++;
      } catch (e) {
        toast.err((e as Error).message);
        break;
      }
    }
    setBusy(null);
    if (n) toast.ok(`Scheduled ${n} daily reminder${n > 1 ? "s" : ""} via ${channel === "ntfy" ? "push" : "SMS"}.`);
  };

  const test = async (channel: "ntfy" | "twilio" | "whatsapp") => {
    setBusy(`test-${channel}`);
    try {
      await send(channel, todayDigest ? digestText(todayDigest) : "Test from your networking dashboard ✔", undefined, "Coverage test");
      toast.ok("Sent. Check your phone.");
    } catch (e) {
      toast.err((e as Error).message);
    }
    setBusy(null);
  };

  const ics = () => {
    const events = contacts.flatMap((c) => {
      const a = nextAction(c, settings.followUp, banks[bankKey(c.bank, c.region)]);
      if ((a.kind !== "follow_up" && a.kind !== "move_on") || !a.due) return [];
      const start = a.due < new Date() ? new Date() : a.due;
      return [
        {
          uid: `${c.id}-${c.followUps}`,
          start,
          title: `${a.kind === "follow_up" ? "Follow up" : "Move on?"}: ${c.name} (${c.bank})`,
          description: `${c.position} · ${c.bank} ${c.region}\nEmail: ${c.email}\nFirst emailed: ${fmtDate(c.sentAt)} · follow-ups: ${c.followUps}`,
          url: c.linkedin || undefined,
        },
      ];
    });
    if (!events.length) return toast.info("No follow-up dates to export yet.");
    download(buildIcs(events), "follow-ups.ics", "text/calendar");
    toast.ok(`Exported ${events.length} reminders. Open the file to add them to Google or Apple Calendar.`);
  };

  const ntfyReady = !!k.ntfyTopic;
  const twilioReady = !!(k.twilioSid && k.twilioToken && k.twilioTo && (k.twilioFrom || k.twilioMessagingServiceSid));
  const whatsappReady = !!(k.whatsappPhone && k.whatsappApiKey);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Upcoming reminder digests" sub="One message per day at 9am, listing everyone to follow up with" />
        {digests.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-muted">No follow-ups scheduled in the next 5 weeks.</div>
        ) : (
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
            {digests.map((d) => (
              <li key={d.date} className="px-4 py-2.5">
                <div className="flex items-center gap-2 text-[12.5px] font-medium">
                  {d.when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  <span className="num text-muted">· {d.items.length}</span>
                  {scheduled[`ntfy:${d.date}`] && <Badge tone="green">push</Badge>}
                  {scheduled[`twilio:${d.date}`] && <Badge tone="green">SMS</Badge>}
                </div>
                <div className="mt-0.5 truncate text-[12px] text-muted">{d.items.map((i) => i.c.name).join(", ")}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Browser notifications" sub="A daily alert whenever this dashboard is open" right={<Bell className="size-4 text-muted" />} />
          <div className="flex items-center gap-3 p-4 text-[13px]">
            <span className="flex-1 text-ink-2">
              {perm === "granted" ? "On" : perm === "denied" ? "Blocked in browser settings" : perm === "unsupported" ? "Not supported here" : "Off"}
            </span>
            {perm === "default" && (
              <Button size="sm" onClick={async () => setPerm(await Notification.requestPermission())}>
                Enable
              </Button>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Phone push (ntfy)" sub="Free push notifications through the ntfy app. Can schedule up to 3 days ahead." right={<Smartphone className="size-4 text-muted" />} />
          <div className="flex flex-wrap items-center gap-2 p-4">
            {ntfyReady ? (
              <>
                <Button size="sm" loading={busy === "test-ntfy"} onClick={() => test("ntfy")}>
                  Send test
                </Button>
                <Button size="sm" variant="primary" loading={busy === "ntfy"} onClick={() => schedule("ntfy")}>
                  Schedule next 3 days
                </Button>
              </>
            ) : (
              <SetupHint text="Install the ntfy app, subscribe to a hard-to-guess topic, and paste that topic in Settings." />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Text messages (Twilio)" sub="SMS digests. Scheduling up to 35 days out needs a Messaging Service SID." right={<MessageSquare className="size-4 text-muted" />} />
          <div className="flex flex-wrap items-center gap-2 p-4">
            {twilioReady ? (
              <>
                <Button size="sm" loading={busy === "test-twilio"} onClick={() => test("twilio")}>
                  Text me today’s list
                </Button>
                <Button size="sm" variant="primary" loading={busy === "twilio"} disabled={!k.twilioMessagingServiceSid} onClick={() => schedule("twilio")}>
                  Schedule upcoming
                </Button>
              </>
            ) : (
              <SetupHint text="Add your Twilio Account SID, auth token, a From number or Messaging Service, and your phone number in Settings." />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="WhatsApp (CallMeBot)"
            sub="Free. Sends today's list to your own WhatsApp right now. It can't schedule, so pair it with ntfy or the calendar."
            right={<MessageSquare className="size-4 text-muted" />}
          />
          <div className="flex flex-wrap items-center gap-2 p-4">
            {whatsappReady ? (
              <Button size="sm" loading={busy === "test-whatsapp"} onClick={() => test("whatsapp")}>
                WhatsApp me today’s list
              </Button>
            ) : (
              <SetupHint text="Message +34 694 23 41 84 on WhatsApp: “I allow callmebot to send me messages”, then paste the API key it replies with into Settings." />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Calendar" sub="Each follow-up becomes an all-day event with a 9am alert on your phone" right={<CalendarPlus className="size-4 text-muted" />} />
          <div className="p-4">
            <Button size="sm" onClick={ics} icon={<CalendarPlus className="size-3.5" />}>
              Download .ics
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SetupHint({ text }: { text: string }) {
  return (
    <p className="text-[12.5px] text-muted">
      {text}{" "}
      <Link href="/settings#alerts" className="font-medium text-navy underline">
        Settings
      </Link>
    </p>
  );
}

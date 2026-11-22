"use client";

import { useMemo, useState } from "react";
import { BellPlus, Check, ChevronDown, ChevronRight, ExternalLink, Mail, Undo2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { googleClientId } from "@/lib/keys";
import { connectGmail, latestFrom } from "@/lib/gmail";
import { DAY, cn } from "@/lib/util";
import { reminderRows, unansweredReplies, wentQuiet, type Age, type QuietRow, type Reminder, type ReminderRow, type ReplyRow } from "@/lib/thinkAbout";
import type { Contact } from "@/lib/types";
import { Badge, Button, Card, Empty, Input, Kpi, Menu, PageHeader, Segmented, toast } from "@/components/ui";

/**
 * Things to think about (owner, 2026-11-21): "outstanding things i need to think about" — replies you haven't
 * answered (with their message), people who replied and went quiet (nudge sooner than a week before a chat), and dated
 * reminders ("one bank told me to reach out in January"). Logic in lib/thinkAbout.ts; the 9 PM text lists the same.
 */
type Tab = "replies" | "quiet" | "reminders";
type AgeFilter = "all" | Age;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const dayDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const ago = (days: number) => (days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`);
const gmailLink = (c: Contact, threadId?: string) =>
  threadId || c.threadId ? `https://mail.google.com/mail/u/0/#all/${threadId ?? c.threadId}` : `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`from:${c.email}`)}`;

function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get("tab");
  return t === "quiet" || t === "reminders" ? t : "replies";
}

export default function ThinkPage() {
  const contacts = useStore((s) => s.contacts);
  const mine = useStore((s) => s.coverage.reminders);
  const [tab, setTabState] = useState<Tab>(initialTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, "", t === "replies" ? "/think" : `/think?tab=${t}`);
  };
  const replies = useMemo(() => unansweredReplies(contacts), [contacts]);
  const quiet = useMemo(() => wentQuiet(contacts), [contacts]);
  const reminders = useMemo(() => reminderRows(contacts, mine), [contacts, mine]);
  const [now] = useState(() => Date.now());
  const quietDue = quiet.filter((q) => Date.parse(q.due) <= now).length;
  const remindersDue = reminders.filter((r) => !r.done && r.due <= today()).length;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Things to think about"
        sub="Replies you haven't answered, people who went quiet, and the dates bankers told you to come back. The 9 PM text lists the same."
        right={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              ["replies", `Replies to answer${replies.length ? ` (${replies.length})` : ""}`],
              ["quiet", `Went quiet${quiet.length ? ` (${quiet.length})` : ""}`],
              ["reminders", `Reminders${remindersDue ? ` (${remindersDue})` : ""}`],
            ]}
          />
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Replies to answer" value={replies.length} sub={`${replies.filter((r) => r.age === "longer").length} older than a week`} tone={replies.some((r) => r.age === "longer") ? "bad" : undefined} />
        <Kpi label="Went quiet" value={quiet.length} sub={`${quietDue} to nudge now`} />
        <Kpi label="Reminders due" value={remindersDue} sub={`${reminders.filter((r) => !r.done && r.due > today()).length} coming up`} />
        <Kpi label="Found for you" value={reminders.filter((r) => r.found && !r.done).length} sub="dates from replies + notes" />
      </div>
      {tab === "replies" && <RepliesTab rows={replies} />}
      {tab === "quiet" && <QuietTab rows={quiet} />}
      {tab === "reminders" && <RemindersTab rows={reminders} contacts={contacts} />}
    </div>
  );
}

/* ---------------- shared pieces ---------------- */

function AgeTabs<T extends { age: Age }>({ rows, value, onChange, labels }: { rows: T[]; value: AgeFilter; onChange: (v: AgeFilter) => void; labels: [string, string, string] }) {
  const n = (a: Age) => rows.filter((r) => r.age === a).length;
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        ["all", `All (${rows.length})`],
        ["day", `${labels[0]} (${n("day")})`],
        ["week", `${labels[1]} (${n("week")})`],
        ["longer", `${labels[2]} (${n("longer")})`],
      ]}
    />
  );
}

/** Their message: the stored text, else a button that reads their latest email from Gmail and keeps it. */
function TheirMessage({ c, text, summary }: { c: Contact; text?: string; summary?: string }) {
  const settings = useStore((s) => s.settings);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!c.email) return;
    setBusy(true);
    try {
      const clientId = googleClientId(settings);
      await connectGmail(clientId);
      const m = await latestFrom(clientId, c.email);
      if (!m) {
        toast.err(`No email from ${c.name} found in Gmail.`);
        return;
      }
      const cur = useStore.getState().contacts.find((x) => x.id === c.id);
      if (cur && (!cur.lastReply || m.date >= cur.lastReply.at))
        useStore.getState().updateContact(c.id, { lastReply: { at: m.date, messageId: m.id, threadId: m.threadId, text: (m.text || m.full).trim().slice(0, 1500) } });
    } catch (e) {
      toast.err(e instanceof Error ? e.message : "Couldn't read Gmail.");
    } finally {
      setBusy(false);
    }
  };
  if (!text)
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        Coverage doesn&apos;t have this email&apos;s text yet.
        <Button size="sm" icon={<Mail className="size-3.5" />} loading={busy} onClick={load} disabled={!c.email}>
          Load it from Gmail
        </Button>
      </div>
    );
  return (
    <div className="grid gap-1.5">
      {summary && <div className="text-[12px] text-muted">In short: {summary}</div>}
      <blockquote className="max-h-72 overflow-y-auto rounded-lg border-l-[3px] border-brass bg-subtle px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{text}</blockquote>
    </div>
  );
}

function RowShell({ open, onToggle, head, children }: { open: boolean; onToggle: () => void; head: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-hover">
        {open ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted" /> : <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted" />}
        <div className="min-w-0 flex-1">{head}</div>
      </button>
      {open && <div className="grid gap-3 px-4 pb-4 pl-10">{children}</div>}
    </li>
  );
}

function Who({ c }: { c: Contact }) {
  return (
    <span className="min-w-0">
      <span className="font-medium text-ink">{c.name}</span>
      <span className="text-muted"> · {c.bank}</span>
      {c.position && <span className="hidden text-muted sm:inline"> · {c.position}</span>}
    </span>
  );
}

function setReminder(r: Reminder | null, id: string) {
  useStore.getState().setCoverage((cov) => {
    const m = { ...(cov.reminders ?? {}) };
    if (r) m[id] = r;
    else delete m[id];
    return { ...cov, reminders: m };
  });
}

/** "Remind me" on a person: a dated reminder tied to them. */
function RemindMe({ c, defaultNote }: { c: Contact; defaultNote: string }) {
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState(() => ymd(new Date(Date.now() + 7 * DAY)));
  const [note, setNote] = useState(defaultNote);
  if (!open)
    return (
      <Button size="sm" variant="ghost" icon={<BellPlus className="size-3.5" />} onClick={() => setOpen(true)}>
        Remind me
      </Button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const id = `man_${Date.now().toString(36)}`;
        setReminder({ id, due, note: note.trim() || defaultNote, bank: c.bank, contactId: c.id, createdAt: new Date().toISOString(), source: "manual" }, id);
        toast.ok(`Reminder set for ${dayDate(due)}.`);
        setOpen(false);
      }}
    >
      <div className="w-[150px]">
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
      </div>
      <div className="w-[260px] max-w-full">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to do" />
      </div>
      <Button size="sm" variant="primary" type="submit">
        Save
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}

/* ---------------- Replies to answer ---------------- */

function RepliesTab({ rows }: { rows: ReplyRow[] }) {
  const [age, setAge] = useState<AgeFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [showAck, setShowAck] = useState(false);
  const acks = rows.filter((r) => r.noReplyNeeded).length;
  const shown = rows.filter((r) => (age === "all" || r.age === age) && (showAck || !r.noReplyNeeded));
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <AgeTabs rows={rows} value={age} onChange={setAge} labels={["Last day", "This week", "Longer"]} />
        {acks > 0 && (
          <button type="button" onClick={() => setShowAck((v) => !v)} className="text-[12.5px] text-muted underline-offset-2 hover:underline">
            {showAck ? "Hide" : "Show"} {acks} that probably need no reply
          </button>
        )}
      </div>
      {!shown.length ? (
        <Empty title={rows.length ? "Nothing in this range" : "You're caught up"}>
          {rows.length ? "Pick another range above." : "Everyone who wrote to you has an answer (as far as Gmail and the tracker show)."}
        </Empty>
      ) : (
        <ul>
          {shown.map((r) => (
            <RowShell
              key={r.c.id}
              open={open === r.c.id}
              onToggle={() => setOpen(open === r.c.id ? null : r.c.id)}
              head={
                <div className="grid gap-0.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <Who c={r.c} />
                    <span className="flex items-center gap-1.5 text-[12px] text-muted">
                      {r.noReplyNeeded && <Badge>no reply needed?</Badge>}
                      <Badge tone={r.age === "longer" ? "red" : r.age === "week" ? "amber" : "green"}>{ago(r.days)}</Badge>
                      {shortDate(r.at)}
                    </span>
                  </div>
                  {(r.summary || r.text) && <div className="truncate text-[12.5px] text-muted">{r.summary ?? r.text!.replace(/\s+/g, " ").slice(0, 160)}</div>}
                </div>
              }
            >
              <TheirMessage c={r.c} text={r.text} summary={r.summary} />
              <div className="flex flex-wrap items-center gap-2">
                <a href={gmailLink(r.c, r.c.lastReply?.threadId)} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="primary" icon={<ExternalLink className="size-3.5" />}>
                    Reply in Gmail
                  </Button>
                </a>
                <Button
                  size="sm"
                  icon={<Check className="size-3.5" />}
                  onClick={() => {
                    const at = new Date().toISOString();
                    useStore.getState().updateContact(r.c.id, { handledAt: at }, { at, type: "note", note: "Reply settled by hand (Things to think about)" });
                    toast.ok(`${r.c.name}: marked answered.`);
                  }}
                >
                  Answered / no reply needed
                </Button>
                <RemindMe c={r.c} defaultNote={`Get back to ${r.c.name.split(" ")[0]}`} />
              </div>
            </RowShell>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------------- Went quiet ---------------- */

function QuietTab({ rows }: { rows: QuietRow[] }) {
  const [age, setAge] = useState<AgeFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const shown = rows.filter((r) => age === "all" || r.age === age);
  const snooze = (c: Contact, days: number) => {
    useStore.getState().updateContact(c.id, { snoozeUntil: new Date(Date.now() + days * DAY).toISOString() });
    toast.ok(`${c.name}: snoozed ${days} days.`);
  };
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <AgeTabs rows={rows} value={age} onChange={setAge} labels={["Last day", "This week", "Longer"]} />
        <span className="text-[12px] text-muted">Nudge 4 days after your email if you haven&apos;t talked yet; 7 days after a chat.</span>
      </div>
      {!shown.length ? (
        <Empty title={rows.length ? "Nothing in this range" : "Nobody's gone quiet"}>{rows.length ? "Pick another range above." : "Everyone who replied is either talking to you or waiting on you."}</Empty>
      ) : (
        <ul>
          {shown.map((r) => {
            const due = Date.parse(r.due) <= now;
            const lr = r.c.lastReply && Date.parse(r.c.lastReply.at) >= Date.parse(r.heardAt) - 60_000 ? r.c.lastReply : undefined;
            return (
              <RowShell
                key={r.c.id}
                open={open === r.c.id}
                onToggle={() => setOpen(open === r.c.id ? null : r.c.id)}
                head={
                  <div className="grid gap-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <Who c={r.c} />
                      <span className="flex items-center gap-1.5 text-[12px] text-muted">
                        <Badge tone={r.chatted ? "neutral" : "blue"}>{r.chatted ? "after a chat" : "no chat yet"}</Badge>
                        {due ? <Badge tone="amber">nudge now</Badge> : <span>nudge {dayDate(ymd(new Date(r.due)))}</span>}
                      </span>
                    </div>
                    <div className="text-[12.5px] text-muted">
                      They last wrote {shortDate(r.heardAt)} · you wrote {ago(r.days)} ({shortDate(r.youAt)})
                    </div>
                  </div>
                }
              >
                <div className="text-[12px] font-medium tracking-wide text-muted uppercase">Their last email</div>
                <TheirMessage c={r.c} text={lr?.text} summary={lr?.summary} />
                <div className="flex flex-wrap items-center gap-2">
                  <a href={gmailLink(r.c, lr?.threadId)} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="primary" icon={<ExternalLink className="size-3.5" />}>
                      Open the thread
                    </Button>
                  </a>
                  <Button
                    size="sm"
                    icon={<Check className="size-3.5" />}
                    onClick={() => {
                      const at = new Date().toISOString();
                      useStore.getState().updateContact(r.c.id, { handledAt: at }, { at, type: "note", note: "Nudged by hand (Things to think about)" });
                      toast.ok(`${r.c.name}: the clock restarts from today.`);
                    }}
                  >
                    I nudged them
                  </Button>
                  <Menu
                    label="Snooze"
                    trigger={(toggle) => (
                      <Button size="sm" variant="ghost" onClick={toggle}>
                        Snooze…
                      </Button>
                    )}
                    items={[
                      { label: "3 days", onClick: () => snooze(r.c, 3) },
                      { label: "1 week", onClick: () => snooze(r.c, 7) },
                      { label: "1 month", onClick: () => snooze(r.c, 30) },
                    ]}
                  />
                  <RemindMe c={r.c} defaultNote={`Nudge ${r.c.name.split(" ")[0]}`} />
                </div>
              </RowShell>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ---------------- Reminders ---------------- */

function RemindersTab({ rows, contacts }: { rows: ReminderRow[]; contacts: Contact[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const t = today();
  const due = rows.filter((r) => !r.done && r.due <= t);
  const later = rows.filter((r) => !r.done && r.due > t);
  const done = rows.filter((r) => r.done);
  const mine = useStore((s) => s.coverage.reminders);

  const save = (r: ReminderRow, patch: Partial<Reminder>) => {
    const prev = mine?.[r.id];
    setReminder({ id: r.id, due: r.due, note: r.note, bank: r.bank, contactId: r.contactId, createdAt: prev?.createdAt ?? new Date().toISOString(), source: r.found ? "found" : "manual", ...prev, ...patch }, r.id);
  };
  const section = (title: string, list: ReminderRow[]) =>
    list.length > 0 && (
      <>
        <li className="border-b border-line bg-subtle px-4 py-1.5 text-[11.5px] font-medium tracking-wide text-muted uppercase">{title}</li>
        {list.map((r) => (
          <RowShell
            key={r.id}
            open={open === r.id}
            onToggle={() => setOpen(open === r.id ? null : r.id)}
            head={
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className={cn("min-w-0", r.done && "text-muted line-through")}>
                  <span className="font-medium text-ink">{r.note}</span>
                  {(r.name || r.bank) && <span className="text-muted"> · {[r.name, r.bank].filter(Boolean).join(", ")}</span>}
                </span>
                <span className="flex items-center gap-1.5 text-[12px] text-muted">
                  {r.found && <Badge tone="navy">found</Badge>}
                  <Badge tone={r.done ? "neutral" : r.due < t ? "red" : r.due === t ? "amber" : "neutral"}>{dayDate(r.due)}</Badge>
                </span>
              </div>
            }
          >
            {r.quote && (
              <div className="grid gap-1">
                <div className="text-[12px] text-muted">From {r.from}:</div>
                <blockquote className="rounded-lg border-l-[3px] border-brass bg-subtle px-3 py-2 text-[13px] text-ink-2">{r.quote}</blockquote>
              </div>
            )}
            {!r.quote && <div className="text-[12px] text-muted">Added by you.</div>}
            <div className="flex flex-wrap items-center gap-2">
              {r.done ? (
                <Button size="sm" icon={<Undo2 className="size-3.5" />} onClick={() => save(r, { done: undefined })}>
                  Not done
                </Button>
              ) : (
                <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => save(r, { done: new Date().toISOString() })}>
                  Done
                </Button>
              )}
              <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                Date
                <span className="w-[150px]">
                  <Input type="date" value={r.due} onChange={(e) => e.target.value && save(r, { due: e.target.value })} />
                </span>
              </label>
              {!r.done && (
                <Button size="sm" variant="ghost" onClick={() => save(r, { due: ymd(new Date(Math.max(Date.now(), Date.parse(`${r.due}T12:00:00`)) + 7 * DAY)) })}>
                  +1 week
                </Button>
              )}
              {r.found ? (
                !r.done && (
                  <Button size="sm" variant="ghost" onClick={() => save(r, { done: new Date().toISOString() })}>
                    Not a reminder
                  </Button>
                )
              ) : (
                <Button size="sm" variant="danger" onClick={() => setReminder(null, r.id)}>
                  Delete
                </Button>
              )}
              {r.contactId && (() => {
                const c = contacts.find((x) => x.id === r.contactId);
                return c?.email ? (
                  <a href={gmailLink(c)} target="_blank" rel="noreferrer" className="text-[12.5px] text-brass-ink underline-offset-2 hover:underline">
                    Their emails in Gmail
                  </a>
                ) : null;
              })()}
            </div>
          </RowShell>
        ))}
      </>
    );

  return (
    <div className="grid gap-4">
      <AddReminder contacts={contacts} />
      <Card>
        {!due.length && !later.length && !(showDone && done.length) ? (
          <Empty title="No reminders">Add one above. Coverage also picks up &quot;reach out in January&quot; from bankers&apos; replies and your chat notes.</Empty>
        ) : (
          <ul>
            {section("Due now", due)}
            {section("Coming up", later)}
            {showDone && section("Done", done)}
          </ul>
        )}
        {done.length > 0 && (
          <div className="border-t border-line px-4 py-2">
            <button type="button" onClick={() => setShowDone((v) => !v)} className="text-[12.5px] text-muted underline-offset-2 hover:underline">
              {showDone ? "Hide" : "Show"} {done.length} done
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

function AddReminder({ contacts }: { contacts: Contact[] }) {
  const [due, setDue] = useState(() => ymd(new Date(Date.now() + 7 * DAY)));
  const [note, setNote] = useState("");
  const [who, setWho] = useState("");
  const banks = useMemo(() => [...new Set(contacts.map((c) => c.bank).filter(Boolean))].sort(), [contacts]);
  const people = useMemo(() => contacts.filter((c) => c.sentAt || c.repliedAt || c.chats?.length).map((c) => ({ label: `${c.name} (${c.bank})`, c })), [contacts]);
  return (
    <Card className="p-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          const person = people.find((p) => p.label === who)?.c;
          const bank = person?.bank ?? (who.trim() || undefined);
          const id = `man_${Date.now().toString(36)}`;
          setReminder({ id, due, note: note.trim(), bank, contactId: person?.id, createdAt: new Date().toISOString(), source: "manual" }, id);
          toast.ok(`Reminder set for ${dayDate(due)}.`);
          setNote("");
          setWho("");
        }}
      >
        <label className="grid gap-1 text-[12px] text-muted">
          What
          <span className="w-[280px] max-w-full">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reach out to Evercore about the SF office" />
          </span>
        </label>
        <label className="grid gap-1 text-[12px] text-muted">
          Bank or person (optional)
          <span className="w-[230px] max-w-full">
            <Input value={who} onChange={(e) => setWho(e.target.value)} list="think-who" placeholder="Evercore" />
          </span>
          <datalist id="think-who">
            {banks.map((b) => (
              <option key={b} value={b} />
            ))}
            {people.map((p) => (
              <option key={p.c.id} value={p.label} />
            ))}
          </datalist>
        </label>
        <label className="grid gap-1 text-[12px] text-muted">
          When
          <span className="w-[150px]">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
          </span>
        </label>
        <Button variant="primary" type="submit" icon={<BellPlus className="size-4" />} disabled={!note.trim()}>
          Add reminder
        </Button>
      </form>
    </Card>
  );
}

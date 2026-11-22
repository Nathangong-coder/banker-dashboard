"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, BellPlus, Check, ChevronDown, ChevronRight, ExternalLink, Lightbulb, RefreshCw, Undo2 } from "lucide-react";
import { chatsToCheck, type ChatRecord } from "@/lib/chatEvidence";
import { ObjectHeader, Tabs } from "@/components/crm";
import { useStore } from "@/lib/store";
import { googleClientId, aiReady } from "@/lib/keys";
import { connectGmail, latestFrom } from "@/lib/gmail";
import { DAY, cn } from "@/lib/util";
import { REASON_LABEL, reminderRows, resolvedPeople, todoRows, wrongAddress, type Age, type Reminder, type ReminderRow, type TodoRow, type Triage } from "@/lib/thinkAbout";
import type { Contact } from "@/lib/types";
import { Badge, Button, Card, Empty, Input, Menu, Segmented, toast } from "@/components/ui";

/**
 * Things to think about (owner, 2026-11-21/22): who you owe a thank-you or a reply, who replied and went quiet, and
 * dated reminders. The SAME per-person read as the 9 PM text (lib/thinkAbout.ts#todoFor), built from each person's
 * email conversation (lib/mailLedger.ts). Noise is filtered by rules and an AI read with safeguards; every filtered or
 * resolved person stays one click away.
 */
type Tab = "reply" | "quiet" | "chats" | "reminders";
type AgeFilter = "all" | Age;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const dayDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const ago = (days: number) => (days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`);
const gmailLink = (c: Contact, threadId?: string) =>
  threadId || c.threadId ? `https://mail.google.com/mail/u/0/#all/${threadId ?? c.threadId}` : `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`from:${c.email} OR to:${c.email}`)}`;
const KIND_LABEL: Record<TodoRow["kind"], string> = { thank: "thank-you owed", reply: "they wrote last", quiet: "no chat yet", check_in: "after a chat" };

function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get("tab");
  return t === "quiet" || t === "reminders" || t === "chats" ? t : "reply";
}

export default function ThinkPage() {
  const contacts = useStore((s) => s.contacts);
  const mine = useStore((s) => s.coverage.reminders);
  const settings = useStore((s) => s.settings);
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, "", t === "reply" ? "/think" : `/think?tab=${t}`);
  };
  const rows = useMemo(() => todoRows(contacts, now), [contacts, now]);
  const reminders = useMemo(() => reminderRows(contacts, mine), [contacts, mine]);
  const resolved = useMemo(() => resolvedPeople(contacts), [contacts]);
  const wrong = useMemo(() => wrongAddress(contacts), [contacts]);
  const replyRows = rows.filter((r) => r.kind === "thank" || r.kind === "reply");
  const quietRows = rows.filter((r) => r.kind === "quiet" || r.kind === "check_in");
  const shown = (list: TodoRow[]) => list.filter((r) => !r.hidden);
  const quietDue = shown(quietRows).filter((q) => Date.parse(q.due) <= now).length;
  const remindersDue = reminders.filter((r) => !r.done && r.due <= today()).length;
  const filtered = rows.filter((r) => r.hidden).length;
  const checks = useMemo(() => contacts.flatMap((c) => chatsToCheck(c, now).map((r) => ({ c, r }))).sort((a, b) => b.r.at.localeCompare(a.r.at)), [contacts, now]);

  /** Read conversations from Gmail (the ones due, or everyone on the page), then the AI's noise read. */
  const refresh = async (force: boolean) => {
    setBusy("Reading your emails with them…");
    try {
      const { syncLedgers } = await import("@/lib/ledgerSync");
      const n = await syncLedgers(force ? { force: true, max: 120 } : { max: 40 });
      if (aiReady(useStore.getState().settings)) {
        setBusy("Checking which ones need you…");
        const { runTriage } = await import("@/lib/triageRun");
        await runTriage({ force });
      }
      if (force) toast.ok(`Checked ${n} conversation${n === 1 ? "" : "s"} in Gmail.`);
    } catch (e) {
      if (force) toast.err(e instanceof Error ? e.message : "Couldn't read Gmail.");
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (!useStore.getState().settings.server?.id) return;
    const t = setTimeout(() => void refresh(false), 600);
    return () => clearTimeout(t);
    // Once per visit.
  }, []);

  const thanks = shown(replyRows).filter((r) => r.kind === "thank").length;
  // docs/DESIGN.md L-3: one header (title + one action), counts in the meta line, underline tabs, then the queue.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <ObjectHeader
        icon={<Lightbulb className="size-5" />}
        eyebrow="To-do · same list as the 9 PM text"
        title="Things to think about"
        actions={
          <Button variant="primary" icon={<RefreshCw className={cn("size-4", busy && "animate-spin")} />} disabled={!!busy || !settings.server?.id} onClick={() => void refresh(true)}>
            Check Gmail
          </Button>
        }
        meta={
          busy ??
          (!settings.server?.id
            ? "Connect Google (Settings → Account) so Coverage can read each conversation. Until then the list uses the dates it already has."
            : [
                `${shown(replyRows).length} to reply or thank${thanks ? ` (${thanks} thank-you${thanks === 1 ? "" : "s"})` : ""}`,
                `${quietDue} to nudge now`,
                checks.length ? `${checks.length} chat${checks.length === 1 ? "" : "s"} to confirm` : "",
                filtered ? `${filtered} filtered out as noise (${Math.round((filtered / rows.length) * 100)}%)` : "",
                remindersDue ? `${remindersDue} reminder${remindersDue === 1 ? "" : "s"} due` : "",
              ]
                .filter(Boolean)
                .join(" · "))
        }
      />
      {wrong.length > 0 && <WrongAddresses list={wrong} />}
      <div>
        <Tabs
          className="mb-3"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "reply", label: "Reply or thank", count: shown(replyRows).length },
            { id: "quiet", label: "Went quiet", count: shown(quietRows).length },
            { id: "chats", label: "Chats to confirm", count: checks.length },
            { id: "reminders", label: "Reminders", count: remindersDue || undefined },
          ]}
        />
        <div>
          {tab === "reply" && <TodoTab rows={replyRows} resolved={resolved} now={now} empty="Everyone who wrote to you or talked with you has an answer." />}
          {tab === "quiet" && <TodoTab rows={quietRows} resolved={[]} now={now} empty="Everyone who replied is either talking to you or waiting on you." quiet />}
          {tab === "chats" && <ChatsToConfirm list={checks} />}
          {tab === "reminders" && <RemindersTab rows={reminders} contacts={contacts} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- chats to confirm ---------------- */

/**
 * The calendar and your email don't agree about a chat (lib/chatEvidence.ts#chatRecords "check"): it isn't counted
 * until you say it happened (owner, 2026-11-22: "if they don't [reconcile] and you're uncertain, escalate to user").
 */
function ChatsToConfirm({ list }: { list: { c: Contact; r: ChatRecord }[] }) {
  if (!list.length) return <Card><Empty title="Nothing to confirm">Every chat counted has two sources that agree (calendar + thank-you email), or you logged it.</Empty></Card>;
  const answer = (c: Contact, day: string, v: "yes" | "no") => {
    const at = new Date().toISOString();
    useStore.getState().updateContact(c.id, { chatVerdicts: { ...(c.chatVerdicts ?? {}), [day]: v } }, { at, type: "note", note: v === "yes" ? `You confirmed a chat on ${dayDate(day)}` : `You said there was no chat on ${dayDate(day)}` });
    toast.ok(v === "yes" ? `Counted the chat with ${c.name}.` : `Won't count that one for ${c.name}.`);
  };
  return (
    <Card className="grid gap-2 p-3">
      <p className="px-1 text-[12px] text-muted">Each of these has only one source, so it isn&apos;t in your chat counts yet. Say whether it happened; you&apos;re asked once.</p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {list.map(({ c, r }) => (
          <li key={`${c.id}|${r.day}`} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 basis-[280px]">
              <div className="text-[13px]">
                <Link href={`/person?id=${encodeURIComponent(c.id)}`} className="font-semibold text-brass-ink hover:underline">
                  {c.name}
                </Link>
                <span className="text-muted"> · {c.bank} · {dayDate(r.day)}</span>
              </div>
              <div className="text-[13px] text-ink-2">{r.why}</div>
              <div className="mt-0.5 text-[12px] text-muted">{r.sources.map((s) => `${s.label} ${shortDate(s.at)}`).join(" · ")}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="primary" onClick={() => answer(c, r.day, "yes")}>
                Yes, we talked
              </Button>
              <Button size="sm" onClick={() => answer(c, r.day, "no")}>
                No
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------------- wrong addresses ---------------- */

function WrongAddresses({ list }: { list: Contact[] }) {
  return (
    <Card className="border-amber/40 p-4">
      <div className="text-[13px] font-medium text-ink">These addresses look like someone else&apos;s</div>
      <div className="mt-0.5 text-[12.5px] text-muted">Gmail shows a different name on them, so these people are left off the lists until the address is fixed.</div>
      <ul className="mt-2 grid gap-1.5">
        {list.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-medium text-ink">{c.name}</span>
            <span className="text-muted">
              · {c.bank} · {c.email} is {c.mail?.otherPerson}
            </span>
            <Button
              size="sm"
              onClick={() => {
                const at = new Date().toISOString();
                useStore.getState().updateContact(c.id, { email: "", aliases: [], mail: undefined }, { at, type: "note", note: `Removed ${c.email}: it belongs to ${c.mail?.otherPerson}` });
                toast.ok(`Removed that address from ${c.name}.`);
              }}
            >
              Remove the address
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------------- shared pieces ---------------- */

function AgeTabs({ rows, value, onChange }: { rows: { age: Age }[]; value: AgeFilter; onChange: (v: AgeFilter) => void }) {
  const n = (a: Age) => rows.filter((r) => r.age === a).length;
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        ["all", `All (${rows.length})`],
        ["day", `Last day (${n("day")})`],
        ["week", `This week (${n("week")})`],
        ["longer", `Longer (${n("longer")})`],
      ]}
    />
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

/** The conversation: newest messages both ways; the newest of each side in full. */
function Conversation({ row }: { row: TodoRow }) {
  const c = row.c;
  const L = c.mail;
  const settings = useStore((s) => s.settings);
  const [loading, setLoading] = useState(false);
  const [all, setAll] = useState(false);
  const reload = async () => {
    setLoading(true);
    try {
      if (settings.server?.id) {
        const { syncLedgers } = await import("@/lib/ledgerSync");
        await syncLedgers({ ids: [c.id] });
      } else if (c.email) {
        const clientId = googleClientId(settings);
        await connectGmail(clientId);
        const m = await latestFrom(clientId, c.email);
        if (m) useStore.getState().updateContact(c.id, { lastReply: { at: m.date, messageId: m.id, threadId: m.threadId, text: (m.text || m.full).trim().slice(0, 1500) } });
      }
    } catch (e) {
      toast.err(e instanceof Error ? e.message : "Couldn't read Gmail.");
    } finally {
      setLoading(false);
    }
  };
  const refreshBtn = (
    <Button size="sm" variant="ghost" icon={<RefreshCw className={cn("size-3.5", loading && "animate-spin")} />} loading={false} disabled={loading} onClick={reload}>
      {L ? `Read ${shortDate(L.checkedAt)} · refresh` : "Load from Gmail"}
    </Button>
  );
  if (!L?.messages.length)
    return (
      <div className="grid gap-2">
        {row.text ? <blockquote className="max-h-72 overflow-y-auto rounded-lg border-l-[3px] border-brass bg-subtle px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{row.text}</blockquote> : <div className="text-[12.5px] text-muted">No emails read for them yet.</div>}
        <div>{refreshBtn}</div>
      </div>
    );
  const list = all ? L.messages : L.messages.slice(-5);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11.5px] font-medium tracking-wide text-muted uppercase">Conversation ({L.messages.length})</span>
        {refreshBtn}
      </div>
      <ol className="grid gap-1.5">
        {L.messages.length > list.length && (
          <li>
            <button type="button" className="text-[12px] text-muted underline-offset-2 hover:underline" onClick={() => setAll(true)}>
              Show {L.messages.length - list.length} older
            </button>
          </li>
        )}
        {list.map((m) => {
          const full = m.id === L.lastIn?.id ? L.lastIn.text : m.id === L.lastOut?.id ? L.lastOut.text : undefined;
          return (
            <li key={m.id} className={cn("rounded-lg border px-3 py-2", m.dir === "in" ? "border-brass/40 bg-subtle" : "border-line bg-panel")}>
              <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                {m.dir === "in" ? <ArrowDownLeft className="size-3.5 text-brass-ink" /> : <ArrowUpRight className="size-3.5" />}
                <span className="font-medium text-ink-2">{m.dir === "in" ? c.name.split(" ")[0] : "You"}</span>
                <span>{new Date(m.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                <span className="truncate">· {m.subject || "(no subject)"}</span>
                <a href={gmailLink(c, m.threadId)} target="_blank" rel="noreferrer" className="ml-auto text-brass-ink underline-offset-2 hover:underline">
                  open
                </a>
              </div>
              <div className={cn("mt-1 text-[13px] leading-relaxed text-ink-2", full ? "max-h-64 overflow-y-auto whitespace-pre-wrap" : "line-clamp-2")}>{full ?? m.snippet}</div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const RESOLVE_CHIPS = ["Already thanked", "Nothing needed", "Got what I needed", "They referred me", "Talked another way", "Not networking"];

/** Resolve: off the page and the 9 PM text until they write again, with a short note why. */
function Resolve({ c }: { c: Contact }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const save = (n: string) => {
    const at = new Date().toISOString();
    useStore.getState().updateContact(c.id, { resolved: { at, note: n.trim() || "Resolved" } }, { at, type: "note", note: `Resolved: ${n.trim() || "nothing to do"}` });
    toast.ok(`${c.name}: resolved. They come back if they write again.`);
    setOpen(false);
  };
  if (!open)
    return (
      <Button size="sm" icon={<Check className="size-3.5" />} onClick={() => setOpen(true)}>
        Resolve…
      </Button>
    );
  return (
    <form
      className="grid w-full gap-2 rounded-lg border border-line bg-subtle p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save(note);
      }}
    >
      <div className="text-[12.5px] text-muted">Why is nothing needed? (It helps the filter learn what you consider done.)</div>
      <div className="flex flex-wrap gap-1.5">
        {RESOLVE_CHIPS.map((x) => (
          <button key={x} type="button" onClick={() => save(x)} className="rounded-full border border-line-2 bg-panel px-2.5 py-1 text-[12px] text-ink-2 hover:bg-hover">
            {x}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-[320px] max-w-full">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Or a note: only messaged him to farm contacts" autoFocus />
        </div>
        <Button size="sm" variant="primary" type="submit">
          Resolve
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
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

/** Keep a filtered item on the list (for this email): the AI and the rules leave it alone, and it's an example for next time. */
function keep(row: TodoRow) {
  const prev = row.c.triage?.key === row.key ? row.c.triage : undefined;
  const triage: Triage = { key: row.key, at: new Date().toISOString(), needed: true, reason: prev?.reason ?? row.hidden?.reason ?? "kept", why: prev?.why ?? row.hidden?.why ?? "", confidence: prev?.confidence ?? 1, asks: prev?.asks, kept: true };
  useStore.getState().updateContact(row.c.id, { triage });
  toast.ok(`${row.c.name} stays on your list.`);
}

/* ---------------- Reply or thank / Went quiet ---------------- */

function TodoTab({ rows, resolved, now, empty, quiet }: { rows: TodoRow[]; resolved: Contact[]; now: number; empty: string; quiet?: boolean }) {
  const [age, setAge] = useState<AgeFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const visible = rows.filter((r) => !r.hidden);
  const hidden = rows.filter((r) => r.hidden);
  const list = visible.filter((r) => age === "all" || r.age === age);
  const snooze = (c: Contact, days: number) => {
    useStore.getState().updateContact(c.id, { snoozeUntil: new Date(Date.now() + days * DAY).toISOString() });
    toast.ok(`${c.name}: snoozed ${days} days.`);
  };

  const item = (r: TodoRow) => {
    const due = Date.parse(r.due) <= now;
    const tr = r.c.triage?.key === r.key ? r.c.triage : undefined;
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
                {r.hidden ? (
                  <Badge>{REASON_LABEL[r.hidden.reason] ?? r.hidden.reason}</Badge>
                ) : (
                  <Badge tone={r.kind === "thank" ? "red" : r.kind === "reply" ? "blue" : "neutral"}>{KIND_LABEL[r.kind]}</Badge>
                )}
                {quiet && !r.hidden ? (
                  due ? <Badge tone="amber">nudge now</Badge> : <span>nudge {dayDate(ymd(new Date(r.due)))}</span>
                ) : (
                  <Badge tone={r.age === "longer" ? "red" : r.age === "week" ? "amber" : "green"}>{ago(r.days)}</Badge>
                )}
              </span>
            </div>
            <div className="truncate text-[12.5px] text-muted">{r.hidden ? r.hidden.why : r.summary ?? (r.text ? r.text.replace(/\s+/g, " ").slice(0, 160) : r.why)}</div>
          </div>
        }
      >
        <div className="text-[12.5px] text-muted">
          {r.why}
          {tr && !r.hidden && <span> AI read: {tr.needed ? "needs you" : `${REASON_LABEL[tr.reason] ?? tr.reason}, not sure enough to hide`} ({tr.why})</span>}
          {r.hidden && <span> Filtered out by {r.hidden.by === "ai" ? "the AI" : "a rule"}: {r.hidden.why}</span>}
        </div>
        <Conversation row={r} />
        <div className="flex flex-wrap items-center gap-2">
          <a href={gmailLink(r.c, r.c.mail?.messages[r.c.mail.messages.length - 1]?.threadId ?? r.c.lastReply?.threadId)} target="_blank" rel="noreferrer">
            <Button size="sm" variant={r.hidden ? "secondary" : "primary"} icon={<ExternalLink className="size-3.5" />}>
              {r.kind === "thank" ? "Write the thank-you" : r.kind === "reply" ? "Reply in Gmail" : "Open the thread"}
            </Button>
          </a>
          {r.hidden && (
            <Button size="sm" variant="brass" onClick={() => keep(r)}>
              Keep it on my list
            </Button>
          )}
          {quiet && !r.hidden && (
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
          )}
          <RemindMe c={r.c} defaultNote={`Follow up with ${r.c.name.split(" ")[0]}`} />
          <Resolve c={r.c} />
        </div>
      </RowShell>
    );
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <AgeTabs rows={visible} value={age} onChange={setAge} />
        {quiet && <span className="text-[12px] text-muted">Nudge 4 days after your email if you haven&apos;t talked yet; 7 days after a chat.</span>}
      </div>
      {!list.length ? (
        <Empty title={visible.length ? "Nothing in this range" : "You're caught up"}>{visible.length ? "Pick another range above." : empty}</Empty>
      ) : (
        <ul>{list.map(item)}</ul>
      )}
      {hidden.length > 0 && (
        <div className="border-t border-line">
          <button type="button" onClick={() => setShowHidden((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[12.5px] text-muted hover:bg-hover">
            {showHidden ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            Filtered out as noise ({hidden.length}): check these now and then
          </button>
          {showHidden && <ul className="border-t border-line bg-subtle/40">{hidden.map(item)}</ul>}
        </div>
      )}
      {resolved.length > 0 && (
        <div className="border-t border-line">
          <button type="button" onClick={() => setShowResolved((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[12.5px] text-muted hover:bg-hover">
            {showResolved ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            Resolved by you ({resolved.length})
          </button>
          {showResolved && (
            <ul className="border-t border-line">
              {resolved.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 text-[13px] last:border-b-0">
                  <span className="min-w-0">
                    <Who c={c} />
                    <span className="text-muted"> · {c.resolved!.note} ({shortDate(c.resolved!.at)})</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Undo2 className="size-3.5" />}
                    onClick={() => {
                      useStore.getState().updateContact(c.id, { resolved: undefined });
                      toast.ok(`${c.name} is back on the list.`);
                    }}
                  >
                    Undo
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
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

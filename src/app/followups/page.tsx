"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CalendarPlus, Check, Clock, MailPlus, MessageSquare, RefreshCw, Smartphone, UserX } from "lucide-react";
import { blobs, bankKey, useStore } from "@/lib/store";
import { isVpPlus } from "@/lib/seniority";
import { nextAction, pendingFollowUpDraft, rollupBanks, type BankRollup, type NextAction } from "@/lib/followups";
import { nextSendSlot, windowLabel, windowOf } from "@/lib/sendWindow";
import { deskKey, deskOf, liveByDesk, nextUpByDesk } from "@/lib/desks";
import { connectGmail, deleteDraft, upsertDraft } from "@/lib/gmail";
import { describeSync, syncAllWithGmail } from "@/lib/gmailSync";
import { callApi } from "@/lib/api";
import { buildIcs } from "@/lib/ics";
import { digestText, sendWhatsAppDigest, upcomingDigests, whatsappDigest } from "@/lib/reminders";
import { fillPlaceholders, followUpTemplate, hasAiSlots, missingPlaceholders, AI_SLOT } from "@/lib/template";
import { EMAIL_FONTS, type BankStatus, type Contact, type Region, REGIONS, regionInfo } from "@/lib/types";
import { addDays, cn, download, fmtDate, relDays } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Field, Input, PageHeader, Progress, Select, StatusBadge, toast } from "@/components/ui";
import { ContactModal } from "@/components/ContactModal";
import { FilterBar, useContactFilter, type Filters } from "@/components/ContactsTable";
import { aiReady, googleClientId } from "@/lib/keys";
import { bodyToPlain, withSignature } from "@/lib/emailFormat";
import { markServerConnected, queueSends, sendableDraft, syncServer } from "@/lib/serverSync";
import { AutoSendCard, SendModeSwitch } from "@/components/AutoSend";
import { ScheduleCallsCard } from "@/components/Scheduling";
import { SeniorGmailCheck } from "@/components/SeniorGmailCheck";
import { ReplacementsCard } from "@/components/Replacements";
import { ScheduledRow } from "@/components/ScheduledRow";

type Tab = "due" | "bankers" | "banks" | "reminders";

export default function FollowupsPage() {
  // ?tab=reminders (where Google sends you back after connecting automatic sending).
  const [tab, setTab] = useState<Tab>(() => {
    const t = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return t === "reminders" || t === "bankers" || t === "banks" ? t : "due";
  });
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("tab");
    if (q.get("server") === "connected" && q.get("email")) {
      markServerConnected(q.get("email")!);
      toast.ok(`Automatic sending is on for ${q.get("email")}.`);
      syncServer().catch((e: Error) => toast.err(e.message));
    } else if (q.get("server") === "error") toast.err(`Automatic sending wasn't connected: ${q.get("reason") ?? "unknown error"}`);
    if (q.get("server")) window.history.replaceState(null, "", "/followups" + (t ? `?tab=${t}` : ""));
  }, []);
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

      {tab === "due" && <DueList onOpen={setOpen} onSync={runSync} syncing={!!sync} onAuto={() => setTab("reminders")} />}
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

  /**
   * Write follow-up #n for one person and put it in Gmail as a draft in the original thread (updating the one made
   * earlier, if any). Throws with a user-facing message. Returns false when there's no Gmail (mailto fallback opened).
   */
  const draftFollowUp = async (c: Contact, opts: { mailtoFallback: boolean }) => {
    const t = followUpTemplate(c, s.templates);
    if (!t) throw new Error("Create a follow-up template on the Drafts page first.");
    if (!c.email) throw new Error(`${c.name} has no email yet.`);
    let subject = fillPlaceholders(t.subject, c, s.settings);
    // In-thread replies keep the original subject; without one, fall back to a neutral subject.
    if (/\{\{\s*original_subject\s*\}\}/.test(subject)) subject = c.threadId ? "Re:" : `Following up: ${s.settings.profile.school || "networking"}`;
    let body = fillPlaceholders(t.body, c, s.settings);
    if (hasAiSlots(body) || missingPlaceholders(body).length) {
      if (aiReady(s.settings)) {
        const r = await callApi<{ subject: string; body: string }>(
          "/api/draft",
          {
            mode: "fill",
            contact: { id: c.id, name: c.name, bank: c.bank, position: c.position, location: [c.location, c.team].filter(Boolean).join(" · "), region: c.region, school: c.school, comment: c.comment },
            sender: { name: s.settings.profile.name, school: s.settings.profile.school },
            subject,
            body,
          },
          s.settings,
        );
        body = r.body;
      } else body = body.replace(new RegExp(AI_SLOT.source, "g"), "");
    }
    body = withSignature(body, s.settings.profile);
    const clientId = googleClientId(s.settings);
    if (!clientId) {
      if (!opts.mailtoFallback) throw new Error("Connect Gmail in Settings to draft follow-ups in bulk.");
      window.location.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyToPlain(body))}`;
      return false;
    }
    await connectGmail(clientId);
    const step = c.followUps + 1;
    const prev = pendingFollowUpDraft(c);
    const d = await upsertDraft(clientId, prev?.step === step ? prev.gmailDraftId : undefined, {
      to: c.email,
      subject,
      body,
      threadId: c.threadId,
      inReplyTo: c.lastMessageId,
      attachment: t.attachResume ? await blobs.resume() : undefined,
      // Same font as the first email (keeps font experiments clean and the thread consistent).
      font: EMAIL_FONTS[c.trial?.font ?? s.settings.emailStyle.font]?.css,
    });
    s.updateContact(
      c.id,
      { followUpDraft: { gmailDraftId: d.id, messageId: d.message.id, step, createdAt: new Date().toISOString() } },
      { at: now(), type: "note", note: `Follow-up #${step} drafted in Gmail` },
    );
    return true;
  };

  const followUpDraft = async (c: Contact) => {
    try {
      if (await draftFollowUp(c, { mailtoFallback: true }))
        toast.ok(`Follow-up draft for ${c.name} is in Gmail${c.threadId ? " (same thread)" : ""}. Schedule it for ${nextSendSlot(c, windowOf(s.settings)).label}.`);
    } catch (e) {
      toast.err((e as Error).message);
    }
  };

  return {
    followUpDraft,
    draftFollowUp,
    markFollowed: (c: Contact) => s.setStatus([c.id], "followed_up", `Follow-up #${c.followUps + 1} sent`),
    markSent: (c: Contact) => s.setStatus([c.id], "sent"),
    replied: (c: Contact) => s.setStatus([c.id], "replied"),
    moveOn: (c: Contact) => s.setStatus([c.id], "ignored", "Moved on"),
    snooze: (c: Contact, days: number) =>
      s.updateContact(c.id, { snoozeUntil: addDays(new Date(), days).toISOString() }, { at: now(), type: "note", note: `Snoozed ${days}d` }),
  };
}

function DueList({ onOpen, onSync, syncing, onAuto }: { onOpen: (c: Contact) => void; onSync: () => void; syncing: boolean; onAuto: () => void }) {
  const { contacts, banks, settings } = useStore();
  const act = useActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  // Ticked rows: bulk actions use only these (nothing ticked in a list = the whole list).
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setAll = (ids: string[], on: boolean) => setSel((x) => { const n = new Set(x); for (const id of ids) if (on) n.add(id); else n.delete(id); return n; });
  const { behind, drafted, due, upcoming, scheduled, unknown } = useMemo(() => {
    const all = contacts
      .map((c) => ({ c, a: nextAction(c, settings.followUp, banks[bankKey(c.bank, c.region)]) }))
      .filter(({ a }) => ["follow_up", "move_on", "send", "scheduled"].includes(a.kind));
    const sorted = all.sort((x, y) => (x.a.due?.getTime() ?? 0) - (y.a.due?.getTime() ?? 0));
    const dated = sorted.filter((x) => !x.a.unknownDate && x.a.kind !== "scheduled");
    const due = dated.filter((x) => x.a.isDue);
    return {
      due,
      behind: due.filter((x) => x.a.kind !== "send"),
      // Oldest draft first.
      drafted: due.filter((x) => x.a.kind === "send").sort((x, y) => (x.c.draft?.createdAt ?? "").localeCompare(y.c.draft?.createdAt ?? "")),
      upcoming: dated.filter((x) => !x.a.isDue).slice(0, 15),
      scheduled: sorted.filter((x) => x.a.kind === "scheduled"),
      unknown: sorted.filter((x) => x.a.unknownDate).length,
    };
  }, [contacts, banks, settings.followUp]);

  // Follow-ups that still need a Gmail draft (move-on rows have nothing to send).
  const picked = <T extends { c: Contact }>(list: T[]) => (list.some(({ c }) => sel.has(c.id)) ? list.filter(({ c }) => sel.has(c.id)) : list);
  const behindPick = picked(behind);
  const behindSelected = behind.some(({ c }) => sel.has(c.id));
  const toDraft = behindPick.filter(({ c, a }) => a.kind === "follow_up" && c.email && !pendingFollowUpDraft(c));
  const draftAll = async () => {
    setBulk({ done: 0, total: toDraft.length });
    let made = 0;
    const failed: string[] = [];
    for (const { c } of toDraft) {
      try {
        await draftFollowUp(c, { mailtoFallback: false });
        made++;
      } catch (e) {
        const msg = (e as Error).message;
        failed.push(`${c.name}: ${msg}`);
        // No template / Gmail / expired session: the rest would fail the same way.
        if (/template|connect gmail|session expired/i.test(msg)) break;
      }
      setBulk((b) => b && { ...b, done: b.done + 1 });
    }
    setBulk(null);
    if (made) toast.ok(`${made} follow-up draft${made > 1 ? "s" : ""} in Gmail, each in its original thread. Schedule them for the times shown here.`);
    if (failed.length) toast.err(`Not drafted: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? ` (+${failed.length - 3} more)` : ""}`);
  };
  const { draftFollowUp } = act;

  // Automatic sending (the server sends queued Gmail drafts at each person's slot; lib/serverSync.ts).
  const auto = !!settings.server?.email && settings.sendMode !== "gmail";
  const toSchedule = behindPick.filter(({ c, a }) => a.kind === "follow_up" && c.email);
  const draftAndSchedule = async (only?: { c: Contact }[]) => {
    const list = only ?? toSchedule;
    const need = list.filter(({ c }) => !pendingFollowUpDraft(c));
    setBulk({ done: 0, total: need.length });
    const failed: string[] = [];
    for (const { c } of need) {
      try {
        await draftFollowUp(c, { mailtoFallback: false });
      } catch (e) {
        failed.push(`${c.name}: ${(e as Error).message}`);
        if (/template|connect gmail|session expired/i.test((e as Error).message)) break;
      }
      setBulk((b) => b && { ...b, done: b.done + 1 });
    }
    try {
      // Re-read: drafting just recorded each followUpDraft.
      const ids = new Set(list.map(({ c }) => c.id));
      const n = await queueSends(useStore.getState().contacts.filter((c) => ids.has(c.id)));
      if (n) toast.ok(`${n} follow-up${n > 1 ? "s" : ""} drafted and scheduled. Each goes out ${windowLabel(windowOf(settings))}, even with the dashboard closed.`);
      const held = list.length - n;
      if (held > 0) toast.info(`${held} not scheduled: VP or above (your rule), or no Gmail draft yet. They're still in the list.`);
    } catch (e) {
      failed.push((e as Error).message);
    }
    setBulk(null);
    if (failed.length) toast.err(`Not scheduled: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? ` (+${failed.length - 3} more)` : ""}`);
  };
  const draftedSelected = drafted.some(({ c }) => sel.has(c.id));
  const schedulable = picked(drafted).filter(({ c }) => sendableDraft(c));
  const scheduleDrafted = async (only?: Contact[]) => {
    setBusy(only?.length === 1 ? only[0].id : "schedule-drafted");
    try {
      const n = await queueSends(only ?? schedulable.map(({ c }) => c));
      toast.ok(`${n} email${n > 1 ? "s" : ""} scheduled for their send slots.`);
    } catch (e) {
      toast.err((e as Error).message);
    }
    setBusy(null);
  };

  const selected = contacts.filter((c) => sel.has(c.id));
  const store = useStore.getState;
  const noteNow = () => new Date().toISOString();
  /** Throw away the draft waiting in Gmail (first email or follow-up) and anything queued to send it. */
  const discardDrafts = async (list: Contact[]) => {
    const clientId = googleClientId(settings);
    let gmailGone = 0;
    for (const c of list) {
      const ids = [c.status === "drafted" ? c.draft?.gmailDraftId : undefined, pendingFollowUpDraft(c)?.gmailDraftId].filter((x): x is string => !!x);
      for (const id of ids) {
        try {
          if (clientId) {
            await connectGmail(clientId);
            await deleteDraft(clientId, id);
            gmailGone++;
          }
        } catch {
          /* already gone */
        }
      }
      store().updateContact(
        c.id,
        {
          serverSend: undefined,
          followUpDraft: undefined,
          ...(c.status === "drafted" ? { status: "new" as const, draft: undefined, draftMeta: undefined } : {}),
        },
        { at: noteNow(), type: "note", note: "Draft discarded (Follow-ups)" },
      );
    }
    await syncServer().catch(() => undefined);
    toast.ok(`Discarded ${list.length} draft${list.length === 1 ? "" : "s"}${gmailGone ? ` (${gmailGone} deleted from Gmail)` : ""}.`);
  };
  const cancelSends = async (list: Contact[]) => {
    const q = list.filter((c) => c.serverSend);
    for (const c of q) store().updateContact(c.id, { serverSend: undefined }, { at: noteNow(), type: "note", note: "Scheduled send cancelled" });
    await syncServer().catch(() => undefined);
    toast.ok(q.length ? `Cancelled ${q.length} scheduled send${q.length === 1 ? "" : "s"}. The drafts stay in Gmail.` : "None of those were scheduled by Coverage (Gmail Schedule send can only be cancelled in Gmail).");
  };
  const stopFollowingUp = (list: Contact[]) => {
    store().setStatus(list.map((c) => c.id), "ignored", "Stopped following up (Follow-ups)");
    for (const c of list) if (c.serverSend) store().updateContact(c.id, { serverSend: undefined });
    void syncServer().catch(() => undefined);
    toast.ok(`${list.length} moved to "Moved on": no more follow-ups (saved to your spreadsheet as Moved on).`);
  };
  const deleteContacts = (list: Contact[]) => {
    const fromSheet = list.filter((c) => c.source === "sheet").length;
    const ok = window.confirm(
      `Delete ${list.length} contact${list.length === 1 ? "" : "s"} from the dashboard?${fromSheet ? `\n\n${fromSheet} ${fromSheet === 1 ? "is" : "are"} in your spreadsheet and will come back on the next import unless you delete the row there too (or use "Stop following up" instead).` : ""}`,
    );
    if (!ok) return;
    for (const c of list) if (c.serverSend) store().updateContact(c.id, { serverSend: undefined });
    store().removeContacts(list.map((c) => c.id));
    setSel(new Set());
    void syncServer().catch(() => undefined);
    toast.ok(`Deleted ${list.length} contact${list.length === 1 ? "" : "s"}.`);
  };

  /** "Select all" for one list. */
  const selectAll = (list: { c: Contact }[]) => {
    const ids = list.map(({ c }) => c.id);
    const all = ids.length > 0 && ids.every((id) => sel.has(id));
    return <input type="checkbox" className="mr-2 size-4 accent-navy align-[-3px]" aria-label="Select all" checked={all} onChange={(e) => setAll(ids, e.target.checked)} />;
  };

  const row = ({ c, a }: { c: Contact; a: NextAction }) => {
    const fu = pendingFollowUpDraft(c);
    const slot = nextSendSlot(c, windowOf(settings));
    return (
      <li key={c.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", sel.has(c.id) && "bg-navy/[0.04]")}>
        <input type="checkbox" className="size-4 accent-navy" aria-label={`Select ${c.name}`} checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
        <button onClick={() => onOpen(c)} className="min-w-[200px] flex-1 text-left">
          <div className="font-medium hover:underline">
            {c.name}
            {isVpPlus(c.position || c.headline) && <span className="ml-1.5 rounded bg-red-soft px-1 py-px text-[10.5px] font-semibold text-red" title="VP or above">VP+</span>}
          </div>
          <div className="text-[12px] text-muted">
            {c.position || "—"} · {c.bank} {c.region !== "Other" && `(${c.region})`} ·{" "}
            {a.kind === "send" ? `drafted ${fmtDate(c.draft?.createdAt)}` : `emailed ${fmtDate(c.sentAt)}`}
            {c.followUps > 0 && ` · ${c.followUps} follow-up${c.followUps > 1 ? "s" : ""}`}
          </div>
        </button>
        {a.kind === "send" ? (
          <Badge tone="neutral">Send · {slot.label}</Badge>
        ) : fu ? (
          <a href={`https://mail.google.com/mail/u/0/#drafts?compose=${fu.messageId}`} target="_blank" rel="noreferrer" title="Open the draft and use Schedule send">
            <Badge tone="green">Draft #{fu.step} ready · open &amp; Schedule send for {slot.label}</Badge>
          </a>
        ) : (
          <Badge tone={a.kind === "move_on" ? "neutral" : "red"}>
            {a.label} {a.due && `· ${relDays(a.due)}`}
          </Badge>
        )}
        <div className="flex gap-1">
          {a.kind === "send" ? (
            <>
              {auto && sendableDraft(c) && (
                <Button size="sm" variant="brass" loading={busy === c.id} icon={<Clock className="size-3.5" />} onClick={() => scheduleDrafted([c])} title="Coverage sends it in your send window">
                  Schedule
                </Button>
              )}
              <Button size="sm" onClick={() => act.markSent(c)} icon={<Check className="size-3.5" />}>
                Mark sent
              </Button>
              <Button size="sm" variant="ghost" onClick={() => discardDrafts([c])} title="Delete the draft (in Gmail too) and put them back to not contacted">
                Discard
              </Button>
            </>
          ) : a.kind === "follow_up" ? (
            <>
              {auto && c.email && (
                <Button
                  size="sm"
                  variant="brass"
                  loading={busy === `sched-${c.id}`}
                  icon={<Clock className="size-3.5" />}
                  onClick={async () => {
                    setBusy(`sched-${c.id}`);
                    await draftAndSchedule([{ c }]);
                    setBusy(null);
                  }}
                  title="Draft this follow-up (if needed) and have Coverage send it in your send window"
                >
                  {fu ? "Schedule" : "Draft & schedule"}
                </Button>
              )}
              <Button
                size="sm"
                variant={fu || auto ? "ghost" : "brass"}
                loading={busy === c.id}
                icon={<MailPlus className="size-3.5" />}
                onClick={async () => {
                  setBusy(c.id);
                  await act.followUpDraft(c);
                  setBusy(null);
                }}
              >
                {fu ? "Redraft" : "Draft follow-up"}
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
          {a.kind !== "send" && (
            <Button size="sm" variant="ghost" onClick={() => act.replied(c)} icon={<MessageSquare className="size-3.5" />}>
              Replied
            </Button>
          )}
          {a.kind !== "send" && (
            <Button size="sm" variant="ghost" onClick={() => act.snooze(c, 3)} icon={<Clock className="size-3.5" />}>
              3d
            </Button>
          )}
        </div>
      </li>
    );
  };

  if (!due.length && !upcoming.length && !scheduled.length && !unknown)
    return (
      <div className="space-y-6">
        <SeniorGmailCheck />
        <ReplacementsCard onOpen={onOpen} />
        <ScheduleCallsCard onOpen={onOpen} />
        <Card>
        <Empty icon={<Check className="size-6" />} title="No follow-ups pending">
          Once you mark people as sent (or sync with Gmail), reminders show up here {settings.followUp.firstAfterDays} days later.
        </Empty>
      </Card>
      </div>
    );

  return (
    <div className="space-y-6">
      {unknown > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber/30 bg-amber-soft/50 px-4 py-3 text-[13px]">
          <span className="flex-1">
            <b>{unknown}</b> contact{unknown > 1 ? "s are" : " is"} marked sent without a date, so {unknown > 1 ? "they aren't" : "it isn't"} timed
            yet. Gmail can fill in when you actually emailed them, how many follow-ups went out, and whether they replied (the
            dates are saved to the sheet&apos;s Contacted column).
          </span>
          <Button size="sm" variant="primary" loading={syncing} onClick={onSync}>
            Fill in from Gmail
          </Button>
        </div>
      )}
      <SeniorGmailCheck />
        <ReplacementsCard onOpen={onOpen} />
        <ScheduleCallsCard onOpen={onOpen} />
      <SendModeSwitch onAuto={onAuto} />
      {selected.length > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-navy/30 bg-panel px-4 py-2.5 shadow-sm">
          <span className="text-[13px] font-medium">{selected.length} selected</span>
          <span className="text-[12px] text-muted">Draft / schedule buttons below use only these.</span>
          <div className="flex-1" />
          {selected.some((c) => c.serverSend) && (
            <Button size="sm" onClick={() => cancelSends(selected)}>
              Cancel scheduled sends
            </Button>
          )}
          {selected.some((c) => (c.status === "drafted" && c.draft) || pendingFollowUpDraft(c)) && (
            <Button size="sm" onClick={() => discardDrafts(selected.filter((c) => (c.status === "drafted" && c.draft) || pendingFollowUpDraft(c)))}>
              Discard drafts
            </Button>
          )}
          <Button size="sm" onClick={() => selected.forEach((c) => act.snooze(c, 3))}>
            Snooze 3 days
          </Button>
          <Button size="sm" onClick={() => (stopFollowingUp(selected), setSel(new Set()))} title="Mark them Moved on: no more follow-ups (kept in your sheet)">
            Stop following up
          </Button>
          <Button size="sm" variant="danger" onClick={() => deleteContacts(selected)}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
            Clear
          </Button>
        </div>
      )}
      <Card>
        <CardHeader
          title={<>{selectAll(behind)}{`Follow-ups due · ${behind.length}`}</>}
          sub={`Emailed ${settings.followUp.firstAfterDays}+ days ago with no reply. Overdue first.`}
          right={
            bulk ? (
              <div className="w-56">
                <Progress value={bulk.done} max={bulk.total} label={`Drafting ${bulk.done}/${bulk.total}`} />
              </div>
            ) : auto ? (
              toSchedule.length > 0 && (
                <Button size="sm" variant="brass" icon={<MailPlus className="size-3.5" />} onClick={() => draftAndSchedule()} title="Writes each follow-up into its original Gmail thread, then sends it in your send window">
                  Draft &amp; schedule {behindSelected ? `${toSchedule.length} selected` : `all ${toSchedule.length}`}
                </Button>
              )
            ) : (
              <div className="flex items-center gap-3">
                <button onClick={onAuto} className="text-[12px] font-medium text-navy underline">
                  Send them automatically
                </button>
                {toDraft.length > 0 && (
                  <Button size="sm" variant="brass" icon={<MailPlus className="size-3.5" />} onClick={draftAll} title="Writes each follow-up into its original Gmail thread">
                    Draft {behindSelected ? `${toDraft.length} selected` : `all ${toDraft.length}`} in Gmail
                  </Button>
                )}
              </div>
            )
          }
        />
        {behind.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-muted">You’re caught up.</div>
        ) : (
          <ul className="divide-y divide-line">{behind.map(row)}</ul>
        )}
      </Card>

      {drafted.length > 0 && (
        <Card>
          <CardHeader
            title={<>{selectAll(drafted)}{`Drafted, not sent yet · ${drafted.length}`}</>}
            sub={auto ? "First emails written but not sent. Schedule sends each one at the person's slot." : "First emails written but not sent or scheduled. Send or schedule them in Gmail, then sync."}
            right={
              <div className="flex items-center gap-3">
                <Link href="/drafts" className="text-[12.5px] font-medium text-navy underline">
                  Open drafts
                </Link>
                {auto && schedulable.length > 0 && (
                  <Button size="sm" variant="brass" loading={busy === "schedule-drafted"} icon={<Clock className="size-3.5" />} onClick={() => scheduleDrafted()} title="Only drafts already in Gmail can be scheduled">
                    Schedule {draftedSelected ? `${schedulable.length} selected` : `all ${schedulable.length}`}
                  </Button>
                )}
              </div>
            }
          />
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">{drafted.map(row)}</ul>
        </Card>
      )}

      {scheduled.length > 0 && (
        <Card>
          <CardHeader title={<>{selectAll(scheduled)}{`Scheduled · ${scheduled.length}`}</>} sub="Going out by themselves (Gmail Schedule send, or sent by Coverage). Follow-ups are timed from when each one actually goes out." />
          <ul className="max-h-[320px] divide-y divide-line overflow-y-auto">
            {scheduled.map(({ c, a }) => (
              <ScheduledRow key={c.id} c={c} label={a.label.replace(/^.*scheduled · /, "")} onOpen={onOpen} selected={sel.has(c.id)} onSelect={() => toggle(c.id)} />
            ))}
          </ul>
        </Card>
      )}

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
                    <td className="num px-2 py-2 text-right text-[12px]">{c.sentAt ? fmtDate(c.sentAt) : c.scheduledAt ? <span className="text-muted">sched. {fmtDate(c.scheduledAt)}</span> : "—"}</td>
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
  const live = useMemo(() => liveByDesk(contacts), [contacts]);
  const cap = settings.followUp.livePerBank;
  const regions: Region[] = REGIONS.map((x) => x.id).filter((id) => id === "SF" || id === "NY" || rollups.some((r) => r.meta.region === id));

  const row = (r: BankRollup) => {
    const isOpen = expanded === r.meta.key;
    // The live cap is per team here (SF Tech and SF Generalist each get their own slots).
    const desks = [...new Map(r.contacts.map((c) => [deskKey(c), deskOf(c).team])).entries()]
      .map(([key, team]) => ({ key, team, live: live.get(key)?.live ?? 0 }))
      .filter((d) => d.live > 0);
    const upNext = r.meta.status === "active" ? nextUpByDesk(r.contacts, contacts, cap) : undefined;
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
                {upNext.team && ` (${upNext.team})`}
                {!upNext.email && " (needs email)"}
              </div>
            )}
          </button>
{desks.length === 0 ? (
            <Badge tone="neutral">
              <span className="num">0 live</span>
            </Badge>
          ) : (
            desks.map((d) => (
              <Badge key={d.key} tone={d.live >= cap ? "amber" : "neutral"}>
                <span className="num">
                  {d.team || "no team"} {d.live}/{cap}
                </span>
              </Badge>
            ))
          )}
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
      {regions.map((region) => {
        const list = rollups.filter((r) => r.meta.region === region).sort((a, b) => b.due - a.due || a.meta.name.localeCompare(b.meta.name));
        const totals = list.reduce((t, r) => ({ reached: t.reached + r.reached, replied: t.replied + r.replied }), { reached: 0, replied: 0 });
        return (
          <Card key={region}>
            <CardHeader
              title={regionInfo(region).label}
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
  const { contacts, banks, settings, scheduled, markScheduled, setSettings } = useStore();
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
      const wa = channel === "whatsapp" ? whatsappDigest(contacts, banks, settings.followUp) : null;
      if (wa) {
        const n = await sendWhatsAppDigest(wa, (title, message) => send("whatsapp", message, undefined, title));
        toast.ok(`Sent${n > 1 ? ` as ${n} messages` : ""}. Check your phone.`);
      } else {
        await send(channel, todayDigest ? digestText(todayDigest) : "Test from your networking dashboard ✔ (nothing due today)", undefined, "Coverage test");
        toast.ok("Sent. Check your phone.");
      }
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
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
        <AutoSendCard />
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
            sub="Free. Today's list goes to your own WhatsApp once a day, the first time the dashboard is open after 9am. CallMeBot can't schedule and there's no server yet, so a day you don't open the dashboard gets no text: pair it with ntfy or the calendar."
            right={<MessageSquare className="size-4 text-muted" />}
          />
          <div className="flex flex-wrap items-center gap-3 p-4">
            {whatsappReady ? (
              <>
                <label className="flex items-center gap-1.5 text-[12.5px]">
                  <Checkbox
                    checked={settings.alerts?.whatsappDaily !== false}
                    onChange={(on) => setSettings((x) => ({ ...x, alerts: { ...x.alerts, whatsappDaily: on } }))}
                  />
                  Send automatically each day
                </label>
                {scheduled[`whatsapp:${new Date().toLocaleDateString("en-CA")}`] && <Badge tone="green">sent today</Badge>}
                <Button size="sm" loading={busy === "test-whatsapp"} onClick={() => test("whatsapp")}>
                  WhatsApp me today’s list
                </Button>
              </>
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
      <Link href="/settings?tab=reminders" className="font-medium text-navy underline">
        Settings
      </Link>
    </p>
  );
}

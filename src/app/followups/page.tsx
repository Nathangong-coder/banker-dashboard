"use client";

import { addSmartMention } from "@/lib/mentionDrafts";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CalendarClock, CalendarPlus, Check, ChevronDown, Clock, MailPlus, MessageSquare, RefreshCw, Send, Smartphone, Trash2, UserPlus, UserX, X } from "lucide-react";
import { bankKey, useStore } from "@/lib/store";
import { isVpPlus } from "@/lib/seniority";
import { nextAction, pendingFollowUpDraft, rollupBanks, sendLabel, type BankRollup, type NextAction } from "@/lib/followups";
import { nextSendSlot, windowLabel, windowOf } from "@/lib/sendWindow";
import { deskKey, deskOf, liveByDesk, nextUpByDesk } from "@/lib/desks";
import { connectGmail, deleteDraft, gmailConnected, upsertDraft } from "@/lib/gmail";
import { notePixelDraft, pixelFor } from "@/lib/trackingActions";
import { describeSync, syncAllWithGmail } from "@/lib/gmailSync";
import { callApi } from "@/lib/api";
import { buildIcs } from "@/lib/ics";
import { digestText, nightExtras, nightPlan, sendWhatsAppDigest, textTime, upcomingDigests, whatsappDigest } from "@/lib/reminders";
import { digestMessages } from "@/lib/digestFormat";
import { fillPlaceholders, followUpTemplate, hasAiSlots, missingPlaceholders, AI_SLOT } from "@/lib/template";
import { EMAIL_FONTS, type BankStatus, type Contact, type Region, REGIONS, regionInfo } from "@/lib/types";
import { addDays, cn, download, fmtDate, relDays } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Field, Input, Menu, Modal, PageHeader, Progress, Segmented, Select, StatusBadge, toast } from "@/components/ui";
import { ContactModal } from "@/components/ContactModal";
import { FilterBar, useContactFilter, type Filters } from "@/components/ContactsTable";
import { aiReady, googleClientId } from "@/lib/keys";
import { bodyToPlain, withSignature } from "@/lib/emailFormat";
import { FOLLOW_UP_SPREAD } from "@/lib/sendWindow";
import { cancelSend, earlySends, fixEarlySends, gmailScheduledOverlap, lateSends, markServerConnected, moveLateSends, queueSends, sendableDraft, syncServer } from "@/lib/serverSync";
import { AutoSendCard } from "@/components/AutoSend";
import { repliedToSchedule, ScheduleCallsTable } from "@/components/Scheduling";
import { SeniorGmailCheck } from "@/components/SeniorGmailCheck";
import { replacementLists, ReplacementsTable } from "@/components/Replacements";
import { referralCount, ReferralsTable } from "@/components/Referrals";
import { OffSheetTable, useOffSheet } from "@/components/OffSheet";
import { ScheduledRow } from "@/components/ScheduledRow";
import { BatchSchedule } from "@/components/BatchSchedule";
import { Cell, ListTable, NameCell, Notice, Row, RowActions, RowCheckbox } from "@/components/FollowupsUi";

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
        sub={`Follow up ${s.settings.followUp.firstAfterDays} days after the first email, up to ${s.settings.followUp.maxFollowUps} times, then move on.`}
        right={
          <>
            <SendModeMenu onAuto={() => setTab("reminders")} />
            {sync ? (
              <div className="w-56">
                <Progress value={sync.done} max={sync.total} label={`${sync.done}/${sync.total} checked`} />
              </div>
            ) : (
              <Button icon={<RefreshCw className="size-3.5" />} onClick={runSync} title="Reads Sent mail and your inbox to fill in dates and replies">
                Sync with Gmail
              </Button>
            )}
          </>
        }
      />

      <Segmented
        className="mb-5"
        value={tab}
        onChange={setTab}
        options={[
          ["due", "Queue"],
          ["bankers", "By banker"],
          ["banks", "By bank"],
          ["reminders", "Reminders & alerts"],
        ]}
      />

      {tab === "due" && <DueList onOpen={setOpen} onSync={runSync} syncing={!!sync} onAuto={() => setTab("reminders")} />}
      {tab === "bankers" && <BankerTable onOpen={setOpen} />}
      {tab === "banks" && <BankBoard onOpen={setOpen} />}
      {tab === "reminders" && <Reminders />}

      <ContactModal contact={open} onClose={() => setOpen(null)} />
    </>
  );
}

/**
 * Who sends the drafts made here: Coverage (the server, at each person's slot) or you, with Gmail's Schedule send.
 * Gmail's API has no Schedule send, so the Gmail option means: drafts land in Gmail and you schedule each one there.
 * Same setting as Settings → Email → Sending (`SendModeSwitch`), shown here as a header menu.
 */
function SendModeMenu({ onAuto }: { onAuto: () => void }) {
  const connected = useStore((s) => !!s.settings.server?.email);
  const mode = useStore((s) => s.settings.sendMode);
  const setSettings = useStore((s) => s.setSettings);
  const current = connected && mode !== "gmail" ? "coverage" : "gmail";
  const pick = (m: "coverage" | "gmail") => {
    if (m === "coverage" && !connected) return onAuto();
    setSettings((x) => ({ ...x, sendMode: m }));
  };
  const mark = (m: "coverage" | "gmail") => (current === m ? <Check className="text-brass-ink" /> : <span className="block size-4" />);
  return (
    <Menu
      label="How drafts go out"
      trigger={(toggle, open) => (
        <Button variant="ghost" onClick={toggle} aria-expanded={open} aria-haspopup="menu" icon={<Send className="size-3.5" />} title="How drafts go out">
          {current === "coverage" ? "Coverage sends" : "I schedule in Gmail"}
          <ChevronDown className="size-3.5 text-muted" />
        </Button>
      )}
      items={[
        {
          label: "Coverage sends them",
          hint: connected
            ? "Sent from your Gmail at each person's slot, even with the dashboard closed. They wait in Gmail Drafts until then."
            : "Needs a one-time Google sign-in (opens Reminders & alerts).",
          icon: mark("coverage"),
          onClick: () => pick("coverage"),
        },
        {
          label: "Gmail Schedule send (I click)",
          hint: "Drafts land in Gmail; open each one and pick the time shown here. Google doesn't let apps create Schedule-send emails, so that click is yours.",
          icon: mark("gmail"),
          onClick: () => pick("gmail"),
        },
      ]}
    />
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
    // A good chat at their bank since your last email to them: say so (lib/smartMention.ts).
    body = (await addSmartMention(c, body, "follow_up", aiReady(s.settings))).body;
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
    const reuse = prev?.step === step ? prev.gmailDraftId : undefined;
    const pixel = await pixelFor({ to: c.email, subject, kind: "follow-up", step, contactId: c.id, gmailDraftId: reuse });
    const d = await upsertDraft(clientId, reuse, {
      to: c.email,
      subject,
      body,
      pixel,
      threadId: c.threadId,
      inReplyTo: c.lastMessageId,
      // No attachment: the resume goes on the first cold email only (it's already in this thread).
      // Same font as the first email (keeps font experiments clean and the thread consistent).
      font: EMAIL_FONTS[c.trial?.font ?? s.settings.emailStyle.font]?.css,
    });
    notePixelDraft(pixel, d);
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

/** The lists inside the Queue card. */
type View = "due" | "drafted" | "scheduled" | "replied" | "referrals" | "offsheet" | "replace";

function DueList({ onOpen, onSync, syncing, onAuto }: { onOpen: (c: Contact) => void; onSync: () => void; syncing: boolean; onAuto: () => void }) {
  const { contacts, banks, settings } = useStore();
  const act = useActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  // Ticked rows: bulk actions use only these (nothing ticked in a list = the whole list).
  const [sel, setSel] = useState<Set<string>>(new Set());
  // The batch schedule dialog (pick a day and/or time for many at once).
  const [batch, setBatch] = useState<Contact[] | null>(null);
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
  const draftAndSchedule = async (only?: { c: Contact }[], pick?: boolean) => {
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
    if (pick) {
      setBulk(null);
      if (failed.length) toast.err(`Not drafted: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? ` (+${failed.length - 3} more)` : ""}`);
      const ids = new Set(list.map(({ c }) => c.id));
      setBatch(useStore.getState().contacts.filter((c) => ids.has(c.id)));
      return;
    }
    try {
      // Re-read: drafting just recorded each followUpDraft.
      const ids = new Set(list.map(({ c }) => c.id));
      const why = new Map<string, string>();
      const overlap: string[] = [];
      const n = await queueSends(useStore.getState().contacts.filter((c) => ids.has(c.id)), why, overlap);
      if (overlap.length) toast.info(`Left out, already scheduled in Gmail: ${overlap.slice(0, 5).join(", ")}${overlap.length > 5 ? "…" : ""}.`);
      if (n) toast.ok(`${n} follow-up${n > 1 ? "s" : ""} drafted and scheduled. Each goes out ${windowLabel(windowOf(settings))}, even with the dashboard closed.`);
      if (why.size) toast.info(movedNote(why));
      const held = list.length - n - overlap.length;
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
      const why = new Map<string, string>();
      const overlap: string[] = [];
      const n = await queueSends(only ?? schedulable.map(({ c }) => c), why, overlap);
      if (overlap.length) toast.info(`Left out, already scheduled in Gmail: ${overlap.slice(0, 5).join(", ")}${overlap.length > 5 ? "…" : ""}.`);
      toast.ok(`${n} email${n > 1 ? "s" : ""} scheduled for their send slots.`);
      if (why.size) toast.info(movedNote(why));
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

  // Which list the card shows. "replace" (Needs a new contact) only appears when someone's outreach failed.
  const [view, setView] = useState<View>("due");
  const replied = useMemo(() => repliedToSchedule(contacts).length, [contacts]);
  const fails = useMemo(() => replacementLists(contacts), [contacts]);
  const replaceCount = fails.suspected.length + fails.failed.length;
  const referrals = useMemo(() => referralCount(contacts), [contacts]);
  const offSheet = useOffSheet().filter((p) => p.bankDomain).length;
  const shownView: View = view === "replace" && !replaceCount ? "due" : view;

  /** "Select all" for one list (the table header checkbox). */
  const selectAll = (list: { c: Contact }[]) => {
    const ids = list.map(({ c }) => c.id);
    const all = ids.length > 0 && ids.every((id) => sel.has(id));
    return <RowCheckbox label="Select all" checked={all} onChange={() => setAll(ids, !all)} />;
  };

  const row = ({ c, a }: { c: Contact; a: NextAction }) => {
    const fu = pendingFollowUpDraft(c);
    const slot = nextSendSlot(c, windowOf(settings));
    const busyHere = busy === c.id || busy === `sched-${c.id}`;
    const draftOne = async () => {
      setBusy(c.id);
      await act.followUpDraft(c);
      setBusy(null);
    };
    const repliedItem = { label: "Replied", hint: "They wrote back: no more follow-ups", icon: <MessageSquare />, onClick: () => act.replied(c) };
    const snooze = { label: "Snooze 3 days", icon: <Clock />, onClick: () => act.snooze(c, 3) };
    return (
      <Row key={c.id} selected={sel.has(c.id)}>
        <Cell shrink>
          <RowCheckbox label={`Select ${c.name}`} checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
        </Cell>
        <Cell main>
          <NameCell
            name={c.name}
            extra={
              isVpPlus(c.position || c.headline) && (
                <span className="ml-1.5 rounded-full bg-red-soft px-1.5 py-px text-[10.5px] font-semibold text-red" title="VP or above">
                  VP+
                </span>
              )
            }
            sub={`${c.position || "—"} · ${c.bank}${c.region !== "Other" ? ` (${c.region})` : ""}`}
            onOpen={() => onOpen(c)}
          />
        </Cell>
        <Cell>
          {a.kind === "send" ? (
            <Badge tone="neutral">Send · {slot.label}</Badge>
          ) : fu ? (
            <a href={`https://mail.google.com/mail/u/0/#drafts?compose=${fu.messageId}`} target="_blank" rel="noreferrer" title={`Open the draft and use Schedule send for ${slot.label}`}>
              <Badge tone="green">Draft #{fu.step} ready · schedule {slot.label}</Badge>
            </a>
          ) : (
            <Badge tone={a.kind === "move_on" ? "neutral" : "red"}>
              {a.label} {a.due && `· ${relDays(a.due)}`}
            </Badge>
          )}
        </Cell>
        <Cell className="text-[12px] whitespace-nowrap text-muted">
          {a.kind === "send" ? `Drafted ${fmtDate(c.draft?.createdAt)}` : `Emailed ${fmtDate(c.sentAt)}`}
          {c.followUps > 0 && ` · ${c.followUps} follow-up${c.followUps > 1 ? "s" : ""}`}
        </Cell>
        <Cell>
          <RowActions show={sel.has(c.id) || busyHere}>
            {a.kind === "send" ? (
              <>
                {auto && sendableDraft(c) ? (
                  <Button size="sm" variant="brass" loading={busy === c.id} icon={<Clock className="size-3.5" />} onClick={() => scheduleDrafted([c])} title="Coverage sends it in your send window">
                    Schedule
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => act.markSent(c)} icon={<Check className="size-3.5" />}>
                    Mark sent
                  </Button>
                )}
                <Menu
                  label={`More for ${c.name}`}
                  items={[
                    auto && sendableDraft(c) && { label: "Mark sent", hint: "You sent it yourself", icon: <Check />, onClick: () => act.markSent(c) },
                    { label: "Discard draft", hint: "Delete the draft (in Gmail too) and put them back to not contacted", icon: <Trash2 />, danger: true, onClick: () => void discardDrafts([c]) },
                  ]}
                />
              </>
            ) : a.kind === "follow_up" ? (
              <>
                {auto && c.email ? (
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
                ) : (
                  <Button size="sm" variant="brass" loading={busy === c.id} icon={<MailPlus className="size-3.5" />} onClick={draftOne}>
                    {fu ? "Redraft" : "Draft follow-up"}
                  </Button>
                )}
                <Menu
                  label={`More for ${c.name}`}
                  items={[
                    auto && !!c.email && {
                      label: fu ? "Redraft in Gmail" : "Draft follow-up in Gmail",
                      hint: "Write it into the original thread without scheduling it",
                      icon: <MailPlus />,
                      disabled: busy === c.id,
                      onClick: () => void draftOne(),
                    },
                    { label: "Followed up", hint: `Mark follow-up #${c.followUps + 1} as sent`, icon: <Check />, onClick: () => act.markFollowed(c) },
                    repliedItem,
                    snooze,
                  ]}
                />
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => act.moveOn(c)} icon={<UserX className="size-3.5" />}>
                  Move on
                </Button>
                <Menu label={`More for ${c.name}`} items={[repliedItem, snooze]} />
              </>
            )}
          </RowActions>
        </Cell>
      </Row>
    );
  };

  const views: [View, string, number][] = [
    ["due", "Due", behind.length],
    ["drafted", "Drafted", drafted.length],
    ["scheduled", "Scheduled", scheduled.length],
    ["replied", "Replied", replied],
    ["referrals", "Referrals", referrals],
    ["offsheet", "Not in tracker", offSheet],
  ];
  if (replaceCount) views.push(["replace", "Needs new contact", replaceCount]);

  const caption: Record<View, string> = {
    due: `Emailed ${settings.followUp.firstAfterDays}+ days ago with no reply. Overdue first.`,
    drafted: auto ? "First emails written but not sent. Schedule sends each one at the person's slot." : "First emails written but not sent or scheduled. Send or schedule them in Gmail, then sync.",
    scheduled: "Going out by themselves (Gmail Schedule send, or sent by Coverage). Follow-ups are timed from when each one actually goes out.",
    replied: "Offer your free times in their time zone, then send the calendar invite.",
    referrals: "Intros and referrals found in bankers' replies (confirm them), and what's next with each person you were referred to.",
    offsheet: "Bankers you emailed at their work address who have no row in your tracker (e.g. a thank-you sent right after an info session). Add them so follow-ups are timed.",
    replace: "Bounced emails, people who left, and clear no's: no follow-ups go to them, and their desk gets someone new.",
  };

  // One primary action per list (the rest are per row or in the selection bar).
  const toolbarAction = bulk ? (
    <div className="w-56">
      <Progress value={bulk.done} max={bulk.total} label={`Drafting ${bulk.done}/${bulk.total}`} />
    </div>
  ) : shownView === "due" ? (
    auto ? (
      toSchedule.length > 0 && (
        <Button size="sm" variant="primary" icon={<MailPlus className="size-3.5" />} onClick={() => draftAndSchedule(undefined, true)} title="Writes each follow-up into its original Gmail thread, then lets you pick the day and time">
          Draft &amp; schedule {behindSelected ? `${toSchedule.length} selected` : `all ${toSchedule.length}`}
        </Button>
      )
    ) : (
      <>
        <Button size="sm" variant="ghost" onClick={onAuto} title="Coverage sends each follow-up at its slot, even with the dashboard closed">
          Send them automatically
        </Button>
        {toDraft.length > 0 && (
          <Button size="sm" variant="primary" icon={<MailPlus className="size-3.5" />} onClick={draftAll} title="Writes each follow-up into its original Gmail thread">
            Draft {behindSelected ? `${toDraft.length} selected` : `all ${toDraft.length}`} in Gmail
          </Button>
        )}
      </>
    )
  ) : shownView === "drafted" ? (
    <>
      <Link href="/drafts" className="inline-flex h-7 items-center rounded-lg px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-hover">
        Open drafts
      </Link>
      {auto && schedulable.length > 0 && (
        <Button size="sm" variant="primary" loading={busy === "schedule-drafted"} icon={<Clock className="size-3.5" />} onClick={() => setBatch(schedulable.map(({ c }) => c))} title="Pick the day and time (only drafts already in Gmail can be scheduled)">
          Schedule {draftedSelected ? `${schedulable.length} selected` : `all ${schedulable.length}`}
        </Button>
      )}
    </>
  ) : shownView === "scheduled" ? (
    scheduled.some(({ c }) => c.serverSend) && (
      <Button
        size="sm"
        variant="primary"
        icon={<Clock className="size-3.5" />}
        onClick={() => {
          const mine = scheduled.filter(({ c }) => c.serverSend);
          const ticked = mine.filter(({ c }) => sel.has(c.id));
          setBatch((ticked.length ? ticked : mine).map(({ c }) => c));
        }}
        title="Move many at once: one day, a new time, or both"
      >
        Change day / time{scheduled.some(({ c }) => c.serverSend && sel.has(c.id)) ? " (selected)" : ""}…
      </Button>
    )
  ) : null;

  const withDraft = selected.filter((c) => (c.status === "drafted" && c.draft) || pendingFollowUpDraft(c));

  return (
    <div className="space-y-4">
      {/* Notices: one line each. */}
      <div className="space-y-2 empty:hidden">
        {unknown > 0 && (
          <Notice
            tone="amber"
            icon={<CalendarClock />}
            action={
              <Button size="sm" variant="brass" loading={syncing} onClick={onSync}>
                Fill in from Gmail
              </Button>
            }
          >
            <span title="Gmail can fill in when you actually emailed them, how many follow-ups went out, and whether they replied (the dates are saved to the sheet's Contacted column).">
              <b>{unknown}</b> contact{unknown > 1 ? "s are" : " is"} marked sent without a date, so {unknown > 1 ? "they aren't" : "it isn't"} timed yet.
            </span>
          </Notice>
        )}
        <EarlySendsBanner />
        <DoubleSendsBanner />
        <LateSendsBanner />
        {replaceCount > 0 && (
          <Notice
            tone={fails.suspected.length ? "amber" : "neutral"}
            icon={<UserPlus />}
            action={
              <Button size="sm" variant="ghost" onClick={() => setView("replace")}>
                Review
              </Button>
            }
          >
            {fails.suspected.length > 0 && (
              <>
                <b>{fails.suspected.length}</b> repl{fails.suspected.length === 1 ? "y looks" : "ies look"} like a no (confirm first)
                {fails.failed.length > 0 && " · "}
              </>
            )}
            {fails.failed.length > 0 && (
              <>
                <b>{fails.failed.length}</b> {fails.failed.length === 1 ? "desk needs" : "desks need"} a new contact (bounced, left, or said no)
              </>
            )}
          </Notice>
        )}
        <SeniorGmailCheck />
      </div>

      {selected.length > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brass-strong/40 bg-panel px-4 py-2 shadow-[0_6px_20px_rgba(15,23,42,0.10)]">
          <span className="text-[13px] font-medium">{selected.length} selected</span>
          <span className="hidden text-[12px] text-muted sm:inline">List buttons use only these.</span>
          <div className="flex-1" />
          {selected.some((c) => c.serverSend || sendableDraft(c)) && (
            <Button size="sm" variant="brass" icon={<Clock className="size-3.5" />} onClick={() => setBatch(selected)}>
              Schedule / change day…
            </Button>
          )}
          <Button size="sm" onClick={() => selected.forEach((c) => act.snooze(c, 3))} icon={<Clock className="size-3.5" />}>
            Snooze 3 days
          </Button>
          <Menu
            label="More for the selected"
            items={[
              selected.some((c) => c.serverSend) && { label: "Cancel scheduled sends", hint: "The drafts stay in Gmail", icon: <X />, onClick: () => void cancelSends(selected) },
              withDraft.length > 0 && { label: `Discard ${withDraft.length} draft${withDraft.length === 1 ? "" : "s"}`, hint: "Deleted in Gmail too; first emails go back to not contacted", icon: <Trash2 />, onClick: () => void discardDrafts(withDraft) },
              { label: "Stop following up", hint: "Mark them Moved on: no more follow-ups (kept in your sheet)", icon: <UserX />, onClick: () => (stopFollowingUp(selected), setSel(new Set())) },
              "divider",
              { label: `Delete ${selected.length} contact${selected.length === 1 ? "" : "s"}`, icon: <Trash2 />, danger: true, onClick: () => deleteContacts(selected) },
            ]}
          />
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())} aria-label="Clear selection">
            Clear
          </Button>
        </div>
      )}

      <Card className="overflow-visible">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <Segmented
            value={shownView}
            onChange={setView}
            options={views.map(([v, label, n]) => [
              v,
              <span key={v} className="inline-flex items-center gap-1.5">
                {label}
                <span className={cn("num rounded-full px-1.5 text-[11px]", n && v === "due" ? "bg-red-soft text-red" : "bg-track text-muted")}>{n}</span>
              </span>,
            ])}
          />
          <div className="flex-1" />
          <div className="flex flex-wrap items-center gap-1.5">{toolbarAction}</div>
        </div>
        <p className="border-b border-line px-4 py-2 text-[12px] text-muted">{caption[shownView]}</p>

        {shownView === "due" &&
          (behind.length === 0 && !upcoming.length ? (
            <Empty icon={<Check className="size-6" />} title={due.length || scheduled.length ? "You’re caught up" : "No follow-ups pending"}>
              Once you mark people as sent (or sync with Gmail), reminders show up here {settings.followUp.firstAfterDays} days later.
            </Empty>
          ) : (
            <ListTable head={[selectAll(behind), "Contact", "Next step", "Last email", ""]}>
              {behind.length === 0 && (
                <tr className="max-lg:block">
                  <td colSpan={5} className="px-4 py-6 text-center text-[13px] text-muted max-lg:block">
                    You’re caught up.
                  </td>
                </tr>
              )}
              {behind.map(row)}
              {upcoming.length > 0 && (
                <>
                  <tr className="bg-subtle max-lg:block">
                    <td colSpan={5} className="px-4 py-1.5 text-[11px] font-medium tracking-wide text-muted uppercase max-lg:block">
                      Coming up · {upcoming.length}
                    </td>
                  </tr>
                  {upcoming.map(({ c, a }) => (
                    <Row key={c.id}>
                      <Cell shrink className="max-lg:hidden" />
                      <Cell main>
                        <NameCell name={c.name} sub={c.bank} onOpen={() => onOpen(c)} />
                      </Cell>
                      <Cell className="text-[12.5px] text-ink-2">{a.label}</Cell>
                      <Cell className="num text-[12px] whitespace-nowrap text-muted">{relDays(a.due)}</Cell>
                      <Cell className="max-lg:hidden" />
                    </Row>
                  ))}
                </>
              )}
            </ListTable>
          ))}

        {shownView === "drafted" &&
          (drafted.length === 0 ? (
            <Empty icon={<MailPlus className="size-6" />} title="No unsent drafts">
              First emails you draft show up here until they&apos;re sent or scheduled.
            </Empty>
          ) : (
            <ListTable head={[selectAll(drafted), "Contact", "Next step", "Drafted", ""]}>{drafted.map(row)}</ListTable>
          ))}

        {shownView === "scheduled" &&
          (scheduled.length === 0 ? (
            <Empty icon={<Clock className="size-6" />} title="Nothing scheduled">
              Emails queued with Coverage or Gmail&apos;s Schedule send show up here.
            </Empty>
          ) : (
            <ListTable head={[selectAll(scheduled), "Contact", "Email", "Sends", ""]}>
              {scheduled.map(({ c, a }) => (
                <ScheduledRow key={c.id} c={c} label={a.label.replace(/^.*scheduled · /, "")} onOpen={onOpen} selected={sel.has(c.id)} onSelect={() => toggle(c.id)} />
              ))}
            </ListTable>
          ))}

        {shownView === "replied" && <ScheduleCallsTable onOpen={onOpen} />}
        {shownView === "referrals" && <ReferralsTable onOpen={onOpen} />}
        {shownView === "offsheet" && <OffSheetTable />}
        {shownView === "replace" && <ReplacementsTable onOpen={onOpen} />}
      </Card>

      <Modal open={!!batch} onClose={() => setBatch(null)} title={`Schedule ${batch?.length ?? 0} email${batch?.length === 1 ? "" : "s"}`} wide>
        {batch && <BatchSchedule contacts={batch} onClose={() => setBatch(null)} />}
      </Modal>
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
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="sticky top-0 bg-subtle text-left text-[11px] tracking-wide text-muted uppercase">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Banker</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">First email</th>
                <th className="px-3 py-2 text-right font-medium">Last touch</th>
                <th className="px-3 py-2 text-right font-medium">F/U</th>
                <th className="px-4 py-2 font-medium">Next</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => {
                const a = nextAction(c, settings.followUp, banks[bankKey(c.bank, c.region)]);
                return (
                  <tr key={c.id} onClick={() => onOpen(c)} className="h-11 cursor-pointer hover:bg-subtle">
                    <td className="px-4 py-2">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-[12px] text-muted">
                        {c.bank} · {c.region}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="num px-3 py-2 text-right text-[12px]">{c.sentAt ? fmtDate(c.sentAt) : c.scheduledAt ? <span className="text-muted">sched. {fmtDate(c.scheduledAt)}</span> : "—"}</td>
                    <td className="num px-3 py-2 text-right text-[12px]">{fmtDate(c.lastTouchAt)}</td>
                    <td className="num px-3 py-2 text-right text-[12px]">{c.followUps}</td>
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
          <div className="border-t border-dashed border-line bg-subtle px-4 py-3">
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
      <NightTextPreview />
      <Card className="overflow-hidden">
        <CardHeader title="Upcoming reminder digests" sub="Push / SMS / calendar: one message per day at 9am, listing everyone to follow up with" />
        {digests.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-muted">No follow-ups scheduled in the next 5 weeks.</div>
        ) : (
          <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
            {digests.map((d) => (
              <li key={d.date} className="px-5 py-2.5 hover:bg-subtle">
                <div className="flex items-center gap-2 text-[12.5px] font-medium">
                  {d.when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  <span className="num rounded-full bg-track px-1.5 text-[11px] text-muted">{d.items.length}</span>
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
          <CardHeader title="Alert channels" sub="Where your daily follow-up list goes. Keys and numbers live in Settings → Reminders." />
          <ul className="divide-y divide-line">
            <Channel
              icon={<Bell />}
              title="Browser notifications"
              sub="A daily alert whenever this dashboard is open"
              status={
                perm === "granted" ? <Badge tone="green">On</Badge> : <Badge tone="neutral">{perm === "denied" ? "Blocked in browser settings" : perm === "unsupported" ? "Not supported here" : "Off"}</Badge>
              }
            >
              {perm === "default" && (
                <Button size="sm" onClick={async () => setPerm(await Notification.requestPermission())}>
                  Enable
                </Button>
              )}
            </Channel>

            <Channel
              icon={<Smartphone />}
              title="Phone push (ntfy)"
              sub={ntfyReady ? "Free push notifications through the ntfy app. Can schedule up to 3 days ahead." : <SetupHint text="Install the ntfy app, subscribe to a hard-to-guess topic, and paste that topic in" />}
            >
              {ntfyReady && (
                <>
                  <Button size="sm" variant="ghost" loading={busy === "test-ntfy"} onClick={() => test("ntfy")}>
                    Send test
                  </Button>
                  <Button size="sm" variant="brass" loading={busy === "ntfy"} onClick={() => schedule("ntfy")}>
                    Schedule next 3 days
                  </Button>
                </>
              )}
            </Channel>

            <Channel
              icon={<MessageSquare />}
              title="Text messages (Twilio)"
              sub={
                twilioReady ? (
                  "SMS digests. Scheduling up to 35 days out needs a Messaging Service SID."
                ) : (
                  <SetupHint text="Add your Twilio Account SID, auth token, a From number or Messaging Service, and your phone number in" />
                )
              }
            >
              {twilioReady && (
                <>
                  <Button size="sm" variant="ghost" loading={busy === "test-twilio"} onClick={() => test("twilio")}>
                    Text me today’s list
                  </Button>
                  <Button size="sm" variant="brass" loading={busy === "twilio"} disabled={!k.twilioMessagingServiceSid} onClick={() => schedule("twilio")}>
                    Schedule upcoming
                  </Button>
                </>
              )}
            </Channel>

            <Channel
              icon={<MessageSquare />}
              title="WhatsApp (CallMeBot)"
              sub={
                whatsappReady ? (
                  <span title="With automatic sending on, the server sends it even when the dashboard is closed; otherwise it goes out the first time the dashboard is open after 9 PM.">
                    Free. Your list at 9 PM, Mon–Thu: today&apos;s thank-yous, replies and check-ins owed, and follow-ups due before the next text. The server sends it when automatic sending is on.
                  </span>
                ) : (
                  <SetupHint text="Message +34 694 23 41 84 on WhatsApp: “I allow callmebot to send me messages”, then paste the API key it replies with into" />
                )
              }
              status={whatsappReady && scheduled[`whatsapp:${new Date().toLocaleDateString("en-CA")}`] ? <Badge tone="green">sent today</Badge> : undefined}
            >
              {whatsappReady && (
                <>
                  <label className="flex items-center gap-1.5 text-[12.5px] whitespace-nowrap">
                    <Checkbox checked={settings.alerts?.whatsappDaily !== false} onChange={(on) => setSettings((x) => ({ ...x, alerts: { ...x.alerts, whatsappDaily: on } }))} />
                    Send automatically
                  </label>
                  <Button size="sm" variant="ghost" loading={busy === "test-whatsapp"} onClick={() => test("whatsapp")}>
                    WhatsApp me today’s list
                  </Button>
                </>
              )}
            </Channel>

            <Channel icon={<CalendarPlus />} title="Calendar" sub="Each follow-up becomes an all-day event with a 9am alert on your phone">
              <Button size="sm" onClick={ics} icon={<CalendarPlus className="size-3.5" />}>
                Download .ics
              </Button>
            </Channel>
          </ul>
        </Card>
      </div>
    </div>
  );
}

/** One alert channel: icon, name, one muted line, its status and buttons on the right. */
function Channel({ icon, title, sub, status, children }: { icon: React.ReactNode; title: string; sub: React.ReactNode; status?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 py-3.5">
      <span className="mt-0.5 text-muted [&>svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1 basis-[200px]">
        <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
          {title}
          {status}
        </div>
        <div className="mt-0.5 text-[12px] text-muted">{sub}</div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-1.5">{children}</div>}
    </li>
  );
}

function SetupHint({ text }: { text: string }) {
  return (
    <>
      {text}{" "}
      <Link href="/settings?tab=reminders" className="font-medium text-brass-ink underline">
        Settings
      </Link>
      .
    </>
  );
}

/** What the next 9 PM WhatsApp text will say (Mon–Thu), from the same plan the server gets. */
function NightTextPreview() {
  const contacts = useStore((s) => s.contacts);
  const banks = useStore((s) => s.banks);
  const followUp = useStore((s) => s.settings.followUp);
  const next = useMemo(() => {
    const plan = nightPlan(contacts, banks, followUp, 8);
    const day = Object.keys(plan).sort()[0];
    return day ? { day, messages: digestMessages(plan[day].items, nightExtras(plan[day], contacts, day), 4000) } : null;
  }, [contacts, banks, followUp]);
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title={next ? `Next 9 PM text · ${textTime(next.day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}` : "Next 9 PM text"}
        sub="Mon–Thu nights. Google Calendar calls are added by the server when it sends; check-ins stop once you mark someone referred (Coffee chat prep) or Done."
      />
      {next ? (
        <div className="p-4">
          <pre className="max-h-[360px] overflow-y-auto rounded-lg border border-line bg-subtle p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">{next.messages.join("\n\n")}</pre>
        </div>
      ) : (
        <div className="p-6 text-center text-[13px] text-muted">Nothing to send in the next week.</div>
      )}
    </Card>
  );
}

/** "3 not on the first open day: Tara Goel (window full on Tue …)…" */
function movedNote(why: Map<string, string>) {
  const names = new Map(useStore.getState().contacts.map((c) => [c.id, c.name]));
  const list = [...why].slice(0, 3).map(([id, w]) => `${names.get(id) ?? id}: ${w}`);
  return `${why.size} not on the first open day. ${list.join(" · ")}${why.size > 3 ? ` (+${why.size - 3} more)` : ""}`;
}

/**
 * People with an email queued in Coverage AND one waiting in Gmail's Schedule send: two emails would go out. Checked
 * against Gmail when this opens (if Gmail is connected this session), with a one-click fix that cancels Coverage's.
 */
function DoubleSendsBanner() {
  const contacts = useStore((s) => s.contacts);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!gmailConnected()) return;
    const queued = useStore.getState().contacts.filter((c) => c.serverSend && new Date(c.serverSend.sendAt) > new Date());
    void gmailScheduledOverlap(queued).catch(() => undefined);
  }, []);
  const now = new Date();
  const both = contacts.filter((c) => c.serverSend && new Date(c.serverSend.sendAt) > now && c.scheduledAt && new Date(c.scheduledAt) > now);
  if (!both.length) return null;
  return (
    <Notice
      tone="red"
      icon={<Clock />}
      action={
        <Button
          size="sm"
          variant="danger"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              for (const c of both) await cancelSend(c);
              toast.ok(`Cancelled Coverage's send for ${both.length}. Their Gmail Schedule-send email still goes out.`);
            } catch (e) {
              toast.err((e as Error).message);
            }
            setBusy(false);
          }}
        >
          Cancel Coverage&apos;s {both.length}
        </Button>
      }
    >
      <b>{both.length}</b> {both.length > 1 ? "people have" : "person has"} an email queued here and another in Gmail&apos;s Schedule send:{" "}
      {both.slice(0, 6).map((c) => `${c.name} (Gmail ${sendLabel(c.scheduledAt!)})`).join(", ")}
      {both.length > 6 ? ` +${both.length - 6} more` : ""}.
    </Notice>
  );
}

/** Queued sends set for a later day than they need to be (e.g. Tue 10/27 when Thu 10/22 is allowed), with a fix. */
function LateSendsBanner() {
  const contacts = useStore((s) => s.contacts);
  const sendWindow = useStore((s) => s.settings.sendWindow);
  const followUp = useStore((s) => s.settings.followUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- lateSends reads the window and spacing from the store
  const late = useMemo(() => lateSends(contacts), [contacts, sendWindow, followUp]);
  const [busy, setBusy] = useState(false);
  if (!late.length) return null;
  const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
  return (
    <Notice
      tone="amber"
      icon={<Clock />}
      action={
        <Button
          size="sm"
          variant="brass"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const moved = await moveLateSends();
              toast.ok(`Moved ${moved.length} earlier: ${moved.slice(0, 3).map((m) => `${m.name} → ${day(m.to)}`).join(", ")}${moved.length > 3 ? "…" : ""}`);
            } catch (e) {
              toast.err((e as Error).message);
            }
            setBusy(false);
          }}
        >
          Move {late.length} earlier
        </Button>
      }
    >
      <b>{late.length}</b> queued follow-up{late.length > 1 ? "s are" : " is"} past the {Math.max(1, followUp.firstAfterDays - FOLLOW_UP_SPREAD)}–{followUp.firstAfterDays + FOLLOW_UP_SPREAD} day range:{" "}
      {late.slice(0, 6).map((x, i) => (
        <span key={x.c.id}>
          {i ? ", " : ""}
          {x.c.name} ({day(x.from)} → {day(x.to)})
        </span>
      ))}
      {late.length > 6 ? ` +${late.length - 6} more` : ""}.
    </Notice>
  );
}

/** Queued follow-ups that would go out sooner than your follow-up spacing (e.g. 5 days after the last one), with a fix. */
function EarlySendsBanner() {
  const contacts = useStore((s) => s.contacts);
  const followUp = useStore((s) => s.settings.followUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- earlySends reads the spacing from the store
  const early = useMemo(() => earlySends(contacts), [contacts, followUp]);
  const [busy, setBusy] = useState(false);
  if (!early.length) return null;
  return (
    <Notice
      tone="red"
      icon={<Clock />}
      action={
        <Button
          size="sm"
          variant="danger"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const moved = await fixEarlySends();
              toast.ok(`Moved ${moved.length}: ${moved.slice(0, 3).map((m) => `${m.name} → ${m.to.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" })}`).join(", ")}${moved.length > 3 ? "…" : ""}`);
            } catch (e) {
              toast.err((e as Error).message);
            }
            setBusy(false);
          }}
        >
          Move too-early sends
        </Button>
      }
    >
      <b>{early.length}</b> queued follow-up{early.length > 1 ? "s go" : " goes"} out sooner than {Math.max(1, followUp.nextAfterDays - FOLLOW_UP_SPREAD)} days after your last email (
      {early.slice(0, 4).map((c) => c.name).join(", ")}
      {early.length > 4 ? "…" : ""}).
    </Notice>
  );
}

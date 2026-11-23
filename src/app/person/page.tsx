"use client";

import Link from "@/components/Link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Building2, CalendarDays, CalendarPlus, Coffee, ExternalLink, Mail, MessageSquareText, NotebookPen, StickyNote, UserRound } from "lucide-react";
import { useStore } from "@/lib/store";
import { canonBank } from "@/lib/banks";
import { chatRecords, type ChatRecord } from "@/lib/chatEvidence";
import { teamSourceLabel } from "@/lib/coverageGrid";
import { STATUS_LABEL, type Contact } from "@/lib/types";
import { Path, RecordHeader, RelatedCard, Tabs, Timeline, type TimelineItem } from "@/components/crm";
import { Badge, Button, Card, Empty, Modal, toast } from "@/components/ui";
import { CallInvite } from "@/components/Scheduling";

/**
 * A person (docs/DESIGN.md L-2, HubSpot's record layout): About on the left, activity in the middle, related records
 * on the right. Opened from global search, Things to think about and bank pages. `?id=<contact id>`.
 */
export default function PersonPage() {
  return (
    <Suspense>
      <Person />
    </Suspense>
  );
}

type Stage = "found" | "emailed" | "replied" | "talked" | "referral";
const STAGES: { id: Stage; label: string }[] = [
  { id: "found", label: "Found" },
  { id: "emailed", label: "Emailed" },
  { id: "replied", label: "Replied" },
  { id: "talked", label: "Talked" },
  { id: "referral", label: "Referral" },
];

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dayDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

function stageOf(c: Contact, chats: ChatRecord[]): Stage {
  if (c.referral) return "referral";
  if (chats.some((r) => r.state === "confirmed" || r.state === "likely")) return "talked";
  if (c.repliedAt || c.lastHeardAt || c.mail?.lastIn) return "replied";
  if (c.sentAt || c.lastEmailedAt) return "emailed";
  return "found";
}

function Person() {
  const id = useSearchParams().get("id") ?? "";
  const contacts = useStore((s) => s.contacts);
  const c = contacts.find((x) => x.id === id);
  const [tab, setTab] = useState<"activity" | "chats" | "history">("activity");
  const [inviting, setInviting] = useState(false);
  const [now] = useState(() => Date.now());
  const chats = useMemo(() => (c ? chatRecords(c, now) : []), [c, now]);

  if (!c)
    return (
      <Card>
        <Empty icon={<UserRound className="size-6" />} title="Person not found">
          They may have been removed. Search for someone in the bar at the top.
        </Empty>
      </Card>
    );

  const team = teamSourceLabel(c);
  const counted = chats.filter((r) => r.state === "confirmed" || r.state === "likely").length;
  const toCheck = chats.filter((r) => r.state === "check").length;
  const bankKey = canonBank(c.bank);
  const colleagues = contacts.filter((x) => x.id !== c.id && canonBank(x.bank) === bankKey);
  const referredTo = (c.referral?.to ?? []).map((t) => ({ ...t, c: t.contactId ? contacts.find((x) => x.id === t.contactId) : undefined }));
  const referrer = c.referredBy?.contactId ? contacts.find((x) => x.id === c.referredBy!.contactId) : undefined;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <RecordHeader
        icon={<UserRound className="size-5" />}
        eyebrow="Person"
        title={c.name}
        actions={
          <>
            <Button icon={<CalendarPlus className="size-4" />} onClick={() => setInviting(true)}>
              Send invite
            </Button>
            <Link href={`/log?log=${encodeURIComponent(c.id)}&kind=coffee_chat`} className="inline-flex h-8 items-center gap-1.5 rounded border border-line-2 bg-panel px-3 text-[13px] font-medium text-brass-ink hover:bg-hover">
              <NotebookPen className="size-4" /> Log a chat
            </Link>
            <Link href={`/prep?id=${encodeURIComponent(c.id)}`} className="inline-flex h-8 items-center gap-1.5 rounded border border-line-2 bg-panel px-3 text-[13px] font-medium text-brass-ink hover:bg-hover">
              <Coffee className="size-4" /> Prep
            </Link>
            {c.email && (
              <a href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`from:${c.email} OR to:${c.email}`)}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded bg-brass-strong px-3 text-[13px] font-medium text-white hover:bg-brass-hover">
                <Mail className="size-4" /> Open in Gmail
              </a>
            )}
          </>
        }
        fields={[
          { label: "Bank", value: c.bank ? <Link href={`/bank?key=${encodeURIComponent(bankKey)}`} className="text-brass-ink hover:underline">{c.bank}</Link> : "—" },
          { label: "Title", value: c.position || "—" },
          { label: "Team", value: team.team ? <span className={team.confirmed ? "" : "text-amber italic"}>{team.team}{team.confirmed ? "" : "?"} <span className="text-[12px] text-muted not-italic">({team.source})</span></span> : "—" },
          { label: "Office", value: c.location || c.region || "—" },
          { label: "Status", value: STATUS_LABEL[c.status] },
          { label: "Chats", value: <>{counted}{toCheck > 0 && <span className="text-amber"> (+{toCheck} to confirm)</span>}</> },
        ]}
      >
        <Path steps={STAGES} current={stageOf(c, chats)} label="Relationship" />
      </RecordHeader>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[280px_minmax(0,1fr)_280px]">
        <RelatedCard title="About" icon={<UserRound />}>
          <dl className="grid gap-2 text-[13px]">
            <Field label="Email" value={c.email ? <a className="break-all text-brass-ink hover:underline" href={`mailto:${c.email}`}>{c.email}</a> : "—"} />
            {(c.aliases?.length ?? 0) > 0 && <Field label="Also writes from" value={c.aliases!.join(", ")} />}
            <Field label="LinkedIn" value={c.linkedin ? <a className="inline-flex items-center gap-1 text-brass-ink hover:underline" href={c.linkedin} target="_blank" rel="noreferrer">Profile <ExternalLink className="size-3" /></a> : "—"} />
            <Field label="First emailed" value={fmt(c.sentAt)} />
            <Field label="Last emailed" value={fmt(c.lastEmailedAt ?? c.lastTouchAt ?? c.sentAt)} />
            <Field label="Follow-ups sent" value={c.followUps} />
            <Field label="Last heard from" value={fmt(c.lastHeardAt ?? c.repliedAt)} />
            {c.call && <Field label="Call" value={fmtTime(c.call.at)} />}
            {c.comment && <Field label="Notes" value={<span className="whitespace-pre-line">{c.comment}</span>} />}
          </dl>
        </RelatedCard>

        <Card className="min-w-0">
          <Tabs
            className="px-2"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "activity", label: "Activity" },
              { id: "chats", label: "Chats", count: chats.filter((r) => r.state !== "rejected").length },
              { id: "history", label: "History", count: c.history.length },
            ]}
          />
          <div className="p-4">
            {tab === "activity" && <Timeline items={activity(c, chats)} />}
            {tab === "chats" && <ChatsList c={c} chats={chats} />}
            {tab === "history" && (
              <Timeline
                items={[...c.history]
                  .reverse()
                  .slice(0, 80)
                  .map((h, i) => ({ id: `h${i}`, icon: <StickyNote />, title: h.note ?? h.type.replace("_", " "), meta: fmtTime(h.at) }))}
              />
            )}
          </div>
        </Card>

        <div className="grid content-start gap-3">
          <RelatedCard title={c.bank || "Bank"} icon={<Building2 />} count={colleagues.length} footer={c.bank ? <Link href={`/bank?key=${encodeURIComponent(bankKey)}`} className="text-brass-ink hover:underline">View bank</Link> : undefined}>
            {colleagues.length ? (
              <ul className="grid gap-1.5 text-[13px]">
                {colleagues.slice(0, 6).map((x) => (
                  <li key={x.id} className="flex items-baseline justify-between gap-2">
                    <Link href={`/person?id=${encodeURIComponent(x.id)}`} className="truncate text-brass-ink hover:underline">
                      {x.name}
                    </Link>
                    <span className="shrink-0 text-[12px] text-muted">{STATUS_LABEL[x.status]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">Nobody else here yet.</p>
            )}
          </RelatedCard>
          {(c.referredBy || referredTo.length > 0) && (
            <RelatedCard title="Referrals" icon={<ArrowUpRight />}>
              <ul className="grid gap-1.5 text-[13px]">
                {c.referredBy && (
                  <li>
                    Referred by{" "}
                    {referrer ? (
                      <Link href={`/person?id=${encodeURIComponent(referrer.id)}`} className="text-brass-ink hover:underline">
                        {c.referredBy.name}
                      </Link>
                    ) : (
                      c.referredBy.name
                    )}{" "}
                    <span className="text-muted">· {fmt(c.referredBy.at)}</span>
                  </li>
                )}
                {referredTo.map((t) => (
                  <li key={t.name}>
                    Referred you to{" "}
                    {t.c ? (
                      <Link href={`/person?id=${encodeURIComponent(t.c.id)}`} className="text-brass-ink hover:underline">
                        {t.name}
                      </Link>
                    ) : (
                      t.name
                    )}
                  </li>
                ))}
              </ul>
            </RelatedCard>
          )}
        </div>
      </div>
      <Modal open={inviting} onClose={() => setInviting(false)} title={`Invite ${c.name} to a call`} wide>
        {inviting && <CallInvite c={c} onClose={() => setInviting(false)} />}
      </Modal>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

/** Emails (the conversation Coverage read from Gmail, else the dates it knows), chats and the call, newest first. */
function activity(c: Contact, chats: ChatRecord[]): TimelineItem[] {
  const items: (TimelineItem & { at: string })[] = [];
  const msgs = c.mail?.messages ?? [];
  for (const m of msgs)
    items.push({
      id: `m:${m.id}`,
      at: m.at,
      icon: m.dir === "in" ? <ArrowDownLeft /> : <ArrowUpRight />,
      tone: m.dir === "in" ? "green" : "blue",
      title: (
        <a href={`https://mail.google.com/mail/u/0/#all/${m.threadId}`} target="_blank" rel="noreferrer" className="hover:underline">
          {m.dir === "in" ? `${c.name.split(" ")[0]} wrote` : "You wrote"}: {m.subject || "(no subject)"}
        </a>
      ),
      meta: fmtTime(m.at),
      body: m.snippet,
    });
  if (!msgs.length) {
    if (c.sentAt) items.push({ id: "sent", at: c.sentAt, icon: <ArrowUpRight />, tone: "blue", title: "First email", meta: fmtTime(c.sentAt) });
    if (c.lastEmailedAt && c.lastEmailedAt !== c.sentAt) items.push({ id: "last", at: c.lastEmailedAt, icon: <ArrowUpRight />, tone: "blue", title: "Your latest email", meta: fmtTime(c.lastEmailedAt) });
    if (c.repliedAt) items.push({ id: "rep", at: c.repliedAt, icon: <ArrowDownLeft />, tone: "green", title: "They replied", meta: fmtTime(c.repliedAt) });
    if (c.lastHeardAt && c.lastHeardAt !== c.repliedAt) items.push({ id: "heard", at: c.lastHeardAt, icon: <ArrowDownLeft />, tone: "green", title: "They wrote again", meta: fmtTime(c.lastHeardAt) });
  }
  for (const r of chats) {
    if (r.state === "rejected") continue;
    items.push({
      id: `chat:${r.day}`,
      at: r.at,
      icon: <MessageSquareText />,
      tone: r.state === "check" ? "amber" : "green",
      title: r.state === "check" ? "Chat? (not counted until you confirm)" : "Chat",
      meta: `${dayDate(r.day)} · ${r.sources.map((s) => s.label.toLowerCase()).join(", ")}`,
    });
  }
  if (c.call && Date.parse(c.call.at) > Date.now()) items.push({ id: "call", at: c.call.at, icon: <CalendarDays />, title: "Call coming up", meta: fmtTime(c.call.at) });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

function ChatsList({ c, chats }: { c: Contact; chats: ChatRecord[] }) {
  if (!chats.length) return <p className="text-[13px] text-muted">No chats found: nothing on your calendar with them, no logged chat, no thank-you email.</p>;
  const answer = (day: string, v: "yes" | "no" | null) => {
    const verdicts = { ...(c.chatVerdicts ?? {}) };
    if (v) verdicts[day] = v;
    else delete verdicts[day];
    useStore.getState().updateContact(c.id, { chatVerdicts: Object.keys(verdicts).length ? verdicts : undefined }, v ? { at: new Date().toISOString(), type: "note", note: v === "yes" ? `You confirmed a chat on ${dayDate(day)}` : `You said there was no chat on ${dayDate(day)}` } : undefined);
    if (v) toast.ok(v === "yes" ? "Counted." : "Not counted.");
  };
  const TONE = { confirmed: "green", likely: "blue", check: "amber", rejected: "neutral" } as const;
  const WORD = { confirmed: "Counted", likely: "Counted (thank-you owed)", check: "To confirm", rejected: "Not a chat" };
  return (
    <div className="grid gap-3">
      <p className="text-[12px] text-muted">A chat counts when two sources agree (your calendar + a thank-you email), or you logged / confirmed it. One source alone is asked about instead of counted.</p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {chats.map((r) => (
          <li key={r.day} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-[260px]">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-semibold text-ink">{dayDate(r.day)}</span>
                <Badge tone={TONE[r.state]}>{WORD[r.state]}</Badge>
              </div>
              <div className="text-[13px] text-ink-2">{r.why}</div>
              <ul className="mt-0.5 text-[12px] text-muted">
                {r.sources.map((s, i) => (
                  <li key={i}>
                    {s.label}: {fmtTime(s.at)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex shrink-0 gap-2">
              {r.state === "check" && (
                <>
                  <Button size="sm" variant="primary" onClick={() => answer(r.day, "yes")}>
                    Yes, we talked
                  </Button>
                  <Button size="sm" onClick={() => answer(r.day, "no")}>
                    No
                  </Button>
                </>
              )}
              {c.chatVerdicts?.[r.day] && (
                <Button size="sm" variant="ghost" onClick={() => answer(r.day, null)}>
                  Undo my answer
                </Button>
              )}
              {r.state !== "check" && !c.chatVerdicts?.[r.day] && r.state !== "rejected" && !r.sources.some((s) => s.source === "logged") && (
                <Button size="sm" variant="ghost" onClick={() => answer(r.day, "no")}>
                  Not a chat
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

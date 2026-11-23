"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ExternalLink, MessagesSquare, RefreshCw } from "lucide-react";
import { useStore } from "@/lib/store";
import { ongoingRows, unmatchedScheduled, type OngoingGroup, type OngoingRow } from "@/lib/ongoing";
import { STOP_LABEL, applyGmailScheduled } from "@/lib/gmailScheduled";
import { syncLedgers } from "@/lib/ledgerSync";
import { Button, Card, Empty, PageHeader, toast } from "@/components/ui";
import { Tabs } from "@/components/crm";
import { Cell, ListTable, NameCell, Row, RowActions } from "@/components/FollowupsUi";

const GROUPS: { id: OngoingGroup; label: string; caption: string }[] = [
  { id: "yours", label: "Your move", caption: "They wrote last and you haven't answered. Oldest first." },
  { id: "scheduled", label: "Scheduled", caption: "An email to them is already queued (Gmail Schedule send or Coverage). Nothing to do until it goes out." },
  { id: "waiting", label: "Waiting on them", caption: "You wrote last in a two-way conversation. Newest first." },
];

const when = (iso: string) => {
  const d = new Date(iso);
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (days < 0) return `${day}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

const gmailLink = (threadId?: string) => (threadId ? `https://mail.google.com/mail/u/0/#all/${threadId}` : "https://mail.google.com/mail/u/0/#scheduled");

/** Ongoing threads (L-3 workspace): every live conversation and what's already queued. */
export default function OngoingPage() {
  const router = useRouter();
  const contacts = useStore((s) => s.contacts);
  const scheduledMail = useStore((s) => s.offSheet.scheduled);
  const checkedAt = useStore((s) => s.offSheet.scheduledCheckedAt);
  const updateContact = useStore((s) => s.updateContact);
  const [tab, setTab] = useState<OngoingGroup>("yours");
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => ongoingRows(contacts), [contacts]);
  const unmatched = useMemo(() => unmatchedScheduled(scheduledMail ?? [], contacts), [scheduledMail, contacts]);
  const count = (g: OngoingGroup) => rows.filter((r) => r.group === g).length + (g === "scheduled" ? unmatched.length : 0);
  const shown = rows.filter((r) => r.group === tab);
  // A scheduled email to them carrying a label like "DO NOT SEND - MOVED ON" or "HOLD - desk full".
  const stopLabels = (r: OngoingRow) => {
    const mine = new Set([r.c.email, ...(r.c.aliases ?? [])].filter(Boolean).map((e) => e.toLowerCase()));
    return [...new Set((scheduledMail ?? []).filter((it) => it.to.some((e) => mine.has(e))).flatMap((it) => it.labels.filter((l) => STOP_LABEL.test(l))))];
  };

  const refresh = async () => {
    setBusy(true);
    try {
      await applyGmailScheduled();
      const n = await syncLedgers({ ids: rows.map((r) => r.c.id), force: true });
      toast.ok(`Re-read ${n} conversation${n === 1 ? "" : "s"} and Gmail's scheduled emails.`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Ongoing threads"
        sub={`Two-way conversations from the last 45 days, and every email waiting to go out${checkedAt ? ` (Gmail's scheduled emails read ${when(checkedAt)})` : ""}.`}
        right={
          <Button icon={<RefreshCw className="size-3.5" />} loading={busy} onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />
      <Tabs className="my-3" value={tab} onChange={setTab} tabs={GROUPS.map((g) => ({ id: g.id, label: g.label, count: count(g.id) }))} />
      <Card>
        <p className="border-b border-line px-4 py-2 text-[12px] text-muted">{GROUPS.find((g) => g.id === tab)!.caption}</p>
        {shown.length === 0 && !(tab === "scheduled" && unmatched.length) ? (
          <Empty icon={<MessagesSquare className="size-6" />} title={tab === "yours" ? "Nobody is waiting on you" : "Nothing here"} />
        ) : (
          <ListTable head={["Person", tab === "scheduled" ? "Goes out" : "Last message", "When", ""]}>
            {shown.map((r) => {
              const stops = tab === "scheduled" ? stopLabels(r) : [];
              return (
                <Row key={r.c.id} tone={stops.length ? "amber" : undefined}>
                  <Cell main>
                    <NameCell name={r.c.name} sub={`${r.c.position ? `${r.c.position} · ` : ""}${r.c.bank}`} onOpen={() => router.push(`/person?id=${encodeURIComponent(r.c.id)}`)} />
                  </Cell>
                  <Cell className="max-w-[520px]">
                    <div className="truncate text-[12.5px] text-ink">
                      <span className="text-muted">{r.who === "them" ? "They wrote: " : "You: "}</span>
                      {r.subject || "(no subject)"}
                    </div>
                    {r.snippet && <div className="truncate text-[12px] text-muted">{r.snippet}</div>}
                    {stops.length > 0 && (
                      <div className="mt-0.5 flex items-center gap-1 text-[12px] text-amber">
                        <AlertTriangle className="size-3.5" /> Still scheduled, but labelled {stops.map((l) => `"${l}"`).join(", ")}
                      </div>
                    )}
                  </Cell>
                  <Cell className="num text-[12px] whitespace-nowrap text-muted">
                    {r.at ? when(r.at) : "—"}
                    {r.messages > 1 && <div>{r.messages} emails</div>}
                  </Cell>
                  <Cell>
                    <RowActions show>
                      <a href={gmailLink(r.group === "scheduled" ? undefined : r.threadId)} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] text-brass-ink hover:bg-hover">
                        <ExternalLink className="size-3.5" /> Gmail
                      </a>
                      {r.group === "yours" && (
                        <Button size="sm" variant="ghost" icon={<Check className="size-3.5" />} onClick={() => updateContact(r.c.id, { handledAt: new Date().toISOString() }, { at: new Date().toISOString(), type: "note", note: "Handled (Ongoing threads)" })}>
                          Handled
                        </Button>
                      )}
                    </RowActions>
                  </Cell>
                </Row>
              );
            })}
            {tab === "scheduled" &&
              unmatched.map((it) => (
                <Row key={it.threadId + it.at} tone={it.labels.some((l) => STOP_LABEL.test(l)) ? "amber" : undefined}>
                  <Cell main>
                    <div className="text-[13px] font-medium text-ink">{it.to[0]}</div>
                    <div className="text-[12px] text-muted">Not in your tracker</div>
                  </Cell>
                  <Cell>
                    <div className="truncate text-[12.5px] text-ink">{it.subject || "(no subject)"}</div>
                    {it.labels.some((l) => STOP_LABEL.test(l)) && (
                      <div className="mt-0.5 flex items-center gap-1 text-[12px] text-amber">
                        <AlertTriangle className="size-3.5" /> Still scheduled, but labelled {it.labels.filter((l) => STOP_LABEL.test(l)).map((l) => `"${l}"`).join(", ")}
                      </div>
                    )}
                  </Cell>
                  <Cell className="num text-[12px] whitespace-nowrap text-muted">{when(it.at)}</Cell>
                  <Cell>
                    <RowActions show>
                      <a href={gmailLink()} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] text-brass-ink hover:bg-hover">
                        <ExternalLink className="size-3.5" /> Gmail
                      </a>
                    </RowActions>
                  </Cell>
                </Row>
              ))}
          </ListTable>
        )}
      </Card>
    </>
  );
}

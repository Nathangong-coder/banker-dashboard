"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Forward, Mail, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { clientOf, labelHits, type HitLabel } from "@/lib/opens";
import { gmailReadableQuietly, gmailThreadUrl, threadMessages, type ThreadMessage } from "@/lib/gmail";
import { googleClientId } from "@/lib/keys";
import { kindLabel, settleFor, tzFor, whenIn, whenMine, type TrackedRow } from "@/lib/trackingView";
import { Badge, Button, Menu } from "./ui";
import { SafeEmailHtml } from "./SafeEmailHtml";

const LABEL: Record<HitLabel, { text: string; tone: "green" | "neutral" | "blue" | "brass"; hint: string }> = {
  person: { text: "Opened", tone: "green", hint: "Counted as a real open." },
  scanner: { text: "Security scanner", tone: "neutral", hint: "A mail filter fetched the image (right after sending, a known scanner network, or a burst). Not counted." },
  "apple-privacy": { text: "Apple Mail privacy", tone: "blue", hint: "Apple loads images for people who use Mail Privacy Protection, read or not. Not counted." },
  you: { text: "You", tone: "brass", hint: "Your own view (before it was sent, while you had it open, or Gmail's image proxy for a non-Google recipient). Not counted." },
};

const FAMILY: Record<string, string> = { outlook: "Outlook", gmail: "Gmail", "apple-mail": "Apple Mail", other: "Mail app" };

/** The thread read for one message (`for` = its id), so a late answer for another row is dropped (settleFor). */
type Thread = { for: string; state: "idle" | "loading" | "needs" | "error" | "done"; list: ThreadMessage[]; error?: string };

/** One tracked email: its open timeline, the thread read from Gmail (pixels removed), and a jump to Gmail. */
export function TrackingDetail({ row, onClose, onOpenContact }: { row: TrackedRow; onClose: () => void; onOpenContact?: () => void }) {
  const { m, c, s } = row;
  const mx = useStore((st) => st.tracking.mx);
  const settings = useStore((st) => st.settings);
  const clientId = googleClientId(settings);
  const tz = tzFor(c);
  const hits = labelHits(m, mx);
  const domain = m.to[0]?.split("@")[1]?.toLowerCase();
  const googleHosted = !!domain && mx[domain] === "google";

  const [thread, setThread] = useState<Thread>({ for: m.id, state: "idle", list: [] });
  const [prevId, setPrevId] = useState(m.id);
  if (prevId !== m.id) {
    setPrevId(m.id);
    setThread({ for: m.id, state: "idle", list: [] });
  }
  // Only applied while the panel still shows that message.
  const settle = (next: Thread) => setThread((prev) => settleFor(prev, next));

  const load = async (threadId: string) => {
    const id = m.id;
    settle({ for: id, state: "loading", list: [] });
    try {
      const list = await threadMessages(clientId, threadId);
      settle({ for: id, state: "done", list });
    } catch (e) {
      settle({ for: id, state: "error", list: [], error: (e as Error).message });
    }
  };

  // Read the thread straight away when Gmail can be read without a popup; otherwise wait for a click.
  useEffect(() => {
    if (!m.threadId || thread.state !== "idle") return;
    let gone = false;
    const id = m.threadId;
    gmailReadableQuietly(clientId)
      .catch(() => false)
      .then((ok) => {
        if (gone) return;
        if (ok) void load(id);
        else settle({ for: m.id, state: "needs", list: [] });
      });
    return () => {
      gone = true;
    };
    // load / settle only close over clientId and m.id, which are in the deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id, m.threadId, thread.state, clientId]);

  const who = c?.name ?? (m.to.length ? m.to.join(", ") : "Unknown recipient");

  return (
    <div className="flex max-h-full min-h-0 flex-col">
      <div className="border-b border-line px-5 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-muted">
              {kindLabel(m)}
              {row.firm && ` · ${row.firm}`}
            </div>
            <h2 className="mt-0.5 text-[17px] leading-snug font-medium break-words text-ink">{m.subject || "(no subject)"}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
              {c && onOpenContact ? (
                <button type="button" onClick={onOpenContact} className="font-medium text-navy hover:underline">
                  {who}
                </button>
              ) : (
                <span className="text-ink-2">{who}</span>
              )}
              {!c && <Badge>Not in tracker</Badge>}
              <span title={m.sentAt ? whenMine(m.sentAt) : undefined}>{m.sentAt ? `Sent ${whenIn(m.sentAt, tz)}` : "Not sent yet"}</span>
            </div>
          </div>
          <Menu
            items={[
              !!m.threadId && { label: "Open in Gmail", icon: <ExternalLink />, onClick: () => void window.open(gmailThreadUrl(m.threadId!), "_blank", "noopener,noreferrer") },
              !!m.threadId && thread.state === "done" && { label: "Reload the thread", icon: <Mail />, onClick: () => void load(m.threadId!) },
            ]}
          />
          <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:bg-hover" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {s.opens ? <Badge tone="green">Opened {s.opens}×</Badge> : <Badge>{m.sentAt ? "Not opened yet" : "Draft"}</Badge>}
          {s.forwarded && (
            <Badge tone="amber">
              <Forward className="size-3" /> Possibly forwarded
            </Badge>
          )}
          {row.replied && <Badge tone="blue">Replied</Badge>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-line px-5 py-4">
          <h3 className="mb-2 text-[11px] font-medium tracking-[0.06em] text-muted uppercase">Opens</h3>
          {hits.length === 0 ? (
            <p className="text-[12.5px] text-muted">{m.sentAt ? "No opens seen yet. Some mail apps block images, so this isn't proof they didn't read it." : "Opens start once it's sent."}</p>
          ) : (
            <ol className="space-y-2">
              {hits.map(({ hit, label }, i) => {
                const cl = clientOf(hit.ua);
                const place = [hit.city, hit.country].filter(Boolean).join(", ");
                return (
                  <li key={`${hit.at}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
                    <span className="num text-ink" title={`Your time: ${whenMine(hit.at)}`}>
                      {whenIn(hit.at, tz)}
                    </span>
                    <span title={LABEL[label].hint}>
                      <Badge tone={LABEL[label].tone}>{LABEL[label].text}</Badge>
                    </span>
                    <span className="text-muted">
                      {FAMILY[cl.family]}
                      {cl.device !== "unknown" && ` · ${cl.device}`}
                      {place && ` · ${place}`}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {googleHosted && (
            <p className="mt-2 text-[11.5px] text-muted">Their mail is on Google: if you read this email on your phone&apos;s Gmail app, those views can look like theirs.</p>
          )}
        </section>

        <section className="px-5 py-4">
          <h3 className="mb-2 text-[11px] font-medium tracking-[0.06em] text-muted uppercase">The email</h3>
          {!m.threadId ? (
            <p className="text-[12.5px] text-muted">Coverage doesn&apos;t know this email&apos;s Gmail thread yet. It fills in after the next Gmail sync once it&apos;s sent.</p>
          ) : thread.state === "needs" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" icon={<Mail className="size-3.5" />} onClick={() => void load(m.threadId!)}>
                Connect Gmail to read it here
              </Button>
            </div>
          ) : thread.state === "error" ? (
            <div className="space-y-2 text-[12.5px]">
              <p className="text-red">{thread.error}</p>
              <Button size="sm" onClick={() => void load(m.threadId!)}>
                Try again
              </Button>
            </div>
          ) : thread.state === "done" ? (
            thread.list.length === 0 ? (
              <p className="text-[12.5px] text-muted">That thread is empty or was deleted in Gmail.</p>
            ) : (
              <ol className="space-y-3">
                {thread.list.map((t) => (
                  <li key={t.id} className="rounded-lg border border-line">
                    <div className="border-b border-line bg-subtle px-3 py-2 text-[12px]">
                      <div className="truncate font-medium text-ink" title={t.from}>
                        {t.from}
                      </div>
                      <div className="truncate text-muted" title={t.to}>
                        to {t.to} · {whenMine(t.at)}
                      </div>
                    </div>
                    <SafeEmailHtml html={t.html} text={t.text} className="px-3 py-2.5" />
                  </li>
                ))}
              </ol>
            )
          ) : (
            <p className="text-[12.5px] text-muted">Reading it from Gmail…</p>
          )}
          {m.threadId && (
            <a href={gmailThreadUrl(m.threadId)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-navy hover:underline">
              Open in Gmail to reply <ExternalLink className="size-3" />
            </a>
          )}
        </section>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, ShieldAlert, Tag } from "lucide-react";
import { useStore } from "@/lib/store";
import { googleClientId } from "@/lib/keys";
import { connectGmail, gmailConnected, labelInGmail, outgoingQueue, type Outgoing } from "@/lib/gmail";
import { vpPlusWarning } from "@/lib/seniority";
import { rulesOf } from "@/lib/outreach";
import type { Contact } from "@/lib/types";
import { Badge, Button, toast } from "./ui";
import { Notice } from "./FollowupsUi";

/**
 * Your rule: don't email VP and above. This checks what's actually waiting in Gmail (drafts and Schedule-send
 * messages, including ones made outside the dashboard) against your contacts' titles, lists anything going to a VP+,
 * and can put a red "⚠ VP+ check" label on those messages so the warning shows inside Gmail too. Shown as a one-line
 * notice on Follow-ups (the flagged list opens under it).
 */
export function SeniorGmailCheck() {
  const contacts = useStore((s) => s.contacts);
  const settings = useStore((s) => s.settings);
  const clientId = googleClientId(settings);
  const [queue, setQueue] = useState<Outgoing[] | null>(null);
  const [busy, setBusy] = useState<"scan" | "label" | null>(null);
  const [show, setShow] = useState(false);

  const scan = async () => {
    setBusy("scan");
    try {
      await connectGmail(clientId);
      setQueue(await outgoingQueue(clientId));
    } catch (e) {
      toast.err((e as Error).message);
    }
    setBusy(null);
  };
  // Already connected this session: check once, quietly.
  useEffect(() => {
    if (!clientId || !gmailConnected(clientId)) return;
    const t = setTimeout(() => void scan(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const flagged = useMemo(() => {
    if (!queue) return [];
    const byEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]));
    const rules = rulesOf(settings);
    return queue.flatMap((m) =>
      m.to
        .map((e) => byEmail.get(e))
        .filter((c): c is Contact => !!c)
        .map((c) => ({ m, c, w: vpPlusWarning(c, rules) }))
        .filter((x) => !!x.w),
    );
  }, [queue, contacts, settings]);

  if (!clientId) return null;
  if (queue && !flagged.length) return null;

  return (
    <div>
      <Notice
        tone={flagged.length ? "red" : "neutral"}
        icon={<ShieldAlert />}
        action={
          <>
            {flagged.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setShow((x) => !x)} aria-expanded={show}>
                {show ? "Hide" : "Show"}
              </Button>
            )}
            {flagged.length > 0 && (
              <Button
                size="sm"
                variant="danger"
                loading={busy === "label"}
                icon={<Tag className="size-3.5" />}
                onClick={async () => {
                  setBusy("label");
                  try {
                    const n = await labelInGmail(clientId, [...new Set(flagged.map((f) => f.m.messageId))]);
                    toast.ok(`Labelled ${n} message${n === 1 ? "" : "s"} "⚠ VP+ check" in Gmail.`);
                  } catch (e) {
                    toast.err((e as Error).message);
                  }
                  setBusy(null);
                }}
                title="Adds a red label in Gmail (asks Google for permission to manage labels the first time)"
              >
                Label in Gmail
              </Button>
            )}
            <Button size="sm" variant="ghost" loading={busy === "scan"} onClick={scan}>
              {queue ? "Scan again" : "Scan Gmail"}
            </Button>
          </>
        }
      >
        {queue ? (
          <span title="Drafts and scheduled emails in your Gmail addressed to VP / Director / MD / Head / Partner contacts. Your rule is not to email them: delete or unschedule them in Gmail unless you mean it.">
            <b>{flagged.length}</b> email{flagged.length === 1 ? "" : "s"} waiting in Gmail go{flagged.length === 1 ? "es" : ""} to a VP or above. Delete or unschedule them in Gmail unless you mean it.
          </span>
        ) : (
          <span title="Scans your Gmail drafts and Schedule-send emails (including ones you made outside the dashboard) for VP+ recipients.">
            Check your Gmail drafts and scheduled emails for VP+ recipients.
          </span>
        )}
      </Notice>
      {show && flagged.length > 0 && (
        <ul className="mt-1.5 divide-y divide-line rounded-lg border border-line bg-panel">
          {flagged.map(({ m, c, w }) => (
            <li key={`${m.messageId}:${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12.5px]">
              <div className="min-w-[200px] flex-1">
                <span className="font-medium">{c.name}</span> <span className="text-muted">· {c.bank}</span>
                <div className={w!.tie ? "text-[12px] text-amber" : "text-[12px] font-medium text-red"}>⚠ {w!.text}</div>
              </div>
              <Badge tone={m.kind === "scheduled" ? "amber" : "neutral"}>
                {m.kind === "scheduled" ? `Scheduled ${new Date(m.at!).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Draft"}
              </Badge>
              <a
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brass-ink hover:underline"
                href={m.kind === "draft" ? `https://mail.google.com/mail/u/0/#drafts?compose=${m.messageId}` : `https://mail.google.com/mail/u/0/#scheduled/${m.messageId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Gmail <ExternalLink className="size-3" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

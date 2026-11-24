"use client";

import { useMemo, useState } from "react";
import { Bot, CalendarClock, Check, ExternalLink, X } from "lucide-react";
import Link from "@/components/Link";
import { Badge, Button, toast } from "@/components/ui";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";
import { gmailDraftUrl, gmailSearchUrl } from "@/lib/gmailLinks";
import { handoffItems } from "@/lib/handoff";
import { removeFromHandoff } from "@/lib/handoffActions";

/**
 * "To schedule in Gmail" (owner, 2026-11-23): drafts waiting for Gmail's own Schedule send. The extension does them
 * all (`onExtension`), or Claude in Chrome does (the Recruitify plugin's schedule-in-gmail skill reads the same list
 * through the Coverage connector). A row turns "In Gmail ✓" only when Gmail's Scheduled folder shows it.
 */
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

export function HandoffPanel({ onExtension, busy }: { onExtension?: () => void; busy?: boolean }) {
  const contacts = useStore((s) => s.contacts);
  const waiting = useMemo(() => handoffItems(contacts), [contacts]);
  const [now] = useState(() => Date.now());
  const confirmed = useMemo(
    () => contacts.filter((c) => c.gmailSchedule?.state === "scheduled" && Date.parse(c.gmailSchedule.at) > now).sort((a, b) => a.gmailSchedule!.at.localeCompare(b.gmailSchedule!.at)),
    [contacts, now],
  );
  const failed = useMemo(() => contacts.filter((c) => c.gmailSchedule?.state === "failed"), [contacts]);
  const [showHow, setShowHow] = useState(false);
  if (!waiting.length && !confirmed.length && !failed.length) return null;
  const allInGmail = gmailSearchUrl(`in:scheduled (${[...waiting.map((w) => w.to), ...confirmed.map((c) => c.email)].map((e) => `to:${e}`).join(" OR ")})`);

  return (
    <section className="border-b border-line">
      <div className="flex flex-wrap items-center gap-2 bg-subtle px-4 py-2">
        <CalendarClock className="size-4 text-muted" aria-hidden="true" />
        <h3 className="text-[13px] font-semibold text-ink">
          To schedule in Gmail <span className="num font-normal text-muted">({waiting.length})</span>
        </h3>
        {confirmed.length > 0 && <span className="text-[12px] text-muted">· {confirmed.length} confirmed in Gmail</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <a href={allInGmail} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] font-medium text-brass-ink hover:bg-hover">
            <ExternalLink className="size-3.5" aria-hidden="true" /> See them in Gmail
          </a>
          <Button size="sm" variant="ghost" icon={<Bot className="size-3.5" />} onClick={() => setShowHow((v) => !v)} aria-expanded={showHow}>
            With Claude
          </Button>
          {onExtension && waiting.length > 0 && (
            <Button size="sm" variant="primary" loading={busy} icon={<CalendarClock className="size-3.5" />} onClick={onExtension} title="The Coverage extension opens each draft in your Gmail tab and uses Schedule send at its time. You can watch it; it never presses Send.">
              Schedule {waiting.length} in Gmail
            </Button>
          )}
        </div>
      </div>
      {showHow && (
        <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-2">
          In Claude (with Claude in Chrome and the Coverage connector or the Recruitify plugin), say <b>&ldquo;schedule my Coverage emails in Gmail&rdquo;</b>. Claude reads this list, shows it to you, opens each draft in Gmail and uses Schedule send at the time here. It
          never presses Send, and a row only turns &ldquo;In Gmail&rdquo; once Gmail&apos;s Scheduled folder shows it (press Sync after).
        </p>
      )}
      <ul className="divide-y divide-line border-t border-line">
        {failed.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px]">
            <Link href={`/person?id=${encodeURIComponent(c.id)}`} className="font-semibold text-brass-ink hover:underline">
              {c.name}
            </Link>
            <Badge tone="red">Not scheduled: {c.gmailSchedule?.error ?? "unknown error"}</Badge>
            <button type="button" className="ml-auto text-[12px] text-muted hover:text-ink" onClick={() => removeFromHandoff([c.id])}>
              Remove
            </button>
          </li>
        ))}
        {waiting.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px]">
            <span className="min-w-0 flex-1 basis-[200px]">
              <Link href={`/person?id=${encodeURIComponent(w.id)}`} className="font-semibold text-brass-ink hover:underline">
                {w.name}
              </Link>
              <span className="text-muted"> · {w.step === 0 ? "First email" : w.step === -1 ? "Check-in" : `Follow-up #${w.step}`}</span>
            </span>
            <span className="num whitespace-nowrap text-ink-2">{when(w.at)}</span>
            <a href={gmailDraftUrl(w.messageId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-brass-ink hover:underline">
              <ExternalLink className="size-3.5" aria-hidden="true" /> Open draft
            </a>
            <button
              type="button"
              aria-label={`Take ${w.name} off the list`}
              className="grid size-6 place-items-center rounded text-muted hover:bg-hover hover:text-ink"
              onClick={() => {
                removeFromHandoff([w.id]);
                toast.info(`${w.name} is off the list. The draft stays in Gmail.`);
              }}
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
        {confirmed.map((c) => (
          <li key={c.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px] text-muted")}>
            <span className="min-w-0 flex-1 basis-[200px]">
              <span className="font-medium text-ink-2">{c.name}</span>
            </span>
            <span className="num whitespace-nowrap">{when(c.gmailSchedule!.at)}</span>
            <span className="inline-flex items-center gap-1 text-[12px] text-green">
              <Check className="size-3.5" aria-hidden="true" /> In Gmail
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

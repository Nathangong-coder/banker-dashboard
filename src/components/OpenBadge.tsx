"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { openSummary } from "@/lib/opens";
import { contactOpenBadge, kindLabel, tzFor, whenIn } from "@/lib/trackingView";
import type { Contact } from "@/lib/types";
import { Badge } from "./ui";

/**
 * "Opened 3× · Tue 9:14 AM ET" / "Not opened yet" for a contact's latest email, only when that email was tracked.
 * Links to the email on the Email tracking page (`plain` = no link, for use inside a button).
 */
export function OpenBadge({ c, className, plain }: { c: Contact; className?: string; /** No link (inside another button). */ plain?: boolean }) {
  const messages = useStore((s) => s.tracking.messages);
  const mx = useStore((s) => s.tracking.mx);
  const b = contactOpenBadge(c, messages, mx);
  if (!b) return null;
  if (plain)
    return (
      <span title={b.title} className={className}>
        <Badge tone={b.opened ? "green" : "neutral"}>{b.text}</Badge>
      </span>
    );
  return (
    <Link href={`/tracking?id=${encodeURIComponent(b.message.id)}`} onClick={(e) => e.stopPropagation()} title={b.title} className={className}>
      <Badge tone={b.opened ? "green" : "neutral"}>{b.text}</Badge>
    </Link>
  );
}

/** The open history of every tracked email to this contact (contact window). Nothing when none was tracked. */
export function ContactOpens({ c }: { c: Contact }) {
  const messages = useStore((s) => s.tracking.messages);
  const mx = useStore((s) => s.tracking.mx);
  const mine = messages.filter((m) => m.contactId === c.id && m.sentAt).sort((a, b) => a.sentAt!.localeCompare(b.sentAt!));
  if (!mine.length) return null;
  const tz = tzFor(c);
  return (
    <div>
      <div className="mb-1 text-[12px] font-medium text-ink-2">Email opens</div>
      <ul className="space-y-1 text-[12px] text-muted">
        {mine.map((m) => {
          const s = openSummary(m, mx);
          return (
            <li key={m.id}>
              <Link href={`/tracking?id=${encodeURIComponent(m.id)}`} className="text-navy hover:underline">
                {kindLabel(m)}
              </Link>
              {" · "}
              {s.opens && s.firstAt ? `opened ${s.opens}× · first ${whenIn(s.firstAt, tz)}${s.forwarded ? " · possibly forwarded" : ""}` : "not opened yet"}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

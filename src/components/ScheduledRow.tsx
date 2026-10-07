"use client";

import { useState } from "react";
import { cancelSend, rescheduleOne } from "@/lib/serverSync";
import { recipientTz, windowLabel, windowOf } from "@/lib/sendWindow";
import { tzLabel } from "@/lib/availability";
import { useStore } from "@/lib/store";
import type { Contact } from "@/lib/types";
import { Badge, Button, Input, toast } from "./ui";

/** "2026-10-13T09:05" in this browser's zone, for <input type="datetime-local">. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * One email in Follow-ups → Scheduled. Sends queued with Coverage can be moved to any time (or cancelled); the time is
 * entered in your zone and shown in theirs. Gmail Schedule-send emails can only be changed in Gmail (no API for it).
 */
export function ScheduledRow({ c, label, onOpen }: { c: Contact; label: string; onOpen: (c: Contact) => void }) {
  const w = useStore((s) => windowOf(s.settings));
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => (c.serverSend ? localInput(new Date(c.serverSend.sendAt)) : ""));
  const [busy, setBusy] = useState(false);
  const theirTz = recipientTz(c);
  const picked = value ? new Date(value) : null;
  const theirTime = picked && !Number.isNaN(picked.getTime()) ? picked.toLocaleString("en-US", { timeZone: theirTz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
      <button onClick={() => onOpen(c)} className="min-w-[160px] flex-1 text-left hover:underline">
        {c.name} <span className="text-muted">· {c.bank}</span>
      </button>
      {c.serverSend && <Badge tone="neutral">{c.serverSend.step ? `Follow-up #${c.serverSend.step}` : "First email"} · by Coverage</Badge>}
      {editing ? (
        <span className="flex flex-wrap items-center gap-2">
          <Input type="datetime-local" className="h-8 w-auto" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`New send time for ${c.name} (your time)`} />
          {theirTime && <span className="text-[12px] text-muted">= {theirTime} {tzLabel(theirTz)} for them</span>}
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            onClick={async () => {
              if (!picked) return;
              setBusy(true);
              try {
                await rescheduleOne(c, picked);
                toast.ok(`${c.name}'s email now goes out ${theirTime} ${tzLabel(theirTz)}.`);
                setEditing(false);
              } catch (e) {
                toast.err((e as Error).message);
              }
              setBusy(false);
            }}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        <>
          <span className="num text-ink-2">{label}</span>
          {c.serverSend ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} title={`Your send window is ${windowLabel(w)}; you can pick any time here.`}>
                Change time
              </Button>
              <Button size="sm" variant="ghost" onClick={() => cancelSend(c).then(() => toast.info("Cancelled. The draft stays in Gmail."), (e: Error) => toast.err(e.message))}>
                Cancel
              </Button>
            </>
          ) : (
            <a className="text-[12px] text-navy underline" href="https://mail.google.com/mail/u/0/#scheduled" target="_blank" rel="noreferrer" title="Gmail's Schedule send can only be changed in Gmail">
              Change in Gmail
            </a>
          )}
        </>
      )}
    </li>
  );
}

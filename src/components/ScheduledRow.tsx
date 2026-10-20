"use client";

import { useState } from "react";
import { cancelSend, notBeforeOf, rescheduleOne } from "@/lib/serverSync";
import { recipientTz, windowLabel, windowOf } from "@/lib/sendWindow";
import { tzLabel } from "@/lib/availability";
import { useStore } from "@/lib/store";
import type { Contact } from "@/lib/types";
import { Clock, ExternalLink, X } from "lucide-react";
import { Badge, Button, Input, Menu, toast } from "./ui";
import { Cell, NameCell, Row, RowActions, RowCheckbox } from "./FollowupsUi";

/** "2026-10-13T09:05" in this browser's zone, for <input type="datetime-local">. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * One email in Follow-ups → Scheduled (a table row inside `ListTable`). Sends queued with Coverage can be moved to any time (or cancelled); the time is
 * entered in your zone and shown in theirs. Gmail Schedule-send emails can only be changed in Gmail (no API for it).
 */
export function ScheduledRow({ c, label, onOpen, selected, onSelect }: { c: Contact; label: string; onOpen: (c: Contact) => void; selected?: boolean; onSelect?: () => void }) {
  // Select the stored value and derive outside: windowOf returns a new object each call, which loops forever in zustand v5.
  const saved = useStore((s) => s.settings.sendWindow);
  const w = windowOf({ sendWindow: saved });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => (c.serverSend ? localInput(new Date(c.serverSend.sendAt)) : ""));
  const [busy, setBusy] = useState(false);
  const theirTz = recipientTz(c);
  const picked = value ? new Date(value) : null;
  const theirTime = picked && !Number.isNaN(picked.getTime()) ? picked.toLocaleString("en-US", { timeZone: theirTz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  return (
    <Row selected={selected}>
      {onSelect && (
        <Cell shrink>
          <RowCheckbox label={`Select ${c.name}`} checked={!!selected} onChange={onSelect} />
        </Cell>
      )}
      <Cell main>
        <NameCell name={c.name} sub={c.bank} onOpen={() => onOpen(c)} />
      </Cell>
      {editing ? (
        <td colSpan={3} className="px-3 py-2 pr-4 max-lg:block max-lg:basis-full max-lg:p-0">
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
        </td>
      ) : (
        <>
          <Cell>
            {c.serverSend ? (
              <Badge tone="blue">{c.serverSend.step ? `Follow-up #${c.serverSend.step}` : "First email"} · by Coverage</Badge>
            ) : (
              <Badge tone="neutral">Gmail Schedule send</Badge>
            )}
          </Cell>
          <Cell>
            <span className="num whitespace-nowrap text-ink-2">{label}</span>
            {c.serverSend && (
              <div className="mt-0.5">
                <SendNote c={c} />
              </div>
            )}
          </Cell>
          <Cell>
            <RowActions show={selected}>
              {c.serverSend ? (
                <>
                  <Button size="sm" variant="secondary" icon={<Clock className="size-3.5" />} onClick={() => setEditing(true)} title={`Your send window is ${windowLabel(w)}; you can pick any time here.`}>
                    Change time
                  </Button>
                  <Menu
                    label={`More for ${c.name}`}
                    items={[
                      {
                        label: "Cancel this send",
                        hint: "The draft stays in Gmail",
                        icon: <X />,
                        danger: true,
                        onClick: () => cancelSend(c).then(() => toast.info("Cancelled. The draft stays in Gmail."), (e: Error) => toast.err(e.message)),
                      },
                    ]}
                  />
                </>
              ) : (
                <a
                  className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-hover"
                  href="https://mail.google.com/mail/u/0/#scheduled"
                  target="_blank"
                  rel="noreferrer"
                  title="Gmail's Schedule send can only be changed in Gmail"
                >
                  Change in Gmail <ExternalLink className="size-3" />
                </a>
              )}
            </RowActions>
          </Cell>
        </>
      )}
    </Row>
  );
}

/** Why this send is on the day it is, and a warning when it's sooner than your follow-up spacing. */
function SendNote({ c }: { c: Contact }) {
  const nb = notBeforeOf(c);
  if (nb && new Date(c.serverSend!.sendAt) < nb)
    return (
      <span title={`Your spacing says not before ${nb.toLocaleString()}. Use "Move too-early sends" above the list.`}>
        <Badge tone="red">too soon after your last email</Badge>
      </span>
    );
  return c.serverSend?.why ? <span className="text-[11.5px] text-muted">{c.serverSend.why}</span> : null;
}

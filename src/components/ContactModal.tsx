"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { useStore } from "@/lib/store";
import { STATUS_LABEL, type Contact, type Region, type Status } from "@/lib/types";
import { fmtDate } from "@/lib/util";
import { withRegionTag } from "@/lib/workbook";
import { Button, Field, Input, Modal, Select, Textarea } from "./ui";

const toDateInput = (iso?: string) => (iso ? iso.slice(0, 10) : "");
const fromDateInput = (v: string) => (v ? new Date(`${v}T12:00:00`).toISOString() : undefined);

export function ContactModal({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  return (
    <Modal open={!!contact} onClose={onClose} title={contact?.name ?? ""} wide>
      {contact && <Editor key={contact.id} c={contact} onClose={onClose} />}
    </Modal>
  );
}

function Editor({ c, onClose }: { c: Contact; onClose: () => void }) {
  const update = useStore((s) => s.updateContact);
  const remove = useStore((s) => s.removeContacts);
  const [d, setD] = useState<Contact>(c);
  const set = <K extends keyof Contact>(k: K, v: Contact[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = () => {
    const changedStatus = d.status !== c.status;
    const now = new Date().toISOString();
    const outreach = ["sent", "followed_up"].includes(d.status);
    update(
      c.id,
      {
        ...d,
        location: d.region !== c.region ? withRegionTag(d.location, d.region) : d.location,
        sentAt: d.sentAt ?? (outreach ? now : undefined),
        lastTouchAt: d.lastTouchAt ?? (outreach ? d.sentAt ?? now : undefined),
        emailSource: d.email !== c.email ? "manual" : d.emailSource,
        repliedAt: d.repliedAt ?? (["replied", "call_scheduled"].includes(d.status) ? new Date().toISOString() : undefined),
      },
      changedStatus ? { at: new Date().toISOString(), type: "status", note: `${STATUS_LABEL[c.status]} → ${STATUS_LABEL[d.status]}` } : undefined,
    );
    onClose();
  };

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_260px]">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={d.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Bank">
          <Input value={d.bank} onChange={(e) => set("bank", e.target.value)} />
        </Field>
        <Field label="First name">
          <Input value={d.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </Field>
        <Field label="Last name">
          <Input value={d.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </Field>
        <Field label="Email" hint={c.emailSource ? `Source: ${c.emailSource}${c.emailStatus ? ` (${c.emailStatus})` : ""}` : undefined}>
          <Input value={d.email} onChange={(e) => set("email", e.target.value.trim())} />
        </Field>
        <Field label="Position">
          <Input value={d.position} onChange={(e) => set("position", e.target.value)} />
        </Field>
        <Field label="Location / team">
          <Input value={d.location} onChange={(e) => set("location", e.target.value)} />
        </Field>
        <Field label="Region">
          <Select className="w-full" value={d.region} onChange={(e) => set("region", e.target.value as Region)}>
            <option value="SF">SF / West Coast</option>
            <option value="NY">New York</option>
            <option value="Other">Other</option>
          </Select>
        </Field>
        <Field label="School">
          <Input value={d.school ?? ""} onChange={(e) => set("school", e.target.value)} />
        </Field>
        <Field label="LinkedIn">
          <div className="flex gap-1.5">
            <Input value={d.linkedin} onChange={(e) => set("linkedin", e.target.value)} />
            {d.linkedin && (
              <a href={d.linkedin} target="_blank" rel="noreferrer" className="flex items-center rounded-md border border-line-2 px-2 text-muted hover:text-ink" aria-label="Open LinkedIn">
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </Field>
        <div className="col-span-2">
          <Field label="Notes / connection">
            <Textarea rows={3} value={d.comment} onChange={(e) => set("comment", e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <Field label="Status">
          <Select className="w-full" value={d.status} onChange={(e) => set("status", e.target.value as Status)}>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="First emailed">
          <Input type="date" value={toDateInput(d.sentAt)} onChange={(e) => set("sentAt", fromDateInput(e.target.value))} />
        </Field>
        <Field label="Last touch (email or follow-up)">
          <Input type="date" value={toDateInput(d.lastTouchAt)} onChange={(e) => set("lastTouchAt", fromDateInput(e.target.value))} />
        </Field>
        <Field label="Follow-ups sent">
          <Input type="number" min={0} value={d.followUps} onChange={(e) => set("followUps", Number(e.target.value) || 0)} />
        </Field>
        <Field label="Snooze reminders until">
          <Input type="date" value={toDateInput(d.snoozeUntil)} onChange={(e) => set("snoozeUntil", fromDateInput(e.target.value))} />
        </Field>
        {c.history.length > 0 && (
          <div>
            <div className="mb-1 text-[12px] font-medium text-ink-2">History</div>
            <ul className="max-h-32 space-y-1 overflow-y-auto text-[12px] text-muted">
              {[...c.history].reverse().map((h, i) => (
                <li key={i}>
                  <span className="num">{fmtDate(h.at)}</span> · {h.note ?? h.type}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line pt-4 md:col-span-2">
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            remove([c.id]);
            onClose();
          }}
        >
          Remove from dashboard
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

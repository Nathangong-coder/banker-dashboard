"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { addManualContact, type NewContact } from "@/lib/actions";
import { allocateRow, detectRegion } from "@/lib/workbook";
import type { Region } from "@/lib/types";
import { Button, Field, Input, Modal, Select, Textarea, toast } from "./ui";
import { LocationTeamFields } from "./LocationTeam";

const EMPTY: NewContact = { name: "", bank: "", linkedin: "", email: "", position: "", location: "", team: "", region: "SF", comment: "" };

export function AddContactModal({ open, onClose, defaultBank }: { open: boolean; onClose: () => void; defaultBank?: string }) {
  return (
    <Modal open={open} onClose={onClose} title="Add a contact">
      {open && <Form onClose={onClose} defaultBank={defaultBank} />}
    </Modal>
  );
}

function Form({ onClose, defaultBank }: { onClose: () => void; defaultBank?: string }) {
  const contacts = useStore((s) => s.contacts);
  const tables = useStore((s) => s.tables);
  const hasWorkbook = useStore((s) => !!s.workbook);
  const [d, setD] = useState<NewContact>({ ...EMPTY, bank: defaultBank ?? "" });
  const [regionTouched, setRegionTouched] = useState(false);
  const [toSheet, setToSheet] = useState(hasWorkbook);
  const set = <K extends keyof NewContact>(k: K, v: NewContact[K]) => setD((x) => ({ ...x, [k]: v }));
  const banks = useMemo(() => [...new Set(contacts.map((c) => c.bank))].sort(), [contacts]);

  // Where the person will land in the spreadsheet, so it's clear before saving.
  const slot = useMemo(() => {
    if (!hasWorkbook || !d.bank.trim()) return null;
    const taken = new Set(contacts.filter((c) => c.ref).map((c) => `${c.ref!.sheet}:${c.ref!.row}`));
    return allocateRow(d.bank.trim(), tables, taken);
  }, [hasWorkbook, d.bank, contacts, tables]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const c = addManualContact(d, toSheet);
      toast.ok(
        c.ref
          ? `Added ${c.name} to row ${c.ref.row} of "${c.ref.sheet}". Save the spreadsheet to write it to the file.`
          : `Added ${c.name}.`,
      );
      onClose();
    } catch (err) {
      toast.err((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      <Field label="Name">
        <Input autoFocus required value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="First Last" />
      </Field>
      <Field label="Bank">
        <Input required list="add-contact-banks" value={d.bank} onChange={(e) => set("bank", e.target.value)} />
        <datalist id="add-contact-banks">
          {banks.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </Field>
      <div className="col-span-2">
        <Field label="LinkedIn">
          <Input value={d.linkedin} onChange={(e) => set("linkedin", e.target.value)} placeholder="https://www.linkedin.com/in/…" />
        </Field>
      </div>
      <Field label="Email" hint="Leave blank and use Enrich to find it.">
        <Input type="email" value={d.email} onChange={(e) => set("email", e.target.value)} />
      </Field>
      <Field label="Position">
        <Input value={d.position} onChange={(e) => set("position", e.target.value)} placeholder="Analyst" />
      </Field>
      <LocationTeamFields
        location={d.location}
        team={d.team}
        onLocation={(location) => {
          const guess = detectRegion(location);
          setD((x) => ({ ...x, location, region: !regionTouched && guess !== "Other" ? guess : x.region }));
        }}
        onTeam={(team) => set("team", team)}
      />
      <Field label="Region">
        <Select
          className="w-full"
          value={d.region}
          onChange={(e) => {
            setRegionTouched(true);
            set("region", e.target.value as Region);
          }}
        >
          <option value="SF">SF / West Coast</option>
          <option value="NY">New York</option>
          <option value="Other">Other</option>
        </Select>
      </Field>
      <div className="col-span-2">
        <Field label="Notes / connection">
          <Textarea rows={2} value={d.comment} onChange={(e) => set("comment", e.target.value)} />
        </Field>
      </div>
      {hasWorkbook && (
        <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-ink-2">
          <input type="checkbox" className="accent-navy" checked={toSheet} onChange={(e) => setToSheet(e.target.checked)} />
          Add to the spreadsheet
          {toSheet && slot && (
            <span className="text-muted">
              · row {slot.row} of &ldquo;{slot.sheet}&rdquo;
            </span>
          )}
        </label>
      )}
      <div className="col-span-2 flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Add contact
        </Button>
      </div>
    </form>
  );
}

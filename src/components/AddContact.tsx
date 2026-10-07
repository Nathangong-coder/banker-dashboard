"use client";

import { checkEmail, checkLinkedIn, checkName, checkText } from "@/lib/validate";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { addManualContact, type NewContact } from "@/lib/actions";
import { allocateRow, detectRegion } from "@/lib/workbook";
import { REGIONS, type CellRef, type Region } from "@/lib/types";
import { Button, Field, Input, Modal, Select, Textarea, toast } from "./ui";
import { LocationTeamFields } from "./LocationTeam";

const EMPTY: NewContact = { name: "", bank: "", linkedin: "", email: "", position: "", location: "", team: "", region: "SF", comment: "" };

export function AddContactModal({
  open,
  onClose,
  defaultBank,
  initial,
  row,
}: {
  open: boolean;
  onClose: () => void;
  defaultBank?: string;
  /** Pre-filled values (e.g. read from a spreadsheet row). */
  initial?: Partial<NewContact>;
  /** The spreadsheet row this person lives in, when turning a grid row into a contact. */
  row?: CellRef;
}) {
  return (
    <Modal open={open} onClose={onClose} title={row ? `Make row ${row.row} a contact` : "Add a contact"}>
      {open && <Form onClose={onClose} defaultBank={defaultBank} initial={initial} row={row} />}
    </Modal>
  );
}

function Form({ onClose, defaultBank, initial, row }: { onClose: () => void; defaultBank?: string; initial?: Partial<NewContact>; row?: CellRef }) {
  const contacts = useStore((s) => s.contacts);
  const tables = useStore((s) => s.tables);
  const hasWorkbook = useStore((s) => !!s.workbook);
  const [d, setD] = useState<NewContact>(() => {
    const init = { ...EMPTY, bank: defaultBank ?? "", ...initial };
    const guess = detectRegion(`${init.location} ${row?.sheet ?? ""}`);
    return { ...init, region: guess !== "Other" ? guess : init.region };
  });
  const [regionTouched, setRegionTouched] = useState(false);
  const [toSheet, setToSheet] = useState(hasWorkbook && !row);
  const set = <K extends keyof NewContact>(k: K, v: NewContact[K]) => setD((x) => ({ ...x, [k]: v }));
  const banks = useMemo(() => [...new Set(contacts.map((c) => c.bank))].sort(), [contacts]);

  // Where the person will land in the spreadsheet, so it's clear before saving.
  const slot = useMemo(() => {
    if (!hasWorkbook || !d.bank.trim()) return null;
    const taken = new Set(contacts.filter((c) => c.ref).map((c) => `${c.ref!.sheet}:${c.ref!.row}`));
    return allocateRow(d.bank.trim(), tables, taken);
  }, [hasWorkbook, d.bank, contacts, tables]);

  const [tried, setTried] = useState(false);
  const errors = {
    name: checkName(d.name),
    bank: d.bank.trim() ? checkText(d.bank, 120, "Bank") : "Enter the bank or firm.",
    email: checkEmail(d.email),
    linkedin: checkLinkedIn(d.linkedin),
    comment: checkText(d.comment, 2000, "Notes"),
  };
  // Show errors once the user has tried to save, or as soon as a filled-in field is wrong.
  const show = (k: keyof typeof errors, v: string) => (tried || v.trim() ? errors[k] : undefined);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    try {
      const c = addManualContact(d, toSheet, row);
      toast.ok(
        row
          ? `${c.name} is now a contact (row ${row.row} of "${row.sheet}"). Enrich can look up their email.`
          : c.ref
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
      <Field label="Name" error={tried ? errors.name : undefined}>
        <Input autoFocus required aria-invalid={tried && !!errors.name} value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="First Last" />
      </Field>
      <Field label="Bank" error={tried ? errors.bank : undefined}>
        <Input required aria-invalid={tried && !!errors.bank} list="add-contact-banks" value={d.bank} onChange={(e) => set("bank", e.target.value)} />
        <datalist id="add-contact-banks">
          {banks.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </Field>
      <div className="col-span-2">
        <Field label="LinkedIn" error={show("linkedin", d.linkedin)}>
          <Input inputMode="url" aria-invalid={!!show("linkedin", d.linkedin)} value={d.linkedin} onChange={(e) => set("linkedin", e.target.value)} placeholder="https://www.linkedin.com/in/…" />
        </Field>
      </div>
      <Field label="Email" hint="Leave blank and use Enrich to find it." error={show("email", d.email)}>
        <Input type="email" aria-invalid={!!show("email", d.email)} value={d.email} onChange={(e) => set("email", e.target.value)} />
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
          {REGIONS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="col-span-2">
        <Field label="Notes / connection" error={show("comment", d.comment)}>
          <Textarea rows={2} value={d.comment} onChange={(e) => set("comment", e.target.value)} />
        </Field>
      </div>
      {hasWorkbook && !row && (
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

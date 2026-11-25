"use client";

import { useMemo, useState } from "react";
import { BellPlus } from "lucide-react";
import { Button, Card, Input, toast } from "@/components/ui";
import { useStore } from "@/lib/store";
import { DAY } from "@/lib/util";
import type { Reminder } from "@/lib/thinkAbout";
import type { Contact } from "@/lib/types";

/** A dated reminder of your own ("reach out to Evercore in January"): To-do lists it when it's due, and the 9 PM text. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function setReminder(r: Reminder, id: string) {
  useStore.getState().setCoverage((cov) => ({ ...cov, reminders: { ...(cov.reminders ?? {}), [id]: r } }));
}

export function AddReminder({ contacts }: { contacts: Contact[] }) {
  const [due, setDue] = useState(() => ymd(new Date(Date.now() + 7 * DAY)));
  const [note, setNote] = useState("");
  const [who, setWho] = useState("");
  const banks = useMemo(() => [...new Set(contacts.map((c) => c.bank).filter(Boolean))].sort(), [contacts]);
  const people = useMemo(() => contacts.filter((c) => c.sentAt || c.repliedAt || c.chats?.length).map((c) => ({ label: `${c.name} (${c.bank})`, c })), [contacts]);
  return (
    <Card className="p-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          const person = people.find((p) => p.label === who)?.c;
          const bank = person?.bank ?? (who.trim() || undefined);
          const id = `man_${Date.now().toString(36)}`;
          setReminder({ id, due, note: note.trim(), bank, contactId: person?.id, createdAt: new Date().toISOString(), source: "manual" }, id);
          toast.ok(`Reminder set for ${dayDate(due)}.`);
          setNote("");
          setWho("");
        }}
      >
        <label className="grid gap-1 text-[12px] text-muted">
          What
          <span className="w-[280px] max-w-full">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reach out to Evercore about the SF office" />
          </span>
        </label>
        <label className="grid gap-1 text-[12px] text-muted">
          Bank or person (optional)
          <span className="w-[230px] max-w-full">
            <Input value={who} onChange={(e) => setWho(e.target.value)} list="think-who" placeholder="Evercore" />
          </span>
          <datalist id="think-who">
            {banks.map((b) => (
              <option key={b} value={b} />
            ))}
            {people.map((p) => (
              <option key={p.c.id} value={p.label} />
            ))}
          </datalist>
        </label>
        <label className="grid gap-1 text-[12px] text-muted">
          When
          <span className="w-[150px]">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
          </span>
        </label>
        <Button variant="primary" type="submit" icon={<BellPlus className="size-4" />} disabled={!note.trim()}>
          Add reminder
        </Button>
      </form>
    </Card>
  );
}

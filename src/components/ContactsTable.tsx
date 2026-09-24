"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ExternalLink, Search } from "lucide-react";
import { useStore } from "@/lib/store";
import { STATUS_LABEL, type Contact, type Status } from "@/lib/types";
import { cn } from "@/lib/util";
import { Badge, Card, Checkbox, Empty, Input, Select, StatusBadge } from "./ui";
import { ContactModal } from "./ContactModal";

export interface Filters {
  q: string;
  bank: string;
  region: string;
  status: string;
  email: string;
}

export function useContactFilter(contacts: Contact[], f: Filters) {
  return useMemo(() => {
    const q = f.q.toLowerCase();
    return contacts.filter(
      (c) =>
        (!q || `${c.name} ${c.bank} ${c.position} ${c.comment} ${c.email}`.toLowerCase().includes(q)) &&
        (!f.bank || c.bank === f.bank) &&
        (!f.region || c.region === f.region) &&
        (!f.status || c.status === f.status) &&
        (!f.email || (f.email === "noemail" ? !c.email : !!c.email)),
    );
  }, [contacts, f]);
}

export function FilterBar({ f, setF, contacts, extra }: { f: Filters; setF: (f: Filters) => void; contacts: Contact[]; extra?: ReactNode }) {
  const banks = useMemo(() => [...new Set(contacts.map((c) => c.bank))].sort(), [contacts]);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
      <div className="relative w-56">
        <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted" />
        <Input className="h-8 pl-8" placeholder="Search…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
      </div>
      <Select className="h-8" value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} aria-label="Bank">
        <option value="">All banks</option>
        {banks.map((b) => (
          <option key={b}>{b}</option>
        ))}
      </Select>
      <Select className="h-8" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} aria-label="Region">
        <option value="">SF + NY</option>
        <option value="SF">SF</option>
        <option value="NY">NY</option>
        <option value="Other">Other</option>
      </Select>
      <Select className="h-8" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
        <option value="">Any status</option>
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </Select>
      <Select className="h-8" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-label="Email">
        <option value="">Email: any</option>
        <option value="noemail">Missing email</option>
        <option value="has">Has email</option>
      </Select>
      <div className="flex-1" />
      {extra}
    </div>
  );
}

export function ContactsTable({
  selected,
  onSelected,
  initialFilter,
}: {
  selected: Set<string>;
  onSelected: (s: Set<string>) => void;
  initialFilter?: string;
}) {
  const contacts = useStore((s) => s.contacts);
  const [f, setF] = useState<Filters>({ q: "", bank: "", region: "", status: "", email: initialFilter === "noemail" ? "noemail" : "" });
  const [open, setOpen] = useState<Contact | null>(null);
  const rows = useContactFilter(contacts, f);
  const allSel = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <Card className="overflow-hidden">
      <FilterBar
        f={f}
        setF={setF}
        contacts={contacts}
        extra={<span className="text-[12px] text-muted">{selected.size ? `${selected.size} selected · ` : ""}{rows.length} shown</span>}
      />
      {rows.length === 0 ? (
        <Empty title="No contacts match">Try clearing filters.</Empty>
      ) : (
        <div className="max-h-[68vh] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-[#faf9f5] text-left text-[11px] uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="w-8 px-3 py-2">
                  <Checkbox
                    label="Select all"
                    checked={allSel}
                    onChange={(v) => {
                      const s = new Set(selected);
                      rows.forEach((r) => (v ? s.add(r.id) : s.delete(r.id)));
                      onSelected(s);
                    }}
                  />
                </th>
                <th className="px-2 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Bank</th>
                <th className="px-2 py-2 font-medium">Position</th>
                <th className="px-2 py-2 font-medium">Email</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id} className={cn("cursor-pointer hover:bg-[#fbfaf6]", selected.has(c.id) && "bg-blue-soft/40")} onClick={() => setOpen(c)}>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      label={`Select ${c.name}`}
                      checked={selected.has(c.id)}
                      onChange={(v) => {
                        const s = new Set(selected);
                        if (v) s.add(c.id);
                        else s.delete(c.id);
                        onSelected(s);
                      }}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5 font-medium">
                      {c.name}
                      {c.linkedin && (
                        <a href={c.linkedin} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted hover:text-blue" aria-label="LinkedIn">
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                      {c.source === "prospect" && <Badge tone="brass">new</Badge>}
                    </div>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {c.bank} <span className="text-[11px] text-muted">{c.region !== "Other" ? c.region : ""}</span>
                  </td>
                  <td className="px-2 py-2 text-ink-2">{c.position}</td>
                  <td className="px-2 py-2">
                    {c.email ? (
                      <span className={cn("num text-[12px]", c.emailSource && c.emailSource !== "sheet" && "text-green")}>{c.email}</span>
                    ) : (
                      <span className="text-[12px] text-red/80">missing</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="max-w-[280px] truncate px-2 py-2 text-[12px] text-muted" title={c.comment}>
                    {c.comment}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ContactModal contact={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

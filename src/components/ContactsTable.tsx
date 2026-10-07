"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, ExternalLink, Plus, Search, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { isVpPlus } from "@/lib/seniority";
import { REGIONS, STATUS_LABEL, type Contact, type Status } from "@/lib/types";
import { cn } from "@/lib/util";
import { teamGuess, teamOf } from "@/lib/locationTeam";
import { useFirmKinds } from "./useFirmKinds";
import { Badge, Button, Card, Checkbox, Empty, Input, Select, StatusBadge } from "./ui";
import { ContactModal } from "./ContactModal";
import { AddContactModal } from "./AddContact";

export interface Filters {
  q: string;
  bank: string;
  region: string;
  status: string;
  email: string;
  /** "" = any, NO_TEAM = team not set, else a team name. */
  team?: string;
  /** "" = any, "bank" or "pe" (private equity is tracked separately from banks). */
  firm?: "" | "bank" | "pe";
}

export const NO_TEAM = "__none";

export function useContactFilter(contacts: Contact[], f: Filters) {
  const kind = useFirmKinds();
  return useMemo(() => {
    const q = f.q.toLowerCase();
    return contacts.filter(
      (c) =>
        (!q || `${c.name} ${c.bank} ${c.position} ${c.comment} ${c.email}`.toLowerCase().includes(q)) &&
        (!f.bank || c.bank === f.bank) &&
        (!f.region || c.region === f.region) &&
        (!f.status || c.status === f.status) &&
        (!f.email || (f.email === "noemail" ? !c.email : !!c.email)) &&
        (!f.team || (f.team === NO_TEAM ? !teamOf(c) : teamOf(c).toLowerCase() === f.team.toLowerCase())) &&
        (!f.firm || kind(c.bank) === f.firm),
    );
  }, [contacts, f, kind]);
}

export function FilterBar({ f, setF, contacts, extra }: { f: Filters; setF: (f: Filters) => void; contacts: Contact[]; extra?: ReactNode }) {
  const banks = useMemo(() => [...new Set(contacts.map((c) => c.bank))].sort(), [contacts]);
  const teams = useMemo(() => [...new Set(contacts.map((c) => teamOf(c)).filter(Boolean))].sort(), [contacts]);
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
        <option value="">All regions</option>
        {REGIONS.map((x) => (
          <option key={x.id} value={x.id}>
            {x.short}
          </option>
        ))}
      </Select>
      <Select className="h-8" value={f.team ?? ""} onChange={(e) => setF({ ...f, team: e.target.value })} aria-label="Team">
        <option value="">Any team</option>
        <option value={NO_TEAM}>Team not set</option>
        {teams.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </Select>
      <Select className="h-8" value={f.firm ?? ""} onChange={(e) => setF({ ...f, firm: e.target.value as Filters["firm"] })} aria-label="Firm type">
        <option value="">Banks + PE</option>
        <option value="bank">Banks</option>
        <option value="pe">Private equity</option>
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
  initialBank,
}: {
  selected: Set<string>;
  onSelected: (s: Set<string>) => void;
  initialFilter?: string;
  initialBank?: string;
}) {
  const contacts = useStore((s) => s.contacts);
  const updateContacts = useStore((s) => s.updateContacts);
  // Teams guessed from a title / notes / headline that haven't been accepted into the sheet yet.
  const pendingHigh = useMemo(
    () =>
      contacts.flatMap((c) => {
        const g = teamGuess(c);
        return g && g.source !== "sheet" && g.source !== "manual" && g.confidence === "high" && c.teamRejected !== g.team ? [{ c, g }] : [];
      }),
    [contacts],
  );
  const [f, setF] = useState<Filters>({ q: "", bank: initialBank ?? "", region: "", status: "", email: initialFilter === "noemail" ? "noemail" : "", team: initialFilter === "noteam" ? NO_TEAM : "" });
  const [open, setOpen] = useState<Contact | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = useContactFilter(contacts, f);
  const allSel = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <Card className="overflow-hidden">
      <FilterBar
        f={f}
        setF={setF}
        contacts={contacts}
        extra={
          <>
            {pendingHigh.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                title={pendingHigh.slice(0, 8).map(({ c, g }) => `${c.name}: ${g.team} (from ${g.source}: "${g.match}")`).join("\n")}
                onClick={() =>
                  updateContacts(pendingHigh.map(({ c, g }) => ({ id: c.id, patch: { team: g.team, teamSource: g.source } })))
                }
              >
                Accept {pendingHigh.length} inferred team{pendingHigh.length > 1 ? "s" : ""}
              </Button>
            )}
            <span className="text-[12px] text-muted">{selected.size ? `${selected.size} selected · ` : ""}{rows.length} shown</span>
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
              Add contact
            </Button>
          </>
        }
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
                <th className="px-2 py-2 font-medium">Team</th>
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
                  <td className="px-2 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <TeamCell c={c} />
                  </td>
                  <td className="px-2 py-2 text-ink-2">
                    {c.position}
                    {isVpPlus(c.position || c.headline) && (
                      <span className="ml-1.5 rounded bg-red-soft px-1 py-px text-[10.5px] font-semibold text-red" title="VP or above: your rule is not to email them (or double-check first)">
                        VP+
                      </span>
                    )}
                  </td>
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
      <AddContactModal open={adding} onClose={() => setAdding(false)} defaultBank={f.bank || undefined} />
    </Card>
  );
}

/** The sheet's team, or an inferred one (italic) with accept ✓ / reject ✗. Accepting writes the Team cell like any edit. */
function TeamCell({ c }: { c: Contact }) {
  const updateContact = useStore((s) => s.updateContact);
  const g = teamGuess(c);
  if (!g) return <span className="text-[12px] text-muted">not set</span>;
  if (g.source === "sheet" || g.source === "manual") return <span className="text-[12.5px]">{g.team}</span>;
  if (c.teamRejected === g.team) return <span className="text-[12px] text-muted" title={`Rejected guess: ${g.team}`}>not set</span>;
  const from = g.source === "position" ? "title" : g.source === "comment" ? "notes" : g.source === "office" ? "the COVERAGE tab" : "LinkedIn headline";
  return (
    <span className="inline-flex items-center gap-1">
      <i className={cn("text-[12.5px]", g.confidence === "low" ? "text-muted" : "text-ink-2")} title={`Inferred from ${from}: "${g.match}"${g.confidence === "low" ? " (low confidence, not counted until accepted)" : ""}`}>
        {g.team}
        {g.confidence === "low" && "?"}
      </i>
      <button
        className="rounded p-0.5 text-green hover:bg-green-soft"
        title={`Accept ${g.team} (writes the Team cell)`}
        aria-label={`Accept team ${g.team} for ${c.name}`}
        onClick={() => updateContact(c.id, { team: g.team, teamSource: g.source })}
      >
        <Check className="size-3" />
      </button>
      <button
        className="rounded p-0.5 text-muted hover:bg-[#efede5] hover:text-red"
        title="Not their team"
        aria-label={`Reject team ${g.team} for ${c.name}`}
        onClick={() => updateContact(c.id, { teamRejected: g.team })}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, ExternalLink, Plus, Search, Trash2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { isVpPlus } from "@/lib/seniority";
import { REGIONS, STATUS_LABEL, type Contact, type Status } from "@/lib/types";
import { cn } from "@/lib/util";
import { teamGuess, teamOf } from "@/lib/locationTeam";
import { hasDashboardWork } from "@/lib/workbook";
import { useFirmKinds } from "./useFirmKinds";
import { dayLabel, lastEmailOf, nextAction } from "@/lib/followups";
import { autoMovedOn } from "@/lib/contactUpkeep";
import { Badge, Button, Card, Checkbox, Empty, Input, Modal, Select, StatusBadge, toast } from "./ui";
import { OpenBadge } from "./OpenBadge";
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
  /** "" = any, "sheet" = has a row in the spreadsheet, "none" = dashboard-only (or left over from another file). */
  where?: "" | "sheet" | "none";
}

export const NO_TEAM = "__none";
/** Status filter values beyond the statuses: about to be moved on (last follow-up sent, no reply), and moved on for no reply. */
export const MOVING_ON = "__moving";
export const MOVED_ON = "__movedon";

export function useContactFilter(contacts: Contact[], f: Filters) {
  const kind = useFirmKinds();
  const fu = useStore((s) => s.settings.followUp);
  return useMemo(() => {
    const q = f.q.toLowerCase();
    return contacts.filter(
      (c) =>
        (!q || `${c.name} ${c.bank} ${c.position} ${c.comment} ${c.email}`.toLowerCase().includes(q)) &&
        (!f.bank || c.bank === f.bank) &&
        (!f.region || c.region === f.region) &&
        (!f.status ||
          (f.status === MOVING_ON ? nextAction(c, fu).kind === "move_on" : f.status === MOVED_ON ? autoMovedOn(c) : c.status === f.status)) &&
        (!f.email || (f.email === "noemail" ? !c.email : !!c.email)) &&
        (!f.team || (f.team === NO_TEAM ? !teamOf(c) : teamOf(c).toLowerCase() === f.team.toLowerCase())) &&
        (!f.firm || kind(c.bank) === f.firm) &&
        (!f.where || (f.where === "sheet" ? !!c.ref : !c.ref)),
    );
  }, [contacts, f, kind, fu]);
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
        <option value={MOVING_ON}>Moving on (last follow-up sent)</option>
        <option value={MOVED_ON}>Moved on (no reply)</option>
      </Select>
      <Select className="h-8" value={f.where ?? ""} onChange={(e) => setF({ ...f, where: e.target.value as Filters["where"] })} aria-label="In the spreadsheet">
        <option value="">In sheet or not</option>
        <option value="sheet">In the spreadsheet</option>
        <option value="none">Not in the spreadsheet</option>
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
  const [deleting, setDeleting] = useState(false);
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
            {selected.size > 0 && (
              <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)}>
                Delete {selected.size}
              </Button>
            )}
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
            <thead className="sticky top-0 z-10 bg-subtle text-left text-[11px] uppercase tracking-wide text-muted">
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
                <th className="px-2 py-2 font-medium">First emailed</th>
                <th className="px-2 py-2 font-medium">Last emailed</th>
                <th className="px-2 py-2 font-medium">Next</th>
                <th className="px-2 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id} className={cn("cursor-pointer hover:bg-subtle", selected.has(c.id) && "bg-blue-soft/40")} onClick={() => setOpen(c)}>
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
                  <td className="px-2 py-2 whitespace-nowrap">
                    <StatusBadge status={c.status} />
                    {c.followUps > 0 && <span className="ml-1 num text-[11px] text-muted">{c.followUps}× followed up</span>}
                    <OpenBadge c={c} className="ml-1.5 inline-flex align-middle" />
                  </td>
                  <EmailDates c={c} />
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
      <DeleteContactsModal
        open={deleting}
        ids={[...selected]}
        onClose={() => setDeleting(false)}
        onDone={() => {
          setDeleting(false);
          onSelected(new Set());
        }}
      />
      <AddContactModal open={adding} onClose={() => setAdding(false)} defaultBank={f.bank || undefined} />
    </Card>
  );
}

/** First / last email and what happens next: "Follow-up #2 · Thu 10/29", "Moves on Fri 10/30", "Moved on Fri 10/23 (no reply)". */
function EmailDates({ c }: { c: Contact }) {
  const fu = useStore((s) => s.settings.followUp);
  const banks = useStore((s) => s.banks);
  const last = c.sentAt ? lastEmailOf(c) : undefined;
  const a = nextAction(c, fu, banks[`${c.bank}|${c.region}`]);
  let next: ReactNode = null;
  if (autoMovedOn(c)) next = <Badge tone="neutral">Moved on {dayLabel(c.outcome!.at)} · no reply</Badge>;
  else if (c.outcome?.confirmed) next = <span className="text-[12px] text-muted">{c.outcome.kind === "bounced" ? "Bounced" : c.outcome.kind === "left" ? "Left firm" : "Said no"}</span>;
  else if (a.kind === "move_on" && a.due) next = <Badge tone="amber">Moves on {dayLabel(a.due)}</Badge>;
  else if (a.kind === "follow_up" && a.due) next = <span className={cn("text-[12px]", a.isDue ? "font-medium text-red" : "text-ink-2")}>{a.label} · {a.isDue ? "due now" : dayLabel(a.due)}</span>;
  else if (a.kind === "scheduled" && a.due) next = <span className="text-[12px] text-ink-2">Scheduled {dayLabel(a.due)}</span>;
  else if (a.kind === "send") next = <span className="text-[12px] text-ink-2">Send draft</span>;
  else if (c.repliedAt) next = <span className="text-[12px] text-green">Replied {dayLabel(c.repliedAt)}</span>;
  return (
    <>
      <td className="num px-2 py-2 text-[12px] whitespace-nowrap text-ink-2">{c.sentAt ? dayLabel(c.sentAt) : <span className="text-muted">—</span>}</td>
      <td className="num px-2 py-2 text-[12px] whitespace-nowrap text-ink-2">{last && last !== c.sentAt ? dayLabel(last) : <span className="text-muted">—</span>}</td>
      <td className="px-2 py-2 whitespace-nowrap">{next}</td>
    </>
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
        className="rounded p-0.5 text-muted hover:bg-hover hover:text-red"
        title="Not their team"
        aria-label={`Reject team ${g.team} for ${c.name}`}
        onClick={() => updateContact(c.id, { teamRejected: g.team })}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/** Confirm a bulk delete: dashboard copies always go; spreadsheet rows too unless unticked. Ctrl+Z on the grid undoes it. */
function DeleteContactsModal({ open, ids, onClose, onDone }: { open: boolean; ids: string[]; onClose: () => void; onDone: () => void }) {
  const contacts = useStore((s) => s.contacts);
  const deleteContacts = useStore((s) => s.deleteContacts);
  const [rows, setRows] = useState(true);
  const list = useMemo(() => {
    const s = new Set(ids);
    return contacts.filter((c) => s.has(c.id));
  }, [contacts, ids]);
  const inSheet = list.filter((c) => c.ref).length;
  const withWork = list.filter(hasDashboardWork).length;
  const queued = list.filter((c) => c.serverSend || c.draft?.gmailDraftId).length;
  return (
    <Modal open={open} onClose={onClose} title={`Delete ${list.length} contact${list.length === 1 ? "" : "s"}`}>
      <div className="space-y-3 text-[13px] text-ink-2">
        <p>
          {list.slice(0, 5).map((c) => c.name).join(", ")}
          {list.length > 5 ? ` and ${list.length - 5} more` : ""} will be removed from the dashboard.
        </p>
        {inSheet > 0 && (
          <label className="flex items-start gap-2">
            <Checkbox checked={rows} onChange={setRows} label="Also delete their spreadsheet rows" />
            <span>
              Also delete their rows in the spreadsheet ({inSheet}). Rows below move up inside each table, like Delete row
              in Sheet view. Nothing is written to the file until you save.
              {!rows && " Unticked: people who are in the spreadsheet come back the next time you import it."}
            </span>
          </label>
        )}
        {withWork > 0 && <p className="text-[12.5px] text-red">{withWork} of them have outreach history (sent emails, drafts or found emails). That history is deleted too.</p>}
        {queued > 0 && <p className="text-[12.5px] text-muted">{queued} have a Gmail draft or a queued send. Queued sends are cancelled; Gmail drafts and sent mail stay in Gmail.</p>}
        <p className="text-[12px] text-muted">Changed your mind? Ctrl+Z in Sheet view undoes it (this session only).</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            onClick={() => {
              const r = deleteContacts(list.map((c) => c.id), { rows: rows && inSheet > 0 });
              toast.ok(`Deleted ${r.removed} contact${r.removed === 1 ? "" : "s"}${r.rows ? ` and ${r.rows} spreadsheet row${r.rows === 1 ? "" : "s"} (save to write it to the file)` : ""}.`);
              onDone();
            }}
          >
            Delete {list.length}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

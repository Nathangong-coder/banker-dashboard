"use client";

import { useMemo, useState } from "react";
import Link from "@/components/Link";
import { Search } from "lucide-react";
import { useStore } from "@/lib/store";
import { bestOffice, SOURCE_LABEL } from "@/lib/officeEvidence";
import { DEFAULT_TEAMS, locationForRegion, teamOf } from "@/lib/locationTeam";
import { detectRegion } from "@/lib/region";
import { chatRecords } from "@/lib/chatEvidence";
import { notThem } from "./CalendarActions";
import { REGIONS, STATUS_LABEL, type Contact, type Region, type Status } from "@/lib/types";
import { cn } from "@/lib/util";
import { Badge, Button, Card, Empty, Input, Select, toast } from "./ui";

/**
 * Corrections → People and → Chats (owner, 2026-11-23: "Corrections needs more features"). Everything Coverage
 * worked out about a person, with where it came from and a way to set it yourself: office (lib/officeEvidence.ts),
 * team, title, status, email; and every chat or calendar match that only one source supports.
 */
const now = () => new Date().toISOString();

/** Why this person is worth a look (empty = nothing looks off). */
export function personIssues(c: Contact): string[] {
  const out: string[] = [];
  const b = bestOffice(c);
  if (c.regionSource !== "manual") {
    if (b.source === "default") out.push("office guessed");
    if (b.conflict) out.push(`${SOURCE_LABEL[b.conflict.source]} says ${b.conflict.region}`);
  }
  if (!c.team && teamOf(c)) out.push("team guessed");
  if (c.mail?.otherPerson) out.push(`email looks like ${c.mail.otherPerson}'s`);
  const msgs = c.mail?.messages ?? [];
  if (msgs.some((m) => m.dir === "out") && (c.status === "new" || c.status === "drafted")) out.push("emailed, status says not sent");
  if (msgs.some((m) => m.dir === "in") && ["new", "drafted", "sent", "followed_up"].includes(c.status)) out.push("replied, status says no reply");
  return out;
}

export function PeopleTab() {
  const contacts = useStore((s) => s.contacts);
  const update = useStore((s) => s.updateContact);
  const [q, setQ] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(true);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return contacts
      .map((c) => ({ c, issues: personIssues(c) }))
      .filter(({ c, issues }) => (!onlyIssues || issues.length) && (!t || `${c.name} ${c.bank} ${c.email}`.toLowerCase().includes(t)))
      .sort((a, b) => b.issues.length - a.issues.length || a.c.bank.localeCompare(b.c.bank) || a.c.name.localeCompare(b.c.name));
  }, [contacts, q, onlyIssues]);
  const issues = useMemo(() => contacts.filter((c) => personIssues(c).length).length, [contacts]);

  const setOffice = (c: Contact, v: string) => {
    if (v === "auto") return update(c.id, { regionSource: undefined }, { at: now(), type: "note", note: "Office back to automatic" });
    const region = v as Region;
    update(c.id, { region, regionSource: "manual", location: locationForRegion(c.location, region, detectRegion) }, { at: now(), type: "note", note: `Office set to ${region} (Corrections)` });
  };
  const setField = (c: Contact, patch: Partial<Contact>, note: string) => update(c.id, patch, { at: now(), type: "note", note });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2 left-2 size-3.5 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, bank or email" className="w-64 pl-7" aria-label="Search people" />
        </div>
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <input type="checkbox" className="accent-brass-strong" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
          Only ones that need a look ({issues})
        </label>
        <span className="ml-auto text-[12px] text-muted">{rows.length} people</span>
      </div>
      {rows.length === 0 ? (
        <Empty title="Nothing looks off">Turn off the filter to see everyone.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-subtle text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Person</th>
                <th className="px-2 py-2 font-semibold">Office</th>
                <th className="px-2 py-2 font-semibold">Team</th>
                <th className="px-2 py-2 font-semibold">Title</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.slice(0, 150).map(({ c, issues }) => {
                const b = bestOffice(c);
                const guessTeam = !c.team ? teamOf(c) : "";
                return (
                  <tr key={c.id} className="align-top hover:bg-subtle">
                    <td className="px-4 py-2">
                      <Link href={`/person?id=${encodeURIComponent(c.id)}`} className="font-semibold text-ink hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-[12px] text-muted">{c.bank}</div>
                      {issues.length > 0 && <div className="mt-0.5 text-[11.5px] text-amber">{issues.join(" · ")}</div>}
                    </td>
                    <td className="px-2 py-2">
                      <Select value={c.regionSource === "manual" ? c.region : "auto"} onChange={(e) => setOffice(c, e.target.value)} aria-label={`Office for ${c.name}`} className="w-28">
                        <option value="auto">Auto: {b.region}</option>
                        {REGIONS.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                      <div className={cn("mt-0.5 text-[11.5px]", b.source === "default" ? "text-amber" : "text-muted")}>
                        {c.regionSource === "manual" ? "set by you" : `${SOURCE_LABEL[b.source]}${b.detail && b.source !== "default" ? `: ${b.detail}` : ""}`}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        defaultValue={c.team ?? ""}
                        placeholder={guessTeam ? `${guessTeam}?` : "—"}
                        list="corr-teams"
                        className="w-28"
                        aria-label={`Team for ${c.name}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (c.team ?? "")) setField(c, { team: v || undefined, teamSource: v ? "manual" : undefined }, v ? `Team set to ${v} (Corrections)` : "Team cleared (Corrections)");
                        }}
                      />
                      {guessTeam && (
                        <button type="button" className="mt-0.5 block text-[11.5px] text-brass-ink hover:underline" onClick={() => setField(c, { team: guessTeam, teamSource: "manual" }, `Team ${guessTeam} confirmed (Corrections)`)}>
                          Confirm {guessTeam}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        defaultValue={c.position ?? ""}
                        className="w-40"
                        aria-label={`Title for ${c.name}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (c.position ?? "")) setField(c, { position: v }, `Title set to ${v || "blank"} (Corrections)`);
                        }}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Select value={c.status} onChange={(e) => setField(c, { status: e.target.value as Status }, `Status set to ${STATUS_LABEL[e.target.value as Status]} (Corrections)`)} aria-label={`Status for ${c.name}`} className="w-36">
                        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        defaultValue={c.email}
                        className="w-52"
                        aria-label={`Email for ${c.name}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== c.email) setField(c, { email: v, emailSource: "manual", mail: undefined }, `Email set to ${v || "blank"} (Corrections)`);
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 150 && <p className="px-4 py-2 text-[12px] text-muted">Showing 150 of {rows.length}: search to narrow it down.</p>}
          <datalist id="corr-teams">
            {DEFAULT_TEAMS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      )}
    </Card>
  );
}

const dayDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** Every chat only one source supports, every calendar call Coverage matched, and the ones you said no to. */
export function ChatsTab() {
  const contacts = useStore((s) => s.contacts);
  const update = useStore((s) => s.updateContact);
  const list = useMemo(
    () =>
      contacts
        .flatMap((c) => chatRecords(c).map((r) => ({ c, r })))
        .filter(({ r }) => r.state === "check" || r.state === "rejected" || r.state === "likely")
        .sort((a, b) => ({ check: 0, likely: 1, rejected: 2 })[a.r.state as "check"] - ({ check: 0, likely: 1, rejected: 2 })[b.r.state as "check"] || b.r.day.localeCompare(a.r.day)),
    [contacts],
  );
  const calls = useMemo(() => contacts.filter((c) => c.call?.eventId).sort((a, b) => b.call!.at.localeCompare(a.call!.at)), [contacts]);
  const answer = (c: Contact, day: string, v: "yes" | "no" | null) => {
    const verdicts = { ...(c.chatVerdicts ?? {}) };
    if (v) verdicts[day] = v;
    else delete verdicts[day];
    update(c.id, { chatVerdicts: Object.keys(verdicts).length ? verdicts : undefined }, v ? { at: now(), type: "note", note: v === "yes" ? `You confirmed a chat on ${dayDate(day)}` : `You said there was no chat on ${dayDate(day)}` } : undefined);
  };
  const TONE = { check: "amber", likely: "blue", rejected: "neutral", confirmed: "green" } as const;
  const WORD = { check: "Only one source", likely: "Likely", rejected: "You said no", confirmed: "Confirmed" } as const;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <div className="border-b border-line px-4 py-2.5 text-[14px] font-semibold text-ink">Chats to check · {list.length}</div>
        {list.length === 0 ? (
          <Empty title="Every chat is backed by your calendar and email" />
        ) : (
          <ul className="divide-y divide-line">
            {list.map(({ c, r }) => (
              <li key={`${c.id}:${r.day}`} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink">
                    {c.name} <span className="font-normal text-muted">· {c.bank} · {dayDate(r.day)}</span>
                  </div>
                  <div className="text-[12px] text-muted">{r.why}</div>
                </div>
                <Badge tone={TONE[r.state]}>{WORD[r.state]}</Badge>
                {r.state === "rejected" ? (
                  <Button size="sm" variant="ghost" onClick={() => answer(c, r.day, null)}>
                    Undo
                  </Button>
                ) : (
                  <>
                    <Button size="sm" onClick={() => (answer(c, r.day, "yes"), toast.ok("Counted."))}>
                      Yes, we talked
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => (answer(c, r.day, "no"), toast.ok("Not counted."))}>
                      No
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <div className="border-b border-line px-4 py-2.5 text-[14px] font-semibold text-ink">Calendar calls matched to people · {calls.length}</div>
        {calls.length === 0 ? (
          <Empty title="No calendar events matched yet" />
        ) : (
          <ul className="divide-y divide-line">
            {calls.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink">
                    {c.name} <span className="font-normal text-muted">· {c.bank}</span>
                  </div>
                  <div className="text-[12px] text-muted">{new Date(c.call!.at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => (notThem(c.id), toast.ok(`That event is no longer matched to ${c.name}.`))}>
                  Not them
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

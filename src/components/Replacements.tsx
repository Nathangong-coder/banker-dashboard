"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Check, MailX, Search, UserPlus, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { canonBank } from "@/lib/banks";
import { deskLabel, deskOf } from "@/lib/desks";
import { teamOf } from "@/lib/locationTeam";
import type { Contact } from "@/lib/types";
import { relDays } from "@/lib/util";
import { Badge, Button, Card, CardHeader } from "./ui";

const enc = encodeURIComponent;
const WHY: Record<NonNullable<Contact["outcome"]>["kind"], string> = { bounced: "Email bounced", left: "Left the firm", declined: "Said no" };

/**
 * People whose outreach failed (email bounced, they left, or they said no). They get no follow-ups, and their desk
 * (bank × office × team) needs someone new: the next person you already have on that desk, or a search for one.
 * A "no" is only suggested by Gmail sync; confirm it here first.
 */
export function ReplacementsCard({ onOpen }: { onOpen: (c: Contact) => void }) {
  const contacts = useStore((s) => s.contacts);
  const updateContact = useStore((s) => s.updateContact);
  const now = new Date().toISOString();

  const { suspected, failed } = useMemo(() => {
    const open = contacts.filter((c) => c.outcome && !c.outcome.replaced);
    return { suspected: open.filter((c) => !c.outcome!.confirmed), failed: open.filter((c) => c.outcome!.confirmed) };
  }, [contacts]);

  /** Who's next on the same desk: same firm, office and team, not contacted yet, with an email first. */
  const nextFor = (c: Contact) => {
    const d = deskOf(c);
    return contacts
      .filter((x) => x.id !== c.id && x.status === "new" && canonBank(x.bank) === canonBank(c.bank) && x.region === d.region && teamOf(x) === d.team)
      .sort((a, b) => Number(!!b.email) - Number(!!a.email))[0];
  };

  if (!suspected.length && !failed.length) return null;
  return (
    <Card className="border-amber/40">
      <CardHeader
        title={`Needs a new contact · ${failed.length}${suspected.length ? ` (+${suspected.length} to confirm)` : ""}`}
        sub="Bounced emails, people who left, and clear no's: no follow-ups go to them, and their desk gets someone new."
        right={<UserPlus className="size-4 text-muted" />}
      />
      <ul className="divide-y divide-line">
        {suspected.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 bg-amber-soft/40 px-4 py-3">
            <button onClick={() => onOpen(c)} className="min-w-[220px] flex-1 text-left">
              <div className="font-medium hover:underline">
                {c.name} <span className="font-normal text-muted">· {c.bank}</span>
              </div>
              <div className="text-[12px] text-ink-2">Looks like a no: “{c.outcome!.note}”</div>
            </button>
            <div className="flex gap-1">
              <Button
                size="sm"
                icon={<Check className="size-3.5" />}
                onClick={() => updateContact(c.id, { status: "ignored", outcome: { ...c.outcome!, confirmed: true } }, { at: now, type: "status", note: "Declined (confirmed): no follow-ups; desk needs someone new" })}
              >
                Yes, it&apos;s a no
              </Button>
              <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => updateContact(c.id, { outcome: undefined }, { at: now, type: "note", note: "Not a no (kept as replied)" })}>
                Not a no
              </Button>
            </div>
          </li>
        ))}
        {failed.map((c) => {
          const next = nextFor(c);
          const d = deskOf(c);
          const desk = `${d.region !== "Other" ? d.region : c.location}|${d.team}`;
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <button onClick={() => onOpen(c)} className="min-w-[220px] flex-1 text-left">
                <div className="font-medium hover:underline">
                  {c.name} <span className="font-normal text-muted">· {c.bank} · {deskLabel(d.region, d.team)}</span>
                </div>
                <div className="text-[12px] text-muted">
                  <Badge tone="red">{WHY[c.outcome!.kind]}</Badge> {relDays(c.outcome!.at)}
                  {next ? ` · next on this desk: ${next.name}${next.email ? "" : " (needs an email)"}` : " · nobody else on this desk yet"}
                </div>
              </button>
              <div className="flex flex-wrap gap-1">
                {next ? (
                  <Link href={`/drafts?bank=${enc(c.bank)}`} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-navy px-2.5 text-[12.5px] font-medium text-white hover:bg-[#1c3259]">
                    Email {next.firstName || next.name}
                  </Link>
                ) : (
                  <Link href={`/find?banks=${enc(c.bank)}${d.team ? `&desk=${enc(desk)}` : ""}`} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-navy px-2.5 text-[12.5px] font-medium text-white hover:bg-[#1c3259]">
                    <Search className="size-3.5" /> Find a replacement
                  </Link>
                )}
                {c.outcome!.kind === "bounced" && (
                  <Button
                    size="sm"
                    icon={<MailX className="size-3.5" />}
                    title="The person is fine, the address was wrong: clear it so Enrich can look up the right one"
                    onClick={() =>
                      updateContact(
                        c.id,
                        { email: "", emailSource: undefined, emailStatus: undefined, status: "new", sentAt: undefined, lastTouchAt: undefined, followUps: 0, outcome: { ...c.outcome!, replaced: true } },
                        { at: now, type: "note", note: `Bounced address ${c.email} cleared to look up the right one` },
                      )
                    }
                  >
                    Fix their email instead
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => updateContact(c.id, { outcome: { ...c.outcome!, replaced: true } })} title="Hide from this list">
                  Done
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

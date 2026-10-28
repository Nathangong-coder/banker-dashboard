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
import { Badge, Button, Empty, Menu } from "./ui";
import { Cell, ListTable, NameCell, Row, RowActions } from "./FollowupsUi";

const enc = encodeURIComponent;
const WHY: Record<NonNullable<Contact["outcome"]>["kind"], string> = { bounced: "Email bounced", left: "Left the firm", declined: "Said no", no_reply: "No reply: moved on" };

/** Failed outreach still open: `suspected` = a reply that looks like a no (to confirm), `failed` = confirmed (desk needs someone new). */
export function replacementLists(contacts: Contact[]) {
  const open = contacts.filter((c) => c.outcome && !c.outcome.replaced);
  return { suspected: open.filter((c) => !c.outcome!.confirmed), failed: open.filter((c) => c.outcome!.confirmed) };
}

const linkBtn = "inline-flex h-7 items-center gap-1.5 rounded-lg bg-brass-strong px-2.5 text-[12.5px] font-medium whitespace-nowrap text-white hover:bg-brass-hover";

/**
 * People whose outreach failed (email bounced, they left, or they said no). They get no follow-ups, and their desk
 * (bank × office × team) needs someone new: the next person you already have on that desk, or a search for one.
 * A "no" is only suggested by Gmail sync; confirm it here first. Rows for the Follow-ups list card.
 */
export function ReplacementsTable({ onOpen }: { onOpen: (c: Contact) => void }) {
  const contacts = useStore((s) => s.contacts);
  const updateContact = useStore((s) => s.updateContact);
  const now = new Date().toISOString();

  const { suspected, failed } = useMemo(() => replacementLists(contacts), [contacts]);

  /** Who's next on the same desk: same firm, office and team, not contacted yet, with an email first. */
  const nextFor = (c: Contact) => {
    const d = deskOf(c);
    return contacts
      .filter((x) => x.id !== c.id && x.status === "new" && canonBank(x.bank) === canonBank(c.bank) && x.region === d.region && teamOf(x) === d.team)
      .sort((a, b) => Number(!!b.email) - Number(!!a.email))[0];
  };

  if (!suspected.length && !failed.length)
    return (
      <Empty icon={<UserPlus className="size-6" />} title="Nobody to replace">
        Bounced emails, people who left, and clear no&apos;s show up here so their desk gets someone new.
      </Empty>
    );
  return (
    <ListTable head={["Contact", "What happened", "Next on this desk", ""]}>
      {suspected.map((c) => (
        <Row key={c.id} tone="amber">
          <Cell main>
            <NameCell name={c.name} sub={c.bank} onOpen={() => onOpen(c)} />
          </Cell>
          <Cell>
            <Badge tone="amber">Looks like a no</Badge>
            <div className="mt-0.5 max-w-[280px] truncate text-[12px] text-ink-2" title={c.outcome!.note}>
              “{c.outcome!.note}”
            </div>
          </Cell>
          <Cell className="text-[12px] text-muted">Confirm first</Cell>
          <Cell>
            <RowActions show>
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
            </RowActions>
          </Cell>
        </Row>
      ))}
      {failed.map((c) => {
        const next = nextFor(c);
        const d = deskOf(c);
        const desk = `${d.region !== "Other" ? d.region : c.location}|${d.team}`;
        return (
          <Row key={c.id}>
            <Cell main>
              <NameCell name={c.name} sub={`${c.bank} · ${deskLabel(d.region, d.team)}`} onOpen={() => onOpen(c)} />
            </Cell>
            <Cell className="whitespace-nowrap">
              <Badge tone="red">{WHY[c.outcome!.kind]}</Badge> <span className="text-[12px] text-muted">{relDays(c.outcome!.at)}</span>
            </Cell>
            <Cell className="text-[12px] text-ink-2">{next ? `${next.name}${next.email ? "" : " (needs an email)"}` : <span className="text-muted">Nobody yet</span>}</Cell>
            <Cell>
              <RowActions>
                {next ? (
                  <Link href={`/drafts?bank=${enc(c.bank)}`} className={linkBtn}>
                    Email {next.firstName || next.name}
                  </Link>
                ) : (
                  <Link href={`/find?banks=${enc(c.bank)}${d.team ? `&desk=${enc(desk)}` : ""}`} className={linkBtn}>
                    <Search className="size-3.5" /> Find a replacement
                  </Link>
                )}
                <Menu
                  label={`More for ${c.name}`}
                  items={[
                    c.outcome!.kind === "bounced" && {
                      label: "Fix their email instead",
                      hint: "The person is fine, the address was wrong: clear it so Enrich can look up the right one",
                      icon: <MailX />,
                      onClick: () =>
                        updateContact(
                          c.id,
                          { email: "", emailSource: undefined, emailStatus: undefined, status: "new", sentAt: undefined, lastTouchAt: undefined, followUps: 0, outcome: { ...c.outcome!, replaced: true } },
                          { at: now, type: "note", note: `Bounced address ${c.email} cleared to look up the right one` },
                        ),
                    },
                    { label: "Done", hint: "Hide from this list", icon: <Check />, onClick: () => updateContact(c.id, { outcome: { ...c.outcome!, replaced: true } }) },
                  ]}
                />
              </RowActions>
            </Cell>
          </Row>
        );
      })}
    </ListTable>
  );
}

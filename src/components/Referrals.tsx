"use client";

import { useMemo, useState } from "react";
import { Check, Handshake, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { confirmSignal, dismissSignal, openSignals, referralRows } from "@/lib/referrals";
import type { Contact } from "@/lib/types";
import { relDays } from "@/lib/util";
import { Badge, Button, Empty, toast } from "./ui";
import { Cell, ListTable, NameCell, Notice, Row, RowActions } from "./FollowupsUi";

const md = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const KIND = { intro: "Intro (cc'd)", referral: "Referral", promise: "Promise" } as const;

/** How many rows Follow-ups → Referrals has (suggestions + referrals with a step left). */
export function referralCount(contacts: Contact[]) {
  return openSignals(contacts).length + referralRows(contacts).filter((r) => !r.next.startsWith("Done")).length;
}

/**
 * Follow-ups → Referrals (owner, 2026-10-22). Top: what Gmail found in bankers' replies (someone cc'd = an intro; the
 * AI read for referrals with no cc, and promises), each to confirm or dismiss. Below: every confirmed referral with the
 * next step for the person you were referred to and for the referrer.
 */
export function ReferralsTable({ onOpen }: { onOpen: (c: Contact) => void }) {
  const contacts = useStore((s) => s.contacts);
  const signals = useMemo(() => openSignals(contacts), [contacts]);
  const rows = useMemo(() => referralRows(contacts), [contacts]);
  const [busy, setBusy] = useState("");
  const [now] = useState(() => Date.now());

  const confirm = async (c: Contact, id: string) => {
    setBusy(id);
    try {
      await confirmSignal(c.id, id);
      toast.ok(`Saved: ${c.name}'s referral`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  if (!signals.length && !rows.length)
    return (
      <Empty icon={<Handshake className="size-6" />} title="No referrals yet">
        When a banker cc&apos;s a colleague or says they passed your name on, it shows up here to confirm. With Gmail read access, Coverage checks every hour.
      </Empty>
    );
  return (
    <div className="space-y-4">
      {signals.length > 0 && (
        <div>
          <Notice tone="amber">Found in Gmail: confirm the real ones. Nothing changes until you do.</Notice>
          <ListTable head={["From", "What they did", "Who", ""]} className="mt-2">
            {signals.map(({ c, s }) => (
              <Row key={s.id} tone="amber">
                <Cell main>
                  <NameCell name={c.name} sub={`${c.bank} · ${md(s.at)}`} onOpen={() => onOpen(c)} />
                </Cell>
                <Cell>
                  <Badge tone={s.kind === "promise" ? "blue" : "amber"}>{KIND[s.kind]}</Badge>
                  <div className="mt-0.5 max-w-[320px] text-[12px] text-ink-2">{s.text}</div>
                </Cell>
                <Cell className="text-[12px] text-ink-2">
                  {(s.people ?? []).map((p) => (
                    <div key={p.email ?? p.name}>
                      {p.name || p.email}
                      {p.email && p.name ? <span className="text-muted"> · {p.email}</span> : null}
                      {p.role ? <span className="text-muted"> ({p.role})</span> : null}
                    </div>
                  ))}
                  {s.youWroteAt && <div className="text-muted">You emailed them {md(s.youWroteAt)}</div>}
                </Cell>
                <Cell>
                  <RowActions show>
                    <Button size="sm" variant="primary" loading={busy === s.id} icon={<Check className="size-3.5" />} onClick={() => confirm(c, s.id)}>
                      {s.kind === "promise" ? "Got it" : "Confirm"}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => dismissSignal(c.id, s.id)}>
                      {s.kind === "promise" ? "Hide" : "Not a referral"}
                    </Button>
                  </RowActions>
                </Cell>
              </Row>
            ))}
          </ListTable>
        </div>
      )}
      {rows.length > 0 && (
        <ListTable head={["Referred by", "To", "Next step", "When"]}>
          {rows.map((r) => (
            <Row key={`${r.referrer.id}:${r.person?.id ?? r.name}`}>
              <Cell main>
                <NameCell
                  name={r.referrer.name}
                  sub={
                    <>
                      {r.referrer.bank} · {md(r.at)}
                      {r.dateGuess && <span title="The Referral? box was ticked in the sheet: this date is the latest chat or email, not the referral itself."> (date guessed)</span>}
                    </>
                  }
                  onOpen={() => onOpen(r.referrer)}
                />
              </Cell>
              <Cell className="text-[12.5px]">
                {r.person ? (
                  <button className="text-ink hover:underline" onClick={() => onOpen(r.person!)}>
                    {r.person.name}
                  </button>
                ) : (
                  <span className="text-muted">{r.name || "Not recorded"}</span>
                )}
              </Cell>
              <Cell className="text-[12.5px] text-ink-2">{r.next}</Cell>
              <Cell className="text-[12px] whitespace-nowrap text-muted">{r.due ? (Date.parse(r.due) > now ? md(r.due) : relDays(r.due)) : ""}</Cell>
            </Row>
          ))}
        </ListTable>
      )}
    </div>
  );
}

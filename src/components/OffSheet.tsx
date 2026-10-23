"use client";

import { useMemo, useState } from "react";
import { MailSearch, Plus, RefreshCw, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { addOffSheet, bankNames, ignoreOffSheet, scanOffSheet } from "@/lib/gmailSync";
import { offSheetPeople, type OffSheetPerson } from "@/lib/offSheet";
import { relDays } from "@/lib/util";
import { Badge, Button, Empty, toast } from "./ui";
import { Cell, ListTable, Notice, Row, RowActions } from "./FollowupsUi";

const md = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Bankers emailed but not in the tracker, from the stored sent-mail recipients (lib/offSheet.ts). */
export function useOffSheet() {
  const offSheet = useStore((s) => s.offSheet);
  const contacts = useStore((s) => s.contacts);
  const email = useStore((s) => s.settings.profile.email);
  const targets = useStore((s) => s.targets);
  const added = useStore((s) => s.coverage.added);
  return useMemo(
    () => offSheetPeople(offSheet.recipients, contacts, { me: [email].filter(Boolean), banks: bankNames(), ignored: offSheet.ignored }),
    // bankNames() reads targets / coverage / contacts from the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offSheet, contacts, email, targets, added],
  );
}

/**
 * Follow-ups → Not in tracker (owner, 2026-10-23): people you emailed at a bank (a thank-you right after an info
 * session, an intro you wrote to) who never got a row. "Add" puts them on the bank's tab with their Gmail dates, so
 * the usual follow-up timing applies; "Not a banker" hides them. Other company addresses are listed under the banks.
 */
export function OffSheetTable() {
  const list = useOffSheet();
  const scannedAt = useStore((s) => s.offSheet.scannedAt);
  const [busy, setBusy] = useState("");
  const [showOther, setShowOther] = useState(false);
  const [now] = useState(() => Date.now());
  const banks = list.filter((p) => p.bankDomain);
  const other = list.filter((p) => !p.bankDomain);

  const scan = async () => {
    setBusy("scan");
    try {
      const n = await scanOffSheet({ interactive: true, force: true });
      toast.ok(n ? `Found ${n} ${n === 1 ? "person" : "people"} you emailed who aren't in your tracker.` : "Everyone you've emailed at a bank is in your tracker.");
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const add = async (p: OffSheetPerson) => {
    setBusy(p.email);
    try {
      const c = await addOffSheet(p);
      toast.ok(`Added ${c.name} (${c.bank}). Follow-ups will remind you when it's time.`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const row = (p: OffSheetPerson) => {
    const days = Math.floor((now - Date.parse(p.lastAt)) / 86_400_000);
    return (
      <Row key={p.email}>
        <Cell main>
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{p.name || p.email}</div>
            <div className="truncate text-[12px] text-muted">
              {p.bank} · {p.email}
            </div>
          </div>
        </Cell>
        <Cell className="max-w-[320px] truncate text-[12.5px] text-ink-2">
          <span title={p.subject}>{p.subject || "(no subject)"}</span>
        </Cell>
        <Cell className="num text-[12px] whitespace-nowrap text-muted">
          {md(p.lastAt)}
          {p.count > 1 && ` · ${p.count} emails`}
          {days >= 7 && (
            <Badge tone="amber" className="ml-1.5">
              {days} days, no follow-up
            </Badge>
          )}
        </Cell>
        <Cell>
          <RowActions show>
            <Button size="sm" variant="brass" icon={<Plus className="size-3.5" />} loading={busy === p.email} onClick={() => add(p)}>
              Add to tracker
            </Button>
            <Button size="sm" variant="ghost" aria-label={`${p.name}: not a banker to track`} title="Not a banker to track" onClick={() => ignoreOffSheet(p.email)}>
              <X className="size-3.5" />
            </Button>
          </RowActions>
        </Cell>
      </Row>
    );
  };

  return (
    <div className="space-y-3 p-4 pt-3">
      <Notice
        icon={<MailSearch className="size-4" />}
        action={
          <Button size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" />} loading={busy === "scan"} onClick={scan}>
            Scan sent mail
          </Button>
        }
      >
        {scannedAt ? `Sent mail from the last 120 days, checked ${relDays(new Date(scannedAt))}.` : "Not checked yet: scan your sent mail (it also runs after each Gmail sync)."}
      </Notice>
      {!banks.length && !other.length ? (
        <Empty icon={<MailSearch className="size-6" />} title={scannedAt ? "Everyone you emailed is tracked" : "Scan your sent mail"}>
          Bankers you email outside the tracker (a thank-you after an info session, an intro) show up here so their follow-ups aren&apos;t missed.
        </Empty>
      ) : (
        <>
          {banks.length > 0 && <ListTable head={["Banker", "Your email", "Last emailed", ""]}>{banks.map(row)}</ListTable>}
          {other.length > 0 && (
            <div>
              <button className="text-[12.5px] font-medium text-brass-ink hover:underline" onClick={() => setShowOther((v) => !v)}>
                {showOther ? "Hide" : "Show"} {other.length} other work address{other.length === 1 ? "" : "es"} (not a bank Coverage knows)
              </button>
              {showOther && (
                <ListTable head={["Person", "Your email", "Last emailed", ""]} className="mt-2">
                  {other.map(row)}
                </ListTable>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

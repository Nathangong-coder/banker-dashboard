"use client";

import { useMemo, useState } from "react";
import { Copy, UserPlus } from "lucide-react";
import { useStore } from "@/lib/store";
import { findDuplicates, mergedPatch, type DuplicatePair } from "@/lib/duplicates";
import { addOffSheet } from "@/lib/gmailSync";
import { Button, toast } from "./ui";
import { Notice } from "./FollowupsUi";
import { useOffSheet } from "./OffSheet";

/**
 * Keep the tracker honest (owner, 2026-11-21): the same banker twice (merge), and bankers you emailed who have no row
 * (add them all). Shown at the top of Follow-ups and on Bank coverage.
 */

/** Merge `drop` into `keep`: every address, date, chat and to-do moves over; a duplicate spreadsheet row is deleted. */
export function mergeDuplicate(p: DuplicatePair) {
  const s = useStore.getState();
  const keep = s.contacts.find((c) => c.id === p.keep.id);
  const drop = s.contacts.find((c) => c.id === p.drop.id);
  if (!keep || !drop) return false;
  s.updateContact(keep.id, mergedPatch(keep, drop), { at: new Date().toISOString(), type: "note", note: `Merged with ${drop.name}${drop.ref ? ` (row ${drop.ref.row} on ${drop.ref.sheet})` : ""}: ${p.reason}` });
  // Both on the sheet: the second row is the duplicate (deleted, rows below move up; Ctrl+Z on the grid undoes it).
  // A dashboard-only copy just goes.
  s.deleteContacts([drop.id], { rows: !!drop.ref && !!keep.ref });
  return true;
}

export function DuplicatesNotice() {
  const contacts = useStore((s) => s.contacts);
  const pairs = useMemo(() => findDuplicates(contacts), [contacts]);
  const [open, setOpen] = useState(false);
  if (!pairs.length) return null;
  const certain = pairs.filter((p) => p.certain);
  const label = (p: DuplicatePair) => `${p.drop.name} → ${p.keep.name}${p.keep.bank ? ` (${p.keep.bank})` : ""}`;
  return (
    <Notice
      tone="amber"
      icon={<Copy />}
      action={
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Review"}
          </Button>
          {certain.length > 0 && (
            <Button
              size="sm"
              variant="brass"
              onClick={() => {
                let n = 0;
                for (const p of certain) if (mergeDuplicate(p)) n++;
                toast.ok(`Merged ${n} duplicate${n === 1 ? "" : "s"} (same email). Save the spreadsheet to write any rows removed.`);
              }}
            >
              Merge {certain.length} with the same email
            </Button>
          )}
        </div>
      }
    >
      <b>{pairs.length}</b> {pairs.length === 1 ? "banker is" : "bankers are"} in your tracker twice, so each copy gets its own follow-ups and half the replies:{" "}
      {pairs.slice(0, 4).map(label).join(", ")}
      {pairs.length > 4 ? ` +${pairs.length - 4} more` : ""}.
      {open && (
        <ul className="mt-2 space-y-1.5">
          {pairs.map((p) => (
            <li key={p.drop.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="font-medium text-ink">{label(p)}</span>
              <span className="text-muted">
                {p.reason}
                {p.drop.ref && p.keep.ref ? ` · removes row ${p.drop.ref.row} on ${p.drop.ref.sheet}` : ""}
                {!p.certain ? " · check it's really them" : ""}
              </span>
              <Button size="sm" variant="ghost" onClick={() => mergeDuplicate(p) && toast.ok(`Merged ${p.drop.name} into ${p.keep.name}.`)}>
                Merge
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Notice>
  );
}

/** "N bankers you emailed aren't in your tracker" with one button that adds them all (rows on their bank tabs). */
export function OffSheetNotice({ onView }: { onView?: () => void }) {
  const list = useOffSheet().filter((p) => p.bankDomain);
  const [busy, setBusy] = useState(false);
  if (!list.length) return null;
  return (
    <Notice
      tone="amber"
      icon={<UserPlus />}
      action={
        <div className="flex flex-wrap gap-1.5">
          {onView && (
            <Button size="sm" variant="secondary" onClick={onView}>
              Review
            </Button>
          )}
          <Button
            size="sm"
            variant="brass"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              let n = 0;
              for (const p of list) {
                try {
                  await addOffSheet(p);
                  n++;
                } catch {
                  /* the rest still go in */
                }
              }
              setBusy(false);
              toast.ok(`Added ${n} banker${n === 1 ? "" : "s"} to your tracker with their Gmail dates. Save the spreadsheet to write their rows.`);
            }}
          >
            Add all {list.length} to tracker
          </Button>
        </div>
      }
    >
      <b>{list.length}</b> {list.length === 1 ? "banker you emailed isn't" : "bankers you emailed aren't"} in your spreadsheet:{" "}
      {list
        .slice(0, 4)
        .map((p) => `${p.name || p.email} (${p.bank})`)
        .join(", ")}
      {list.length > 4 ? ` +${list.length - 4} more` : ""}. Add them so their follow-ups and replies are tracked.
    </Notice>
  );
}

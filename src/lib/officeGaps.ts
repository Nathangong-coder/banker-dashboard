import type { BankMeta, Contact, Settings } from "./types";
import type { ContactTable } from "./workbook";
import type { TargetBank } from "./banks";
import { buildCoverage, tierRank, type CoverageSettings } from "./coverage";
import { DESK_PRESETS } from "./desks";
import { officeSlots, officesFor, type OfficeSlot } from "./bankWork";
import { isPrivateEquity } from "./bankTabs";
import { LABELS, type DigestItem } from "./digestFormat";

/**
 * Every bank with an office that isn't maxed out (owner, 2026-10-27): fewer than the cap awaiting a reply and nobody
 * referral / live there. Same rows as /coverage (the plan's banks, not hidden, not PE), applications first, then tier.
 */
export function officeGaps(s: { contacts: Contact[]; tables: ContactTable[]; targets: TargetBank[]; coverage: CoverageSettings; banks: Record<string, BankMeta>; followUp: Settings["followUp"] }) {
  const cap = Math.max(1, s.followUp.livePerBank);
  const rows = buildCoverage(s).filter((r) => r.bucket !== "hidden" && !r.notOffered && !isPrivateEquity(r.tier));
  const out: { bank: string; applied: boolean; tier?: string; offices: OfficeSlot[] }[] = [];
  for (const r of rows) {
    const open = officeSlots(r.allContacts, officesFor(r.name, r.desks, DESK_PRESETS, r.specialty?.teams), cap).filter((o) => !o.full);
    if (open.length) out.push({ bank: r.name, applied: !!r.applied?.length, tier: r.tier, offices: open });
  }
  return out.sort((a, b) => Number(b.applied) - Number(a.applied) || tierRank(a.tier) - tierRank(b.tier) || a.bank.localeCompare(b.bank));
}

/** One 9 PM text line per bank: "Houlihan Lokey: LA 0/2, SF 1/2" (at most `max`, then "…and N more"). */
export function officeGapItems(gaps: ReturnType<typeof officeGaps>, cap: number, max = 20): DigestItem[] {
  const items = gaps.slice(0, max).map((g) => ({
    contactId: `office:${g.bank}`,
    name: `${g.bank}: ${g.offices.map((o) => `${o.office} ${o.awaiting.length}/${cap}`).join(", ")}`.slice(0, 190),
    label: LABELS.fillOffices,
  }));
  if (gaps.length > max) items.push({ contactId: "office:more", name: `…and ${gaps.length - max} more on Bank coverage`, label: LABELS.fillOffices });
  return items;
}

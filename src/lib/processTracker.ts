import type { Contact } from "./types";
import type { CoverageRow, CoverageSettings } from "./coverage";
import { canonBank } from "./banks";
import { appState, type AppJob } from "./nightProgress";
import { jobsForCycle } from "./programs";
import { STARTER_TARGETS } from "./banks";
import { BANK_DOMAINS } from "./util";
import { wasEmailed } from "./bankWork";

/**
 * Process tracker (owner, 2026-11-21): every bank you're working on, dragged between columns that follow a recruiting
 * process (Watching → Networking → Applied / HireVue → First round → Superday → Offer, or Closed). Pure.
 *
 * Where a bank sits: the column you dragged it to (`coverage.processAt`), else a guess from what's known: an
 * interview on Applications → First round, an offer → Offer, rejected / withdrawn → Closed, an application in →
 * Applied, anyone emailed → Networking, else Watching.
 */
export interface ProcessColumn {
  id: string;
  label: string;
  /** One line under the column title. */
  hint?: string;
}

export const PROCESS_COLUMNS: ProcessColumn[] = [
  { id: "watching", label: "Watching", hint: "On your list, nothing started" },
  { id: "networking", label: "Networking", hint: "Emails and chats" },
  { id: "applied", label: "Applied / HireVue", hint: "Application in, HireVue or test" },
  { id: "first", label: "First round", hint: "First-round interviews" },
  { id: "superday", label: "Superday", hint: "Final round" },
  { id: "offer", label: "Offer", hint: "Offer in hand" },
  { id: "closed", label: "Closed", hint: "Rejected, withdrew or not hiring" },
];

export const columnsOf = (c: Pick<CoverageSettings, "processColumns">) => (c.processColumns?.length ? c.processColumns : PROCESS_COLUMNS);

export interface Cycle {
  /** The summer this board is for. */
  cycle: number;
  /** The summer you're recruiting for (Summer 2028 for the class of 2029). */
  target: number;
}

/** The column a bank goes in when you haven't dragged it anywhere (only this cycle's programs count). */
export function guessColumn(row: Pick<CoverageRow, "key" | "applied" | "allContacts">, jobs: AppJob[], cyc?: Cycle): string {
  const at = jobs.filter((j) => canonBank(j.company) === row.key);
  const mine = cyc ? jobsForCycle(at, cyc.cycle, cyc.target) : at;
  if (mine.some((j) => j.status === "offer")) return "offer";
  if (mine.some((j) => j.status === "interview")) return "first";
  const app = appState(row, jobs, cyc);
  if (app === "applied") return "applied";
  if (mine.length && mine.every((j) => j.status === "rejected" || j.status === "withdrawn")) return "closed";
  // Networking is for your target summer's board (other cycles go by their programs).
  if ((!cyc || cyc.cycle === cyc.target) && row.allContacts.some((c: Contact) => wasEmailed(c) || !!c.chats?.length)) return "networking";
  return "watching";
}

/** Where a bank's column is stored: the bank's key on your target summer's board, "<summer>|<key>" on another. */
export const placeKey = (key: string, cyc?: Cycle) => (!cyc || cyc.cycle === cyc.target ? key : `${cyc.cycle}|${key}`);

/** Where a bank is: dragged (if that column still exists), else the guess. */
export function columnFor(
  row: Pick<CoverageRow, "key" | "applied" | "allContacts">,
  coverage: Pick<CoverageSettings, "processAt" | "processColumns">,
  jobs: AppJob[],
  cyc?: Cycle,
): { id: string; set: boolean } {
  const cols = columnsOf(coverage);
  const set = coverage.processAt?.[placeKey(row.key, cyc)];
  if (set && cols.some((c) => c.id === set)) return { id: set, set: true };
  const guess = guessColumn(row, jobs, cyc);
  return { id: cols.some((c) => c.id === guess) ? guess : cols[0].id, set: false };
}

/**
 * Is this firm a bank (owner, 2026-11-21: RCLCO, a real-estate consultancy, was on the Process tracker)? Your setting
 * wins; else a tier from your lists or a known bank name = bank, anything else = "other" (hidden behind a toggle).
 */
const KNOWN = new Set([...Object.keys(BANK_DOMAINS), ...STARTER_TARGETS.map((t) => t.name)].map((n) => canonBank(n)));
export function isBankFirm(row: Pick<CoverageRow, "key" | "tier">, coverage: Pick<CoverageSettings, "firmKind" | "added">): boolean {
  const set = coverage.firmKind?.[row.key];
  if (set) return set === "bank";
  if (coverage.added.some((t) => canonBank(t.name) === row.key)) return true;
  return !!row.tier || KNOWN.has(row.key);
}

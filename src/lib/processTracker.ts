import type { Contact } from "./types";
import type { CoverageRow, CoverageSettings } from "./coverage";
import type { JobApplication } from "./apply";
import { canonBank } from "./banks";
import { appState } from "./nightProgress";
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

/** The column a bank goes in when you haven't dragged it anywhere. */
export function guessColumn(row: Pick<CoverageRow, "key" | "applied" | "allContacts">, jobs: Pick<JobApplication, "company" | "status">[]): string {
  const mine = jobs.filter((j) => canonBank(j.company) === row.key);
  if (mine.some((j) => j.status === "offer")) return "offer";
  if (mine.some((j) => j.status === "interview")) return "first";
  const app = appState(row, jobs);
  if (app === "applied") return "applied";
  if (mine.length && mine.every((j) => j.status === "rejected" || j.status === "withdrawn")) return "closed";
  if (row.allContacts.some((c: Contact) => wasEmailed(c) || !!c.chats?.length)) return "networking";
  return "watching";
}

/** Where a bank is: dragged (if that column still exists), else the guess. */
export function columnFor(
  row: Pick<CoverageRow, "key" | "applied" | "allContacts">,
  coverage: Pick<CoverageSettings, "processAt" | "processColumns">,
  jobs: Pick<JobApplication, "company" | "status">[],
): { id: string; set: boolean } {
  const cols = columnsOf(coverage);
  const set = coverage.processAt?.[row.key];
  if (set && cols.some((c) => c.id === set)) return { id: set, set: true };
  const guess = guessColumn(row, jobs);
  return { id: cols.some((c) => c.id === guess) ? guess : cols[0].id, set: false };
}

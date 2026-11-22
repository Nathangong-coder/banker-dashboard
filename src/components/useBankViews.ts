"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { buildCoverage, type CoverageRow, type FirmRating } from "@/lib/coverage";
import { DESK_PRESETS } from "@/lib/desks";
import { bankUrgency, bankWork, officeSlots, officesFor, wasEmailed, type OfficeSlot } from "@/lib/bankWork";
import { bankHealth, type BankHealth } from "@/lib/bankHealth";
import { appState } from "@/lib/nightProgress";
import { columnFor, isBankFirm, placeKey, type Cycle } from "@/lib/processTracker";
import { appRowForCycle, targetSummer } from "@/lib/programs";
import { canonBank } from "@/lib/banks";
import { isPrivateEquity } from "@/lib/bankTabs";
import type { ProgressBank } from "@/lib/digestFormat";
import type { BankDetailView } from "./BankDetail";

/**
 * Every bank you're tracking with what the Process tracker and Bank coverage show for it (owner, 2026-11-21):
 * health (lib/bankHealth.ts), urgency incl. the earliest application deadline you track there, the column it sits in,
 * the application state, offices and how full they are, and the target number of contacts.
 */
export interface BankView extends BankDetailView {
  health: BankHealth;
  slots: OfficeSlot[];
  column: { id: string; set: boolean };
  app: ProgressBank["app"];
  /** Contacts you want at this bank (yours, else the cap × the offices you recruit for). */
  target: number;
  targetSet: boolean;
  emailed: number;
  starred: boolean;
  deadline?: string;
  pe: boolean;
  /** Not a bank (RCLCO): hidden behind "Other firms" unless you say it is one. */
  other: boolean;
  /** The color score shown: yours (`coverage.processColor`) when set, else the health score. */
  color: number | null;
  colorSet: boolean;
  /** This cycle has an application / program here, or you placed it on this cycle's board. */
  inCycle: boolean;
}

const NO_RATINGS: Record<string, FirmRating> = {};
const CLOSED = new Set(["rejected", "withdrawn", "offer"]);

/**
 * `scoped`: the recruiting plan's desks decide which banks are listed (Bank coverage). Unscoped: every bank on your
 * list that isn't hidden (the Process tracker: a bank never vanishes because a desk filter doesn't reach it).
 */
export function useBankViews(scoped: boolean, cycleYear?: number): { views: BankView[]; rows: CoverageRow[]; cycle: Cycle } {
  const contacts = useStore((s) => s.contacts);
  const tables = useStore((s) => s.tables);
  const targets = useStore((s) => s.targets);
  const coverage = useStore((s) => s.coverage);
  const banks = useStore((s) => s.banks);
  const followUp = useStore((s) => s.settings.followUp);
  const jobs = useStore((s) => s.apply.jobs);
  const gradDate = useStore((s) => s.apply.profile.gradDate);
  // "Now" for deadlines and live / awaiting: fixed per mount (the page re-reads it when you come back).
  const [now] = useState(() => Date.now());
  return useMemo(() => {
    const target = targetSummer(gradDate);
    const cyc: Cycle = { cycle: cycleYear ?? target, target };
    const rows = buildCoverage({ contacts, tables, targets, coverage: scoped ? coverage : { ...coverage, plan: undefined }, banks, followUp });
    const ratings = coverage.ratings ?? NO_RATINGS;
    const cap = Math.max(1, followUp.livePerBank);
    const views: BankView[] = [];
    for (const r of rows) {
      if (r.bucket === "hidden" || (scoped && r.notOffered)) continue;
      const empty = r.desks.find((d) => d.state === "empty")?.target;
      const w = bankWork({ name: r.name, contacts: r.allContacts, allContacts: contacts, banks, followUp, emptyDesk: empty, now });
      const deadline = jobs
        .filter((j) => canonBank(j.company) === r.key && !CLOSED.has(j.status) && j.deadline && Date.parse(j.deadline) >= now - 86_400_000)
        .map((j) => j.deadline!)
        .sort()[0];
      // Only this cycle's summer analyst applications count (an insight program isn't one).
      const applied = (r.applied ?? []).filter((a) => appRowForCycle(a.program, cyc.cycle, cyc.target));
      const u = bankUrgency({ tier: r.tier, applied }, w, { stars: ratings[r.key]?.stars, timeline: deadline ? { deadline } : undefined, now });
      const offices = officesFor(r.name, r.desks, DESK_PRESETS, r.specialty?.teams);
      const slots = officeSlots(r.allContacts, offices, cap, now);
      const set = coverage.processTargets?.[r.key];
      const health = bankHealth(r.allContacts);
      const mine = coverage.processColor?.[r.key];
      const column = columnFor(r, coverage, jobs, cyc);
      const app = appState(r, jobs, cyc);
      views.push({
        r,
        w,
        u,
        people: r.allContacts,
        unsorted: [],
        health,
        slots,
        column,
        app,
        target: set ?? cap * Math.max(1, offices.length),
        targetSet: set !== undefined,
        emailed: r.allContacts.filter(wasEmailed).length,
        starred: !!coverage.processStars?.[r.key],
        deadline,
        pe: isPrivateEquity(r.tier),
        other: !isBankFirm(r, coverage),
        color: mine ?? health.score,
        colorSet: mine !== undefined,
        inCycle: cyc.cycle === cyc.target || !!app || column.set || !!coverage.processAt?.[placeKey(r.key, cyc)],
      });
    }
    return { views, rows, cycle: cyc };
  }, [contacts, tables, targets, coverage, banks, followUp, jobs, gradDate, scoped, cycleYear, now]);
}

/** Star / unstar a bank ("most tracked": listed first, and in the 9 PM text's Big banks). */
export function toggleStar(key: string) {
  useStore.getState().setCoverage((c) => {
    const stars = { ...(c.processStars ?? {}) };
    if (stars[key]) delete stars[key];
    else stars[key] = true;
    return { ...c, processStars: stars };
  });
}

/** Move a bank to a Process tracker column (null = back to the automatic guess), on one cycle's board. */
export function moveToColumn(key: string, column: string | null, cyc?: Cycle) {
  const k = placeKey(key, cyc);
  useStore.getState().setCoverage((c) => {
    const at = { ...(c.processAt ?? {}) };
    if (column) at[k] = column;
    else delete at[k];
    return { ...c, processAt: at };
  });
}

/** The number of contacts you want at a bank (null = back to the default). */
export function setTarget(key: string, n: number | null) {
  useStore.getState().setCoverage((c) => {
    const t = { ...(c.processTargets ?? {}) };
    if (n === null || !Number.isFinite(n)) delete t[key];
    else t[key] = Math.max(0, Math.min(50, Math.round(n)));
    return { ...c, processTargets: t };
  });
}

/** Your own color for a bank, as a health score (null = back to automatic). */
export function setColor(key: string, score: number | null) {
  useStore.getState().setCoverage((c) => {
    const m = { ...(c.processColor ?? {}) };
    if (score === null) delete m[key];
    else m[key] = Math.max(0, Math.min(100, Math.round(score)));
    return { ...c, processColor: m };
  });
}

/** Mark a firm as a bank / not a bank (null = automatic). */
export function setFirmKind(key: string, kind: "bank" | "other" | null) {
  useStore.getState().setCoverage((c) => {
    const m = { ...(c.firmKind ?? {}) };
    if (kind === null) delete m[key];
    else m[key] = kind;
    return { ...c, firmKind: m };
  });
}

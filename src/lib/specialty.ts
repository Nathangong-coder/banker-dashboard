import { canonBank } from "./banks";

/**
 * Specialist firms: banks that only (or almost only) cover one or two industries. At these, a desk for another team
 * (SF · Tech at Leerink, NY · Generalist at Qatalyst) isn't a real gap, so it shows as "not offered" and leaves the
 * counts, unless you already have someone on it. Full-service banks have no specialty.
 *
 * Kept conservative on purpose: a wrong specialty hides real desks. The owner can change any firm on /coverage
 * (`coverage.specialty`, canonBank key → teams, or null = full-service).
 */
const BUILT_IN: [string[], string[], string][] = [
  [["Leerink Partners"], ["Healthcare"], "healthcare and life sciences only"],
  [["Cain Brothers"], ["Healthcare"], "healthcare only (part of KeyBanc)"],
  [["MTS Health Partners"], ["Healthcare"], "healthcare only"],
  [["Qatalyst Partners"], ["Tech"], "technology only"],
  [["Tidal Partners"], ["Tech"], "technology only"],
  [["Union Square Advisors"], ["Tech"], "technology only"],
  [["FT Partners", "Financial Technology Partners"], ["Tech"], "fintech only"],
  [["LionTree Partners"], ["TMT"], "media, telecom and tech"],
  [["Allen & Company"], ["TMT"], "media and tech"],
  [["Raine Group"], ["TMT"], "media, sports and tech"],
  [["Ducera Partners"], ["RX"], "restructuring / liability management"],
  [["Tudor, Pickering, Holt & Co.", "TPH&Co"], ["Energy"], "energy only"],
];

/** When this list was last checked by hand (public firm descriptions). `check:firms` warns once it's a year old. */
export const SPECIALTY_REVIEWED = "2026-10-06";
export const BUILT_IN_SPECIALTIES = BUILT_IN;

const BY_KEY = new Map<string, { teams: string[]; why: string }>();
for (const [names, teams, why] of BUILT_IN) for (const n of names) BY_KEY.set(canonBank(n), { teams, why });

export interface Specialty {
  teams: string[];
  why: string;
  source: "built-in" | "yours";
  /** Teams your own data shows here beyond the list (an application, the COVERAGE tab): they always count. */
  evidence?: { team: string; from: string }[];
}

/** A firm's specialty: your setting on /coverage first (null = full-service), else the built-in list. */
export function specialtyOf(bank: string, overrides?: Record<string, string[] | null>): Specialty | undefined {
  const key = canonBank(bank);
  if (overrides && key in overrides) {
    const t = overrides[key];
    return t?.length ? { teams: t, why: "set by you", source: "yours" } : undefined;
  }
  const b = BY_KEY.get(key);
  return b && { ...b, source: "built-in" };
}

/** Is there a built-in specialty for this firm (so "full-service" is a real override)? */
export const hasBuiltInSpecialty = (bank: string) => BY_KEY.has(canonBank(bank));

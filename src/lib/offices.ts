/**
 * Which offices a bank hires summer analysts into, and which teams recruit there.
 *
 * Source of truth: the owner's COVERAGE tab (Bank | Tier | Office | SA seats here? | Teams / groups recruiting here |
 * … | # offices/groups you can apply to | Confidence | Notes), read from the workbook snapshots. `BUILT_IN` covers banks
 * and offices the tab doesn't list (it has SF / LA / NY only, so Texas comes from here). Owner-editable.
 */
import type { SheetSnapshot } from "./types";
import { canonBank, normalizeTier } from "./banks";
import { inferTeam } from "./locationTeam";

export type Office = "SF" | "LA" | "NY" | "TX";
export const OFFICE_LABEL: Record<Office, string> = { SF: "SF", LA: "LA", NY: "NY", TX: "Texas" };

export interface OfficeInfo {
  /** true = takes summer analysts; false = doesn't (or "No / unclear" on the tab: shown as "not offered", not cold). */
  hires?: boolean;
  /** "Teams / groups recruiting here", as written. */
  teams?: string;
  confidence?: string;
  notes?: string;
}

export interface BankOffices {
  name: string;
  tier?: string;
  offices: Partial<Record<Office, OfficeInfo>>;
  /** "# offices/groups you can apply to", e.g. "1 application covering 7 US locations". */
  applyNote?: string;
}

/** SF (incl. Menlo Park / Palo Alto / Burlingame), LA (incl. Santa Monica), NY, or Texas (Houston / Dallas / Austin). */
export function officeOf(location: string): Office | undefined {
  // "San Francisco, CA" / "Houston, TX" → the city (a bare "NY" stays NY).
  const l = location.trim().toLowerCase().replace(/(?:,\s*|\s+)(ca|california|ny|tx)$/, "");
  if (/^(sf|san francisco|bay area|sf bay area|menlo park|menlo|palo alto|silicon valley|burlingame|san mateo|redwood city|mountain view|san jose)$/.test(l)) return "SF";
  if (/^(la|los angeles|century city|santa monica|beverly hills)$/.test(l)) return "LA";
  if (/^(ny|nyc|new york|new york city|manhattan)$/.test(l)) return "NY";
  if (/^(tx|texas|houston|dallas|austin)$/.test(l)) return "TX";
  return undefined;
}

/**
 * Built-in facts for what the COVERAGE tab doesn't say. Texas: banks with Houston energy groups that take summer
 * analysts there (a starting list; edit freely). Everything else defers to the tab.
 */
const BUILT_IN: Record<string, Partial<Record<Office, OfficeInfo>>> = {
  "Morgan Stanley": { LA: { hires: false }, TX: { hires: true, teams: "Energy" } },
  "Goldman Sachs": { TX: { hires: true, teams: "Energy" } },
  "JP Morgan": { TX: { hires: true, teams: "Energy" } },
  Citi: { TX: { hires: true, teams: "Energy" } },
  "Bank of America": { TX: { hires: true, teams: "Energy" } },
  Barclays: { TX: { hires: true, teams: "Energy" } },
  "Wells Fargo": { TX: { hires: true, teams: "Energy" } },
  RBC: { LA: { hires: false }, TX: { hires: true, teams: "Energy" } },
  Jefferies: { TX: { hires: true, teams: "Energy" } },
  Evercore: { TX: { hires: true, teams: "Energy" } },
  "Perella Weinberg": { TX: { hires: true, teams: "Energy (TPH)" } },
  Lazard: { TX: { hires: true, teams: "Energy" } },
  "Houlihan Lokey": { TX: { hires: true, teams: "Energy" } },
  Mizuho: { TX: { hires: true, teams: "Energy" } },
  Rothschild: { SF: { hires: false }, TX: { hires: true, teams: "Energy" } },
  "Piper Sandler": { TX: { hires: true, teams: "Energy (Simmons)" } },
  "Raymond James": { TX: { hires: true, teams: "Energy" } },
  Centerview: { LA: { hires: false } },
  Qatalyst: { LA: { hires: false } },
  Raine: { LA: { hires: false }, SF: { hires: false } },
  Truist: { SF: { hires: false } },
  Macquarie: { SF: { hires: false } },
};
const BUILT_IN_BY_KEY = new Map(Object.entries(BUILT_IN).map(([name, v]) => [canonBank(name), v]));

/* ---------------- the COVERAGE tab ---------------- */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Read every sheet that looks like the coverage map (a header row with Bank, Office and "SA seats"). */
export function readOfficeMap(snapshots: SheetSnapshot[]): Map<string, BankOffices> {
  const out = new Map<string, BankOffices>();
  for (const s of snapshots) {
    const at = (r: number, c: number) => (s.cells[`${r}:${c}`]?.v ?? "").trim();
    for (let r = 1; r <= Math.min(s.rows, 30); r++) {
      const cols = new Map<string, number>();
      for (let c = 1; c <= s.cols; c++) {
        const h = norm(at(r, c));
        if (h === "bank" || h === "firm" || h === "institution name") cols.set("bank", c);
        else if (h === "office" || h === "location") cols.set("office", c);
        else if (h === "tier") cols.set("tier", c);
        else if (/sa seats|summer analyst seats|hires/.test(h)) cols.set("hires", c);
        else if (/^teams|groups recruiting/.test(h)) cols.set("teams", c);
        else if (/offices.*apply|can apply/.test(h)) cols.set("apply", c);
        else if (h === "confidence") cols.set("confidence", c);
        else if (/^notes/.test(h)) cols.set("notes", c);
      }
      if (!cols.has("bank") || !cols.has("office") || !cols.has("hires")) continue;
      const get = (row: number, k: string) => (cols.has(k) ? at(row, cols.get(k)!) : "");
      for (let row = r + 1; row <= s.rows; row++) {
        const name = get(row, "bank");
        const office = officeOf(get(row, "office"));
        if (!name || !office) continue;
        const key = canonBank(name);
        const b = out.get(key) ?? { name, tier: normalizeTier(get(row, "tier")), offices: {} };
        const seats = get(row, "hires");
        b.offices[office] = {
          hires: /^yes/i.test(seats) ? true : /^no/i.test(seats) ? false : undefined,
          teams: get(row, "teams").replace(/^—$/, "") || undefined,
          confidence: get(row, "confidence") || undefined,
          notes: get(row, "notes") || undefined,
        };
        b.applyNote ||= get(row, "apply") || undefined;
        out.set(key, b);
      }
      break;
    }
  }
  return out;
}

// The map in use (set from the store whenever the workbook snapshots change; scripts set it after parsing).
let current = new Map<string, BankOffices>();
export function setOfficeMap(map: Map<string, BankOffices>) {
  current = map;
}
export const officeMap = () => current;

/** What's known about a bank's office: the COVERAGE tab first, then the built-in list. Undefined = no data (assume it hires). */
export function officeInfo(bank: string, location: string): OfficeInfo | undefined {
  const o = officeOf(location);
  if (!o) return undefined;
  const key = canonBank(bank);
  const info = current.get(key)?.offices[o] ?? BUILT_IN_BY_KEY.get(key)?.[o];
  // The COVERAGE tab has no Texas rows: only banks on the built-in Texas list count there.
  if (!info && o === "TX") return { hires: false, notes: "Not on the Texas energy list (src/lib/offices.ts)" };
  return info;
}

export function applyNote(bank: string): string | undefined {
  return current.get(canonBank(bank))?.applyNote;
}

/**
 * The team an office's recruiting implies, for people with no team anywhere else: one clear team ("Tech M&A
 * (firm-wide tech only)", "Generalist", "Fintech") is high confidence; a list or an "unclear" is low (shown, not counted).
 */
export function officeTeam(bank: string, location: string): { team: string; confidence: "high" | "low"; match: string } | undefined {
  const info = officeInfo(bank, location);
  if (!info?.teams || info.hires === false) return undefined;
  const pieces = info.teams.split(/;|\band\b/).map((p) => p.trim()).filter(Boolean);
  const teams = [...new Set(pieces.map((p) => inferTeam(p.replace(/\([^)]*\)/g, " "))?.team).filter((t): t is string => !!t))];
  if (!teams.length) return undefined;
  const vague = /unclear|other/i.test(info.teams) || teams.length > 1;
  return { team: teams[0], confidence: vague ? "low" : "high", match: `${bank} ${location}: ${info.teams}` };
}

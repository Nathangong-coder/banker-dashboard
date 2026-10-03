import { REGIONS, regionInfo, type Contact, type Region } from "./types";
import { canonBank } from "./banks";
import { officeInfo, officeOf, officeTeam } from "./offices";
import { normLocation, normTeam, teamOf } from "./locationTeam";
import { LIVE_STATUSES } from "./followups";

/**
 * A "desk" is one team in one office at one bank: GS · SF · Tech is a different desk from GS · NY · Tech or
 * GS · NY · Generalist. The live cap (at most N people emailed without a reply) applies per desk, and the
 * recruiting plan on the coverage page is a checklist of desks.
 */
export function deskOf(c: Contact) {
  return { region: c.region, team: teamOf(c) };
}

export function deskLabel(region: Region, team: string) {
  return [region !== "Other" ? regionInfo(region).short : "", team || "team not set"].filter(Boolean).join(" · ");
}

export function deskKey(c: Contact) {
  const d = deskOf(c);
  return `${canonBank(c.bank)}|${d.region}|${d.team.toLowerCase()}`;
}

export interface DeskLive {
  key: string;
  bank: string;
  label: string;
  live: number;
}

/** Live (drafted / emailed, no reply) people per desk. */
export function liveByDesk(contacts: Contact[]) {
  const m = new Map<string, DeskLive>();
  for (const c of contacts) {
    if (!LIVE_STATUSES.has(c.status)) continue;
    const key = deskKey(c);
    const d = deskOf(c);
    const e = m.get(key) ?? { key, bank: c.bank, label: deskLabel(d.region, d.team), live: 0 };
    e.live++;
    m.set(key, e);
  }
  return m;
}

/** Desks whose live count would exceed the cap if `adding` were drafted too (only desks those people are on). */
export function overCapDesks(contacts: Contact[], adding: Contact[], cap: number): DeskLive[] {
  const live = liveByDesk(contacts);
  const touched = new Set(adding.map(deskKey));
  for (const c of adding) {
    if (LIVE_STATUSES.has(c.status)) continue;
    const key = deskKey(c);
    const d = deskOf(c);
    const e = live.get(key) ?? { key, bank: c.bank, label: deskLabel(d.region, d.team), live: 0 };
    e.live++;
    live.set(key, e);
  }
  return [...live.values()].filter((d) => touched.has(d.key) && d.live > cap);
}

/** Who to email next at a bank: someone new on a desk with an open slot, emails first. */
export function nextUpByDesk(bankContacts: Contact[], allContacts: Contact[], cap: number) {
  const live = liveByDesk(allContacts);
  return bankContacts
    .filter((c) => c.status === "new" && (live.get(deskKey(c))?.live ?? 0) < cap)
    .sort((a, b) => Number(!!b.email) - Number(!!a.email))[0];
}

/* ---------------- recruiting plan ---------------- */

/** One line of the recruiting plan: a desk (office + team) and which firms it applies to. */
export interface DeskTarget {
  id: string;
  location: string;
  team: string;
  scope: "all" | "tiers" | "banks";
  tiers: string[];
  /** Firm names as the user picked them; matched by canonBank. */
  banks: string[];
  enabled: boolean;
}

/**
 * "Tech" also covers TMT / Technology / Green Tech; "Energy" covers power, utilities, oil & gas, natural resources;
 * "Generalist" covers M&A (the generalist pools at Moelis, Evercore NY, PJT…). Otherwise the team must match or
 * appear as a word.
 */
export function teamMatches(want: string, have?: string) {
  const w = normTeam(want).toLowerCase();
  const h = normTeam(have ?? "").toLowerCase();
  if (!w || !h) return false;
  if (h === w || h.split(/[\s/&,]+/).includes(w)) return true;
  if (w === "tech") return /\b(tmt|technology|tech)\b/.test(h);
  if (w === "energy") return /\b(energy|power|utilities|oil|gas|natural resources|renewables?)\b/.test(h);
  if (w === "generalist") return /\b(m&a|generalist)\b/.test(h);
  return false;
}

/**
 * SF, LA, NY and Chicago match the contact's region (Menlo Park counts as SF); Texas matches Houston / Dallas /
 * Austin; other offices match the location text.
 */
export function locationMatches(want: string, c: Pick<Contact, "region" | "location">) {
  const w = normLocation(want);
  if (w === "Texas") return officeOf(c.location ?? "") === "TX";
  const region = REGIONS.find((x) => x.id !== "Other" && (x.short.toLowerCase() === w.toLowerCase() || x.id === w));
  if (region) return c.region === region.id;
  return normLocation(c.location ?? "").toLowerCase() === w.toLowerCase();
}

export function targetAppliesTo(t: DeskTarget, bank: { name: string; tier?: string }) {
  // Desks (office × banking team) are an investment-bank idea: private equity firms are tracked separately.
  if (bank.tier === "Private Equity") return false;
  if (t.scope === "all") return true;
  if (t.scope === "tiers") return !!bank.tier && t.tiers.includes(bank.tier);
  const k = canonBank(bank.name);
  return t.banks.some((b) => canonBank(b) === k);
}

/** not_offered: the bank doesn't hire summer analysts into that office. not_applying: over the bank's office cap (you picked other offices). */
export type DeskState = "replied" | "emailed" | "ready" | "needs_email" | "empty" | "not_offered" | "not_applying";

export interface DeskStatus {
  target: DeskTarget;
  state: DeskState;
  people: Contact[];
  /** Contacts at this office whose team isn't set, and so might belong to this desk. */
  unsorted: number;
}

const REACHED = new Set(["sent", "followed_up", "replied", "call_scheduled", "done"]);
const REPLIED = new Set(["replied", "call_scheduled", "done"]);

/** Where one bank stands on one desk of the plan. With `bank`, an office the bank doesn't hire into is "not_offered" instead of empty. */
export function deskStatus(target: DeskTarget, bankContacts: Contact[], bank?: string): DeskStatus {
  const here = bankContacts.filter((c) => c.status !== "ignored" && locationMatches(target.location, c));
  const people = here.filter((c) => teamMatches(target.team, teamOf(c)));
  const unsorted = here.filter((c) => !teamOf(c)).length;
  let state: DeskState = "empty";
  if (people.some((c) => REPLIED.has(c.status) || c.repliedAt)) state = "replied";
  else if (people.some((c) => !!c.sentAt || REACHED.has(c.status))) state = "emailed";
  else if (people.some((c) => c.email)) state = "ready";
  else if (people.length) state = "needs_email";
  if (state === "empty" && bank) {
    // Not offered: the bank doesn't hire into this office, or the office clearly recruits one other team
    // (Moelis SF = Generalist, so no "SF · Tech" there; Qatalyst NY = Tech M&A, so no "NY · Generalist").
    const only = officeTeam(bank, target.location);
    if (officeInfo(bank, target.location)?.hires === false || (only?.confidence === "high" && !teamMatches(target.team, only.team))) state = "not_offered";
  }
  return { target, state, people, unsorted };
}

export const DESK_STATE_LABEL: Record<DeskState, string> = {
  replied: "replied",
  emailed: "emailed",
  ready: "ready to email",
  needs_email: "needs emails",
  empty: "no one yet",
  not_offered: "not offered",
  not_applying: "not applying",
};

/**
 * The owner's desks (10/2026): Tech in SF and LA, Generalist in LA and NY, Energy in Texas. One-click in the plan,
 * and the desks the insights use when none are checked. Offices a bank doesn't hire into show as "not offered".
 */
const IB_TIERS = ["Bulge Bracket", "Elite Boutique", "Middle Market", "Investment Bank"];
export const DESK_PRESETS: Omit<DeskTarget, "id" | "enabled">[] = [
  { location: "SF", team: "Tech", scope: "tiers", tiers: IB_TIERS, banks: [] },
  { location: "LA", team: "Tech", scope: "tiers", tiers: IB_TIERS, banks: [] },
  { location: "NY", team: "Generalist", scope: "tiers", tiers: IB_TIERS, banks: [] },
  { location: "LA", team: "Generalist", scope: "tiers", tiers: IB_TIERS, banks: [] },
  { location: "Texas", team: "Energy", scope: "tiers", tiers: IB_TIERS, banks: [] },
];

/** Most banks let you apply to about 2 offices; desks beyond that at one bank are "not applying". */
export const DEFAULT_OFFICES_PER_BANK = 2;

/** The office a desk targets (SF / LA / NY / TX), or its location text for anything else. */
export const deskOffice = (t: Pick<DeskTarget, "location">) => officeOf(t.location) ?? normLocation(t.location);

/**
 * Which offices to apply to at one bank when the checked desks span more than `cap`: the owner's pick if set, else
 * offices where they already emailed someone, then ones with contacts, then plan order.
 */
export function pickOffices(desks: DeskTarget[], bankContacts: Contact[], cap: number, pick?: string[]): string[] {
  const offices = [...new Set(desks.map(deskOffice))];
  if (offices.length <= cap) return offices;
  if (pick?.length) return offices.filter((o) => pick.includes(o)).slice(0, cap);
  const score = (o: string) => {
    const here = bankContacts.filter((c) => c.status !== "ignored" && desks.some((t) => deskOffice(t) === o && locationMatches(t.location, c)));
    return here.filter((c) => !!c.sentAt || REACHED.has(c.status)).length * 100 + here.length;
  };
  return offices.map((o, i) => ({ o, s: score(o), i })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, cap).map((x) => x.o);
}

/* ---------------- active scope (the desks checked in the plan) ---------------- */

/** The desks currently checked in the plan. Empty = no filter = the whole list. */
export function activeDesks(plan?: DeskTarget[]): DeskTarget[] {
  return (plan ?? []).filter((t) => t.enabled);
}

/** Does this contact sit on at least one of these desks (office + team)? */
export function inScope(c: Contact, desks: DeskTarget[]): boolean {
  return desks.some((t) => locationMatches(t.location, c) && teamMatches(t.team, teamOf(c)));
}

/** Does at least one of these desks apply to this bank (all banks / its tier / picked by name)? */
export function bankInScope(bank: { name: string; tier?: string }, desks: DeskTarget[]): boolean {
  return desks.some((t) => targetAppliesTo(t, bank));
}

export const targetLabel = (t: Pick<DeskTarget, "location" | "team">) => `${t.location} · ${t.team}`;

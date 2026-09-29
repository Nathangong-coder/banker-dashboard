import { REGIONS, regionInfo, type Contact, type Region } from "./types";
import { canonBank } from "./banks";
import { normLocation, normTeam } from "./locationTeam";
import { LIVE_STATUSES } from "./followups";

/**
 * A "desk" is one team in one office at one bank: GS · SF · Tech is a different desk from GS · NY · Tech or
 * GS · NY · Generalist. The live cap (at most N people emailed without a reply) applies per desk, and the
 * recruiting plan on the coverage page is a checklist of desks.
 */
export function deskOf(c: Pick<Contact, "region" | "team">) {
  return { region: c.region, team: c.team ? normTeam(c.team) : "" };
}

export function deskLabel(region: Region, team: string) {
  return [region !== "Other" ? regionInfo(region).short : "", team || "team not set"].filter(Boolean).join(" · ");
}

export function deskKey(c: Pick<Contact, "bank" | "region" | "team">) {
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

/** "Tech" also covers TMT / Technology / Green Tech; otherwise the team must match or appear as a word. */
export function teamMatches(want: string, have?: string) {
  const w = normTeam(want).toLowerCase();
  const h = normTeam(have ?? "").toLowerCase();
  if (!w || !h) return false;
  if (h === w || h.split(/[\s/&,]+/).includes(w)) return true;
  return w === "tech" && /\b(tmt|technology|tech)\b/.test(h);
}

/** SF, LA, NY and Chicago match the contact's region (Menlo Park counts as SF); other offices match the location text. */
export function locationMatches(want: string, c: Pick<Contact, "region" | "location">) {
  const w = normLocation(want);
  const region = REGIONS.find((x) => x.id !== "Other" && (x.short.toLowerCase() === w.toLowerCase() || x.id === w));
  if (region) return c.region === region.id;
  return normLocation(c.location ?? "").toLowerCase() === w.toLowerCase();
}

export function targetAppliesTo(t: DeskTarget, bank: { name: string; tier?: string }) {
  if (t.scope === "all") return true;
  if (t.scope === "tiers") return !!bank.tier && t.tiers.includes(bank.tier);
  const k = canonBank(bank.name);
  return t.banks.some((b) => canonBank(b) === k);
}

export type DeskState = "replied" | "emailed" | "ready" | "needs_email" | "empty";

export interface DeskStatus {
  target: DeskTarget;
  state: DeskState;
  people: Contact[];
  /** Contacts at this office whose team isn't set, and so might belong to this desk. */
  unsorted: number;
}

const REACHED = new Set(["sent", "followed_up", "replied", "call_scheduled", "done"]);
const REPLIED = new Set(["replied", "call_scheduled", "done"]);

/** Where one bank stands on one desk of the plan. */
export function deskStatus(target: DeskTarget, bankContacts: Contact[]): DeskStatus {
  const here = bankContacts.filter((c) => c.status !== "ignored" && locationMatches(target.location, c));
  const people = here.filter((c) => teamMatches(target.team, c.team));
  const unsorted = here.filter((c) => !c.team).length;
  let state: DeskState = "empty";
  if (people.some((c) => REPLIED.has(c.status) || c.repliedAt)) state = "replied";
  else if (people.some((c) => !!c.sentAt || REACHED.has(c.status))) state = "emailed";
  else if (people.some((c) => c.email)) state = "ready";
  else if (people.length) state = "needs_email";
  return { target, state, people, unsorted };
}

export const DESK_STATE_LABEL: Record<DeskState, string> = {
  replied: "replied",
  emailed: "emailed",
  ready: "ready to email",
  needs_email: "needs emails",
  empty: "no one yet",
};

export const targetLabel = (t: Pick<DeskTarget, "location" | "team">) => `${t.location} · ${t.team}`;

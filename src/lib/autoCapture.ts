"use client";

import { useStore } from "./store";
import { callApi } from "./api";
import { addProspects, enrichContacts } from "./actions";
import { aiReady, hasKey } from "./keys";
import { canonBank } from "./banks";
import { guessBank } from "./linkedinCapture";
import { reconcileTitle } from "./titles";
import { rulesOf, seniorSkipReason } from "./outreach";
import { chunk, linkedinSlug } from "./util";
import type { Contact, Prospect, Region } from "./types";

/**
 * "Add to tracker + find email" from the extension (owner, 2026-10-24): a LinkedIn profile or search you clicked
 * Send on goes straight into the tracker (new people) or onto the existing contact (people you have), then their
 * emails are looked up, with no review step. Nothing here touches LinkedIn: it only uses the page you sent.
 */

export type Verdict = {
  id: string;
  verdict: "match" | "maybe" | "no";
  score: number;
  firstName: string;
  lastName: string;
  position: string;
  team: string;
  school: string;
  location: string;
  region: Region;
  reasons: string;
  employer?: string;
};

/** Was the capture sent with "Add … + find email" (the payload's `auto` flag)? */
export function captureAuto(hash: string): boolean {
  try {
    return (JSON.parse(decodeURIComponent(hash.replace(/^#?li=/, ""))) as { auto?: unknown }).auto === true;
  } catch {
    return false;
  }
}

/** A prospect with the AI screen's reading applied (shared with Find people). */
export function withVerdict(p: Prospect, v: Verdict, bankUniverse: string[]): Prospect {
  return {
    ...p,
    verdict: v.verdict,
    score: v.score,
    firstName: v.firstName || p.firstName,
    lastName: v.lastName || p.lastName,
    // The LinkedIn headline says the current title; the AI sometimes picks an old one from the snippet.
    position: reconcileTitle(p.title, v.position),
    team: v.team,
    school: v.school,
    location: v.location,
    region: v.region,
    reasons: v.reasons,
    bank: p.bank === "Unknown" && v.employer ? (guessBank(v.employer, bankUniverse) ?? v.employer) : p.bank,
  };
}

export async function screenProspects(list: Prospect[], bankUniverse: string[]): Promise<Prospect[]> {
  const st = useStore.getState();
  const byId = new Map(list.map((p) => [p.id, p]));
  for (const b of chunk(list, 15)) {
    const { results } = await callApi<{ results: Verdict[] }>(
      "/api/prospect/filter",
      { criteria: st.settings.prospect.criteria, candidates: b.map(({ id, name, bank, title, snippet }) => ({ id, name, bank, title, snippet })) },
      st.settings,
    );
    for (const v of results) {
      const p = byId.get(v.id);
      if (p) byId.set(v.id, withVerdict(p, v, bankUniverse));
    }
  }
  return [...byId.values()];
}

export const bankUniverseOf = () => {
  const st = useStore.getState();
  return [...new Map([...st.contacts.map((c) => c.bank), ...st.targets.map((t) => t.name)].map((n) => [canonBank(n), n])).values()];
};

const existingFor = (p: Prospect, contacts: Contact[]) => {
  const slug = linkedinSlug(p.linkedin);
  return (
    (slug ? contacts.find((c) => c.linkedin && linkedinSlug(c.linkedin) === slug) : undefined) ??
    contacts.find((c) => c.name.toLowerCase().trim() === p.name.toLowerCase().trim() && p.bank !== "Unknown" && canonBank(c.bank) === canonBank(p.bank))
  );
};

export interface AutoResult {
  added: Contact[];
  merged: Contact[];
  /** Not added, and why (search captures only; a profile you sent is always added). */
  skipped: { name: string; why: string }[];
  /** The people not added, with the AI screen's verdicts, to leave on Find people. */
  rest: Prospect[];
  emails: { found: number; attempted: number } | null;
  /** The (first) contact the capture is about, for opening it. */
  contactId?: string;
}

/**
 * Add or update the captured people, then look up emails for anyone without one. `single`: a profile page you sent
 * (always added, its full text kept as `contact.profile`). A search: only people the AI screen calls a match, at a
 * known firm and not senior (your MD rule) are added; the rest stay on Find people for you to review.
 */
export async function autoAdd(people: Prospect[], opts: { single: boolean }): Promise<AutoResult> {
  const st = useStore.getState();
  const universe = bankUniverseOf();
  const at = new Date().toISOString();
  const res: AutoResult = { added: [], merged: [], skipped: [], rest: [], emails: null };

  // People you already have: attach what the page showed, never touch status, email or dates.
  const fresh: Prospect[] = [];
  for (const p of people) {
    const c = existingFor(p, st.contacts);
    if (!c) {
      fresh.push(p);
      continue;
    }
    st.updateContact(c.id, {
      linkedin: c.linkedin || p.linkedin,
      headline: c.headline || p.title,
      ...(opts.single ? { profile: { text: p.snippet, source: "linkedin" as const, capturedAt: at } } : {}),
    });
    res.merged.push(c);
  }

  let screened = fresh;
  if (fresh.length && aiReady(st.settings)) {
    try {
      screened = await screenProspects(fresh, universe);
    } catch {
      // Screening is a nicety for a single profile; a search without it can't tell who's a banker.
      if (!opts.single) throw new Error("The AI screen failed, so nobody was added. Try again, or review them on Find people.");
    }
  } else if (fresh.length && !opts.single) {
    throw new Error("Adding a whole search automatically needs an AI key (Settings → Data) to pick out the bankers. Review them on Find people instead.");
  }

  // A profile whose firm can't be read (no AI key, a firm not on your lists) isn't added as "Unknown": you pick the firm.
  if (opts.single && screened.length && screened[0].bank === "Unknown")
    throw new Error(`Couldn't tell which firm ${screened[0].name} is at${aiReady(st.settings) ? "" : " (an AI key in Settings → Data reads it from the profile)"}. Add them below.`);
  const rules = rulesOf(st.settings);
  const toAdd = screened.filter((p) => {
    if (opts.single) return true;
    if (p.verdict !== "match") return void res.skipped.push({ name: p.name, why: p.verdict === "no" ? "doesn't match your criteria" : "maybe: review on Find people" });
    if (p.bank === "Unknown") return void res.skipped.push({ name: p.name, why: "couldn't tell the firm" });
    const senior = seniorSkipReason({ position: p.position || p.title, headline: p.title, school: p.school, comment: p.snippet, location: p.location ?? "", profile: undefined }, rules);
    if (senior) return void res.skipped.push({ name: p.name, why: senior });
    return true;
  });
  res.rest = screened.filter((p) => !toAdd.includes(p));
  if (toAdd.length) {
    res.added = addProspects(toAdd, !!st.workbook);
    if (opts.single)
      for (const c of res.added) useStore.getState().updateContact(c.id, { profile: { text: toAdd[0].snippet, source: "linkedin", capturedAt: at } });
  }

  const all = [...res.added, ...res.merged];
  res.contactId = all[0]?.id;
  const needEmail = useStore.getState().contacts.filter((c) => all.some((x) => x.id === c.id) && !c.email);
  if (needEmail.length && (hasKey(st.settings, "apollo") || hasKey(st.settings, "hunter"))) res.emails = await enrichContacts(needEmail.map((c) => c.id));
  return res;
}

/** One line for the toast: who was added / updated, and what the email lookup found. */
export function autoSummary(r: AutoResult, opts: { single: boolean }): string {
  const st = useStore.getState();
  const byId = (id: string) => st.contacts.find((c) => c.id === id);
  if (opts.single) {
    const c = r.contactId ? byId(r.contactId) : undefined;
    if (!c) return "Couldn't add them.";
    const what = r.added.length ? `Added ${c.name} (${[c.position, c.bank].filter(Boolean).join(", ")})` : `Updated ${c.name}, already in your tracker`;
    const email = c.email ? `email: ${c.email}` : r.emails ? "no email found (Apollo / Hunter came up empty)" : hasKey(st.settings, "apollo") || hasKey(st.settings, "hunter") ? "" : "add an Apollo or Hunter key to look up emails";
    return [what, email].filter(Boolean).join(" · ");
  }
  return [
    `Added ${r.added.length}`,
    r.merged.length ? `updated ${r.merged.length} you already had` : "",
    r.emails ? `found ${r.emails.found} of ${r.emails.attempted} emails` : "",
    r.skipped.length ? `${r.skipped.length} left on Find people for you` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

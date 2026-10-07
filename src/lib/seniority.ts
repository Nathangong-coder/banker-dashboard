import { seniorException, type OutreachRules } from "./outreach";
import type { Contact } from "./types";

/**
 * VP and above: Vice President, Director, Executive Director, Principal, Managing Director, Head, Partner, Chair.
 * The owner's rule (10/2026): don't email them, or at least warn hard. Their senior-exception ties (Settings → Outreach
 * rules: your school, hometown…) soften the warning but never hide it. Looks at the current role only ("former VP",
 * "ex-MD" don't count).
 */
const VP_PLUS = /\b(senior vice president|executive vice president|vice president|svp|evp|vp|executive director|managing director|associate director|director|principal|co-head|global head|group head|head|partner|chairman|vice chair(?:man)?|chair|md|ed)\b/gi;
const FORMER = /\b(former|formerly|ex|previously|incoming|prior)\b[\s-]*(?:\w+\s){0,3}$/i;
// Words that look senior but aren't a rank ("Head of Recruiting" is still a head; "Director's Office" is rare enough).
const NOT_RANK = /\b(md&a|ed tech|edtech)\b/i;

export function isVpPlus(title: string | undefined): boolean {
  if (!title || NOT_RANK.test(title)) return false;
  return [...title.matchAll(VP_PLUS)].some((m) => {
    // "MD" / "ED" / "VP" only as capitals (not "md" in an email, "ed" in "edited").
    if (/^(md|ed|vp|svp|evp)$/i.test(m[0]) && m[0] !== m[0].toUpperCase()) return false;
    return !FORMER.test(title.slice(Math.max(0, (m.index ?? 0) - 40), m.index));
  });
}

export interface SeniorWarning {
  /** The title that triggered it. */
  title: string;
  /** One of your senior-exception ties applies (still warned, but softer). */
  tie?: string;
  text: string;
}

export function vpPlusWarning(c: Pick<Contact, "position" | "headline" | "school" | "comment" | "profile" | "location">, rules?: OutreachRules): SeniorWarning | undefined {
  const title = c.position || c.headline;
  if (!isVpPlus(title)) return undefined;
  const tie = seniorException(c, rules);
  return {
    title: title!,
    tie,
    text: tie ? `VP or above (${title}); allowed by your ${tie} exception, but double-check` : `VP or above (${title}). Your rule: don't email VP+`,
  };
}

/**
 * Banking titles. LinkedIn headlines and search snippets mix the current role with old ones ("Associate at Evercore |
 * Former Analyst at Moelis"), and an AI reading the whole snippet sometimes picks the old title. The headline's first
 * seniority word, skipping "former / ex- / previously / incoming", is the current title.
 */
const LEVELS: [RegExp, string][] = [
  [/\bsummer (?:investment banking |ib )?analyst\b|\bsummer associate\b|\bintern(?:ship)?\b/i, "Summer Analyst"],
  // Full phrases in any case; the abbreviations only in capitals, so "md" / "vp" inside ordinary text don't count.
  [/\bmanaging director\b/i, "Managing Director"],
  [/\bMD\b/, "Managing Director"],
  [/\bsenior vice president\b/i, "Senior Vice President"],
  [/\bSVP\b/, "Senior Vice President"],
  [/\bexecutive director\b/i, "Executive Director"],
  [/\bassociate director\b/i, "Associate Director"],
  [/\bvice president\b/i, "Vice President"],
  [/\bVP\b/, "Vice President"],
  [/\bdirector\b/i, "Director"],
  [/\bprincipal\b/i, "Principal"],
  [/\bpartner\b/i, "Partner"],
  [/\bsenior associate\b/i, "Senior Associate"],
  [/\bassociate\b/i, "Associate"],
  [/\bsenior analyst\b/i, "Senior Analyst"],
  [/\banalyst\b/i, "Analyst"],
];

const NOT_CURRENT = /\b(former|formerly|ex|previously|prev|past|incoming|future|aspiring|seeking|prior)\b[\s-]*(?:\w+\s){0,3}$/i;

/** The current seniority in a headline/title, or undefined if it doesn't say. */
export function currentTitle(text: string | undefined): string | undefined {
  if (!text) return undefined;
  let best: { at: number; len: number; title: string } | undefined;
  for (const [re, title] of LEVELS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(g)) {
      const at = m.index ?? 0;
      if (NOT_CURRENT.test(text.slice(Math.max(0, at - 40), at))) continue;
      // Earliest wins; at the same spot the longer phrase wins ("Senior Associate" over "Associate").
      if (!best || at < best.at || (at === best.at && m[0].length > best.len)) best = { at, len: m[0].length, title };
      break;
    }
  }
  return best?.title;
}

/** Same seniority? ("Investment Banking Associate" and "Associate" are the same; "Analyst" and "Associate" aren't.) */
export function sameLevel(a: string | undefined, b: string | undefined) {
  const x = currentTitle(a);
  const y = currentTitle(b);
  return !x || !y || x === y;
}

/**
 * Pick the position to store for someone found online: the headline's current title wins over an AI guess when the
 * two disagree on seniority; otherwise keep the more descriptive text.
 */
export function reconcileTitle(headline: string | undefined, aiPosition: string | undefined): string {
  const fromHeadline = currentTitle(headline);
  if (fromHeadline && !sameLevel(fromHeadline, aiPosition)) return fromHeadline;
  return aiPosition?.trim() || fromHeadline || "";
}

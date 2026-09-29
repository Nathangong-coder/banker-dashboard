import type { Contact, EmailBase, RequiredFact, Settings, Template } from "./types";
import { ORIGINAL_BASE } from "./defaults";

export const PLACEHOLDERS: { key: string; desc: string }[] = [
  { key: "first_name", desc: "Contact first name" },
  { key: "last_name", desc: "Contact last name" },
  { key: "full_name", desc: "Contact full name" },
  { key: "bank", desc: "Contact's bank" },
  { key: "position", desc: "Contact's title" },
  { key: "team", desc: "Contact's team (e.g. Tech), else their location" },
  { key: "their_school", desc: "Contact's school (if known)" },
  { key: "their_city", desc: "Contact's city (from region)" },
  { key: "my_name", desc: "Your name" },
  { key: "my_school", desc: "Your school" },
  { key: "my_school_nickname", desc: "e.g. Bruin" },
  { key: "my_school_city", desc: "e.g. LA" },
  { key: "my_year", desc: "Your class year" },
  { key: "my_major", desc: "Your major" },
  { key: "my_pitch", desc: "Your 1–2 sentence background" },
  { key: "my_club", desc: "Your club" },
  { key: "my_hometown", desc: "Your hometown" },
  { key: "my_phone", desc: "Your phone" },
  { key: "my_linkedin", desc: "Your LinkedIn" },
  { key: "original_subject", desc: "Subject of the first email (follow-ups)" },
  { key: "base_opener", desc: "Base: pleasantry (Email lab)" },
  { key: "base_intro", desc: "Base: who you are (Email lab)" },
  { key: "base_ask", desc: "Base: the ask (Email lab)" },
  { key: "base_close", desc: "Base: sign-off (Email lab)" },
];

/** The base this contact's draft uses: the one recorded on the draft, else the first active base. */
export function baseFor(c: Pick<Contact, "draftMeta">, s: Settings): EmailBase {
  const bases = s.emailBases?.length ? s.emailBases : [ORIGINAL_BASE];
  return bases.find((b) => b.id === c.draftMeta?.baseId) ?? bases.find((b) => b.active) ?? bases[0];
}

/** Put the base's pieces into a template. An empty piece (e.g. no opener) disappears along with the space after it. */
export function expandBase(text: string, base: EmailBase): string {
  return text.replace(/\{\{\s*base_(opener|intro|ask|close)\s*\}\}([ \t]?)/g, (_m, k: "opener" | "intro" | "ask" | "close", sp: string) => {
    const v = base[k]?.trim();
    return v ? v + sp : "";
  });
}

const CITY: Record<string, string> = { NY: "New York", SF: "San Francisco", LA: "Los Angeles", CHI: "Chicago" };

function values(c: Contact, s: Settings): Record<string, string> {
  const p = s.profile;
  return {
    first_name: c.firstName,
    last_name: c.lastName,
    full_name: c.name,
    bank: c.bank,
    position: emailTitle(c.position),
    team: c.team || c.location,
    their_school: c.school ?? "",
    their_city: CITY[c.region] ?? "",
    my_name: p.name,
    my_school: p.school,
    my_school_nickname: p.schoolNickname || (p.school ? `${p.school} student` : ""),
    my_school_city: p.schoolCity,
    my_year: p.year,
    my_major: p.major,
    my_pitch: p.pitch,
    my_club: p.club,
    my_hometown: p.hometown,
    my_phone: p.phone,
    my_linkedin: p.linkedin,
    original_subject: c.draft?.subject?.replace(/^re:\s*/i, "") ?? "",
  };
}

/**
 * Job titles read mid-sentence in emails ("as an associate"), so they're lowercased there. Acronyms (MD, VP, TMT, M&A)
 * keep their capitals. The sheet and dashboard keep the title as written.
 */
export function emailTitle(position: string) {
  return position
    .replace(/\?/g, "")
    .trim()
    .split(/(\s+|[-,/|()])/)
    .map((w) => (/^[A-Z0-9&]{2,}$/.test(w) ? w : w.toLowerCase()))
    .join("");
}

const article = (word: string) => (/^[aeiou]/i.test(word) || /^(MD|SVP|EVP|M&A|MBA)\b/.test(word) ? "an" : "a");

/**
 * Fill {{placeholders}}. Unknown or empty values are LEFT in place (e.g. `{{their_school}}`) so the AI
 * step can fill them from context, or the user sees exactly what's missing, instead of a silent blank.
 * "a {{position}}" / "an {{my_major}}" get the right article for the value.
 */
export function fillPlaceholders(text: string, c: Contact, s: Settings, extra: Record<string, string> = {}, base: EmailBase = baseFor(c, s)) {
  const v = { ...values(c, s), ...extra };
  return expandBase(text, base)
    .replace(/\b([Aa]n?) \{\{\s*(\w+)\s*\}\}/g, (m, a: string, k: string) => {
      const val = v[k];
      if (!val) return m;
      const art = article(val);
      return `${a[0] === "A" ? art[0].toUpperCase() + art.slice(1) : art} ${val}`;
    })
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (v[k] ? v[k] : m));
}

export const AI_SLOT = /\[\[\s*AI:\s*([\s\S]*?)\]\]/g;

export function hasAiSlots(t: string) {
  return new RegExp(AI_SLOT.source).test(t);
}

export function missingPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
}

const UC = /\b(ucla|berkeley|ucsd|uc san diego|uci\b|uc irvine|uc davis|ucsb|santa barbara|uc santa cruz|ucr\b|uc riverside|university of california)\b/;
const WA = /\b(washington|seattle|bellevue|uw\b|foster|tacoma|spokane|uprep|redmond|kirkland)\b/;
const SENIOR = /\b(vp|vice president|director|md|managing director|partner|head|chair|chairman|co-head|executive director)\b/i;

/** Non-AI fallback: keyword rules over the contact's notes/school/title, matched against template names. */
export function ruleAssign(c: Contact, templates: Template[]): Template | undefined {
  const initial = templates.filter((t) => t.kind === "initial");
  const hay = `${c.comment} ${c.school ?? ""} ${c.headline ?? ""}`.toLowerCase();
  const find = (re: RegExp) => initial.find((t) => re.test(`${t.name} ${t.whenToUse}`));
  if (/anderson/.test(hay)) return find(/anderson|business.school/i) ?? find(/same.school|ucla/i);
  if (/\bucla\b|bruin/.test(hay)) return find(/same.school|ucla/i);
  if (/\busc\b/.test(hay)) return find(/\busc\b/i);
  if (UC.test(hay)) return find(/\buc alum|university of california/i);
  if (WA.test(hay)) return find(/hometown|washington/i);
  if (/\b(lmu|pepperdine|occidental|loyola marymount)\b/.test(hay)) return find(/same.city|la schools/i);
  if (SENIOR.test(c.position)) return find(/vp|md|senior/i);
  return find(/^standard|default/i) ?? initial[0];
}

/** Which follow-up template to use for the next follow-up (#1, #2, …). */
export function followUpTemplate(c: Contact, templates: Template[]): Template | undefined {
  const fus = templates.filter((t) => t.kind === "follow_up").sort((a, b) => (a.step ?? 99) - (b.step ?? 99));
  return fus.find((t) => t.step === c.followUps + 1) ?? fus[Math.min(c.followUps, fus.length - 1)];
}

/* ---------------- required facts ---------------- */

export const REQUIRED_FACTS: Record<RequiredFact, { label: string; field: "school" | "position"; placeholder: string }> = {
  their_school: { label: "Their university", field: "school", placeholder: "e.g. San Diego State University" },
  position: { label: "Their title", field: "position", placeholder: "e.g. Associate" },
};

/** Required facts this template needs that the contact doesn't have yet. */
export function missingFacts(t: Template, c: Contact): RequiredFact[] {
  return (t.requires ?? []).filter((k) => !(c[REQUIRED_FACTS[k].field] ?? "").trim());
}

const SCHOOL = /\b(University of [A-Z][A-Za-z.'&-]*(?:[ ,]+(?:at |in )?[A-Z][A-Za-z.'&-]*){0,4}|(?:[A-Z][A-Za-z.'&-]+ ){1,4}(?:University|College|Institute of Technology|State)(?: of [A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)?)\b/;

/**
 * Best guess at where someone went to school, from what the dashboard already has: their captured LinkedIn profile
 * (Education section first), the headline, then the sheet notes. Only ever a suggestion the user confirms.
 */
export function guessSchool(c: Pick<Contact, "profile" | "headline" | "comment">): string | undefined {
  const profile = c.profile?.text ?? "";
  const edu = profile.search(/\beducation\b/i);
  for (const text of [edu >= 0 ? profile.slice(edu, edu + 1500) : "", c.headline ?? "", c.comment ?? "", profile]) {
    const m = text.match(SCHOOL)?.[1]?.replace(/[ ,]+$/, "").trim();
    if (m && !/^(The|Investment|Business)\b/.test(m)) return m;
  }
  return undefined;
}

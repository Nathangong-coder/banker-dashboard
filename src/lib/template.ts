import type { Contact, Settings, Template } from "./types";

export const PLACEHOLDERS: { key: string; desc: string }[] = [
  { key: "first_name", desc: "Contact first name" },
  { key: "last_name", desc: "Contact last name" },
  { key: "full_name", desc: "Contact full name" },
  { key: "bank", desc: "Contact's bank" },
  { key: "position", desc: "Contact's title" },
  { key: "team", desc: "Contact's location/team" },
  { key: "their_school", desc: "Contact's school (if known)" },
  { key: "my_name", desc: "Your name" },
  { key: "my_school", desc: "Your school" },
  { key: "my_year", desc: "Your class year" },
  { key: "my_major", desc: "Your major" },
  { key: "my_phone", desc: "Your phone" },
  { key: "my_linkedin", desc: "Your LinkedIn" },
  { key: "my_hometown", desc: "Your hometown" },
  { key: "original_subject", desc: "Subject of the first email (follow-ups)" },
];

export function fillPlaceholders(text: string, c: Contact, s: Settings, extra: Record<string, string> = {}) {
  const p = s.profile;
  const values: Record<string, string> = {
    first_name: c.firstName,
    last_name: c.lastName,
    full_name: c.name,
    bank: c.bank,
    position: c.position,
    team: c.location,
    their_school: c.school ?? "",
    my_name: p.name,
    my_school: p.school,
    my_year: p.year,
    my_major: p.major,
    my_phone: p.phone,
    my_linkedin: p.linkedin,
    my_hometown: p.hometown,
    original_subject: c.draft?.subject ?? "",
    ...extra,
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in values ? values[k] : m));
}

export const AI_SLOT = /\[\[\s*AI:\s*([\s\S]*?)\]\]/g;

export function hasAiSlots(t: string) {
  return new RegExp(AI_SLOT.source).test(t);
}

export function missingPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
}

/** Simple non-AI fallback: pick the first template whose "when to use" keywords appear in the contact's info. */
export function ruleAssign(c: Contact, templates: Template[]): Template | undefined {
  const initial = templates.filter((t) => t.kind === "initial");
  const hay = `${c.comment} ${c.school ?? ""} ${c.headline ?? ""}`.toLowerCase();
  const uc = /\b(ucla|berkeley|ucsd|uc san diego|uci|uc irvine|uc davis|ucsb|santa barbara|uc santa cruz|ucr|anderson|haas|university of california)\b/;
  const wa = /\b(washington|seattle|bellevue|uw\b|foster|tacoma|spokane|uprep)\b/;
  if (uc.test(hay)) return initial.find((t) => /\buc\b|university of california/i.test(`${t.name} ${t.whenToUse}`)) ?? initial[0];
  if (wa.test(hay)) return initial.find((t) => /washington/i.test(`${t.name} ${t.whenToUse}`)) ?? initial[0];
  return initial.find((t) => /default|general/i.test(`${t.name} ${t.whenToUse}`)) ?? initial[0];
}

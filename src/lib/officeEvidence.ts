import type { Contact, Region } from "./types";
import { detectRegion } from "./region";

/**
 * Which office someone sits in, and why we think so (owner, 2026-11-23: "improve accuracy on location"). The audit of
 * the owner's tracker found 13 people whose Location cell disagreed with their office (Location "LA", office SF: the
 * cell had been edited and the office never followed) and 87 with no location at all, every one of them quietly
 * defaulted to SF. Evidence, strongest first:
 *   1. you set the office by hand (`regionSource: "manual"`)
 *   2. the Location cell / field
 *   3. their own email signature ("New York, NY 10017", "San Francisco, CA") in their latest reply
 *   4. a phone number in that signature or on file (212 / 646 → NY, 415 / 650 → SF, 310 / 213 → LA, 312 → Chicago)
 *   5. their LinkedIn profile / headline text
 *   6. nothing: the bank's default (SF), shown as a guess everywhere
 */
export type OfficeSource = NonNullable<Contact["regionSource"]>;
export type OfficeClue = { region: Region; source: OfficeSource; detail: string };

const AREA: Record<string, Region> = {
  "212": "NY", "646": "NY", "917": "NY", "332": "NY", "347": "NY", "718": "NY", "929": "NY", "201": "NY", "973": "NY", "914": "NY", "203": "NY",
  "415": "SF", "628": "SF", "650": "SF", "408": "SF", "669": "SF", "510": "SF", "925": "SF",
  "310": "LA", "213": "LA", "323": "LA", "424": "LA", "818": "LA", "626": "LA", "949": "LA", "714": "LA", "657": "LA",
  "312": "CHI", "773": "CHI", "872": "CHI", "847": "CHI", "630": "CHI",
};

export const SOURCE_LABEL: Record<OfficeSource, string> = {
  manual: "set by you",
  location: "Location column",
  signature: "their email signature",
  phone: "their phone number",
  profile: "their LinkedIn",
  default: "guessed (no location anywhere)",
};

/** Their own words only: the reply without the quoted thread under it ("On Mon, … wrote:", "From: …"). */
export function ownText(text: string) {
  const cut = text.search(/^\s*(On .{4,120} wrote:|-{2,} ?Original Message|From: .+)$/im);
  return (cut >= 0 ? text.slice(0, cut) : text).slice(0, 4000);
}

const CITY: [RegExp, Region][] = [
  [/\b(New York|Manhattan),? (NY|New York)\b/i, "NY"],
  [/\b(San Francisco|Menlo Park|Palo Alto|San Mateo|Burlingame|Redwood City|Mountain View),? (CA|California)\b/i, "SF"],
  [/\b(Los Angeles|Santa Monica|Century City|Beverly Hills|Irvine|Newport Beach|Pasadena),? (CA|California)\b/i, "LA"],
  [/\bChicago,? (IL|Illinois)\b/i, "CHI"],
];

/** Every clue about their office, strongest first. */
export function officeClues(c: Pick<Contact, "location" | "phone" | "profile" | "headline" | "regionSource" | "region" | "mail">, myPhone?: string): OfficeClue[] {
  const out: OfficeClue[] = [];
  if (c.regionSource === "manual") out.push({ region: c.region, source: "manual", detail: "You picked it" });
  if (c.location) {
    const r = detectRegion(c.location);
    if (r !== "Other") out.push({ region: r, source: "location", detail: c.location });
  }
  const sig = c.mail?.lastIn?.text ? ownText(c.mail.lastIn.text) : "";
  for (const [re, r] of CITY) {
    const m = sig.match(re);
    if (m) {
      out.push({ region: r, source: "signature", detail: m[0] });
      break;
    }
  }
  const mine = (myPhone ?? "").replace(/\D/g, "").slice(-10);
  const phones = [c.phone ?? "", ...(sig.match(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g) ?? [])].map((p) => p.replace(/\D/g, "").slice(-10)).filter((p) => p.length === 10 && p !== mine);
  for (const p of phones) {
    const r = AREA[p.slice(0, 3)];
    if (r) {
      out.push({ region: r, source: "phone", detail: `(${p.slice(0, 3)}) number` });
      break;
    }
  }
  const prof = `${c.profile?.text ?? ""} ${c.headline ?? ""}`.slice(0, 3000);
  const pm = prof.match(/\b(New York City Metropolitan Area|San Francisco Bay Area|Greater Los Angeles Area|Los Angeles Metropolitan Area|Greater Chicago Area|New York, New York|San Francisco, California|Los Angeles, California)\b/i);
  if (pm) out.push({ region: detectRegion(pm[0]), source: "profile", detail: pm[0] });
  return out;
}

/** The office to use and where it came from. Nothing to go on = the current office, marked as a guess. */
export function bestOffice(c: Parameters<typeof officeClues>[0], myPhone?: string): OfficeClue & { conflict?: OfficeClue } {
  const clues = officeClues(c, myPhone);
  const best = clues[0] ?? { region: c.region, source: "default" as const, detail: "No location on file" };
  // A weaker clue that disagrees (signature says NY, Location says SF) is shown, never applied over the stronger one.
  const conflict = clues.find((x) => x.region !== best.region && x.source !== "manual");
  return { ...best, conflict };
}

/** What the upkeep pass changes: the office follows the best clue unless you set it yourself. */
export function officePatch(c: Contact, myPhone?: string): Partial<Contact> | null {
  if (c.regionSource === "manual") return null;
  const b = bestOffice(c, myPhone);
  if (b.region !== c.region || b.source !== (c.regionSource ?? "default")) return { region: b.region, regionSource: b.source };
  return null;
}

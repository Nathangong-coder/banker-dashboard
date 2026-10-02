import type { Region } from "./types";

/** Region from any location text. Shared by the browser (sheet parsing) and server routes (enrichment checks). */
export function detectRegion(...hints: (string | undefined)[]): Region {
  const text = hints.filter(Boolean).join(" ");
  if (/\b(NY|NYC|New York|Manhattan|Brooklyn)\b/i.test(text)) return "NY";
  if (/\b(Chicago|CHI)\b/i.test(text)) return "CHI";
  // LA before SF: "Los Angeles, California" is LA, not the Bay Area.
  if (/\b(LA|L\.A\.|Los Angeles|Century City|Santa Monica|Beverly Hills|Irvine|Newport Beach|Orange County|Pasadena)\b/i.test(text)) return "LA";
  if (/\b(SF|San Francisco|Menlo|Palo Alto|Bay Area|Silicon Valley|Burlingame|San Mateo|Redwood City|Mountain View|San Jose|California)\b/i.test(text))
    return "SF";
  return "Other";
}

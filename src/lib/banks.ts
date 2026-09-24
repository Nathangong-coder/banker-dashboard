/**
 * Bank-name normalization + target lists. Sheets spell the same firm many ways
 * ("Morgan Stanley (MS) & MS NY)", "JPMorgan", "Jeffries", "FinTech Partners" vs "FT Partners"),
 * so every bank is matched by `canonBank()`.
 */

const ALIASES: Record<string, string> = {
  jpmorgan: "jp morgan",
  "j p morgan": "jp morgan",
  "jpmorgan chase": "jp morgan",
  jpm: "jp morgan",
  citigroup: "citi",
  "citi global markets": "citi",
  bofa: "bank of america",
  boa: "bank of america",
  "bofa securities": "bank of america",
  "bank of america merrill lynch": "bank of america",
  baml: "bank of america",
  gs: "goldman sachs",
  ms: "morgan stanley",
  jeffries: "jefferies",
  fintech: "ft",
  "ft partners": "ft",
  pwp: "perella weinberg",
  "perella weinberg": "perella weinberg",
  "raine": "raine",
  "mizuho financial": "mizuho",
  "mitsubishi ufj financial": "mufg",
  "rbc": "rbc",
  "royal bank of canada": "rbc",
  hl: "houlihan lokey",
  "evercore isi": "evercore",
  "wells fargo securities": "wells fargo",
  "deutsche": "deutsche bank",
  "db": "deutsche bank",
};

const STOP = /\b(the|and|co|company|companies|partners|group|advisors|advisory|capital markets|financial group|financial|inc|llc|lp|securities|holdings|international|plc|ag|sa)\b/g;

/** Canonical comparison key for a bank/firm name. */
export function canonBank(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/‍/g, "")
    .replace(/\([^)]*\)?/g, " ")
    .replace(/&/g, " and ")
    .replace(/[.,'’]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (ALIASES[s]) return ALIASES[s];
  s = s.replace(STOP, " ").replace(/\s+/g, " ").trim();
  return ALIASES[s] ?? (s || name.toLowerCase().trim());
}

/** "Morgan Stanley (MS) & MS NY)" → "Morgan Stanley"; "Moelis & Company (MC) & Moelis NY (MCNY)" → "Moelis & Company". */
export function cleanBankName(raw: string): string {
  return raw
    .replace(/‍/g, "")
    .replace(/\([^)]*\)?/g, " ")
    .replace(/\s*&\s*[^&]*\bNY\b.*$/i, "")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface TargetBank {
  name: string;
  tier?: string;
  source: string;
}

export function normalizeTier(raw?: string): string | undefined {
  if (!raw) return undefined;
  const t = raw.toLowerCase();
  if (/bulge/.test(t)) return "Bulge Bracket";
  if (/elite|boutique/.test(t)) return "Elite Boutique";
  if (/middle|mid.?market/.test(t)) return "Middle Market";
  if (/private equity|\bpe\b|private credit|buyout|growth equity/.test(t)) return "Private Equity";
  if (/investment bank/.test(t)) return "Investment Bank";
  if (/venture|\bvc\b/.test(t)) return "Venture Capital";
  if (/hedge/.test(t)) return "Hedge Fund";
  if (/asset/.test(t)) return "Asset Management";
  if (/trading/.test(t)) return "Trading";
  return raw.replace(/\s+/g, " ").trim();
}

/** Tiers that count as IB/buy-side recruiting targets when importing column-style lists. */
export const DEFAULT_TIERS = ["Bulge Bracket", "Elite Boutique", "Middle Market", "Private Equity"];

/** A standard IB target list for people whose sheet doesn't have one. */
export const STARTER_TARGETS: TargetBank[] = [
  ...["Goldman Sachs", "Morgan Stanley", "JP Morgan", "Bank of America", "Citi", "Barclays", "UBS", "Deutsche Bank", "Wells Fargo"].map((name) => ({
    name,
    tier: "Bulge Bracket",
    source: "starter",
  })),
  ...[
    "Evercore",
    "Centerview Partners",
    "Lazard",
    "Moelis & Company",
    "PJT Partners",
    "Perella Weinberg Partners",
    "Qatalyst Partners",
    "Guggenheim Partners",
    "LionTree",
    "Allen & Company",
    "Rothschild & Co.",
    "FT Partners",
    "Solomon Partners",
    "Greenhill & Co.",
  ].map((name) => ({ name, tier: "Elite Boutique", source: "starter" })),
  ...[
    "Jefferies",
    "Houlihan Lokey",
    "RBC Capital Markets",
    "William Blair",
    "Harris Williams",
    "Piper Sandler",
    "Baird",
    "Lincoln International",
    "Raymond James",
    "Stifel",
    "BMO Capital Markets",
    "Mizuho",
    "Nomura",
    "Cantor Fitzgerald",
    "Oppenheimer & Co.",
    "KeyBanc Capital Markets",
  ].map((name) => ({ name, tier: "Middle Market", source: "starter" })),
];

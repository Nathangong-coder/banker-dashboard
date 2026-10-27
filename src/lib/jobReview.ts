/**
 * The AI job review (Applications → Find jobs, owner 2026-10-25/26; docs/superpowers/specs/2026-10-25-linkedin-job-review-design.md).
 * Pure: no store, no network, so `npm run check:jobs` covers it.
 *
 * The AI only extracts and classifies each posting (role type from your list, class years, internship, US, known
 * firm); the verdict (apply / maybe / skip) is decided HERE by code from those fields and your settings, so changing
 * a role type's verdict re-sorts every stored review instantly without another AI call.
 */
import { canonBank } from "./banks";
import { inUS, type FoundJob } from "./jobFinder";

export type Verdict = "apply" | "maybe" | "skip";

export interface RoleType {
  id: string;
  label: string;
  /** What it covers, in a few words: sent to the AI to tell the types apart. */
  covers: string;
  verdict: Verdict;
}

export interface ReviewRules {
  /** In priority order (first = what you want most). */
  roleTypes: RoleType[];
  /** Class years you can apply as (graduation years). */
  classYears: number[];
  /** Lessons from Keep / Remove / overrule ("no rotational programs at insurers"), sent to the AI as guidance. */
  rules: string[];
  /** The 9 PM text reminds you to press Search (owner, 2026-10-26). */
  reminder: { on: boolean; everyDays: number };
  /** Bumped when what the AI is told changes (role type wording, rules): older reviews can be re-checked. */
  version: number;
  /** Default role type ids this list has seen, so ones added to the defaults later are added to your list too. */
  defaultsSeen?: string[];
}

export interface JobReview {
  roleType: string;
  /** Class years the posting is open to, as the AI read them; empty = unclear. */
  classYears: number[];
  internship: boolean;
  us: boolean;
  /** A name most people would recognize (the AI's call, only used when your lists don't know the firm). */
  firmKnown: boolean;
  reason: string;
  at: string;
  version: number;
  /** Decided without the AI (an obvious full-time or non-US posting). */
  quick?: boolean;
}

/** "Not finance" always exists: the catch-all the AI falls back to. */
export const NOT_FINANCE = "not_finance";

/** The owner's list (2026-10-26): everything but sales & trading (maybe) and quant (skip); wealth / AM skipped (2026-10-25). */
export const DEFAULT_ROLE_TYPES: RoleType[] = [
  {
    id: "ib",
    label: "Investment banking",
    covers: "M&A, coverage groups, ECM / DCM, leveraged finance, restructuring",
    verdict: "apply",
  },
  {
    id: "project_finance",
    label: "Project finance",
    covers: "project / infrastructure / energy finance",
    verdict: "apply",
  },
  {
    id: "investing",
    label: "Investing / buy-side",
    covers: "private equity, growth, venture capital, private credit, hedge-fund-style investing",
    verdict: "apply",
  },
  {
    id: "corporate_banking",
    label: "Corporate banking",
    covers: "corporate / commercial banking analyst programs",
    verdict: "apply",
  },
  {
    id: "equity_research",
    label: "Equity research",
    covers: "sell-side research",
    verdict: "apply",
  },
  {
    id: "corp_dev",
    label: "Corporate development / strategy",
    covers: "corp dev, strategic finance",
    verdict: "apply",
  },
  {
    id: "advisory",
    label: "Financial advisory / valuation",
    covers: "transaction services, valuation, Big 4 deal advisory",
    verdict: "apply",
  },
  {
    id: "risk_credit",
    label: "Risk / credit",
    covers: "credit analysis, risk management",
    verdict: "apply",
  },
  {
    id: "general_finance",
    label: "General finance",
    covers: "FP&A, treasury, corporate finance, finance rotational / back-office finance",
    verdict: "apply",
  },
  // Added 2026-10-26 (owner: K1's Business Development Intern and Econ One's Healthcare Economics Summer Analyst were skipped).
  { id: "econ_consulting", label: "Economic consulting / research", covers: "economic & litigation consulting, healthcare / antitrust economics, research analyst roles (Econ One, Analysis Group, Cornerstone, NERA, Compass Lexecon, Brattle)", verdict: "apply" },
  { id: "investment_firm_business", label: "Investment firm business roles", covers: "business development, investor relations, capital raising, strategy or operations interns at PE / VC / hedge fund / investment firms", verdict: "apply" },
  {
    id: "sales_trading",
    label: "Sales & trading",
    covers: "sales, trading, markets",
    verdict: "maybe",
  },
  {
    id: "quant",
    label: "Quant",
    covers: "quant research / trading / developer roles",
    verdict: "skip",
  },
  {
    id: "wealth",
    label: "Wealth management",
    covers: "private wealth, financial advisor",
    verdict: "skip",
  },
  {
    id: "asset_management",
    label: "Asset management",
    covers: "asset / investment management firms' AM roles",
    verdict: "skip",
  },
  {
    id: NOT_FINANCE,
    label: "Not finance",
    covers: "software, marketing, operations, anything else",
    verdict: "skip",
  },
];

/** Class years from your graduation date: that class and the one before it (the owner applies to both). */
export function defaultClassYears(gradDate?: string): number[] {
  const y = Number((gradDate ?? "").match(/(20\d{2})/)?.[1]);
  return y ? [y - 1, y] : [];
}

/** Your saved rules, with defaults filled in (and "Not finance" always there, last). */
export function rulesOf(saved: Partial<ReviewRules> | undefined, gradDate?: string): ReviewRules {
  let types = saved?.roleTypes?.length ? saved.roleTypes : DEFAULT_ROLE_TYPES;
  // Role types added to the defaults after you saved your list: added above the catch-all (deleting one keeps it gone).
  const seen = saved?.defaultsSeen ?? (saved?.roleTypes?.length ? ORIGINAL_DEFAULTS : DEFAULT_ROLE_TYPES.map((t) => t.id));
  const fresh = DEFAULT_ROLE_TYPES.filter((d) => !seen.includes(d.id) && !types.some((t) => t.id === d.id));
  if (fresh.length) {
    const at = types.findIndex((t) => t.id === NOT_FINANCE);
    types = at < 0 ? [...types, ...fresh] : [...types.slice(0, at), ...fresh, ...types.slice(at)];
  }
  const withCatchAll = types.some((t) => t.id === NOT_FINANCE) ? types : [...types, DEFAULT_ROLE_TYPES[DEFAULT_ROLE_TYPES.length - 1]];
  return {
    roleTypes: withCatchAll,
    classYears: saved?.classYears?.length ? saved.classYears : defaultClassYears(gradDate),
    rules: saved?.rules ?? [],
    reminder: saved?.reminder ?? { on: true, everyDays: 1 },
    // New role types change what the AI is told: older reviews become re-checkable.
    // Unsaved = the defaults' own version; a saved list goes up one when new default role types were just added to it.
    version: saved?.version ? saved.version + (fresh.length ? 1 : 0) : DEFAULTS_VERSION,
    defaultsSeen: DEFAULT_ROLE_TYPES.map((t) => t.id),
  };
}

/** The default list as first shipped (2026-10-25): lists saved before `defaultsSeen` existed had seen these. */
const ORIGINAL_DEFAULTS = ["ib", "project_finance", "investing", "corporate_banking", "equity_research", "corp_dev", "advisory", "risk_credit", "general_finance", "sales_trading", "quant", "wealth", "asset_management", NOT_FINANCE];
/** Bumped when the defaults change, so every review made before is offered a re-check (2 = econ consulting + investment firm roles). */
const DEFAULTS_VERSION = 2;

export interface Judged {
  verdict: Verdict;
  /** One line: why (the AI's reason, or the rule that decided it). */
  why: string;
  roleLabel: string;
  yearUnclear: boolean;
}

/** The verdict, by code, from the review's fields and your settings. */
export function judge(review: JobReview, rules: ReviewRules, location?: string): Judged {
  const type = rules.roleTypes.find((t) => t.id === review.roleType) ?? rules.roleTypes.find((t) => t.id === NOT_FINANCE)!;
  const base = {
    roleLabel: type.label,
    yearUnclear: !review.classYears.length,
  };
  if (!review.internship)
    return {
      ...base,
      verdict: "skip",
      why: review.reason || "Not an internship.",
    };
  if (!review.us || (location && !inUS(location))) return { ...base, verdict: "skip", why: "Outside the US." };
  if (review.classYears.length && rules.classYears.length && !review.classYears.some((y) => rules.classYears.includes(y)))
    return {
      ...base,
      verdict: "skip",
      why: `For class of ${review.classYears.join(" / ")}, not yours.`,
    };
  return { ...base, verdict: type.verdict, why: review.reason || type.label };
}

/** Obvious skips decided without spending an AI call (titles that can't be internships, non-US locations). */
export function quickReview(job: Pick<FoundJob, "title" | "location">, version: number, at: string): JobReview | null {
  const t = job.title.toLowerCase();
  const base = {
    roleType: NOT_FINANCE,
    classYears: [],
    firmKnown: false,
    at,
    version,
    quick: true,
  };
  if (/\b(vice president|managing director|director|senior|sr\.?|principal|head of|manager|experienced hire|lateral)\b/.test(t) && !/\b(intern|internship|summer)\b/.test(t))
    return {
      ...base,
      internship: false,
      us: true,
      reason: "A full-time / experienced role, not an internship.",
    };
  if (job.location && !inUS(job.location)) return { ...base, internship: true, us: false, reason: "Outside the US." };
  return null;
}

/** How well known the firm is, for ordering: on your lists > a name the AI recognizes > unknown. */
export function firmRank(company: string, review: JobReview | undefined, known: Set<string>): 2 | 1 | 0 {
  if (known.has(canonBank(company))) return 2;
  return review?.firmKnown ? 1 : 0;
}

/** Order reviewed finds: verdict, then your role-type priority, then firm rank, then newest. */
export function sortReviewed<T extends { company: string; foundAt: string; review?: JobReview }>(list: T[], rules: ReviewRules, known: Set<string>): T[] {
  const order: Record<Verdict, number> = { apply: 0, maybe: 1, skip: 2 };
  const prio = new Map(rules.roleTypes.map((t, i) => [t.id, i]));
  const key = (j: T) => (j.review ? order[judge(j.review, rules).verdict] : 3);
  return [...list].sort(
    (a, b) =>
      key(a) - key(b) ||
      (prio.get(a.review?.roleType ?? "") ?? 99) - (prio.get(b.review?.roleType ?? "") ?? 99) ||
      firmRank(b.company, b.review, known) - firmRank(a.company, a.review, known) ||
      b.foundAt.localeCompare(a.foundAt),
  );
}

/**
 * The resume a posting should go out with: one marked for the only class year the posting is open to (the owner's
 * "junior" resume for class-of-2028 postings), else your main resume (undefined).
 */
export function resumeFor(review: JobReview | undefined, resumes: { id: string; classYear?: number }[]): string | undefined {
  if (!review || review.classYears.length !== 1) return undefined;
  return resumes.find((r) => r.classYear === review.classYears[0])?.id;
}

/** The text sent to the AI for a posting: what it says about itself, capped. */
export function reviewText(j: Pick<FoundJob, "title" | "description" | "snippet">): string {
  return (j.description || j.snippet || "").slice(0, 6000);
}

/** "Read 30 · 7 added · 9 maybe · 14 skipped" */
export function runSummary(n: { read: number; added: number; maybe: number; skipped: number }): string {
  return `Read ${n.read} · ${n.added} added · ${n.maybe} maybe · ${n.skipped} skipped`;
}

/** A role type id from a label you typed ("Real estate investing" → "real_estate_investing"), unique in the list. */
export function roleTypeId(label: string, taken: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "custom";
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}_${i}`;
  return id;
}

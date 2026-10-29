/**
 * Job applications (app/applications) and the extension's autofill. Pure: no store, no React, no network, so
 * `npm run check:apply` can run it on made-up forms.
 *
 * How a fill works (owner, 2026-10-24): the extension scans the form on the job page (labels, types, options) and
 * sends that list to the open Coverage tab. `planFill` decides each value HERE, from your saved info, by fixed
 * rules. Only open questions ("Why this firm?") go to the AI (api/apply/answer), which never sees your demographics,
 * address, phone or visa details. The extension then types the values in, never clicks submit, and you review.
 */

import type { Board, FoundJob } from "./jobFinder";
import type { JobReview, ReviewRules } from "./jobReview";

/**
 * "submitted" = Pend. applied (you submitted; no confirmation email yet). "confirmed" = Off. applied: the firm's
 * "thanks for applying" email arrived (read from Gmail, lib/appEmails.ts; owner, 2026-10-26).
 */
export type JobStatus = "saved" | "applying" | "submitted" | "confirmed" | "interview" | "offer" | "rejected" | "withdrawn";

export const JOB_STATUSES: { id: JobStatus; label: string }[] = [
  { id: "saved", label: "To apply" },
  { id: "applying", label: "In progress" },
  { id: "submitted", label: "Pend. applied" },
  { id: "confirmed", label: "Off. applied" },
  { id: "interview", label: "Interviewing" },
  { id: "offer", label: "Offer" },
  { id: "rejected", label: "Rejected" },
  { id: "withdrawn", label: "Withdrawn" },
];

export interface JobApplication {
  id: string;
  company: string;
  role: string;
  url: string;
  /** Where the application form actually is, when `url` is a listing (a LinkedIn job sends you to the bank's site). */
  applyUrl?: string;
  /** LinkedIn's job id, when the job came from "Track this job" (so it isn't added twice). */
  linkedinJobId?: string;
  /** Handshake's job id (found by the Handshake reader). */
  handshakeJobId?: string;
  /** "ai" = added by the AI job review: shown under "Added by AI" until you Keep it (then it's on My list). */
  addedBy?: "ai";
  /** The AI's review it was added on. */
  review?: JobReview;
  /** Its row on the workbook's applications tab (My list jobs only). */
  sheetRef?: { sheet: string; row: number };
  /** The job description as captured (≤ 6,000 characters): what the job is, for AI answers. */
  description?: string;
  location?: string;
  deadline?: string;
  status: JobStatus;
  notes?: string;
  /** Which resume to upload (ApplyResume.id); undefined = your main resume. */
  resumeId?: string;
  createdAt: string;
  submittedAt?: string;
  lastFilledAt?: string;
  /** Answers the AI wrote for this job's questions (kept so you can reuse or check them later). */
  answers?: { question: string; answer: string; at: string }[];
  /** The last "Fill selected" run on this job (the extension reports it back). */
  fill?: JobFill;
  /** Emails about this application found in Gmail (confirmation, interview, rejection…). */
  emails?: { id: string; kind: string; at: string; subject: string }[];
  /** Summer the internship is for (from the confirmation email or the posting), for the Gmail label. */
  summer?: number;
  /** The graduation date this application uses (your early date when the posting asks for that class), once decided. */
  gradAs?: string;
  /** The cover letter made for this job (your template tailored to it), exactly as uploaded. */
  coverLetter?: { text: string; at: string; tailored: boolean };
}

/**
 * Where a batch fill stands. ready = filled up to the review page · needs_you = required questions left ·
 * signin = the site wants you signed in (it carries on by itself once you are) · account = create an account first ·
 * access = allow Coverage on that site (extension Options) · error / stopped.
 */
export type FillStatus = "queued" | "filling" | "ready" | "needs_you" | "signin" | "account" | "access" | "error" | "stopped";

export interface JobFill {
  status: FillStatus;
  note?: string;
  at: string;
  /** Required questions it couldn't answer. */
  needs?: string[];
}

export const FILL_LABELS: Record<FillStatus, string> = {
  queued: "Waiting",
  filling: "Filling…",
  ready: "Ready to review",
  needs_you: "Needs you",
  signin: "Sign in needed",
  account: "Create an account",
  access: "Allow the site",
  error: "Didn't work",
  stopped: "Stopped",
};

/** Applications → Find jobs: the latest finds, what you dismissed, and the career boards Coverage has learned. */
export interface JobFinderState {
  found: FoundJob[];
  dismissed: string[];
  boards: Board[];
  at?: string;
  terms?: string;
  years?: number[];
  location?: string;
  /** What you want (role types, class years, learned rules, reminder). Undefined = the defaults (`jobReview.rulesOf`). */
  rules?: ReviewRules;
  /** When you last pressed a search button (the 9 PM text reminds you when it's been a while). */
  lastRunAt?: string;
}

export const EMPTY_FINDER: JobFinderState = { found: [], dismissed: [], boards: [] };

/** "" = leave it for me (the field is skipped), "decline" = choose the form's "prefer not to say" option. */
export type Choice = string;

export interface ApplyProfile {
  firstName: string;
  lastName: string;
  preferredName: string;
  email: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  linkedin: string;
  website: string;
  school: string;
  degree: string;
  major: string;
  gpa: string;
  /** "2029-06-15" (or "2029-06"): when the degree ends. */
  gradDate: string;
  /**
   * A date you could also graduate (finishing early), e.g. "2028-06-15": used instead for a job whose posting or form
   * asks for that class / graduation window, with the resume marked for that class year (owner, 2026-10-26).
   */
  earlyGradDate: string;
  /** "yes" | "no" | "" */
  authorized: Choice;
  sponsorNow: Choice;
  sponsorFuture: Choice;
  /** "U.S. citizen", "F-1 student visa"… as you'd write it. */
  citizenship: string;
  over18: Choice;
  /** gender: "male" | "female" | "nonbinary" | "decline" | "" */
  gender: Choice;
  /** "asian" | "black" | "hispanic" | "white" | "native" | "pacific" | "two_or_more" | "decline" | "" */
  race: Choice;
  hispanic: Choice;
  /** "no" | "yes" | "decline" | "" */
  veteran: Choice;
  disability: Choice;
  orientation: Choice;
  transgender: Choice;
  pronouns: string;
  howHeard: string;
  relocate: Choice;
  startDate: string;
  /** "Do you have a valid driver's license?" (the license NUMBER is never filled). */
  driversLicense: Choice;
  /** Free text the AI may draw on: experiences, deals, clubs, skills (your resume in your words). */
  background: string;
  /** Why banking, which groups / offices you want: the AI's facts for "why" questions. */
  interests: string;
  /** How you like to write ("short sentences, no buzzwords"); the samples show it, this says it. */
  styleNotes: string;
}

export const EMPTY_PROFILE: ApplyProfile = {
  firstName: "", lastName: "", preferredName: "", email: "", phone: "", address1: "", address2: "", city: "", state: "", zip: "", country: "United States",
  linkedin: "", website: "", school: "", degree: "", major: "", gpa: "", gradDate: "", earlyGradDate: "", authorized: "", sponsorNow: "", sponsorFuture: "", citizenship: "",
  over18: "", gender: "", race: "", hispanic: "", veteran: "", disability: "", orientation: "", transgender: "", pronouns: "", howHeard: "", relocate: "",
  startDate: "", driversLicense: "", background: "", interests: "", styleNotes: "",
};

export interface WritingSample {
  id: string;
  title: string;
  kind: "cover_letter" | "essay" | "short_answer" | "email" | "other";
  text: string;
  addedAt: string;
}

/** An extra resume kept for applications (the file is in IndexedDB under blob:appresume:<id>). */
export interface ApplyResume {
  id: string;
  name: string;
  /** The class year this version is for (the owner's "junior" resume = 2028): postings only open to that year use it. */
  classYear?: number;
  /** What it's for, in your words ("consulting, economics"): a job whose title / description has these words gets it. */
  tags?: string;
  size: number;
  addedAt: string;
}

export interface ApplyState {
  jobs: JobApplication[];
  profile: ApplyProfile;
  samples: WritingSample[];
  /** Your own Q&A library ("Tell us about yourself"): reused as facts and as style. */
  library: { q: string; a: string }[];
  resumes: ApplyResume[];
  /** The job you last clicked "Autofill" on, so a fill on that site is filed under it. */
  activeJob?: { id: string; at: string };
  finder: JobFinderState;
  /** Accounts Coverage created on application sites (the passwords are only in your PIN-locked saved logins). */
  accounts?: { origin: string; email: string; at: string; company?: string; jobId?: string; verified?: string }[];
  /** Gmail application-email scan: message ids already read (never read twice), labels still to put on in Gmail. */
  mail?: { seen: string[]; at?: string; pendingLabels?: { id: string; label: string }[] };
  /**
   * Answers that worked on a platform (Workday, Greenhouse…), keyed by the question's normalized label: reused on the
   * next application there before any AI call (owner, 2026-10-26: "record what the AI did for one site").
   */
  learned?: Record<string, Record<string, { value: string; kind?: string; at: string; n: number }>>;
  /** One record per application fill, for Applications → Agent benchmark. */
  runs?: FillRun[];
  /** Your $ per million tokens per model ("provider/model" → { in, out }), for the benchmark's cost column. */
  prices?: Record<string, { in: number; out: number }>;
  /** The last "Fill selected" run: when every job in it has finished, one WhatsApp text says what's ready (mass apply). */
  batch?: { ids: string[]; at: string; texted?: boolean };
  /** The extension's saved logins, still encrypted with your PIN (synced through your account; nobody else can read them). */
  vault?: { blob: { v: 1; salt: string; iv: string; data: string } | null; at: string };
}

export const EMPTY_APPLY: ApplyState = { jobs: [], profile: EMPTY_PROFILE, samples: [], library: [], resumes: [], finder: EMPTY_FINDER };

/* ---------------- the form, as the extension scanned it ---------------- */

/**
 * `listbox` = a custom dropdown (a button that opens a list: Workday's "Select One"), its options read by opening it.
 * `typeahead` = a text box that only takes a value picked from the suggestions it shows (school, location…).
 */
export type FieldKind =
  | "text" | "email" | "tel" | "url" | "number" | "date" | "month" | "textarea" | "select" | "radio" | "checkbox" | "checkboxes" | "file" | "listbox" | "typeahead";

export interface FormField {
  id: string;
  kind: FieldKind;
  label: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  maxLength?: number;
  placeholder?: string;
  /** Already filled on the page (by you or the site): left alone. */
  filled?: boolean;
  /** For file inputs: what it accepts (".pdf,.doc"). */
  accept?: string;
}

export type FillSource = "profile" | "ai" | "resume";

export interface FillItem {
  id: string;
  /** Text to type, or the option value to pick (select / radio). */
  value?: string;
  /** Checkbox state. */
  checked?: boolean;
  /** Which of your files goes into a file input: a resume, or a cover letter made from your template. */
  file?: "resume" | "cover";
  /** For a custom dropdown: the option's text (its position can change when the list reopens). */
  optionLabel?: string;
  /** For a typeahead: other ways to say the answer, to match against the suggestions. */
  alts?: string[];
  /** For a typeahead: what to type, in order, when the first search finds nothing (school names). */
  search?: string[];
  /** For a typeahead: only accept a suggestion containing every word of one of `alts` (or an acronym word). */
  strict?: boolean;
  source: FillSource;
  label: string;
  /** Shown in the review list ("AI: check the facts"). */
  note?: string;
}

export interface FillPlan {
  items: FillItem[];
  /** Open questions for the AI (or for you, without an AI key). */
  ai: FormField[];
  /** Left for you, with why ("Salary: yours to answer", "Never filled: SSN"). */
  skipped: { id: string; label: string; why: string }[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Fields the extension must never fill, whatever the label says. Checked here and again in the extension. */
export const NEVER_FILL =
  /\b(password|passcode|ssn|social security|social insurance|national insurance|tax id|taxpayer|itin|bank account|routing|account number|iban|swift|credit card|card number|cvv|cvc|security code|driver'?s? licen[cs]e (number|no\b|#|id)|passport number|mother'?s maiden|date of birth|birth ?date|\bdob\b)/i;

/** A legal attestation or consent box: you tick these yourself. */
/** Eligibility facts (age, work authorization, sponsorship): answered from My info even in "I certify…" wording. */
const ELIGIBILITY = /\b18\b|legal (working )?age|(authori[sz]ed|eligible|permitted) to work|work authori[sz]ation|right to work|sponsor/i;
const ATTEST = /\b(certify|attest|acknowledge|i agree|agree to|consent|terms|privacy (policy|notice)|accurate and complete|true and correct|electronic signature|e-?sign)/i;

const YES = /^(yes\b|y$|true|i am\b|i do\b|i will\b|i have\b|authori[sz]ed)/i;
const NO = /^(no\b|n$|false|i am not\b|i do not\b|i don'?t\b|i will not\b|not\b)/i;
const DECLINE = /(decline|prefer not|(do not|don'?t) (wish|want)|choose not|not to (answer|disclose|say|self|identify)|rather not|no answer|not specified|i don'?t know)/i;

/** The option on a select / radio group that means `want` ("yes" / "no" / "decline" / a free text value). */
export function pickOption(options: { value: string; label: string }[], want: string, synonyms: RegExp[] = []): string | undefined {
  const real = options.filter((o) => o.label.trim() && !/^(select|choose|please select|--|—|-)\b/i.test(o.label.trim()) && o.value !== "");
  const w = norm(want);
  if (!w) return undefined;
  if (w === "decline") return real.find((o) => DECLINE.test(o.label))?.value;
  if (w === "yes") return real.find((o) => YES.test(norm(o.label)) && !DECLINE.test(o.label))?.value;
  if (w === "no") return real.find((o) => NO.test(norm(o.label)) && !DECLINE.test(o.label))?.value;
  for (const re of synonyms) {
    const hit = real.find((o) => re.test(o.label) && !DECLINE.test(o.label));
    if (hit) return hit.value;
  }
  return (
    real.find((o) => norm(o.label) === w) ??
    real.find((o) => norm(o.label).startsWith(w) || w.startsWith(norm(o.label))) ??
    (w.length >= 4 ? real.find((o) => norm(o.label).includes(w)) : undefined)
  )?.value;
}

const GENDER: Record<string, RegExp[]> = {
  male: [/^(male|man)\b/i],
  female: [/^(female|woman)\b/i],
  nonbinary: [/non-?binary|gender ?(queer|fluid|diverse)/i],
};
const RACE: Record<string, RegExp[]> = {
  asian: [/^asian/i, /\basian\b/i],
  black: [/black|african american/i],
  hispanic: [/hispanic|latin[oax]/i],
  white: [/^white|caucasian/i],
  native: [/american indian|alaska native|native american|indigenous/i],
  pacific: [/pacific islander|native hawaiian/i],
  two_or_more: [/two or more|multiracial|multi-racial|mixed/i],
};
// Veteran / disability forms phrase "no" in long sentences ("I am not a protected veteran").
const VETERAN: Record<string, RegExp[]> = {
  no: [/not a (protected )?veteran|i am not|^no\b/i],
  yes: [/i (identify as|am) (one or more|a protected)|^yes\b/i],
};
const DISABILITY: Record<string, RegExp[]> = {
  no: [/no,? i do(n'?t| not) have|^no\b/i],
  yes: [/yes,? i (have|had)|^yes\b/i],
};

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A rule: label pattern → the value (or option choice) from your profile. */
interface Rule {
  re: RegExp;
  /** Skip the rule when the label also matches this. */
  not?: RegExp;
  value: (p: ApplyProfile, f: FormField) => string | undefined;
  /** Option synonyms for choice answers (gender, race…). */
  options?: (p: ApplyProfile) => RegExp[];
  /** A sensitive answer: never left to the AI when your profile has no value for it. */
  sensitive?: boolean;
  /** Applies to long, sentence-style labels too (legal questions are long). Short fact rules ("City") don't. */
  long?: boolean;
  why?: string;
}

/** Your graduation: "2029-06-15" (or "2029-06", read as the 15th: owner, 2026-10-26, "expected June 15 2029"). */
const grad = (p: ApplyProfile) => {
  const m = (p.gradDate ?? "").match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  return m ? { year: m[1], month: MONTHS[Number(m[2]) - 1] ?? "", mm: m[2], dd: m[3] ?? "15" } : undefined;
};

const RULES: Rule[] = [
  { re: /preferred (first )?name|nickname|goes by/, value: (p) => p.preferredName || p.firstName },
  { re: /first name|given name|forename/, value: (p) => p.firstName },
  { re: /last name|surname|family name/, value: (p) => p.lastName },
  { re: /middle (name|initial)/, value: () => undefined, why: "Middle name: add it yourself if you want it." },
  { re: /^(full |legal |your )?name\b|full legal name|candidate name/, not: /company|school|university|referr|employer|recruiter|manager/, value: (p) => [p.firstName, p.lastName].filter(Boolean).join(" ") },
  { re: /e-?mail/, not: /referr|recruiter|confirm/, value: (p) => p.email },
  { re: /confirm.*e-?mail|e-?mail.*(again|confirm)/, value: (p) => p.email },
  { re: /\b(phone|mobile|cell)\b/, not: /type|device|country code/, value: (p) => p.phone },
  { re: /address (line )?(2|two)|\b(apt|apartment|suite|unit)\b/, value: (p) => p.address2 },
  { re: /address|street/, not: /e-?mail|web|ip address/, value: (p) => p.address1 },
  { re: /\b(city|town)\b/, not: /preferred|office|location (preference|you)/, value: (p) => p.city },
  {
    re: /\bstate\b|province|region/,
    not: /statement|united states|preferred|office/,
    value: (p, f) => (f.options?.length ? p.state : (US_STATES[p.state.toUpperCase()] ? p.state.toUpperCase() : p.state)),
    options: (p) => {
      const full = US_STATES[p.state.toUpperCase()] ?? p.state;
      const abbr = Object.entries(US_STATES).find(([, n]) => n.toLowerCase() === p.state.toLowerCase())?.[0] ?? p.state;
      return [new RegExp(`^${escape(full)}$`, "i"), new RegExp(`^${escape(abbr)}$`, "i")];
    },
  },
  { re: /\bzip\b|postal|post code/, value: (p) => p.zip },
  { re: /country/, not: /code|citizen/, value: (p) => p.country, options: (p) => (/^(us|usa|united states)/i.test(p.country) ? [/^united states( of america)?$/i, /^usa?$/i] : []) },
  { re: /linked ?in/, value: (p) => p.linkedin },
  { re: /website|portfolio|github|personal (site|url)/, value: (p) => p.website },
  { re: /\bgpa\b|grade point/, not: /scale|out of/, value: (p) => p.gpa },
  { re: /(school|university|college|institution)( name)?\b/, not: /high school|graduat|year|degree|major|gpa|city|state|attend.*before/, value: (p) => p.school },
  { re: /\bmajor\b|field of study|concentration|discipline/, not: /minor/, value: (p) => p.major },
  { re: /\bdegree\b|level of education/, not: /year|date/, value: (p) => p.degree },
  // "Will you be graduating in either winter of 2027 or summer of 2028?": yes when the graduation date this application
  // uses (gradAs: your early date for such a posting) falls in a year it names.
  { long: true,
    re: /(will|are|do) you (be |expect to )?graduat|expect(ed)? to graduate (in|between|by)|graduating (in|between|by|either)/,
    not: /date|month|year\b(?! (of|in) )/,
    value: (p, f) => {
      const years = (f.label.match(/20\d{2}/g) ?? []).map(Number);
      const g = grad(p);
      if (!years.length || !g) return undefined;
      return years.includes(Number(g.year)) ? "yes" : "no";
    },
  },
  { long: true,
    // Greenhouse's education block asks "End date month" / "End date year": your graduation.
    re: /graduat|expected (completion|end)|class year|year of graduation|degree end|^end date( (month|year|\(mm\/dd\/yyyy\)))?$|^end (month|year)$|^(education )?end date/,
    value: (p, f) => {
      const g = grad(p);
      if (!g) return undefined;
      const l = norm(f.label);
      if (/month/.test(l)) return g.month;
      if (/year/.test(l) && !/month/.test(l)) return g.year;
      if (f.kind === "month" || f.kind === "date") return f.kind === "month" ? `${g.year}-${g.mm}` : `${g.year}-${g.mm}-${g.dd}`;
      // A typed date ("End date", "Expected graduation date (MM/DD/YYYY)"): the full date.
      if (/date|mm\/dd|dd\/mm/.test(l) && !f.options?.length) return /dd\/mm/.test(l) ? `${g.dd}/${g.mm}/${g.year}` : `${g.mm}/${g.dd}/${g.year}`;
      return f.options?.length ? g.year : `${g.month} ${g.year}`;
    },
    options: (p) => {
      const g = grad(p);
      return g ? [new RegExp(`^${g.year}$`), new RegExp(`${g.month}.*${g.year}`, "i"), new RegExp(`^${g.month}$`, "i")] : [];
    },
  },
  { long: true, re: /(legally )?(authori[sz]ed|eligible|permitted) to work|work authori[sz]ation|right to work/, value: (p) => p.authorized, sensitive: true },
  { long: true,
    re: /sponsor/,
    value: (p, f) => {
      const l = norm(f.label);
      // "now or in the future" asks both: yes if either is yes.
      if (/future/.test(l) && /(now|current)/.test(l)) return p.sponsorNow === "yes" || p.sponsorFuture === "yes" ? "yes" : p.sponsorNow && p.sponsorFuture ? "no" : "";
      if (/future/.test(l)) return p.sponsorFuture;
      return p.sponsorNow || p.sponsorFuture;
    },
    sensitive: true,
  },
  { long: true, re: /citizen|visa (status|type)|immigration|nationality/, value: (p) => p.citizenship, sensitive: true },
  { re: /\b(at least|over|older than|under)\b.*\b18\b|\b18\b.*\b(years|older|of age)\b|legal (working )?age/, not: /\$|salary/, value: (p) => p.over18, long: true },
  { long: true, re: /hispanic|latin[oax]/, not: /race.*(and|or)|ethnicit(y|ies) \(/, value: (p) => p.hispanic, sensitive: true },
  { long: true, re: /\brace\b|ethnicit/, value: (p) => p.race, options: (p) => RACE[p.race] ?? [], sensitive: true },
  { long: true, re: /gender|\bsex\b/, not: /identity.*transgender|transgender/, value: (p) => p.gender, options: (p) => GENDER[p.gender] ?? [], sensitive: true },
  { long: true, re: /transgender/, value: (p) => p.transgender, sensitive: true },
  { long: true, re: /sexual orientation|lgbt/, value: (p) => p.orientation, sensitive: true },
  { long: true, re: /pronoun/, value: (p) => p.pronouns, sensitive: true },
  { long: true, re: /veteran|military|armed forces|protected veteran/, value: (p) => p.veteran, options: (p) => VETERAN[p.veteran] ?? [], sensitive: true },
  { long: true, re: /disabilit/, value: (p) => p.disability, options: (p) => DISABILITY[p.disability] ?? [], sensitive: true },
  { long: true, re: /hear about|how did you (learn|find)|referral source|source of (application|referral)/, value: (p) => p.howHeard },
  { long: true, re: /relocat/, value: (p) => p.relocate },
  { long: true, re: /start date|available to start|availability|earliest (date|start)/, not: /interview|^start date (month|year)$/, value: (p) => p.startDate },
  // "Are you able to perform the essential functions of the position, with or without reasonable accommodation?"
  { long: true, re: /essential functions/, value: () => "yes" },
  { long: true, re: /driver'?s? licen[cs]e/, not: /number|no\b|#|\bid\b|state/, value: (p) => p.driversLicense, why: "Set “Valid driver's license?” in Applications → My info." },
];

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What to type into a typeahead for a stored answer ("decline" → words most forms' decline option starts with). */
function typeaheadText(want: string) {
  return want === "yes" ? "Yes" : want === "no" ? "No" : want === "decline" ? "Decline" : want;
}

/** Other spellings to match a typeahead's suggestions against ("WA" → "Washington", decline phrasings…). */
function typeaheadAlts(want: string, synonyms: RegExp[]): string[] {
  const out = new Set<string>([typeaheadText(want)]);
  if (want === "decline") ["Prefer not to say", "I don't wish to answer", "Do not wish to disclose", "Choose not to disclose"].forEach((x) => out.add(x));
  const full = US_STATES[want.toUpperCase()];
  if (full) out.add(full);
  if (/^(us|usa|united states)$/i.test(want)) ["United States", "United States of America", "USA"].forEach((x) => out.add(x));
  for (const re of synonyms) {
    const plain = re.source.replace(/\\b|[\^$()?:]/g, "").split("|")[0];
    if (/^[\w ,.'&-]{3,}$/.test(plain)) out.add(plain);
  }
  return [...out].slice(0, 8);
}

const UC_CAMPUS: Record<string, string> = { UCLA: "Los Angeles", UCB: "Berkeley", UCSD: "San Diego", UCI: "Irvine", UCSB: "Santa Barbara", UCD: "Davis", UCSC: "Santa Cruz", UCR: "Riverside", UCM: "Merced" };

/**
 * How a school can be written in a site's school search (owner, 2026-10-26: Greenhouse lists UCLA as "University of
 * California - Los Angeles"). `accept` = names an option must contain (every word, any punctuation) or the acronym as
 * a word; `search` = what to type, in order (full name, acronym, the part after the comma, the first words). A city
 * alone ("Los Angeles") is only ever typed, never accepted, so "Los Angeles City College" can't be picked.
 */
export function schoolNames(school: string): { accept: string[]; search: string[] } {
  const given = school.trim();
  const key = given.toUpperCase().replace(/[^A-Z]/g, "");
  const full = UC_CAMPUS[key] ? `University of California, ${UC_CAMPUS[key]}` : given;
  const words = full.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean);
  const acronym = words.filter((w) => !/^(of|the|at|and|in|for)$/i.test(w)).map((w) => w[0].toUpperCase()).join("");
  const tail = full.includes(",") ? full.split(",").pop()!.trim() : "";
  const uniq = (xs: string[]) => [...new Set(xs.filter((x) => x && x.length >= 2))];
  return {
    accept: uniq([full, given, acronym.length >= 3 ? acronym : ""]),
    search: uniq([full, acronym.length >= 3 ? acronym : "", tail, words.slice(0, 3).join(" ")]).slice(0, 4),
  };
}

/** A sentence-style prompt ("Please state why…", "Describe…"), not a short fact field. */
const ASKS = /^(why|how|what|describe|tell|explain|please|share|in \d+|briefly|list)\b/i;

/** Looks like an open question for the AI (not a short fact field it couldn't place). */
const isQuestion = (f: FormField) => f.kind === "textarea" || (f.kind === "text" && (f.label.length > 45 || /\?\s*$/.test(f.label) || ASKS.test(f.label.trim())));

/**
 * Decide what goes in each field. Rules from your profile first (sensitive answers ONLY from rules); open
 * questions go to `ai`; anything else is left for you with a reason.
 */
export function planFill(
  fields: FormField[],
  profile: ApplyProfile,
  opts: { hasResume: boolean; coverText?: string; learned?: Record<string, { value: string; kind?: string }>; autoConsent?: boolean },
): FillPlan {
  const items: FillItem[] = [];
  const ai: FormField[] = [];
  const skipped: FillPlan["skipped"] = [];
  const skip = (f: FormField, why: string) => skipped.push({ id: f.id, label: f.label, why });

  // Sites often hide the file input behind an "Attach" / "Upload resume" link, so it has no label of its own. When it's
  // the form's only file input, it's the resume.
  const onlyFile = fields.filter((f) => f.kind === "file").length === 1;
  // The resume goes into ONE upload field (owner, 2026-10-26: it once went into the cover letter box too).
  let resumeUsed = false;
  const fileLabels = fields.filter((f) => f.kind === "file").map((f) => norm(f.label || ""));
  const resumeNamed = fileLabels.some((l) => /resume|\bcv\b|curriculum/.test(l));
  for (const f of fields) {
    const label = norm(f.label || f.placeholder || "");
    if (!label && f.kind === "file" && onlyFile && !f.filled) {
      if (opts.hasResume) items.push({ id: f.id, file: "resume", source: "resume", label: "Resume (upload link)" });
      else skip(f, "No resume uploaded on Applications → Resumes.");
      resumeUsed = true;
      continue;
    }
    if (!label) {
      if (!f.filled) skip(f, "No label: couldn't tell what it asks.");
      continue;
    }
    if (NEVER_FILL.test(label)) {
      skip(f, "Never filled automatically (sensitive). Type it yourself if the form really needs it.");
      continue;
    }
    if (f.filled) continue;
    if (f.kind === "file") {
      if (/cover/.test(label)) {
        if (opts.coverText) items.push({ id: f.id, file: "cover", source: "profile", label: f.label, note: "Your cover letter template, dated today, with this firm's name" });
        else skip(f, "Cover letter: add your template under Applications → Writing (kind: Cover letter) and it's attached for you.");
        continue;
      }
      const named = /resume|\bcv\b|curriculum/.test(label);
      // A field that doesn't say what it's for gets the resume only when no field is named "resume" and none got it yet.
      if (!resumeUsed && (named || (!resumeNamed && !/transcript|portfolio|writing sample|photo|image|additional|other/.test(label)))) {
        if (opts.hasResume) items.push({ id: f.id, file: "resume", source: "resume", label: f.label });
        else skip(f, "No resume uploaded on Applications → Resumes.");
        resumeUsed = true;
      } else skip(f, "Attach this file yourself (couldn't tell it's for your resume).");
      continue;
    }
    if (f.kind === "textarea" && /cover letter/.test(label) && opts.coverText) {
      items.push({ id: f.id, value: f.maxLength ? opts.coverText.slice(0, f.maxLength) : opts.coverText, source: "profile", label: f.label, note: "Your cover letter template, dated today, with this firm's name" });
      continue;
    }
    // Eligibility confirmations ("I certify that I am at least 18", "I am authorized to work in the U.S.", "I will not
    // require sponsorship") are answered from My info even when worded as a certification (owner, 2026-10-26: only 2 of
    // 5 eligibility boxes were ticked). Other certifications / consents stay yours.
    if ((f.kind === "checkbox" || f.kind === "checkboxes") && ATTEST.test(label) && !ELIGIBILITY.test(label)) {
      // The extension's Auto mode (owner, 2026-10-28): data-privacy / terms / consent boxes are ticked for you.
      if (opts.autoConsent && f.kind === "checkbox") items.push({ id: f.id, checked: true, source: "profile", label: f.label, note: "Auto mode: consent / privacy box ticked" });
      else skip(f, "Consent / certification: tick it yourself after reading it.");
      continue;
    }
    if (/salary|compensation|pay (range|expectation)|desired pay/.test(label)) {
      skip(f, "Salary: yours to answer.");
      continue;
    }

    // Short fact rules ("City", "Major") never answer a sentence-style question ("Please state why you chose your major").
    const asks = ASKS.test(label);
    const rule = RULES.find((r) => r.re.test(label) && !(r.not && r.not.test(label)) && (r.long || (label.length <= 60 && !asks)));
    if (rule) {
      const want = rule.value(profile, f)?.trim() ?? "";
      if (!want) {
        skip(f, rule.why ?? (rule.sensitive ? "Not set in your info (Applications → My info), so it's left for you." : "Not in your info yet (Applications → My info)."));
        continue;
      }
      if (f.options?.length && (f.kind === "select" || f.kind === "radio" || f.kind === "listbox")) {
        const schoolSyn = /school\|university/.test(rule.re.source) ? schoolNames(want).accept.map((n) => new RegExp(n.replace(/[^A-Za-z0-9]+/g, "[^A-Za-z0-9]+"), "i")) : [];
        const value = pickOption(f.options, want, [...(rule.options?.(profile) ?? []), ...schoolSyn]);
        if (value === undefined) skip(f, `None of the options matched your answer ("${want}").`);
        else items.push({ id: f.id, value, source: "profile", label: f.label, optionLabel: f.options.find((o) => o.value === value)?.label });
      } else if (f.kind === "listbox") {
        skip(f, "A dropdown whose choices couldn't be read: pick it yourself.");
      } else if (f.kind === "typeahead") {
        if (/school\|university/.test(rule.re.source)) {
          // School searches differ per site: try several wordings, accept only a real match (schoolNames).
          const names = schoolNames(want);
          items.push({ id: f.id, value: names.search[0], alts: names.accept, search: names.search, strict: true, source: "profile", label: f.label });
        } else items.push({ id: f.id, value: typeaheadText(want), alts: typeaheadAlts(want, rule.options?.(profile) ?? []), source: "profile", label: f.label });
      } else if (f.kind === "checkbox") {
        // A box states something; tick it when the statement is true for you. "I will NOT require sponsorship" / "I am
        // under 18" say the opposite of the question, so a "no" answer ticks them.
        const negative = /\b(not|n't|never|no longer|without)\b|\bunder (the age of )?18\b|younger than 18/.test(label);
        if (want === "yes" || want === "no") items.push({ id: f.id, checked: (want === "yes") !== negative, source: "profile", label: f.label });
        else skip(f, "A tick box for this: set it yourself.");
      } else if (f.kind === "checkboxes") {
        // Race "select all that apply" and similar: tick the one that matches.
        const value = pickOption(f.options ?? [], want, rule.options?.(profile) ?? []);
        if (value === undefined) skip(f, `None of the options matched your answer ("${want}").`);
        else items.push({ id: f.id, value, source: "profile", label: f.label });
      } else {
        // A yes/no stored as a word typed into a text box reads "Yes" / "No".
        const text = want === "yes" ? "Yes" : want === "no" ? "No" : want === "decline" ? "Prefer not to say" : want;
        items.push({ id: f.id, value: f.maxLength ? text.slice(0, f.maxLength) : text, source: "profile", label: f.label });
      }
      continue;
    }

    // An answer that worked for this question on this platform before (another firm's Workday…): reused, no AI call.
    const prior = opts.learned?.[learnKey(f.label)];
    if (prior && !NEVER_LEARN.test(label)) {
      if (f.options?.length && (f.kind === "select" || f.kind === "radio" || f.kind === "listbox")) {
        const value = pickOption(f.options, prior.value, []);
        if (value !== undefined) {
          items.push({ id: f.id, value, source: "profile", label: f.label, optionLabel: f.options.find((o) => o.value === value)?.label, note: "Learned from an earlier application on this platform" });
          continue;
        }
      } else if (["text", "email", "tel", "url", "number", "typeahead"].includes(f.kind)) {
        items.push({ id: f.id, value: prior.value, source: "profile", label: f.label, note: "Learned from an earlier application on this platform" });
        continue;
      }
    }
    // Optional open questions ("Is there any additional information you'd like to provide? This is optional") stay
    // blank (owner, 2026-10-26: one was answered with a cover letter). Required ones still go to the AI.
    if (!f.required && (f.kind === "textarea" || f.kind === "text") && (/\boptional\b/.test(label) || /additional information|anything else|supplement(al)? (information|to your application)|other information|is there anything/.test(label))) {
      skip(f, "Optional question: left blank (answer it yourself if you want to).");
      continue;
    }
    if (isQuestion(f) || ((f.kind === "select" || f.kind === "radio" || f.kind === "listbox") && f.options?.length)) ai.push(f);
    else if (f.kind === "typeahead") skip(f, "A pick-from-suggestions box this couldn't place: choose it yourself.");
    else skip(f, "Not sure what goes here: fill it yourself.");
  }
  return { items, ai, skipped };
}

/** Guess company and role from a job link (the user can edit both). */
export function guessFromUrl(url: string): { company: string; host: string } {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    // Workday: <company>.wd5.myworkdayjobs.com · Greenhouse: boards.greenhouse.io/<company> · Lever: jobs.lever.co/<company>
    const path = u.pathname.split("/").filter(Boolean);
    let company = "";
    if (/myworkdayjobs\.com$/.test(host)) company = host.split(".")[0];
    else if (/greenhouse\.io$|lever\.co$|ashbyhq\.com$|smartrecruiters\.com$/.test(host)) company = path[0] ?? "";
    else if (/oraclecloud\.com$/.test(host)) company = host.split(".")[0];
    else company = host.split(".").slice(-2, -1)[0] ?? host;
    company = company.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { company, host };
  } catch {
    return { company: "", host: "" };
  }
}

/** Is this page (by its address) the job's site? Same host, or the same application platform account. */
export function sameJobSite(jobUrl: string, pageUrl: string): boolean {
  try {
    const a = new URL(jobUrl).hostname.replace(/^www\./, "");
    const b = new URL(pageUrl).hostname.replace(/^www\./, "");
    return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
  } catch {
    return false;
  }
}

/**
 * Application systems banks use. Autofill runs on these, or on a job you're tracking; any other site needs a
 * second click ("Fill <site> anyway?"), so a page you didn't mean to give your info to doesn't get it by accident.
 */
const KNOWN_ATS =
  /(^|\.)(myworkdayjobs\.com|myworkdaysite\.com|workday\.com|greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|icims\.com|taleo\.net|oraclecloud\.com|successfactors\.(com|eu)|jobvite\.com|brassring\.com|eightfold\.ai|avature\.net|phenompeople\.com|ultipro\.com|ukg\.net|workable\.com|recruitee\.com|bamboohr\.com|applytojob\.com|paylocity\.com|dayforcehcm\.com|csod\.com|hirevue\.com|rippling\.com|gem\.com|teamtailor\.com|personio\.(de|com))$/i;

export function knownJobSite(url: string): boolean {
  try {
    return KNOWN_ATS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** A job sent from LinkedIn by the extension's "Track this job" (`#job=` on /applications). Untrusted: rebuilt with caps. */
export interface JobCapture {
  title: string;
  company: string;
  location: string;
  description: string;
  /** The LinkedIn / Handshake job page. */
  url: string;
  /** The bank's own application page, when LinkedIn shows it. */
  applyUrl?: string;
  linkedinJobId?: string;
  handshakeJobId?: string;
  /** "Save + fill" in the popup: start Fill selected on it right away. */
  fill?: boolean;
}

const webUrl = (v: unknown) => {
  if (typeof v !== "string") return "";
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href.slice(0, 1000) : "";
  } catch {
    return "";
  }
};

export function parseJobCapture(hash: string): JobCapture | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(decodeURIComponent(hash.replace(/^#?job=/, "")));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const url = webUrl(raw.url);
  const title = str(raw.title, 200);
  const company = str(raw.company, 120);
  const host = url ? new URL(url).hostname : "";
  const handshake = /(^|\.)joinhandshake\.com$/i.test(host);
  if (!url || !(/(^|\.)linkedin\.com$/i.test(host) || handshake) || (!title && !company)) return null;
  const applyUrl = webUrl(raw.applyUrl);
  const id = str(raw.linkedinJobId, 30);
  const hsId = str(raw.handshakeJobId, 30);
  return {
    handshakeJobId: handshake && /^\d+$/.test(hsId) ? hsId : undefined,
    fill: raw.fill === true,
    title,
    company,
    location: str(raw.location, 120),
    description: typeof raw.description === "string" ? raw.description.replace(/[ \t]+/g, " ").trim().slice(0, 6000) : "",
    url,
    applyUrl: applyUrl && !/(^|\.)(linkedin|joinhandshake)\.com$/i.test(new URL(applyUrl).hostname) ? applyUrl : undefined,
    linkedinJobId: !handshake && /^\d+$/.test(id) ? id : undefined,
  };
}

/**
 * Which resume a job gets (owner, 2026-10-26: a class-of-2028 posting went out with the class-of-2029 resume): one you
 * picked on the job, else the version marked for the class year the posting asks for (the AI review's class years,
 * or "class of 2028" / "graduating in 2028" in the posting or the form), else the version whose tags match the most
 * words of the job, else your main resume (undefined).
 */
export function chooseResume(
  job: Pick<JobApplication, "resumeId" | "role" | "description" | "review"> | undefined,
  pageText: string,
  resumes: Pick<ApplyResume, "id" | "classYear" | "tags">[],
  /** The class year this application presents (its graduation date's year): that resume wins. */
  preferYear?: number,
  /** Your usual class year: no switch needed for it (the main resume). */
  mainYear?: number,
): string | undefined {
  if (job?.resumeId) return job.resumeId;
  if (!resumes.length) return undefined;
  if (preferYear && preferYear !== mainYear) {
    const hit = resumes.find((r) => r.classYear === preferYear);
    if (hit) return hit.id;
  }
  const text = `${job?.role ?? ""}\n${job?.description ?? ""}\n${pageText}`.toLowerCase();
  const asked = new Set<number>(job?.review?.classYears ?? []);
  for (const m of text.matchAll(/\b(?:class of|graduat(?:e|es|ing|ion)(?: date)?(?: in| between| by)?|expected graduation:?)\s+(?:[a-z]+\s+)?(20\d{2})((?:\s*(?:,|\/|or|and|-|–|to)\s*(?:[a-z]+\s+)?20\d{2})*)/g)) {
    // "class of 2028 or 2029", "graduating between December 2027 and June 2028": every year named.
    for (const y of `${m[1]} ${m[2] ?? ""}`.match(/20\d{2}/g) ?? []) asked.add(Number(y));
  }
  if (asked.size === 1) {
    const year = [...asked][0];
    const hit = resumes.find((r) => r.classYear === year);
    if (hit) return hit.id;
  }
  let best: { id: string; n: number } | undefined;
  for (const r of resumes) {
    const words = (r.tags ?? "").toLowerCase().split(/[,;]+/).map((w) => w.trim()).filter((w) => w.length > 1);
    const n = words.filter((w) => text.includes(w)).length;
    if (n && (!best || n > best.n)) best = { id: r.id, n };
  }
  return best?.id;
}

/**
 * Graduation years a posting / form asks for: class-of years from the AI review, and every year in a sentence about
 * graduating ("Will you be graduating in either winter of 2027 or summer of 2028?", "Class of 2028", "graduating
 * between December 2027 and June 2028").
 */
export function gradYearsAsked(text: string, reviewYears: number[] = []): number[] {
  const out = new Set<number>(reviewYears);
  for (const sentence of text.split(/[.?!\n]+/)) {
    if (!/graduat|class of|degree (completion|conferral)|expected completion/i.test(sentence)) continue;
    for (const y of sentence.match(/\b20\d{2}\b/g) ?? []) out.add(Number(y));
  }
  return [...out].filter((y) => y >= 2020 && y <= 2040);
}

/**
 * The graduation date an application should use: your usual one, unless the posting / form asks for years that leave
 * it out but include your early date (then the early one). Once an application has switched (`current`), it stays.
 */
export function gradFor(profile: Pick<ApplyProfile, "gradDate" | "earlyGradDate">, text: string, reviewYears: number[] = [], current?: string): string {
  if (current) return current;
  const main = Number((profile.gradDate ?? "").slice(0, 4));
  const early = Number((profile.earlyGradDate ?? "").slice(0, 4));
  if (!early || !main || early === main) return profile.gradDate;
  const asked = gradYearsAsked(text, reviewYears);
  return asked.length && !asked.includes(main) && asked.includes(early) ? profile.earlyGradDate : profile.gradDate;
}

/** One application fill, for the agent benchmark (Applications). */
export interface FillRun {
  id: string;
  jobId: string;
  company: string;
  site: string;
  startedAt: string;
  endedAt?: string;
  /** The final status (ready = reached review, needs_you, error…). */
  outcome?: FillStatus;
  /** Fields filled by your saved info (rules), by Jev, by the answer model; fields left for you. */
  rules: number;
  jev: number;
  ai: number;
  learned: number;
  left: number;
  agent?: { provider: string; model: string; vision?: string; steps: number; inTokens: number; cachedTokens: number; outTokens: number; ms: number; failedActions: number; visionSteps: number; outcome: string };
  /** Fields you had to fix before submitting (you enter it): the user-corrected count. */
  fixes?: number;
}

/** The platform an application runs on: answers learned there are reused on the same platform for other firms. */
export function platformOf(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
  for (const [name, re] of [
    ["workday", /myworkdayjobs\.com$|myworkdaysite\.com$|(^|\.)workday\.com$/],
    ["greenhouse", /greenhouse\.io$/],
    ["lever", /lever\.co$/],
    ["icims", /icims\.com$/],
    ["ashby", /ashbyhq\.com$/],
    ["smartrecruiters", /smartrecruiters\.com$/],
    ["taleo", /taleo\.net$/],
    ["oracle", /oraclecloud\.com$/],
    ["successfactors", /successfactors\.(com|eu)$/],
  ] as const)
    if (re.test(host)) return name;
  return host.replace(/^www\./, "");
}

/** A question's label, normalized for matching across sites ("How did you hear about us? *" → "how did you hear about us"). */
export const learnKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

/** Questions never learned or reused: sensitive / demographic / salary / consent ones stay with your rules or with you. */
export const NEVER_LEARN = /gender|\bsex\b|race|ethnic|hispanic|latin|veteran|disab|orientation|transgender|pronoun|salary|compensation|signature|consent|certify|password|ssn|social security|date of birth|birth/i;

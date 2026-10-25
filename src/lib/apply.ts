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

export type JobStatus = "saved" | "applying" | "submitted" | "interview" | "offer" | "rejected" | "withdrawn";

export const JOB_STATUSES: { id: JobStatus; label: string }[] = [
  { id: "saved", label: "To apply" },
  { id: "applying", label: "In progress" },
  { id: "submitted", label: "Submitted" },
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
  /** "2029-06" (month the degree ends). */
  gradDate: string;
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
  /** Free text the AI may draw on: experiences, deals, clubs, skills (your resume in your words). */
  background: string;
  /** Why banking, which groups / offices you want: the AI's facts for "why" questions. */
  interests: string;
  /** How you like to write ("short sentences, no buzzwords"); the samples show it, this says it. */
  styleNotes: string;
}

export const EMPTY_PROFILE: ApplyProfile = {
  firstName: "", lastName: "", preferredName: "", email: "", phone: "", address1: "", address2: "", city: "", state: "", zip: "", country: "United States",
  linkedin: "", website: "", school: "", degree: "", major: "", gpa: "", gradDate: "", authorized: "", sponsorNow: "", sponsorFuture: "", citizenship: "",
  over18: "", gender: "", race: "", hispanic: "", veteran: "", disability: "", orientation: "", transgender: "", pronouns: "", howHeard: "", relocate: "",
  startDate: "", background: "", interests: "", styleNotes: "",
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
  /** Which of your files goes into a file input. */
  file?: "resume";
  /** For a custom dropdown: the option's text (its position can change when the list reopens). */
  optionLabel?: string;
  /** For a typeahead: other ways to say the answer, to match against the suggestions. */
  alts?: string[];
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
  /\b(password|passcode|ssn|social security|social insurance|national insurance|tax id|taxpayer|itin|bank account|routing|account number|iban|swift|credit card|card number|cvv|cvc|security code|driver'?s? licen[cs]e|passport number|mother'?s maiden|date of birth|birth ?date|\bdob\b)/i;

/** A legal attestation or consent box: you tick these yourself. */
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

const grad = (p: ApplyProfile) => {
  const m = p.gradDate.match(/^(\d{4})-(\d{2})/);
  return m ? { year: m[1], month: MONTHS[Number(m[2]) - 1] ?? "", mm: m[2] } : undefined;
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
  { long: true,
    re: /graduat|expected (completion|end)|class year|year of graduation|degree end/,
    value: (p, f) => {
      const g = grad(p);
      if (!g) return undefined;
      const l = norm(f.label);
      if (/month/.test(l)) return g.month;
      if (/year/.test(l) && !/month/.test(l)) return g.year;
      if (f.kind === "month" || f.kind === "date") return f.kind === "month" ? `${g.year}-${g.mm}` : `${g.year}-${g.mm}-01`;
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
  { long: true, re: /start date|available to start|availability|earliest (date|start)/, not: /interview/, value: (p) => p.startDate },
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

/** A sentence-style prompt ("Please state why…", "Describe…"), not a short fact field. */
const ASKS = /^(why|how|what|describe|tell|explain|please|share|in \d+|briefly|list)\b/i;

/** Looks like an open question for the AI (not a short fact field it couldn't place). */
const isQuestion = (f: FormField) => f.kind === "textarea" || (f.kind === "text" && (f.label.length > 45 || /\?\s*$/.test(f.label) || ASKS.test(f.label.trim())));

/**
 * Decide what goes in each field. Rules from your profile first (sensitive answers ONLY from rules); open
 * questions go to `ai`; anything else is left for you with a reason.
 */
export function planFill(fields: FormField[], profile: ApplyProfile, opts: { hasResume: boolean }): FillPlan {
  const items: FillItem[] = [];
  const ai: FormField[] = [];
  const skipped: FillPlan["skipped"] = [];
  const skip = (f: FormField, why: string) => skipped.push({ id: f.id, label: f.label, why });

  for (const f of fields) {
    const label = norm(f.label || f.placeholder || "");
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
      if (/cover/.test(label)) skip(f, "Cover letter: attach one yourself (or paste an AI draft from Writing).");
      else if (/resume|cv|curriculum/.test(label) || !/transcript|portfolio|writing sample|photo|image/.test(label)) {
        if (opts.hasResume) items.push({ id: f.id, file: "resume", source: "resume", label: f.label });
        else skip(f, "No resume uploaded on Applications → Resumes.");
      } else skip(f, "Attach this file yourself.");
      continue;
    }
    if ((f.kind === "checkbox" || f.kind === "checkboxes") && ATTEST.test(label)) {
      skip(f, "Consent / certification: tick it yourself after reading it.");
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
        const value = pickOption(f.options, want, rule.options?.(profile) ?? []);
        if (value === undefined) skip(f, `None of the options matched your answer ("${want}").`);
        else items.push({ id: f.id, value, source: "profile", label: f.label, optionLabel: f.options.find((o) => o.value === value)?.label });
      } else if (f.kind === "listbox") {
        skip(f, "A dropdown whose choices couldn't be read: pick it yourself.");
      } else if (f.kind === "typeahead") {
        items.push({ id: f.id, value: typeaheadText(want), alts: typeaheadAlts(want, rule.options?.(profile) ?? []), source: "profile", label: f.label });
      } else if (f.kind === "checkbox") {
        if (want === "yes" || want === "no") items.push({ id: f.id, checked: want === "yes", source: "profile", label: f.label });
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
  /** The LinkedIn job page. */
  url: string;
  /** The bank's own application page, when LinkedIn shows it. */
  applyUrl?: string;
  linkedinJobId?: string;
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
  if (!url || !/(^|\.)linkedin\.com$/i.test(new URL(url).hostname) || (!title && !company)) return null;
  const applyUrl = webUrl(raw.applyUrl);
  const id = str(raw.linkedinJobId, 30);
  return {
    title,
    company,
    location: str(raw.location, 120),
    description: typeof raw.description === "string" ? raw.description.replace(/[ \t]+/g, " ").trim().slice(0, 6000) : "",
    url,
    applyUrl: applyUrl && !/(^|\.)linkedin\.com$/i.test(new URL(applyUrl).hostname) ? applyUrl : undefined,
    linkedinJobId: /^\d+$/.test(id) ? id : undefined,
  };
}

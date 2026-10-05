/**
 * The owner's outreach rules (docs/outreach-rules.md, Part A): who to email, how the first email is built, and the
 * experiments every first email is tagged with.
 *
 * A first email is 3 short paragraphs:
 *   1. "I hope this email finds you well! My name is …, I'm a … student at … interested in investment banking." + the tech
 *      hook (only for Tech/TMT people; base intro + {{my_pitch}}).
 *   2. One affinity / career-path hook + the ask ({{outreach_hook}} {{base_ask}}, where the base ask is {{outreach_ask}}).
 *   3. The close ({{outreach_close}}), then the sign-off and signature.
 * At most 2 hooks per email (tech + one affinity). Every fact in a hook comes from the person's own profile: a
 * "your path from X to Y" hook is only written when their LinkedIn profile was captured (else the template wording).
 */
import type { Contact, Experiment, Settings } from "./types";
import { canonBank } from "./banks";
import { hookFor } from "./hooks";
import { currentTitle } from "./titles";

/* ---------------- affinity (your own rules: Settings → Outreach rules) ---------------- */

/**
 * What you might have in common with someone, in priority order: a volunteer activity > hometown > heritage > your
 * school / grad school > schools in your city > your school system > your state > nothing (standard).
 */
export type Affinity = "volunteer" | "hometown" | "heritage" | "school" | "grad" | "city" | "system" | "state" | "standard";
export type SchoolGroup = "school" | "grad" | "city" | "system" | "state";

/** Comma-separated words or phrases; "a+b" means both must appear. */
export type MatchList = string;

export interface OutreachRules {
  /** Your undergrad, as people write it (the subject uses Settings → Profile → school nickname, e.g. "Fellow Bruin"). */
  school: { match: MatchList };
  /** Your grad / business school, if any ("Anderson" → "a fellow Bruin from Anderson"). */
  grad: { name: string; match: MatchList };
  /** Other schools in your city ("Fellow LA Student", "went to school in LA"). */
  city: { label: string; match: MatchList };
  /** Your school system ("Fellow UC Student", "went to a UC"). */
  system: { label: string; match: MatchList };
  /** Other schools in your state ("Fellow California Student"). */
  state: { label: string; match: MatchList };
  /** Where you're from: schools and towns there ("Fellow Washingtonian"; the hook uses Settings → Profile → hometown). */
  hometown: { demonym: string; match: MatchList };
  /** A heritage you share, read only from your own notes (Comment column), never guessed from a name. Empty = off. */
  heritage: { word: string };
  /** Volunteer experiences of yours that make a hook when their profile mentions the same thing. */
  volunteer: { match: MatchList; mine: string; theirs: string }[];
  /** Ties that make an MD / Head / Partner OK to email (otherwise the rule is VPs and below). */
  seniorExceptions: ("school" | "grad" | "hometown" | "heritage" | "city" | "system" | "state")[];
}

/** The owner's rules (docs/outreach-rules.md): UCLA, Anderson, LA schools, the UCs, California, Seattle / Washington. */
export const DEFAULT_OUTREACH_RULES: OutreachRules = {
  school: { match: "UCLA, University of California Los Angeles, University of California, Los Angeles, Bruin, Bruins" },
  grad: { name: "Anderson", match: "UCLA Anderson, Anderson School, Anderson grad, Anderson MBA" },
  city: {
    label: "LA",
    match: "USC, University of Southern California, LMU, Loyola Marymount, Occidental, Cal State LA, Cal State Los Angeles, Cal State Long Beach, Cal State Northridge, CSULB, CSUN",
  },
  system: {
    label: "UC",
    match: "UC Berkeley, Berkeley, Berkley, UCSD, UC San Diego, UCI, UC Irvine, UC Davis, UCSB, UC Santa Barbara, UCSC, UC Santa Cruz, UCR, UC Riverside, UC Merced, University of California",
  },
  state: {
    label: "California",
    match: "Stanford, Santa Clara, Pepperdine, Caltech, Claremont, Pomona College, Harvey Mudd, University of San Francisco, USF, San Diego State, SDSU, San Jose State, Cal Poly, Chapman, University of San Diego",
  },
  hometown: {
    demonym: "Washingtonian",
    match: "University of Washington, Washington State University, Washington State, Seattle, Bellevue, Redmond, Kirkland, Tacoma, Spokane, Gonzaga",
  },
  heritage: { word: "Chinese" },
  volunteer: [
    { match: "tutor+volunteer, tutoring+volunteer", mine: "tutoring SAT math to underprivileged children", theirs: "volunteer tutoring experience" },
    { match: "soup kitchen", mine: "working at a soup kitchen", theirs: "volunteer experience" },
  ],
  seniorExceptions: ["school", "grad", "hometown"],
};

export const rulesOf = (s?: Pick<Settings, "outreach">): OutreachRules => s?.outreach ?? DEFAULT_OUTREACH_RULES;

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
/** The first phrase of the list found in the text (as written there), or undefined. "a+b" needs both parts. */
export function findMatch(list: MatchList, text: string): string | undefined {
  for (const phrase of list.split(",").map((x) => x.trim()).filter(Boolean)) {
    const parts = phrase.split("+").map((x) => x.trim()).filter(Boolean);
    const hits = parts.map((part) => text.match(new RegExp(`\\b${escape(part)}\\b`, "i"))?.[0]);
    if (hits.length && hits.every(Boolean)) return hits[0];
  }
  return undefined;
}

export interface AffinityInfo {
  kind: Affinity;
  /** The shared-school group, kept for the heritage subject line ("Fellow Chinese Bruin") and E4. */
  school?: SchoolGroup;
  /** Their school's name as written, for "your time at {school}" / "graduated from {school}". Empty = the AI fills it. */
  schoolName?: string;
  heritage: boolean;
  volunteer?: OutreachRules["volunteer"][number];
  /** They volunteer in some other way: no hook, flag it for the owner. */
  volunteerOther?: boolean;
}

/** What the sheet notes and the captured profile say about their education and background (never their name). */
function evidence(c: Pick<Contact, "school" | "comment" | "headline" | "profile">) {
  const profile = c.profile?.text ?? "";
  const edu = profile.search(/\beducation\b/i);
  return {
    education: [c.school ?? "", c.comment ?? "", c.headline ?? "", edu >= 0 ? profile.slice(edu, edu + 1500) : ""].join(" \n "),
    all: [c.school ?? "", c.comment ?? "", c.headline ?? "", profile].join(" \n "),
  };
}

const looksLikeSchool = (t: string) => /\b(university|college|school|institute)\b/i.test(t);

/**
 * Pick the hook by the rules' priority. Hometown people get the hometown hook, never the heritage one. Heritage is only
 * ever taken from the owner's own notes (the Comment column), never guessed from a name.
 */
export function affinityOf(c: Pick<Contact, "school" | "comment" | "headline" | "profile">, rules: OutreachRules = DEFAULT_OUTREACH_RULES): AffinityInfo {
  const ev = evidence(c);
  const groups: SchoolGroup[] = ["grad", "school", "city", "system", "state"];
  let school: SchoolGroup | undefined;
  let schoolName: string | undefined;
  for (const g of groups) {
    const hit = findMatch(rules[g].match, ev.education);
    if (hit) {
      school = g;
      schoolName = hit;
      break;
    }
  }
  const word = rules.heritage.word.trim();
  const heritage = !!word && new RegExp(`\\b${escape(word)}\\b`, "i").test(c.comment ?? "");
  const volunteer = rules.volunteer.find((v) => v.mine.trim() && findMatch(v.match, ev.all));
  const volunteerOther = !volunteer && /\bvolunteer(?:ing|ed)?\b/i.test(ev.all);
  const base = { school, schoolName, heritage, volunteerOther };
  if (volunteer) return { ...base, kind: "volunteer", volunteer };
  const home = findMatch(rules.hometown.match, ev.all);
  if (home) {
    const named = ev.all.match(/[A-Z][A-Za-z.' ]{2,40} High School/)?.[0];
    return { ...base, kind: "hometown", schoolName: looksLikeSchool(home) ? home : (named?.trim() ?? "") };
  }
  if (heritage) return { ...base, kind: "heritage" };
  return { ...base, kind: school ?? "standard" };
}

/* ---------------- seniority ---------------- */

// Words in any case; "MD" only in capitals so "md" inside ordinary text doesn't count.
const TOP = [/\b(managing director|co-head|global head|group head|head|partner|chairman|vice chair(?:man)?|chair)\b/gi, /\bMD\b/g];
const FORMER = /\b(former|formerly|ex|previously|incoming)\b[\s-]*(?:\w+\s){0,3}$/i;

/** MD / Head / Partner / Group Head (the current role, not a "former" one). These are skipped unless there's an exception. */
export function isTopSenior(title: string | undefined): boolean {
  if (!title) return false;
  return TOP.some((re) => [...title.matchAll(re)].some((m) => !FORMER.test(title.slice(Math.max(0, (m.index ?? 0) - 40), m.index))));
}

/** VP / Director / ED / Principal (allowed, rank lower) and the approved MD+ exceptions get the senior wording. */
export function isSeniorWording(title: string | undefined): boolean {
  const t = currentTitle(title);
  return isTopSenior(title) || ["Vice President", "Senior Vice President", "Director", "Executive Director", "Associate Director", "Principal", "Managing Director", "Partner"].includes(t ?? "");
}

const TIE_LABEL: Record<OutreachRules["seniorExceptions"][number], (r: OutreachRules) => string> = {
  school: () => "your school",
  grad: (r) => r.grad.name || "your grad school",
  hometown: (r) => r.hometown.demonym || "your hometown",
  heritage: (r) => r.heritage.word || "heritage",
  city: (r) => `${r.city.label} schools`,
  system: (r) => `${r.system.label} schools`,
  state: (r) => `${r.state.label} schools`,
};

/** The tie that lets an MD+ be emailed (Settings → Outreach rules → senior exceptions), or undefined. */
export function seniorException(c: Pick<Contact, "school" | "comment" | "headline" | "profile" | "location">, rules: OutreachRules = DEFAULT_OUTREACH_RULES): string | undefined {
  const a = affinityOf(c, rules);
  const ok = new Set(rules.seniorExceptions);
  if (a.school && ok.has(a.school)) return a.schoolName || TIE_LABEL[a.school](rules);
  if (ok.has("hometown") && (a.kind === "hometown" || findMatch(rules.hometown.match, c.location ?? ""))) return TIE_LABEL.hometown(rules);
  if (ok.has("heritage") && a.heritage) return TIE_LABEL.heritage(rules);
  return undefined;
}

/** Why an MD+ shouldn't be emailed (undefined = fine). */
export function seniorSkipReason(c: Pick<Contact, "position" | "headline" | "school" | "comment" | "profile" | "location">, rules: OutreachRules = DEFAULT_OUTREACH_RULES): string | undefined {
  const title = c.position || c.headline;
  if (!isTopSenior(title)) return undefined;
  if (seniorException(c, rules)) return undefined;
  const ties = rules.seniorExceptions.map((t) => TIE_LABEL[t](rules)).join(" / ");
  return `${title} (MD / Head / Partner${ties ? `, no ${ties} tie` : ""})`;
}

/* ---------------- experiments ---------------- */

export const OUTREACH_EXPERIMENT_IDS = { ask: "exp_e1_ask", close: "exp_e2_close", tailored: "exp_e3_tailored", journey: "exp_e4_journey" } as const;

/** E1–E4 from the owner's outreach (tagged on every first email, read from replies). Weights are target shares. */
export const OUTREACH_EXPERIMENTS: Experiment[] = [
  {
    id: OUTREACH_EXPERIMENT_IDS.ask,
    name: "E1 · Ask lead-in",
    kind: "custom",
    mode: "alternate",
    status: "running",
    startedAt: "2026-10-01T00:00:00.000Z",
    arms: [
      { id: "A", label: "E1-A “I know that as a …”", weight: 50 },
      { id: "B", label: "E1-B “If you happen to be available…”", weight: 50 },
    ],
  },
  {
    id: OUTREACH_EXPERIMENT_IDS.close,
    name: "E2 · Close",
    kind: "custom",
    mode: "alternate",
    status: "running",
    startedAt: "2026-10-01T00:00:00.000Z",
    arms: [
      { id: "1", label: "E2-1 “…look forward to hearing from you soon!”", weight: 50 },
      { id: "2", label: "E2-2 “…hope we get a chance to connect!”", weight: 50 },
    ],
  },
  {
    id: OUTREACH_EXPERIMENT_IDS.tailored,
    name: "E3 · Tailored vs template hook",
    kind: "custom",
    mode: "alternate",
    status: "running",
    startedAt: "2026-10-01T00:00:00.000Z",
    arms: [
      { id: "tailored", label: "Tailored (career path)", weight: 80 },
      { id: "template", label: "Template", weight: 20 },
    ],
  },
  {
    id: OUTREACH_EXPERIMENT_IDS.journey,
    name: "E4 · “Shaped that journey” (Bruin / UC / LA)",
    kind: "custom",
    mode: "alternate",
    status: "running",
    startedAt: "2026-10-01T00:00:00.000Z",
    arms: [
      { id: "A", label: "E4-A “…shaped that journey”", weight: 70 },
      { id: "B", label: "E4-B control (“…reach out to learn more”)", weight: 30 },
    ],
  },
];

/**
 * Weighted assignment by target share: the arm furthest below its share of the drafts so far gets the next one
 * (80/20 gives 4 tailored then 1 template, and stays on target in any batch size). Equal weights = least used.
 */
export function pickWeighted<T extends { id: string; weight?: number }>(arms: T[], counts: Map<string, number>): T {
  const total = arms.reduce((n, a) => n + (counts.get(a.id) ?? 0), 0) + 1;
  const weightSum = arms.reduce((n, a) => n + (a.weight ?? 1), 0);
  const deficit = (a: T) => ((a.weight ?? 1) / weightSum) * total - (counts.get(a.id) ?? 0);
  return [...arms].sort((a, b) => deficit(b) - deficit(a) || Math.random() - 0.5)[0];
}

/* ---------------- composing the email ---------------- */

/** School ties that get the "shaped that journey" line (E4). */
const JOURNEY = new Set<Affinity>(["school", "grad", "city", "system"]);

/** The "{X} to {Y}" career-path fact, written by the AI from the captured LinkedIn Experience section only. */
const PATH =
  "[[AI: their career path as \"{previous firm + group} to {current firm + group}\", e.g. \"LionTree's software team to PJT's Software / AI group\". Use ONLY the Experience section of their LinkedIn profile in the facts; never guess]]";

/** "Greenhill-Mizuho" for the merged Greenhill / Mizuho M&A business (people list either name). */
export function emailBankName(c: Pick<Contact, "bank" | "position" | "team">): string {
  const k = canonBank(c.bank);
  if (k === "greenhill" || (k === "mizuho" && /\bM&A\b/.test(`${c.position} ${c.team ?? ""}`))) return "Greenhill-Mizuho";
  return c.bank;
}

/** "a UC", "an SEC school", "an Ivy": acronyms go by how the first letter is said, words by their first letter. */
const article = (w: string) => (/^[A-Z]{2,}\b/.test(w) ? (/^[AEFHILMNORSX]/.test(w) ? "an" : "a") : /^[aeiou]/i.test(w) ? "an" : "a");

export interface OutreachPlan {
  affinity: AffinityInfo;
  subject: string;
  /** Paragraph 2's hook (may already contain the ask, for volunteer hooks). */
  hook: string;
  ask: string;
  close: string;
  /** Whether paragraph 1 carries the tech hook. */
  techHook: boolean;
  /** Experiment arms that actually shaped this email (what gets recorded). */
  arms: Record<string, string>;
  /** Things the owner should look at before sending. */
  flags: string[];
}

/**
 * Build paragraph 2 + 3 for a first email from the contact, your outreach rules, and the experiment arms already
 * assigned to them (`c.trial.arms`; missing arms use the majority arm). Arms that couldn't apply are corrected, e.g.
 * E1-A on a two-hook email becomes E1-B, so results reflect what was really sent.
 */
export function composeOutreach(c: Contact, s: Settings): OutreachPlan {
  const X = OUTREACH_EXPERIMENT_IDS;
  const rules = rulesOf(s);
  const want = c.trial?.arms ?? {};
  const a = affinityOf(c, rules);
  const flags: string[] = [];
  const tailoredOk = !!c.profile?.text?.trim();
  // Paragraph 1's tech hook comes from the Hooks (Tech/TMT/software teams); a volunteer email carries only the volunteer hook.
  const techHook = !!hookFor(c, s).text && a.kind !== "volunteer";
  const senior = isSeniorWording(c.position);
  const arms: Record<string, string> = {};
  const p = s.profile;
  const my = { school: p.school || "my school", nick: p.schoolNickname || `${p.school || "school"} student`, home: p.hometown || "my hometown" };
  const bank = emailBankName(c);
  const own = (k?: SchoolGroup) => k === "school" || k === "grad";

  // E3: tailored only with a verified path fact (a captured profile); otherwise it's the template wording, untagged.
  const tailored = tailoredOk && (want[X.tailored] ?? "tailored") === "tailored";
  if (tailoredOk && !["volunteer", "hometown"].includes(a.kind) && !senior) arms[X.tailored] = tailored ? "tailored" : "template";
  if (!tailoredOk) flags.push("No LinkedIn profile captured: the template hook was used. Capture their profile to write a career-path hook.");
  if (a.volunteerOther) flags.push("Their profile mentions volunteering (none of your volunteer hooks match): no volunteer hook. Worth a look.");

  const theirSchool = (label: string) => a.schoolName || `[[AI: the ${label} school they attended, from the facts]]`;
  const journeyA = tailored && JOURNEY.has(a.kind) && !senior && (want[X.journey] ?? "A") === "A";
  if (tailored && JOURNEY.has(a.kind) && !senior) arms[X.journey] = journeyA ? "A" : "B";

  const { city, system, state, grad, hometown, heritage } = rules;
  const fellow: Partial<Record<Affinity, string>> = {
    school: `Fellow ${my.nick} Seeking to Connect`,
    grad: `Fellow ${my.nick} Seeking to Connect`,
    city: `Fellow ${city.label} Student Seeking to Connect`,
    system: `Fellow ${system.label} Student Seeking to Connect`,
    state: `Fellow ${state.label} Student Seeking to Connect`,
  };
  const why: Partial<Record<Affinity, string>> = {
    school: `seeing how you also went to ${my.school}`,
    grad: `seeing how you're a fellow ${my.nick} from ${grad.name}`,
    city: `seeing how you also went to school in ${city.label}`,
    system: `seeing how you also went to ${article(system.label)} ${system.label}`,
    state: `seeing how you also went to school in ${state.label}`,
  };
  const shaped: Partial<Record<Affinity, string>> = {
    school: `as a fellow ${my.nick}, I'd love to hear how your time at ${my.school} shaped that journey.`,
    grad: `as a fellow ${my.nick}, I'd love to hear how your time at ${my.school} shaped that journey.`,
    system: `as a fellow ${system.label} student, I'd love to hear how your time at ${theirSchool(system.label)} shaped that journey.`,
    city: `as a fellow ${city.label} student, I'd love to hear how your time at ${theirSchool(city.label)} shaped that journey.`,
  };
  const standardSubject = `${my.school} Student Seeking to Connect`;

  let hook: string;
  let subject: string;
  if (a.kind === "volunteer" && a.volunteer) {
    const at = own(a.school) ? `journey at ${my.school}` : `journey to ${bank}`;
    hook = `One of my most meaningful high school experiences was ${a.volunteer.mine}. I'd love to learn more about your ${a.volunteer.theirs || "volunteer experience"} and ${at}. If you happen to be available, I would love the chance to connect for a quick call. I can send my availability, and I've attached my resume for your reference.`;
    subject = fellow[a.school ?? "standard"] ?? standardSubject;
  } else if (senior) {
    // VP / Director / approved exception: the seniority line folds into the hook, humble and bare-bones.
    hook = tailored
      ? `I know you are extremely busy as a {{position}}, but your path from ${PATH} really stood out to me and made me feel that you would have differentiated insights into building a career in investment banking.`
      : `I know you are extremely busy as a {{position}}, but I felt that you would have differentiated insights into building a career in investment banking.`;
    subject = a.kind === "hometown" && hometown.demonym ? `Fellow ${hometown.demonym} Seeking to Connect` : (fellow[a.school ?? "standard"] ?? standardSubject);
  } else if (a.kind === "hometown") {
    const school = a.schoolName || `[[AI: the school near ${my.home} they graduated from, from the facts]]`;
    hook = `While looking through your profile, I noticed that you graduated from ${school}. Being from ${my.home} myself, I thought it would be great to speak with someone else who lived in my hometown.`;
    subject = hometown.demonym ? `Fellow ${hometown.demonym} Seeking to Connect` : standardSubject;
  } else if (a.kind === "heritage") {
    const word = heritage.word;
    hook = tailored
      ? `Being ${word} myself, your path from ${PATH} really stood out, and I wanted to reach out to learn more.`
      : `Being ${word} myself, I wanted to reach out to you specifically to hear more about your journey and how you found yourself at ${bank}.`;
    const shared = own(a.school) ? `Fellow ${word} ${my.nick}` : a.school === "system" ? `Fellow ${word} ${system.label} Student` : a.school === "city" ? `Fellow ${word} ${city.label} Student` : "";
    subject = shared ? `${shared} Seeking to Connect` : `${word} Student Seeking to Connect`;
  } else if (a.kind === "standard") {
    hook = tailored ? `Your path from ${PATH} stood out to me, and I wanted to reach out to learn more.` : `I wanted to reach out to you because I'm interested in learning more about investment banking at ${bank}.`;
    subject = standardSubject;
  } else {
    hook = journeyA
      ? `Your path from ${PATH} really stood out to me, and ${shaped[a.kind]}`
      : tailored
        ? `Your path from ${PATH} stood out to me, and ${why[a.kind]}, I wanted to reach out to learn more.`
        : `${why[a.kind]![0].toUpperCase()}${why[a.kind]!.slice(1)}, I wanted to reach out to you specifically to hear more about your journey and how you found yourself at ${bank} after graduation.`;
    subject = fellow[a.kind]!;
  }

  // E1: "A" only on short emails (one hook) and never after the senior line (it already says they're busy).
  let ask = "";
  if (a.kind !== "volunteer") {
    const askA = (want[X.ask] ?? "A") === "A" && !techHook && !senior;
    arms[X.ask] = askA ? "A" : "B";
    ask = askA
      ? `I know that as a {{position}}, you must place a lot of value on your time, but if you happen to be available, ${journeyA ? "I would really appreciate a quick call sometime" : "I would love to have a call sometime"}. If so, I can send my availability, and I have attached my resume for your reference.`
      : "If you happen to be available, I would greatly appreciate the chance to connect over a quick call sometime. I have attached my resume for reference and can send my availability if needed.";
  }
  const closeArm = want[X.close] ?? "1";
  arms[X.close] = closeArm === "2" ? "2" : "1";
  const close = closeArm === "2" ? "Thank you for your time; hope we get a chance to connect!" : "Thank you for your time, and I look forward to hearing from you soon!";

  return { affinity: a, subject, hook, ask, close, techHook, arms, flags };
}

/**
 * Arms for the running outreach experiments, assigned when the draft text is written (the text depends on them).
 * A contact keeps arms it already has, so re-drafting doesn't move them. `tally` = drafts per arm so far (trialTally).
 */
export function assignOutreachArms(c: Contact, s: Settings, tally: Map<string, Map<string, number>>): Record<string, string> {
  const ids = new Set<string>(Object.values(OUTREACH_EXPERIMENT_IDS));
  const arms = { ...(c.trial?.arms ?? {}) };
  for (const e of s.experiments ?? []) {
    if (!ids.has(e.id) || e.status !== "running" || !e.arms.length || arms[e.id]) continue;
    const counts = tally.get(e.id) ?? new Map<string, number>();
    const a = e.mode === "wave" ? (e.arms.find((x) => x.id === e.currentArm) ?? e.arms[0]) : pickWeighted(e.arms, counts);
    arms[e.id] = a.id;
  }
  return arms;
}

/** Record what composeOutreach actually used (and count it), dropping arms that didn't apply to this email. */
export function settleOutreachArms(assigned: Record<string, string>, used: Record<string, string>, tally: Map<string, Map<string, number>>) {
  const ids = new Set<string>(Object.values(OUTREACH_EXPERIMENT_IDS));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(assigned)) if (!ids.has(k)) out[k] = v;
  for (const [k, v] of Object.entries(used)) {
    out[k] = v;
    const m = tally.get(k) ?? new Map<string, number>();
    m.set(v, (m.get(v) ?? 0) + 1);
    tally.set(k, m);
  }
  return out;
}

/* ---------------- checks before drafting ---------------- */

/**
 * Only verified addresses get a draft. Addresses from the owner's sheet, typed by hand, or seen in Gmail count as
 * verified; an enricher's only when that provider verified it (Apollo "verified", Hunter "valid").
 */
export function emailVerified(c: Pick<Contact, "email" | "emailSource" | "emailStatus">): boolean {
  if (!c.email) return false;
  if (c.emailSource === "apollo") return c.emailStatus === "verified";
  if (c.emailSource === "hunter") return /^valid\b/.test(c.emailStatus ?? "");
  return true;
}

/** Their LinkedIn headline names a different current employer (e.g. they left banking for a startup). */
export function leftFirm(c: Pick<Contact, "bank" | "headline">): string | undefined {
  const current = (c.headline ?? "").split(/\s[|•·]\s/)[0];
  const m = current.match(/(?:\bat\b|@)\s+(.+?)\s*$/i);
  const employer = m?.[1]?.trim();
  if (!employer || employer.length < 2 || !c.bank) return undefined;
  const x = canonBank(employer);
  const y = canonBank(c.bank);
  return x === y || x.includes(y) || y.includes(x) ? undefined : employer;
}

/** When to send, by the recipient's office: New York at 5:00 PM PT (8 PM ET), everyone else at 7:00 PM PT. */
export function sendTimeFor(c: Pick<Contact, "region">): { hourPT: number; label: string } {
  return c.region === "NY" ? { hourPT: 17, label: "5:00 PM PT (8 PM ET)" } : { hourPT: 19, label: "7:00 PM PT" };
}

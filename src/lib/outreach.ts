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

/* ---------------- affinity ---------------- */

export type Affinity = "volunteer" | "washington" | "chinese" | "ucla" | "anderson" | "la" | "uc" | "california" | "standard";
export type School = "ucla" | "anderson" | "la" | "uc" | "california";

const SCHOOLS: [School, RegExp][] = [
  ["anderson", /\bucla anderson\b|\banderson school\b|\banderson (?:grad|mba)\b/i],
  ["ucla", /\bucla\b|\buniversity of california,? los angeles\b|\bbruins?\b/i],
  ["la", /\busc\b|\buniversity of southern california\b|\blmu\b|\bloyola marymount\b|\boccidental\b|\bcal state (?:la|los angeles|long beach|northridge)\b|\bcsulb\b|\bcsun\b/i],
  ["uc", /\buc ?berkeley\b|\bberke?ley\b|\bucsd\b|\buc san diego\b|\buci\b|\buc irvine\b|\buc davis\b|\bucsb\b|\buc santa barbara\b|\bucsc\b|\buc santa cruz\b|\bucr\b|\buc riverside\b|\buc merced\b|\buniversity of california\b/i],
  ["california", /\bstanford\b|\bsanta clara\b|\bpepperdine\b|\bcaltech\b|\bclaremont\b|\bpomona college\b|\bharvey mudd\b|\buniversity of san francisco\b|\busf\b|\bsan diego state\b|\bsdsu\b|\bsan jose state\b|\bcal poly\b|\bchapman\b|\buniversity of san diego\b/i],
];
const SCHOOL_NAME: Record<School, RegExp> = {
  anderson: /UCLA Anderson[\w ]*/,
  ucla: /UCLA|University of California,? Los Angeles/i,
  la: /University of Southern California|USC|Loyola Marymount University|LMU|Occidental College|Cal State [A-Z][a-z]+(?: [A-Z][a-z]+)?/,
  uc: /UC [A-Z][a-z]+(?: [A-Z][a-z]+)?|University of California,? [A-Z][a-z]+(?: [A-Z][a-z]+)?|UCSD|UCSB|UCI|UCSC|Berkeley/,
  california: /Stanford University|Santa Clara University|Pepperdine University|Caltech|Claremont McKenna|Pomona College|Harvey Mudd|University of San Francisco|San Diego State|San Jose State|Cal Poly|Chapman University|University of San Diego/,
};
const WA = /\buniversity of washington\b|\bwashington state university\b|\bseattle\b|\bbellevue\b|\bredmond\b|\bkirkland\b|\btacoma\b|\bspokane\b|\bgonzaga\b|\bseattle (?:pacific )?university\b|\b(?:wa|washington) state\b/i;
const WA_SCHOOL = /University of Washington|Washington State University|Seattle University|Seattle Pacific University|Gonzaga University|[A-Z][A-Za-z.' ]{2,40} High School/;

export interface AffinityInfo {
  kind: Affinity;
  /** The shared-school group, kept for the Chinese subject line ("Fellow Chinese Bruin") and E4. */
  school?: School;
  /** Their school's name as written, for "{UC school}" / "{WA school}". Empty = the AI fills it from the profile. */
  schoolName?: string;
  chinese: boolean;
  volunteer?: "tutoring" | "soup_kitchen";
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

/**
 * Pick the hook (priority: volunteer > Washington > Chinese > UCLA/Anderson > USC & LA schools > other UC > other
 * California > standard). Seattle/WA people get the WA hook, never the Chinese one. "Chinese" is only ever taken from
 * the owner's own notes (the Comment column), never guessed from a name.
 */
export function affinityOf(c: Pick<Contact, "school" | "comment" | "headline" | "profile">): AffinityInfo {
  const ev = evidence(c);
  const school = SCHOOLS.find(([, re]) => re.test(ev.education))?.[0];
  const schoolName = school ? (ev.education.match(SCHOOL_NAME[school])?.[0]?.trim() ?? "") : undefined;
  const chinese = /\bchinese\b/i.test(c.comment ?? "");
  const volunteer = /\btutor(?:ing|ed)?\b/i.test(ev.all) && /\bvolunteer/i.test(ev.all) ? "tutoring" : /\bsoup kitchen\b/i.test(ev.all) ? "soup_kitchen" : undefined;
  const volunteerOther = !volunteer && /\bvolunteer(?:ing|ed)?\b/i.test(ev.all);
  const base = { school, schoolName, chinese, volunteerOther };
  if (volunteer) return { ...base, kind: "volunteer", volunteer };
  if (WA.test(ev.all)) return { ...base, kind: "washington", schoolName: ev.all.match(WA_SCHOOL)?.[0]?.trim() ?? "" };
  if (chinese) return { ...base, kind: "chinese" };
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

/** The exception that lets an MD+ be emailed: UCLA / UCLA Anderson, or Seattle / Washington. */
export function seniorException(c: Pick<Contact, "school" | "comment" | "headline" | "profile" | "location">): string | undefined {
  const a = affinityOf(c);
  if (a.school === "ucla" || a.school === "anderson") return a.school === "anderson" ? "UCLA Anderson" : "UCLA";
  if (a.kind === "washington" || /\b(seattle|washington state|wa)\b/i.test(c.location ?? "")) return "Seattle / Washington";
  return undefined;
}

/** Why an MD+ shouldn't be emailed (undefined = fine). */
export function seniorSkipReason(c: Pick<Contact, "position" | "headline" | "school" | "comment" | "profile" | "location">): string | undefined {
  const title = c.position || c.headline;
  if (!isTopSenior(title)) return undefined;
  return seniorException(c) ? undefined : `${title} (MD / Head / Partner, no UCLA or Washington tie)`;
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

const BRUIN_UC_LA = new Set<Affinity>(["ucla", "anderson", "la", "uc"]);

/** The "{X} to {Y}" career-path fact, written by the AI from the captured LinkedIn Experience section only. */
const PATH =
  "[[AI: their career path as \"{previous firm + group} to {current firm + group}\", e.g. \"LionTree's software team to PJT's Software / AI group\". Use ONLY the Experience section of their LinkedIn profile in the facts; never guess]]";

/** "Greenhill-Mizuho" for the merged Greenhill / Mizuho M&A business (people list either name). */
export function emailBankName(c: Pick<Contact, "bank" | "position" | "team">): string {
  const k = canonBank(c.bank);
  if (k === "greenhill" || (k === "mizuho" && /\bM&A\b/.test(`${c.position} ${c.team ?? ""}`))) return "Greenhill-Mizuho";
  return c.bank;
}

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
 * Build paragraph 2 + 3 for a first email from the contact and the experiment arms already assigned to them
 * (`c.trial.arms`; missing arms use the majority arm). Arms that couldn't apply are corrected, e.g. E1-A on a
 * two-hook email becomes E1-B, so results reflect what was really sent.
 */
export function composeOutreach(c: Contact, s: Settings): OutreachPlan {
  const X = OUTREACH_EXPERIMENT_IDS;
  const want = c.trial?.arms ?? {};
  const a = affinityOf(c);
  const flags: string[] = [];
  const tailoredOk = !!c.profile?.text?.trim();
  // Paragraph 1's tech hook comes from the Hooks (Tech/TMT/software teams); a volunteer email carries only the volunteer hook.
  const techHook = !!hookFor(c, s).text && a.kind !== "volunteer";
  const senior = isSeniorWording(c.position);
  const arms: Record<string, string> = {};
  const p = s.profile;
  const my = { school: p.school || "UCLA", nick: p.schoolNickname || "Bruin", home: p.hometown || "Seattle, WA" };
  const bank = emailBankName(c);

  // E3: tailored only with a verified path fact (a captured profile); otherwise it's the template wording, untagged.
  const tailored = tailoredOk && (want[X.tailored] ?? "tailored") === "tailored";
  if (tailoredOk && !["volunteer", "washington"].includes(a.kind) && !senior) arms[X.tailored] = tailored ? "tailored" : "template";
  if (!tailoredOk) flags.push("No LinkedIn profile captured: the template hook was used. Capture their profile to write a career-path hook.");
  if (a.volunteerOther) flags.push("Their profile mentions volunteering (not tutoring / a soup kitchen): no volunteer hook. Worth a look.");

  const schoolLabel = a.school === "uc" ? a.schoolName || "[[AI: the UC campus they attended, from the facts]]" : a.schoolName || "[[AI: the LA school they attended, from the facts]]";
  const journeyA = tailored && BRUIN_UC_LA.has(a.kind) && !senior && (want[X.journey] ?? "A") === "A";
  if (tailored && BRUIN_UC_LA.has(a.kind) && !senior) arms[X.journey] = journeyA ? "A" : "B";

  let hook: string;
  let subject: string;
  const fellow: Partial<Record<Affinity, string>> = {
    ucla: `Fellow ${my.nick} Seeking to Connect`,
    anderson: `Fellow ${my.nick} Seeking to Connect`,
    la: "Fellow LA Student Seeking to Connect",
    uc: "Fellow UC Student Seeking to Connect",
    california: "Fellow California Student Seeking to Connect",
  };
  const why: Partial<Record<Affinity, string>> = {
    ucla: `seeing how you also went to ${my.school}`,
    anderson: `seeing how you're a fellow ${my.nick} from Anderson`,
    la: "seeing how you also went to school in LA",
    uc: "seeing how you also went to a UC",
    california: "seeing how you also went to school in California",
  };
  const shaped: Partial<Record<Affinity, string>> = {
    ucla: `as a fellow ${my.nick}, I'd love to hear how your time at ${my.school} shaped that journey.`,
    anderson: `as a fellow ${my.nick}, I'd love to hear how your time at ${my.school} shaped that journey.`,
    uc: `as a fellow UC student, I'd love to hear how your time at ${schoolLabel} shaped that journey.`,
    la: `as a fellow LA student, I'd love to hear how your time at ${schoolLabel} shaped that journey.`,
  };

  if (a.kind === "volunteer") {
    const at = a.school === "ucla" || a.school === "anderson" ? `journey at ${my.school}` : `journey to ${bank}`;
    const what = a.volunteer === "tutoring" ? "tutoring SAT math to underprivileged children" : "working at a soup kitchen";
    const theirs = a.volunteer === "tutoring" ? "volunteer tutoring experience" : "volunteer experience";
    hook = `One of my most meaningful high school experiences was ${what}. I'd love to learn more about your ${theirs} and ${at}. If you happen to be available, I would love the chance to connect for a quick call. I can send my availability, and I've attached my resume for your reference.`;
    subject = fellow[a.school ?? "standard"] ?? `${my.school} Student Seeking to Connect`;
  } else if (senior) {
    // VP / Director / approved exception: the seniority line folds into the hook, humble and bare-bones.
    hook = tailored
      ? `I know you are extremely busy as a {{position}}, but your path from ${PATH} really stood out to me and made me feel that you would have differentiated insights into building a career in investment banking.`
      : `I know you are extremely busy as a {{position}}, but I felt that you would have differentiated insights into building a career in investment banking.`;
    subject = a.kind === "washington" ? "Fellow Washingtonian Seeking to Connect" : (fellow[a.school ?? "standard"] ?? `${my.school} Student Seeking to Connect`);
  } else if (a.kind === "washington") {
    const school = a.schoolName || "[[AI: the Washington school they graduated from, from the facts]]";
    hook = `While looking through your profile, I noticed that you graduated from ${school}. Being from ${my.home} myself, I thought it would be great to speak with someone else who lived in my hometown.`;
    subject = "Fellow Washingtonian Seeking to Connect";
  } else if (a.kind === "chinese") {
    hook = tailored
      ? `Being Chinese myself, your path from ${PATH} really stood out, and I wanted to reach out to learn more.`
      : `Being Chinese myself, I wanted to reach out to you specifically to hear more about your journey and how you found yourself at ${bank}.`;
    const shared = a.school === "ucla" || a.school === "anderson" ? `Fellow Chinese ${my.nick}` : a.school === "uc" ? "Fellow Chinese UC Student" : a.school === "la" ? "Fellow Chinese LA Student" : "";
    subject = shared ? `${shared} Seeking to Connect` : "Chinese Student Seeking to Connect";
  } else if (a.kind === "standard") {
    hook = tailored ? `Your path from ${PATH} stood out to me, and I wanted to reach out to learn more.` : `I wanted to reach out to you because I'm interested in learning more about investment banking at ${bank}.`;
    subject = `${my.school} Student Seeking to Connect`;
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

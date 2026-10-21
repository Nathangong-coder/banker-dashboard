/**
 * The outreach rules (docs/outreach-rules.md, Part A), without a browser or an AI key.
 *   npm run check:outreach
 * Renders the first email for one person of each kind (UCLA, Anderson, LA, UC, California, Chinese, Washington,
 * volunteer, standard, senior), checks the subjects / hooks / asks against the rules, and checks that weighted
 * experiments land on their 80/20 and 70/30 shares. Every template, base and rendered draft must end
 * "<sign-off>,
<first name>

<full name>
<signature>" (signOffIssues).
 */
import { DEFAULT_BASES, DEFAULT_SETTINGS, DEFAULT_TEMPLATES, ORIGINAL_BASE, OUTREACH_TEMPLATE, THREE_PARAGRAPH_BASE } from "../src/lib/defaults";
import { expandBase, fillPlaceholders } from "../src/lib/template";
import { bodyToHtml, bodyToPlain, normalizeBody, withSignature, signatureLine, signOffFor, signOffIssues, templateSignOff, unwrapRedirects } from "../src/lib/emailFormat";
import { DEFAULT_REPLY } from "../src/lib/scheduling";
import { OUTREACH_EXPERIMENT_IDS as X, assignOutreachArms, composeOutreach, emailVerified, isTopSenior, leftFirm, pickWeighted, ruleQuery, rulesOf, seniorSkipReason, settleOutreachArms } from "../src/lib/outreach";
import { DEFAULT_SEND_WINDOW, daysLabel, planBatch, planSends, recipientTz, windowOf, zonedDate } from "../src/lib/sendWindow";
import type { Contact, Settings } from "../src/lib/types";
import { buildMime } from "../src/lib/gmail";
import { signatureBlock } from "../src/lib/emailFormat";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  profile: {
    ...DEFAULT_SETTINGS.profile,
    name: "Nathan Gong",
    school: "UCLA",
    year: "2029",
    major: "Economics & Applied Mathematics",
    email: "student@example.edu",
    phone: "555-010-0000",
    linkedin: "https://www.google.com/url?q=https://www.linkedin.com/in/example/&sa=D",
    schoolNickname: "Bruin",
    hometown: "Seattle, WA",
  },
};

let n = 0;
const person = (over: Partial<Contact>): Contact => ({
  id: `c${n++}`,
  name: "Alex Kim",
  firstName: "Alex",
  lastName: "Kim",
  bank: "PJT Partners",
  region: "SF",
  location: "SF",
  team: "",
  position: "Analyst",
  email: "alex@example.com",
  linkedin: "",
  comment: "",
  status: "new",
  source: "sheet",
  followUps: 0,
  history: [],
  ...over,
});
const profile = (text: string) => ({ text, source: "linkedin" as const, capturedAt: "2026-10-01" });

const cases: { label: string; c: Contact; subject: RegExp; hook: RegExp }[] = [
  { label: "UCLA, tailored, tech", c: person({ comment: "UCLA", team: "Tech", profile: profile("Experience ... Education UCLA") }), subject: /^Fellow Bruin Seeking to Connect$/, hook: /Your path from \[\[AI:/ },
  { label: "Anderson, template", c: person({ comment: "Anderson grad" }), subject: /^Fellow Bruin/, hook: /fellow Bruin from Anderson|also went to UCLA|journey/ },
  { label: "USC", c: person({ comment: "USC" }), subject: /^Fellow LA Student Seeking to Connect$/, hook: /school in LA/ },
  { label: "Berkeley", c: person({ comment: "Berkley kid -> UC connect email" }), subject: /^Fellow UC Student Seeking to Connect$/, hook: /a UC/ },
  { label: "Stanford", c: person({ school: "Stanford University" }), subject: /^Fellow California Student Seeking to Connect$/, hook: /school in California/ },
  { label: "Chinese + UCLA", c: person({ comment: "Chinese, UCLA", profile: profile("Education UCLA") }), subject: /^Fellow Chinese Bruin Seeking to Connect$/, hook: /^Being Chinese myself/ },
  { label: "Chinese, no shared school", c: person({ comment: "Chinese" }), subject: /^Chinese Student Seeking to Connect$/, hook: /^Being Chinese myself/ },
  { label: "Washington (and Chinese: WA wins)", c: person({ comment: "Chinese", school: "University of Washington" }), subject: /^Fellow Washingtonian Seeking to Connect$/, hook: /graduated from University of Washington\. Being from Seattle, WA myself/ },
  { label: "Volunteer tutoring at UCLA", c: person({ team: "Tech", profile: profile("Volunteer: tutoring kids. Education UCLA") }), subject: /^Fellow Bruin/, hook: /tutoring SAT math.*journey at UCLA/ },
  { label: "Standard", c: person({}), subject: /^UCLA Student Seeking to Connect$/, hook: /interested in learning more about investment banking at PJT Partners/ },
  { label: "VP (senior wording)", c: person({ position: "Vice President", comment: "UCLA" }), subject: /^Fellow Bruin/, hook: /^I know you are extremely busy as a {{position}}/ },
  { label: "Greenhill", c: person({ bank: "Greenhill & Co." }), subject: /Seeking to Connect/, hook: /Greenhill-Mizuho/ },
];

let failed = 0;
const tally = new Map<string, Map<string, number>>();
for (const { label, c, subject, hook } of cases) {
  const assigned = assignOutreachArms(c, settings, tally);
  let cc: Contact = { ...c, trial: { at: "", arms: assigned } };
  const plan = composeOutreach(cc, settings);
  cc = { ...cc, trial: { at: "", arms: settleOutreachArms(assigned, plan.arms, tally) } };
  const s = fillPlaceholders(OUTREACH_TEMPLATE.subject, cc, settings, {}, THREE_PARAGRAPH_BASE);
  const body = normalizeBody(withSignature(fillPlaceholders(OUTREACH_TEMPLATE.body, cc, settings, {}, THREE_PARAGRAPH_BASE), settings.profile));
  const paragraphs = body.split("\n\n");
  const problems = [
    !subject.test(s) && `subject "${s}"`,
    !hook.test(plan.hook) && `hook "${plan.hook.slice(0, 90)}…"`,
    /\{\{/.test(s + body) && "leftover {{placeholder}}",
    paragraphs.length !== 6 && `${paragraphs.length} blocks (want greeting + 3 paragraphs + sign-off/first name + signature)`,
    ...signOffIssues(body, settings.profile),
    plan.techHook && plan.arms[X.ask] === "A" && "E1-A on a two-hook email",
    /google\.com\/url/.test(body) && "google redirect in signature",
  ].filter(Boolean);
  console.log(`\n== ${label}  ${problems.length ? "FAIL: " + problems.join("; ") : "ok"}  arms=${JSON.stringify(plan.arms)}`);
  console.log(`Subject: ${s}\n${body}`);
  if (problems.length) failed++;
}

// Weighted shares: 100 drafts at 80/20 and 70/30.
const share = (w: [number, number]) => {
  const counts = new Map<string, number>();
  const arms = [{ id: "a", weight: w[0] }, { id: "b", weight: w[1] }];
  for (let i = 0; i < 100; i++) {
    const a = pickWeighted(arms, counts);
    counts.set(a.id, (counts.get(a.id) ?? 0) + 1);
  }
  return counts.get("a") ?? 0;
};
const s80 = share([80, 20]);
const s70 = share([70, 30]);
console.log(`\nweighted: 80/20 → ${s80}/${100 - s80}, 70/30 → ${s70}/${100 - s70}`);
if (s80 !== 80 || s70 !== 70) failed++;

// Seniority, left firm, verified emails, send times, redirects.
const checks: [string, boolean][] = [
  ["MD is top senior", isTopSenior("Managing Director")],
  ["'MD - Head of Consumer' is top senior", isTopSenior("MD - Head of Consumer & Retail")],
  ["Former MD now VP isn't top senior", !isTopSenior("VP, former MD")],
  ["Analyst isn't top senior", !isTopSenior("Investment Banking Analyst")],
  ["MD without a tie is skipped", !!seniorSkipReason(person({ position: "Managing Director" }))],
  ["MD from UCLA is allowed", !seniorSkipReason(person({ position: "Managing Director", comment: "UCLA" }))],
  ["MD from Seattle is allowed", !seniorSkipReason(person({ position: "Managing Director", school: "University of Washington" }))],
  ["Left firm from headline", leftFirm({ bank: "Evercore", headline: "Founding Engineer at Acme AI | ex-Evercore" }) === "Acme AI"],
  ["Same firm isn't 'left'", !leftFirm({ bank: "Evercore", headline: "Investment Banking Analyst at Evercore" })],
  ["Apollo extrapolated isn't verified", !emailVerified({ email: "a@b.com", emailSource: "apollo", emailStatus: "extrapolated" })],
  ["Apollo verified is verified", emailVerified({ email: "a@b.com", emailSource: "apollo", emailStatus: "verified" })],
  ["Sheet email counts as verified", emailVerified({ email: "a@b.com", emailSource: "sheet" })],

  ["Redirect unwrapped", unwrapRedirects("https://www.google.com/url?q=https://www.linkedin.com/in/x/&sa=D&ust=1") === "https://www.linkedin.com/in/x/"],
  ["Signature has class year + italic major + phone | LinkedIn | email", /UCLA Class of 2029\n\*Economics & Applied Mathematics\*\n555-010-0000 \| \[LinkedIn\]\(https:\/\/www\.linkedin\.com\/in\/example\/\) \| student@example\.edu/.test(signatureLine(settings.profile))],
];
for (const [what, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
}

// Someone else's rules (Settings → Outreach rules): a Michigan student from Chicago, Korean heritage, only their own
// school as a senior exception.
{
  const other: Settings = {
    ...settings,
    profile: { ...settings.profile, school: "Michigan", schoolNickname: "Wolverine", hometown: "Chicago, IL" },
    outreach: {
      school: { match: "University of Michigan, Michigan, Ross, Wolverine" },
      grad: { name: "", match: "" },
      city: { label: "Midwest", match: "Notre Dame, Northwestern, UChicago" },
      system: { label: "Big Ten", match: "Ohio State, Penn State, Wisconsin, Purdue" },
      state: { label: "Michigan", match: "Michigan State, Wayne State" },
      hometown: { demonym: "Chicagoan", match: "Chicago, Evanston, Naperville" },
      heritage: { word: "Korean" },
      volunteer: [],
      sports: [{ match: "baseball", label: "Baseball Player", mine: "played varsity baseball all four years of high school" }],
      seniorExceptions: ["school"],
    },
  };
  // An Orange County student: places only (no school), demonym left blank.
  const oc: Settings = {
    ...other,
    profile: { ...other.profile, hometown: "Irvine, CA" },
    outreach: { ...other.outreach!, hometown: { demonym: "", match: "Orange County, Irvine, Newport Beach, Huntington Beach, Mission Viejo" } },
  };
  const subjectFor = (c: Contact) => composeOutreach(c, other).subject;
  const otherChecks: [string, boolean][] = [
    ["Michigan alum → Fellow Wolverine", subjectFor(person({ school: "University of Michigan" })) === "Fellow Wolverine Seeking to Connect"],
    ["Ohio State → Fellow Big Ten Student", subjectFor(person({ school: "Ohio State" })) === "Fellow Big Ten Student Seeking to Connect"],
    ["'a Big Ten' in the hook", /went to a Big Ten/.test(composeOutreach(person({ school: "Ohio State" }), other).hook)],
    ["Evanston → Fellow Chicagoan", subjectFor(person({ comment: "grew up in Evanston" })) === "Fellow Chicagoan Seeking to Connect"],
    ["Korean (notes) → Korean Student", subjectFor(person({ comment: "Korean" })) === "Korean Student Seeking to Connect"],
    ["UCLA means nothing to them", subjectFor(person({ comment: "UCLA" })) === "Michigan Student Seeking to Connect"],
    ["MD from Michigan is allowed", !seniorSkipReason(person({ position: "Managing Director", school: "University of Michigan" }), other.outreach)],
    ["Baseball in their profile → sports hook", composeOutreach(person({ comment: "Varsity Baseball captain" }), other).hook.includes("you also played baseball. As someone who played varsity baseball all four years of high school, I would love")],
    ["Sports subject", subjectFor(person({ comment: "Varsity Baseball" })) === "Fellow Baseball Player Seeking to Connect"],
    ["Sports hook is flagged for a check", composeOutreach(person({ comment: "Baseball" }), other).flags.some((f) => /Sports hook/.test(f))],
    ["Sport with no 'mine' is off", composeOutreach(person({ comment: "Baseball" }), settings).affinity.kind !== "sports"],
    ["OC place → hometown hook without claiming they grew up there", /noticed your ties to Orange County\. Being from Irvine, CA myself/.test(composeOutreach(person({ comment: "Orange County native" }), oc).hook)],
    ["OC subject without a demonym", composeOutreach(person({ comment: "Newport Beach" }), oc).subject === "Michigan Student from Irvine Seeking to Connect"],
    ["Find query from the hometown list", ruleQuery(oc.outreach!.hometown.match) === 'site:linkedin.com/in "{bank}" "investment banking" ("Orange County" OR Irvine OR "Newport Beach" OR "Huntington Beach" OR "Mission Viejo")'],
    ["Old saved rules get sports defaults", Array.isArray(rulesOf({ outreach: { ...other.outreach!, sports: undefined as never } }).sports)],
    ["MD from Chicago isn't (not an exception for them)", !!seniorSkipReason(person({ position: "Managing Director", comment: "Evanston" }), other.outreach)],
  ];
  for (const [what, ok] of otherChecks) {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  }
}

// Sign-off and signature block: "<sign-off>,\n<first name>\n\n<full name>\n<signature>" on every template and draft.
{
  const ENDING = "Nathan\n\nNathan Gong\nUCLA Class of 2029\n*Economics & Applied Mathematics*\n555-010-0000 | [LinkedIn](https://www.linkedin.com/in/example/) | student@example.edu";
  const cc = person({ comment: "UCLA", school: "UCLA", position: "Associate" });
  const rendered = (t: (typeof DEFAULT_TEMPLATES)[number]) => {
    const base = t.lockBase ? ORIGINAL_BASE : THREE_PARAGRAPH_BASE;
    return normalizeBody(withSignature(fillPlaceholders(t.body, { ...cc, draft: { subject: "Fellow Bruin", body: "", createdAt: "" } }, settings, {}, base), settings.profile));
  };
  const old = "Hi Alex,\n\nThanks!\n\nSincerely,\nNathan Gong\nUCLA Class of 2029\nEconomics & Applied Mathematics\n555-010-0000 | LinkedIn: https://www.google.com/url?q=https://www.linkedin.com/in/example/&sa=D | student@example.edu";
  const html = bodyToHtml(rendered(OUTREACH_TEMPLATE));
  const maya = { ...settings.profile, name: "Maya Patel", school: "Michigan", year: "2028", major: "Economics", phone: "", email: "maya@umich.edu", linkedin: "linkedin.com/in/maya" };
  const signOffChecks: [string, boolean][] = [
    ...DEFAULT_TEMPLATES.map((t): [string, boolean] => {
      const body = rendered(t);
      const want = signOffFor(t.kind === "follow_up" ? t.step : undefined);
      const issues = signOffIssues(body, settings.profile);
      const ok = !issues.length && body.endsWith(`${want}\n${ENDING}`) && !/\{\{\s*my_first_name/.test(body);
      if (!ok) console.log(`  ${t.id}: ${issues.join(" ") || "ending"}\n${body.split("\n").slice(-8).join("\n")}`);
      return [`Template "${t.name}" ends ${want} / first name / blank / signature`, ok];
    }),
    ...DEFAULT_BASES.map((b): [string, boolean] => [`Base "${b.name}" signs "Sincerely," + first name`, /\nSincerely,\n\{\{my_first_name\}\}$/.test(b.close) && !signOffIssues(expandBase("Hi\n\nx\n\n{{base_close}}", b)).length]),
    ["Scheduling reply: Best, / first name / blank / signature", normalizeBody(withSignature(fillPlaceholders(DEFAULT_REPLY.replace("{{my_first_name}}", "Nathan"), cc, settings), settings.profile)).endsWith(`Best,\n${ENDING}`)],
    ["Major is italic in the Gmail HTML", html.includes("<div><i>Economics &amp; Applied Mathematics</i></div>")],
    ["First name, then one blank line, then the full name (HTML)", html.includes("<div>Sincerely,</div><div>Nathan</div><div><br></div><div>Nathan Gong</div>")],
    ["LinkedIn links straight to the profile", html.includes('<a href="https://www.linkedin.com/in/example/">LinkedIn</a>') && !/google\.[a-z.]+\/url/.test(html)],
    ["Plain text drops the italic asterisks", bodyToPlain(rendered(OUTREACH_TEMPLATE)).includes("\nEconomics & Applied Mathematics\n")],
    ["Old ending (full name glued to sign-off, redirect) is flagged", signOffIssues(old, settings.profile).length === 2],
    ["…and withSignature rebuilds it", withSignature(old, settings.profile) === `Hi Alex,\n\nThanks!\n\nSincerely,\n${ENDING}`],
    ["withSignature is idempotent", withSignature(withSignature(old, settings.profile), settings.profile) === withSignature(old, settings.profile)],
    ["No blank line before the signature is flagged", signOffIssues("Hi\n\nThanks!\n\nSincerely,\nNathan\nNathan Gong\nUCLA Class of 2029", settings.profile).some((x) => /blank line/.test(x))],
    ["Missing first-name line is flagged", signOffIssues("Hi\n\nThanks!\n\nSincerely,", settings.profile).some((x) => /first-name line/.test(x))],
    ["No sign-off at all is flagged", signOffIssues("Hi\n\nThanks!", settings.profile).length === 1],
    ["A P.S. after the sign-off is left alone", withSignature("Hi\n\nSincerely,\nNathan\n\nP.S. Go Bruins!", settings.profile) === "Hi\n\nSincerely,\nNathan\n\nP.S. Go Bruins!"],
    ["Template migration: {{my_name}} → {{my_first_name}}", templateSignOff("Hi\n\nThanks!\n\nSincerely,\n{{my_name}}") === "Hi\n\nThanks!\n\nSincerely,\n{{my_first_name}}"],
    ["Template migration: follow-up #2 signs Kind regards", templateSignOff("Hi\n\nBest,\n{{my_name}}", signOffFor(2)) === "Hi\n\nKind regards,\n{{my_first_name}}"],
    ["Template migration leaves a P.S. template alone", templateSignOff("Hi\n\nBest,\n{{my_name}}\n\nP.S. hi") === "Hi\n\nBest,\n{{my_name}}\n\nP.S. hi"],
    ["New user: their own first and full name", withSignature("Hi\n\nSincerely,\nMaya", maya) === "Hi\n\nSincerely,\nMaya\n\nMaya Patel\nMichigan Class of 2028\n*Economics*\n[LinkedIn](https://linkedin.com/in/maya) | maya@umich.edu"],
    ["Custom signature gets the full name on top", withSignature("Hi\n\nSincerely,\nNathan", { ...settings.profile, signature: "UCLA '29 | LinkedIn" }).endsWith("Sincerely,\nNathan\n\nNathan Gong\nUCLA '29 | [LinkedIn](https://www.linkedin.com/in/example/)")],
    ["Custom signature 'Name | phone' is split onto two lines", withSignature("Hi\n\nRegards,\nNathan", { ...settings.profile, signature: "Nathan Gong | 555-010-0000" }).endsWith("Regards,\nNathan\n\nNathan Gong\n555-010-0000")],
  ];
  for (const [what, ok] of signOffChecks) {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  }
}

// Send window: 9–11 AM in the recipient's zone, Tuesday–Thursday, spread out, DST-safe.
{
  const hourIn = (d: Date, tz: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(d));
  const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  const w = DEFAULT_SEND_WINDOW;
  // Friday 2026-10-09 3 PM PT: the next allowed day is Tuesday (weekend and Monday skipped).
  const friPm = zonedDate(2026, 10, 9, 15, 0, "America/Los_Angeles");
  const people = [
    person({ id: "ny1", region: "NY", location: "NY" }),
    person({ id: "ny2", region: "NY", location: "NY" }),
    person({ id: "sf1", region: "SF", location: "SF" }),
    person({ id: "tx1", region: "Other", location: "Houston" }),
  ];
  const plan = planSends(people, w, { now: friPm, jitter: () => 0 });
  // Tuesday 8 AM PT: NY (11 AM ET) has closed, SF (8 AM PT) opens at 9 the same day.
  const tue = zonedDate(2026, 10, 13, 8, 0, "America/Los_Angeles");
  const plan2 = planSends(people, w, { now: tue, jitter: () => 0 });
  // Across the November DST change (Sun 11/1): the Tuesday 11/3 slot is still 9 AM local.
  const dst = planSends([people[0]], w, { now: zonedDate(2026, 10, 31, 12, 0, "America/New_York"), jitter: () => 0 }).get("ny1")!;
  // A big batch overflows into the next allowed day instead of leaving after 11.
  const many = Array.from({ length: 30 }, (_, i) => person({ id: `b${i}`, region: "NY", location: "NY" }));
  const big = planSends(many, w, { now: zonedDate(2026, 10, 12, 6, 0, "America/New_York"), jitter: () => 0 });
  const windowChecks: [string, boolean][] = [
    ["NY gets 9–11 AM Eastern", [...plan].filter(([id]) => id.startsWith("ny")).every(([, d]) => hourIn(d, "America/New_York") >= 9 && hourIn(d, "America/New_York") < 11)],
    ["SF gets 9–11 AM Pacific", hourIn(plan.get("sf1")!, "America/Los_Angeles") === 9],
    ["Houston uses Central time", recipientTz({ region: "Other", location: "Houston" }) === "America/Chicago" && hourIn(plan.get("tx1")!, "America/Chicago") === 9],
    ["Friday afternoon → Tuesday (not the weekend, not Monday)", [...plan.values()].every((d) => dayIn(d, "America/New_York") === "Tue")],
    ["Thursday afternoon → next Tuesday", dayIn(planSends([people[0]], w, { now: zonedDate(2026, 10, 15, 15, 0, "America/Los_Angeles"), jitter: () => 0 }).get("ny1")!, "America/New_York") === "Tue"],
    ["An old 'weekdays' setting becomes Tue–Thu", JSON.stringify(windowOf({ sendWindow: { start: 9, end: 11, basis: "recipient", weekdaysOnly: true } as never }).days) === "[2,3,4]"],
    ["Days read as words", daysLabel([2, 3, 4]) === "Tue–Thu" && daysLabel([1, 3, 5]) === "Mon, Wed, Fri"],
    ["Two NY sends are spread out", Math.abs(plan.get("ny1")!.getTime() - plan.get("ny2")!.getTime()) >= 5 * 60_000],
    ["Tue 8 AM PT: NY → Wed, SF → today 9 AM", dayIn(plan2.get("ny1")!, "America/New_York") === "Wed" && dayIn(plan2.get("sf1")!, "America/Los_Angeles") === "Tue"],
    ["DST week: still 9 AM Eastern", hourIn(dst, "America/New_York") === 9 && dayIn(dst, "America/New_York") === "Tue"],
    ["30 at once: all inside 9–11, some on the next day", [...big.values()].every((d) => hourIn(d, "America/New_York") >= 9 && hourIn(d, "America/New_York") < 11) && new Set([...big.values()].map((d) => dayIn(d, "America/New_York"))).size > 1],
    // Follow-up spacing is in days (Joseph Nichols: first email Thu 10/15 late morning was queued for Tue 10/27).
    ["7 days after a 10:58 AM email = that Thursday, at 9", (() => {
      const sent = zonedDate(2026, 10, 15, 10, 58, "America/New_York");
      const d = planSends([people[0]], w, { now: zonedDate(2026, 10, 20, 18, 0, "America/Los_Angeles"), jitter: () => 0, notBefore: () => new Date(sent.getTime() + 7 * 86_400_000) }).get("ny1")!;
      return dayIn(d, "America/New_York") === "Thu" && hourIn(d, "America/New_York") === 9;
    })()],
    ["A full 9–11 batch a week later all fits that Thursday, with jitter", (() => {
      const batch = Array.from({ length: 20 }, (_, i) => ({ ...person({ id: `f${i}`, region: "NY", location: "NY" }), sent: zonedDate(2026, 10, 15, 9, i * 6, "America/New_York") }));
      const p = planSends(batch, w, { now: zonedDate(2026, 10, 20, 18, 0, "America/Los_Angeles"), jitter: () => 2, notBefore: (c) => new Date(c.sent.getTime() + 7 * 86_400_000) });
      return [...p.values()].every((d) => dayIn(d, "America/New_York") === "Thu" && hourIn(d, "America/New_York") < 11);
    })()],
    ["Your-time basis uses your zone", (() => { const d = planSends([people[0]], { ...w, basis: "mine" }, { now: friPm, jitter: () => 0 }).get("ny1")!; const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; return hourIn(d, tz) === 9; })()],
  ];
  // Batch overrides: 29 emails that must all go Thursday, whatever the planner would have done.
  const mix = Array.from({ length: 29 }, (_, i) => person({ id: `m${i}`, region: i % 3 ? "NY" : "SF", location: i % 3 ? "NY" : "SF" }));
  const tuesNight = zonedDate(2026, 10, 13, 20, 0, "America/Los_Angeles");
  const thu = planBatch(mix, { day: { mode: "date", date: "2026-10-15" }, time: { mode: "spread", start: 9 * 60, end: 11 * 60 }, basis: "recipient", gap: 4 }, w, new Map(), tuesNight);
  const tz = (id: string) => (mix.find((p) => p.id === id)!.region === "NY" ? "America/New_York" : "America/Los_Angeles");
  const queued = new Map(mix.map((p) => [p.id, zonedDate(2026, 10, 20, 10, 30, tz(p.id))]));
  const keepTime = planBatch(mix, { day: { mode: "date", date: "2026-10-15" }, time: { mode: "keep" }, basis: "recipient", gap: 4 }, w, queued, tuesNight);
  const keepDay = planBatch(mix, { day: { mode: "keep" }, time: { mode: "exact", at: 9 * 60 + 15 }, basis: "recipient", gap: 0 }, w, queued, tuesNight);
  const late = planBatch(mix, { day: { mode: "date", date: "2026-10-15" }, time: { mode: "spread", start: 9 * 60, end: 9 * 60 + 30 }, basis: "recipient", gap: 6 }, w, new Map(), tuesNight);
  const friday = planBatch(mix.slice(0, 1), { day: { mode: "date", date: "2026-10-16" }, time: { mode: "exact", at: 10 * 60 }, basis: "recipient", gap: 0 }, w, new Map(), tuesNight);
  windowChecks.push(
    ["Batch: all 29 on Thursday (none rolled to Tuesday)", [...thu].every(([id, p]) => dayIn(p.at, tz(id)) === "Thu")],
    ["Batch: spread starts 9 AM their time, 4 min apart", hourIn(thu.get("m1")!.at, "America/New_York") === 9 && Math.abs(thu.get("m2")!.at.getTime() - thu.get("m1")!.at.getTime()) === 4 * 60_000],
    ["Batch: change the day, keep each time (10:30)", [...keepTime].every(([id, p]) => dayIn(p.at, tz(id)) === "Thu" && new Intl.DateTimeFormat("en-US", { timeZone: tz(id), hour: "numeric", minute: "2-digit" }).format(p.at) === "10:30 AM")],
    ["Batch: keep the day, set the time (9:15)", [...keepDay].every(([id, p]) => dayIn(p.at, tz(id)) === "Tue" && new Intl.DateTimeFormat("en-US", { timeZone: tz(id), hour: "numeric", minute: "2-digit" }).format(p.at) === "9:15 AM")],
    ["Batch: too many for the window → warned, day kept", [...late.values()].some((p) => p.warn?.includes("too many")) && [...late].every(([id, p]) => dayIn(p.at, tz(id)) === "Thu")],
    ["Batch: a day outside Tue–Thu is allowed but warned", !!friday.get("m0")!.warn?.includes("outside your usual days")],
  );
  for (const [what, ok] of windowChecks) {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  }
}

// Signature logo: inline image (multipart/related + cid) right under the signature's last line, only when the body has it.
{
  const sigLines = signatureBlock(settings.profile).split("\n");
  const after = sigLines[sigLines.length - 1];
  const logo = { type: "image/png", data: new Uint8Array([137, 80, 78, 71]).buffer, width: 120, alt: "logo", after };
  const body = withSignature("Hi Jane,\n\nThanks!\n\nSincerely,\nNathan", settings.profile);
  const mime = buildMime({ to: "a@b.com", subject: "Hi", body, logo });
  const html = bodyToHtml(body, undefined, { src: "cid:x", width: 120, after });
  const plainMime = buildMime({ to: "a@b.com", subject: "Re: times", body: "Hi Jane,\n\nTuesday works.\n\nBest,\nNathan", logo });
  const withPs = bodyToHtml(body + "\n\nP.S. Go Bruins", undefined, { src: "cid:x", width: 120, after });
  const logoChecks: [string, boolean][] = [
    ["Logo: multipart/related with a Content-ID", /multipart\/related/.test(mime) && /Content-ID: <signature-logo@coverage>/.test(mime) && /Content-Disposition: inline/.test(mime)],
    ["Logo: img right after the signature's last line", /student@example\.edu<\/a><\/div><div><img src="cid:x" width="120"/.test(html)],
    ["Logo: before a P.S.", withPs.indexOf("cid:x") < withPs.indexOf("P.S.")],
    ["Logo: none when the body has no signature", !/multipart\/related/.test(plainMime)],
    ["Logo: plain-text part unchanged", !/cid:/.test(bodyToPlain(body))],
    ["Logo: link only for https", !/<a href="javascript/.test(bodyToHtml(body, undefined, { src: "cid:x", width: 120, after, link: "javascript:alert(1)" })) && /<a href="https:\/\/x\.com"><img/.test(bodyToHtml(body, undefined, { src: "cid:x", width: 120, after, link: "https://x.com" }))],
    ["Logo: width clamped", /width="600"/.test(bodyToHtml(body, undefined, { src: "cid:x", width: 5000, after }))],
  ];
  for (const [what, ok] of logoChecks) {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  }
}

if (failed) {
  console.error(`\n${failed} outreach check(s) failed`);
  process.exit(1);
}
console.log("\noutreach rules OK");

/**
 * The outreach rules (docs/outreach-rules.md, Part A), without a browser or an AI key.
 *   npm run check:outreach
 * Renders the first email for one person of each kind (UCLA, Anderson, LA, UC, California, Chinese, Washington,
 * volunteer, standard, senior), checks the subjects / hooks / asks against the rules, and checks that weighted
 * experiments land on their 80/20 and 70/30 shares.
 */
import { DEFAULT_SETTINGS, OUTREACH_TEMPLATE, THREE_PARAGRAPH_BASE } from "../src/lib/defaults";
import { fillPlaceholders } from "../src/lib/template";
import { normalizeBody, withSignature, signatureLine, unwrapRedirects } from "../src/lib/emailFormat";
import { OUTREACH_EXPERIMENT_IDS as X, assignOutreachArms, composeOutreach, emailVerified, isTopSenior, leftFirm, pickWeighted, seniorSkipReason, sendTimeFor, settleOutreachArms } from "../src/lib/outreach";
import type { Contact, Settings } from "../src/lib/types";

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
    paragraphs.length !== 5 && `${paragraphs.length} blocks (want greeting + 3 paragraphs + sign-off)`,
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
  ["NY sends at 5 PM PT", sendTimeFor({ region: "NY" }).hourPT === 17],
  ["SF sends at 7 PM PT", sendTimeFor({ region: "SF" }).hourPT === 19],
  ["Redirect unwrapped", unwrapRedirects("https://www.google.com/url?q=https://www.linkedin.com/in/x/&sa=D&ust=1") === "https://www.linkedin.com/in/x/"],
  ["Signature has class year + phone | LinkedIn | email", /UCLA Class of 2029\nEconomics & Applied Mathematics\n555-010-0000 \| \[LinkedIn\]\(https:\/\/www\.linkedin\.com\/in\/example\/\) \| student@example\.edu/.test(signatureLine(settings.profile))],
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
      seniorExceptions: ["school"],
    },
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
    ["MD from Chicago isn't (not an exception for them)", !!seniorSkipReason(person({ position: "Managing Director", comment: "Evanston" }), other.outreach)],
  ];
  for (const [what, ok] of otherChecks) {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  }
}

if (failed) {
  console.error(`\n${failed} outreach check(s) failed`);
  process.exit(1);
}
console.log("\noutreach rules OK");

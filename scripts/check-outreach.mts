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
import { OUTREACH_EXPERIMENT_IDS as X, assignOutreachArms, composeOutreach, emailVerified, isTopSenior, leftFirm, pickWeighted, seniorSkipReason, settleOutreachArms } from "../src/lib/outreach";
import { DEFAULT_SEND_WINDOW, daysLabel, planBatch, planSends, recipientTz, windowOf, zonedDate } from "../src/lib/sendWindow";
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

if (failed) {
  console.error(`\n${failed} outreach check(s) failed`);
  process.exit(1);
}
console.log("\noutreach rules OK");

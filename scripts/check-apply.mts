/**
 * Application autofill planning (src/lib/apply.ts): which fields get filled from your info, which go to the AI, and
 * which are left for you. No browser, no network.
 *   npm run check:apply
 */
import { EMPTY_PROFILE, planFill, pickOption, sameJobSite, guessFromUrl, knownJobSite, type ApplyProfile, type FormField } from "../src/lib/apply";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

const me: ApplyProfile = {
  ...EMPTY_PROFILE,
  firstName: "Alex",
  lastName: "Rivera",
  preferredName: "",
  email: "alex@example.edu",
  phone: "555-010-2000",
  address1: "100 Main St",
  city: "Seattle",
  state: "WA",
  zip: "98101",
  linkedin: "https://www.linkedin.com/in/example/",
  school: "UCLA",
  degree: "Bachelor's",
  major: "Economics",
  gpa: "3.8",
  gradDate: "2029-06",
  authorized: "yes",
  sponsorNow: "no",
  sponsorFuture: "no",
  gender: "decline",
  race: "asian",
  hispanic: "no",
  veteran: "no",
  disability: "decline",
  over18: "yes",
};

const yn = [
  { value: "", label: "Select..." },
  { value: "1", label: "Yes" },
  { value: "0", label: "No" },
];
const f = (id: string, kind: FormField["kind"], label: string, extra: Partial<FormField> = {}): FormField => ({ id, kind, label, ...extra });

const form: FormField[] = [
  f("a", "text", "First Name", { required: true }),
  f("b", "text", "Last Name"),
  f("c", "email", "Email"),
  f("d", "tel", "Phone"),
  f("e", "file", "Resume/CV", { accept: ".pdf" }),
  f("f", "text", "LinkedIn Profile"),
  f("g", "select", "Are you legally authorized to work in the United States?", { options: yn }),
  f("h", "select", "Will you now or in the future require sponsorship for employment visa status?", { options: yn }),
  f("i", "select", "Gender", { options: [{ value: "m", label: "Male" }, { value: "f", label: "Female" }, { value: "d", label: "Decline To Self Identify" }] }),
  f("j", "select", "Are you Hispanic/Latino?", { options: [{ value: "y", label: "Yes" }, { value: "n", label: "No" }, { value: "d", label: "Decline To Self Identify" }] }),
  f("k", "select", "Please identify your race", { options: [{ value: "1", label: "White" }, { value: "2", label: "Asian" }, { value: "3", label: "Two or More Races" }] }),
  f("l", "radio", "Veteran Status", { options: [{ value: "v1", label: "I am not a protected veteran" }, { value: "v2", label: "I identify as one or more of the classifications of a protected veteran" }, { value: "v3", label: "I don't wish to answer" }] }),
  f("m", "radio", "Disability Status", { options: [{ value: "d1", label: "Yes, I have a disability (or previously had a disability)" }, { value: "d2", label: "No, I do not have a disability and have not had one in the past" }, { value: "d3", label: "I do not want to answer" }] }),
  f("n", "textarea", "Why are you interested in investment banking at this firm?", { maxLength: 1500 }),
  f("o", "text", "Social Security Number"),
  f("p", "checkbox", "I certify that the information provided is true and complete"),
  f("q", "text", "Desired salary"),
  f("r", "text", "Please state why you chose your major"),
  f("s", "select", "Expected graduation year", { options: [{ value: "2028", label: "2028" }, { value: "2029", label: "2029" }] }),
  f("t", "text", "City"),
  f("u", "select", "State", { options: [{ value: "CA", label: "California" }, { value: "WA", label: "Washington" }] }),
  f("v", "text", "Password"),
  f("w", "text", "Cumulative GPA"),
  f("x", "text", "Are you at least 18 years of age?"),
  f("y", "text", "First Name", { filled: true }),
  f("z", "select", "Which office are you most interested in?", { options: [{ value: "ny", label: "New York" }, { value: "sf", label: "San Francisco" }] }),
];

const plan = planFill(form, me, { hasResume: true });
const by = (id: string) => plan.items.find((x) => x.id === id);
const skippedIds = plan.skipped.map((s) => s.id).sort();
const aiIds = plan.ai.map((x) => x.id).sort();

eq("first / last / email / phone", [by("a")?.value, by("b")?.value, by("c")?.value, by("d")?.value], ["Alex", "Rivera", "alex@example.edu", "555-010-2000"]);
eq("resume goes in the file input", by("e")?.file, "resume");
eq("work authorization = Yes", by("g")?.value, "1");
eq("sponsorship now or future = No", by("h")?.value, "0");
eq("gender decline", by("i")?.value, "d");
eq("hispanic no", by("j")?.value, "n");
eq("race asian", by("k")?.value, "2");
eq("veteran: long 'not a protected veteran' option", by("l")?.value, "v1");
eq("disability decline", by("m")?.value, "d3");
eq("graduation year option", by("s")?.value, "2029");
eq("city / state option / gpa", [by("t")?.value, by("u")?.value, by("w")?.value], ["Seattle", "WA", "3.8"]);
eq("18+ as text", by("x")?.value, "Yes");
eq("open questions (and an office choice) go to the AI", aiIds, ["n", "r", "z"]);
eq("left for you: SSN, certification box, salary, password", skippedIds, ["o", "p", "q", "v"]);
eq("already-filled field untouched", by("y"), undefined);
eq("sensitive answers never come from the AI", plan.ai.some((x) => /gender|race|veteran|disab|hispanic|sponsor|authori/i.test(x.label)), false);

// Profile without EEO answers: those questions are left for you, never sent to the AI.
const blank = planFill(form.filter((x) => ["i", "k", "l", "g"].includes(x.id)), { ...me, gender: "", race: "", veteran: "", authorized: "" }, { hasResume: false });
eq("unset sensitive answers are skipped, not AI'd", [blank.items.length, blank.ai.length, blank.skipped.length], [0, 0, 4]);
eq("no resume → file left for you", planFill([form[4]], me, { hasResume: false }).skipped.length, 1);

eq("pickOption decline phrasing", pickOption([{ value: "a", label: "Yes" }, { value: "b", label: "I prefer not to say" }], "decline"), "b");
eq("pickOption ignores the placeholder", pickOption(yn, "yes"), "1");
eq("same job site (Workday subdomain)", sameJobSite("https://gs.wd1.myworkdayjobs.com/en-US/careers/job/123", "https://gs.wd1.myworkdayjobs.com/en-US/careers/apply"), true);
eq("different site", sameJobSite("https://boards.greenhouse.io/evercore/jobs/1", "https://evil.example.com/"), false);
eq("guess company from a Greenhouse link", guessFromUrl("https://boards.greenhouse.io/evercore/jobs/123").company, "Evercore");

eq("known application systems", ["https://gs.wd1.myworkdayjobs.com/x", "https://boards.greenhouse.io/x", "https://jobs.lever.co/x"].map(knownJobSite), [true, true, true]);
eq("lookalike hosts aren't known job sites", ["https://greenhouse.io.evil.com/", "https://mygreenhouse.io/", "https://example.com/apply"].map(knownJobSite), [false, false, false]);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\napply planning OK");

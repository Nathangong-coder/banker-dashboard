/**
 * Application autofill planning (src/lib/apply.ts): which fields get filled from your info, which go to the AI, and
 * which are left for you. No browser, no network.
 *   npm run check:apply
 */
import { chooseResume, gradFor, gradYearsAsked, learnKey, platformOf, schoolNames } from "../src/lib/apply";
import { coverLetterFrom, letterPdf } from "../src/lib/coverLetter";
import { openVault } from "../src/lib/vaultCrypto";
import { EMPTY_PROFILE, planFill, pickOption, sameJobSite, guessFromUrl, knownJobSite, parseJobCapture, type ApplyProfile, type FormField } from "../src/lib/apply";

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
// An "Attach resume" link hiding an unlabelled file input: the only file input on the form is the resume.
eq("unlabelled lone file input → resume", planFill([f("u", "file", ""), f("v", "text", "First Name")], me, { hasResume: true }).items.find((x) => x.id === "u")?.file, "resume");
eq("two unlabelled file inputs → left for you", planFill([f("u", "file", ""), f("w", "file", "")], me, { hasResume: true }).skipped.length, 2);

// Resume once, cover letter from your template (owner, 2026-10-26)
{
  const two = [f("r", "file", "Attach Dropbox Google Drive resume"), f("c", "file", "Attach Dropbox Google Drive cover letter")];
  const pl = planFill(two, me, { hasResume: true, coverText: "Dear team" });
  eq("resume + cover letter boxes: each gets its own file", pl.items.map((x) => [x.id, x.file]), [["r", "resume"], ["c", "cover"]]);
  const vague = planFill([f("a", "file", "Attach"), f("b", "file", "Attach")], me, { hasResume: true });
  eq("two unclear upload boxes: resume only in the first", [vague.items.map((x) => x.id), vague.skipped.map((x) => x.id)], [["a"], ["b"]]);
  eq("cover letter box without a template is left for you", planFill([two[1]], me, { hasResume: true }).skipped.length, 1);
  eq("cover letter text box gets the letter", planFill([f("t", "textarea", "Cover Letter")], me, { hasResume: true, coverText: "Dear team" }).items[0]?.value, "Dear team");
}
{
  const tpl = "October 5, 2026\n\nDear Evercore Recruiting Team,\n\nI am excited to apply to Evercore's Summer Analyst program. At Evercore, I hope to learn.\n\nSincerely,\nNathan";
  const out = coverLetterFrom(tpl, "Houlihan Lokey", new Date(2026, 9, 26), ["Evercore", "Goldman Sachs", "Lazard"]);
  eq("cover letter: today's date, new firm everywhere, nothing else", out, "October 26, 2026\n\nDear Houlihan Lokey Recruiting Team,\n\nI am excited to apply to Houlihan Lokey's Summer Analyst program. At Houlihan Lokey, I hope to learn.\n\nSincerely,\nNathan");
  eq("cover letter: {{company}} placeholder and 10/5/2026 dates", coverLetterFrom("10/5/2026 Dear {{company}} team", "Citi", new Date(2026, 9, 26), []), "10/26/2026 Dear Citi team");
  eq("cover letter: a firm name inside another word isn't touched", coverLetterFrom("Dear Citi team, citizenship aside", "UBS", new Date(2026, 9, 26), ["Citi"]), "Dear UBS team, citizenship aside");
  const pdf = new TextDecoder("latin1").decode(letterPdf("Hello (world)\n\nSecond paragraph"));
  eq("cover letter PDF is a PDF with the text", [pdf.startsWith("%PDF-1.4"), pdf.includes("(Hello \\(world\\)) Tj"), pdf.trimEnd().endsWith("%%EOF")], [true, true, true]);
}
{
  const rs = [
    { id: "jr", classYear: 2028 },
    { id: "econ", tags: "economics, consulting" },
  ];
  eq(
    "resume choice: picked > class year in the posting > tags > main",
    [
      chooseResume({ resumeId: "x", role: "", description: "" }, "", rs),
      chooseResume({ role: "Summer Analyst", description: "Open to students in the Class of 2028." }, "", rs),
      chooseResume({ role: "Summer Analyst", description: "", review: { classYears: [2028] } as never }, "", rs),
      chooseResume({ role: "Healthcare Economics Summer Analyst", description: "economic consulting" }, "", rs),
      chooseResume({ role: "IB Summer Analyst", description: "class of 2028 or 2029" }, "", rs),
      chooseResume({ role: "IB Summer Analyst", description: "" }, "", rs),
    ],
    ["x", "jr", "jr", "econ", undefined, undefined],
  );
}

// Eligibility confirmations (owner, 2026-10-26: only 2 of 5 were done): all answered from My info, any wording.
{
  const elig = [
    f("e1", "checkbox", "I certify that I am at least 18 years of age."),
    f("e2", "checkbox", "I confirm that I am legally authorized to work in the United States."),
    f("e3", "checkbox", "I acknowledge that I will not require visa sponsorship now or in the future."),
    f("e4", "radio", "Will you now or in the future require sponsorship for employment visa status?", { options: [{ value: "y", label: "Yes" }, { value: "n", label: "No" }] }),
    f("e5", "select", "Are you at least 18 years old?", { options: [{ value: "", label: "Select" }, { value: "1", label: "Yes" }, { value: "0", label: "No" }] }),
    f("c1", "checkbox", "I certify that the information I have provided is true and complete."),
  ];
  const pl = planFill(elig, me, { hasResume: true });
  const got = Object.fromEntries(pl.items.map((x) => [x.id, x.checked ?? x.value]));
  eq("all 5 eligibility questions answered; the general certification is left for you", [got, pl.skipped.map((x) => x.id)], [{ e1: true, e2: true, e3: true, e4: "n", e5: "1" }, ["c1"]]);
  eq("needs sponsorship → the 'will not require' box stays unticked", planFill([elig[2]], { ...me, sponsorFuture: "yes" }, { hasResume: true }).items[0]?.checked, false);
  eq("not set in My info → left for you (never guessed)", planFill([elig[0]], { ...me, over18: "" }, { hasResume: true }).skipped.length, 1);
}

// Greenhouse leftovers (owner, 2026-10-26): end date, essential functions, driver's license, optional extras.
{
  const yn = [{ value: "0", label: "Yes" }, { value: "1", label: "No" }];
  const months = ["January", "February", "March", "April", "May", "June", "July"].map((m, i) => ({ value: String(i), label: m }));
  const me2 = { ...me, gradDate: "2029-06-15", driversLicense: "yes" };
  const fs2 = [
    f("m", "listbox", "End date month", { options: months }),
    f("y", "text", "End date year"),
    f("d", "text", "Expected graduation date (MM/DD/YYYY)"),
    f("ef", "listbox", "Are you able to perform the essential functions of the position for which you are applying, either with or without reasonable accommodations?", { options: yn }),
    f("dl", "listbox", "Do you have a valid driver's license?", { options: yn }),
    f("dln", "text", "Driver's license number"),
    f("x", "textarea", "Is there any additional information you would like to provide as a supplement to your application? This is optional"),
  ];
  const pl = planFill(fs2, me2, { hasResume: true });
  const got = Object.fromEntries(pl.items.map((x) => [x.id, x.optionLabel ?? x.value]));
  eq("end date month / year / full date, essential functions, driver's license", got, { m: "June", y: "2029", d: "06/15/2029", ef: "Yes", dl: "Yes" });
  eq("license number never filled; optional extra left blank (not sent to the AI)", [pl.skipped.map((x) => x.id).sort(), pl.ai.length], [["dln", "x"], 0]);
  eq("a month-only graduation reads as the 15th", planFill([fs2[2]], { ...me, gradDate: "2029-06" }, { hasResume: true }).items[0]?.value, "06/15/2029");
}

// The dashboard opens the extension's vault with the PIN (same scheme as extension/vault.js).
{
  const b64 = (buf: ArrayBuffer | Uint8Array) => Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("base64");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode("123456"), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const logins = [{ origin: "https://gs.wd5.myworkdayjobs.com", username: "me@ucla.edu", password: "Xy7!generated" }];
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(logins)));
  const blob = { v: 1 as const, salt: b64(salt), iv: b64(iv), data: b64(data) };
  eq("vault: right PIN opens it in the dashboard", (await openVault(blob, "123456"))[0]?.password, "Xy7!generated");
  eq("vault: wrong PIN refused", await openVault(blob, "654321").then(() => "opened", (e: Error) => e.message), "Wrong PIN.");
}

// Early graduation (owner, 2026-10-26): a posting for the earlier class uses your early date + that year's resume.
{
  const prof = { ...me, gradDate: "2029-06-15", earlyGradDate: "2028-06-15" };
  const q = "Will you be graduating in either winter of 2027 or summer of 2028?";
  eq("years asked: the graduation sentence, not other years", gradYearsAsked(`Summer 2027 internship in New York. ${q} Founded in 2004.`), [2027, 2028]);
  eq("posting for 2027/2028 → early date; for 2029 or unclear → usual; once switched it stays", [
    gradFor(prof, q),
    gradFor(prof, "Open to the class of 2029."),
    gradFor(prof, "Summer Analyst program."),
    gradFor(prof, "Class of 2028 or 2029 students."),
    gradFor(prof, "", [2028]),
    gradFor(prof, "anything", [], "2028-06-15"),
    gradFor({ ...prof, earlyGradDate: "" }, q),
  ], ["2028-06-15", "2029-06-15", "2029-06-15", "2029-06-15", "2028-06-15", "2028-06-15", "2029-06-15"]);
  const yn = [{ value: "0", label: "Yes" }, { value: "1", label: "No" }];
  const win = f("w", "listbox", q, { options: yn });
  eq("the window question: yes with the early date, no with the usual one", [
    planFill([win], { ...prof, gradDate: "2028-06-15" }, { hasResume: true }).items[0]?.optionLabel,
    planFill([win], prof, { hasResume: true }).items[0]?.optionLabel,
  ], ["Yes", "No"]);
  eq("and every date field follows it", planFill([f("e", "text", "End date year"), f("d", "text", "Expected graduation date (MM/DD/YYYY)")], { ...prof, gradDate: "2028-06-15" }, { hasResume: true }).items.map((x) => x.value), ["2028", "06/15/2028"]);
  const rs = [{ id: "jr", classYear: 2028 }, { id: "x", classYear: 2029 }];
  eq("resume: the one marked for the year this application uses", [chooseResume({ role: "", description: "" }, "", rs, 2028, 2029), chooseResume({ role: "", description: "" }, "", rs, 2029, 2029)], ["jr", undefined]);
}

// School names (owner, 2026-10-26: Greenhouse lists UCLA as "University of California - Los Angeles").
eq("school: UCLA → full name + acronym accepted; searches add the campus city", schoolNames("University of California, Los Angeles"), {
  accept: ["University of California, Los Angeles", "UCLA"],
  search: ["University of California, Los Angeles", "UCLA", "Los Angeles", "University of California"],
});
eq("school: typed as UCLA → expanded", schoolNames("UCLA").accept, ["University of California, Los Angeles", "UCLA"]);
{
  const ucla = planFill([f("s", "typeahead", "School")], { ...me, school: "University of California, Los Angeles" }, { hasResume: true }).items[0];
  eq("school typeahead: strict match with several searches", [ucla?.strict, ucla?.search?.length], [true, 4]);
  const list = planFill([f("s2", "listbox", "School", { options: ["University of California - Berkeley", "University of California - Los Angeles", "Los Angeles City College"].map((l, i) => ({ value: String(i), label: l })) })], { ...me, school: "University of California, Los Angeles" }, { hasResume: true }).items[0];
  eq("school dropdown: punctuation doesn't matter", list?.optionLabel, "University of California - Los Angeles");
}

// Learned answers (owner, 2026-10-26: "record what the AI did for one Workday site, reuse it on the next").
eq("platform: every Workday host is one platform", [platformOf("https://gs.wd5.myworkdayjobs.com/x"), platformOf("https://wd1.myworkdaysite.com/recruiting/wf/x"), platformOf("https://job-boards.greenhouse.io/x"), platformOf("https://careers.tiktok.com/x")], ["workday", "workday", "greenhouse", "careers.tiktok.com"]);
eq("label key ignores case, stars and punctuation", learnKey("How did you hear about us? *"), "how did you hear about us");
{
  const learned = { [learnKey("Have you previously worked for this company?")]: { value: "No" }, [learnKey("Gender")]: { value: "Male" }, [learnKey("Preferred office")]: { value: "Los Angeles" } };
  const fs3 = [
    f("p", "listbox", "Have you previously worked for this company? *", { options: [{ value: "0", label: "Yes" }, { value: "1", label: "No" }] }),
    f("g", "listbox", "Gender", { options: [{ value: "0", label: "Male" }, { value: "1", label: "Female" }] }),
    f("o", "text", "Preferred office"),
  ];
  const pl = planFill(fs3, { ...me, gender: "" }, { hasResume: true, learned });
  eq("learned answers reused (an option and a short text); a demographic one never", [pl.items.map((x) => [x.id, x.optionLabel ?? x.value]), pl.skipped.map((x) => x.id)], [[["p", "No"], ["o", "Los Angeles"]], ["g"]]);
}

// The AI agent's fill mode (extension 1.5): stops at the final submit, never creates accounts or deletes.
const { fillGate } = await import("../extension/agent/agent.js");
eq(
  "agent fill gate",
  ["Submit Application", "Send application", "Sign and Submit", "Next", "Save and Continue", "Apply Manually", "Add Another", "Create Account", "Delete", "Sign Out"].map((t) => fillGate(t)),
  ["stop", "stop", "stop", "approve", "approve", "approve", "approve", "skip", "skip", "skip"],
);
eq(
  "agent: a bare Submit on an eligibility screener goes on; on a review page it stops",
  [
    fillGate("Submit", "Eligibility questions. Are you authorized to work in the US? Are you 18 years or older?"),
    fillGate("Submit", "Review your application. By submitting this application you certify…"),
    fillGate("Submit", ""),
    fillGate("Submit Application", "Eligibility questions"),
  ],
  ["approve", "stop", "stop", "stop"],
);

eq("pickOption decline phrasing", pickOption([{ value: "a", label: "Yes" }, { value: "b", label: "I prefer not to say" }], "decline"), "b");
eq("pickOption ignores the placeholder", pickOption(yn, "yes"), "1");
eq("same job site (Workday subdomain)", sameJobSite("https://gs.wd1.myworkdayjobs.com/en-US/careers/job/123", "https://gs.wd1.myworkdayjobs.com/en-US/careers/apply"), true);
eq("different site", sameJobSite("https://boards.greenhouse.io/evercore/jobs/1", "https://evil.example.com/"), false);
eq("guess company from a Greenhouse link", guessFromUrl("https://boards.greenhouse.io/evercore/jobs/123").company, "Evercore");

eq("known application systems", ["https://gs.wd1.myworkdayjobs.com/x", "https://boards.greenhouse.io/x", "https://jobs.lever.co/x"].map(knownJobSite), [true, true, true]);
eq("lookalike hosts aren't known job sites", ["https://greenhouse.io.evil.com/", "https://mygreenhouse.io/", "https://example.com/apply"].map(knownJobSite), [false, false, false]);

// Workday-style custom dropdowns (options read by opening them) and typeahead boxes.
const wd = planFill(
  [
    f("w1", "listbox", "Are you legally authorized to work in the country in which the job is located?", { options: [{ value: "0", label: "Select One" }, { value: "1", label: "Yes" }, { value: "2", label: "No" }] }),
    f("w2", "listbox", "Please select your veteran status", { options: [{ value: "0", label: "I am not a protected veteran" }, { value: "1", label: "I identify as one or more of the classifications of protected veteran" }, { value: "2", label: "I do not wish to self-identify" }] }),
    f("w3", "typeahead", "School or University"),
    f("w4", "typeahead", "Gender"),
    f("w5", "listbox", "Gender"),
    f("w6", "typeahead", "Which of our offices interests you most?"),
  ],
  me,
  { hasResume: true },
);
const w = (id: string) => wd.items.find((x) => x.id === id);
eq("custom dropdown: work authorization → Yes (by option text)", [w("w1")?.value, w("w1")?.optionLabel], ["1", "Yes"]);
eq("custom dropdown: veteran", w("w2")?.optionLabel, "I am not a protected veteran");
eq("typeahead school types the full name first, then the acronym", [w("w3")?.value, w("w3")?.search?.[1]], ["University of California, Los Angeles", "UCLA"]);
eq("typeahead gender decline offers decline phrasings", w("w4")?.alts?.includes("Prefer not to say"), true);
eq("a dropdown whose options couldn't be read is left for you", wd.skipped.some((x) => x.id === "w5"), true);
eq("an unplaceable typeahead is left for you, not sent to the AI", [wd.skipped.some((x) => x.id === "w6"), wd.ai.length], [true, 0]);

// "Track this job" from LinkedIn.
// Auto mode (extension, owner 2026-10-28): consent / privacy boxes ticked; without it they stay yours.
const consent = [f("ca", "checkbox", "I have read and agree to the Privacy Notice"), f("cb", "checkbox", "I certify that the information provided is true and complete")];
eq("consent boxes: yours by default", planFill(consent, me, { hasResume: false }).skipped.length, 2);
eq("consent boxes: ticked in Auto mode", planFill(consent, me, { hasResume: false, autoConsent: true }).items.map((i) => i.checked), [true, true]);
eq("Auto mode still never fills a password / SSN", planFill([form.find((x) => x.id === "o")!, form.find((x) => x.id === "v")!], me, { hasResume: false, autoConsent: true }).items.length, 0);

const job = parseJobCapture(
  "#job=" +
    encodeURIComponent(
      JSON.stringify({ title: "2027 IB Summer Analyst", company: "Example Partners", location: "New York, NY", description: "We are hiring.", url: "https://www.linkedin.com/jobs/view/4012345678/", applyUrl: "https://example.wd1.myworkdayjobs.com/x/job/123", linkedinJobId: "4012345678" }),
    ),
);
eq("job capture parsed", [job?.company, job?.title, job?.linkedinJobId, !!job?.applyUrl], ["Example Partners", "2027 IB Summer Analyst", "4012345678", true]);
eq("job capture: non-LinkedIn page refused", parseJobCapture("#job=" + encodeURIComponent(JSON.stringify({ title: "x", company: "y", url: "https://evil.example.com/" }))), null);
eq("job capture: javascript: apply link dropped", parseJobCapture("#job=" + encodeURIComponent(JSON.stringify({ title: "x", company: "y", url: "https://www.linkedin.com/jobs/view/1/", applyUrl: "javascript:alert(1)" })))?.applyUrl, undefined);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\napply planning OK");

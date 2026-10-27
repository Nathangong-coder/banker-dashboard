/**
 * Job finder (src/lib/jobFinder.ts) and recruiter detection (src/lib/recruiters.ts). No browser, no network.
 *   npm run check:jobs
 */
import { boardOf, freshJobs, inUS, isBankingRole, isInternship, jobKey, mergeBoards, parseResultTitle, rankJobs, searchQueries, type FoundJob } from "../src/lib/jobFinder";
import { isRecruiter } from "../src/lib/recruiters";
import { knownIds } from "../src/lib/jobFinder";
import { DEFAULT_ROLE_TYPES, judge, quickReview, resumeFor, roleTypeId, rulesOf, sortReviewed, type JobReview } from "../src/lib/jobReview";
import { assignJobRows, findAppsTable, jobPatches } from "../src/lib/jobSheet";
import { jobRunLine } from "../src/lib/digestFormat";
import { applicationQuery, companyOf, kindOf, labelFor, matchJob, statusAfter, summerOf } from "../src/lib/appEmails";
import type { JobApplication } from "../src/lib/apply";
import type { SheetSnapshot } from "../src/lib/types";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

// Boards from links
eq("workday job link", boardOf("https://ms.wd5.myworkdayjobs.com/en-US/External/job/New-York/2027-Summer-Analyst_JR123"), { kind: "workday", host: "ms.wd5.myworkdayjobs.com", tenant: "ms", site: "External" });
eq("workday link without locale", boardOf("https://bofa.wd1.myworkdayjobs.com/Campus/job/x"), { kind: "workday", host: "bofa.wd1.myworkdayjobs.com", tenant: "bofa", site: "Campus" });
eq("workday cxs endpoint", boardOf("https://bofa.wd1.myworkdayjobs.com/wday/cxs/bofa/Campus/jobs"), { kind: "workday", host: "bofa.wd1.myworkdayjobs.com", tenant: "bofa", site: "Campus" });
eq("greenhouse board", boardOf("https://boards.greenhouse.io/evercore/jobs/123?gh_src=x"), { kind: "greenhouse", board: "evercore" });
eq("greenhouse embed", boardOf("https://boards.greenhouse.io/embed/job_app?for=moelis&token=1"), { kind: "greenhouse", board: "moelis" });
eq("lever board", boardOf("https://jobs.lever.co/qatalyst/abc-123"), { kind: "lever", board: "qatalyst" });
eq("http links and other hosts aren't boards", [boardOf("http://ms.wd5.myworkdayjobs.com/External"), boardOf("https://evil.com/myworkdayjobs.com/x"), boardOf("https://x.myworkdayjobs.com.evil.com/a")], [null, null, null]);
eq("mergeBoards keeps one per board and fills the company", mergeBoards([{ kind: "lever", board: "qatalyst" }], [{ kind: "lever", board: "qatalyst", company: "Qatalyst Partners" }, { kind: "greenhouse", board: "evercore" }]).length, 2);

// Keys / dedupe
eq("jobKey drops tracking params", jobKey("https://boards.greenhouse.io/evercore/jobs/123?gh_src=abc&utm_source=li#app"), "boards.greenhouse.io/evercore/jobs/123");
eq("jobKey LinkedIn by id", jobKey("https://www.linkedin.com/jobs/view/4012345678/?refId=x"), "linkedin:4012345678");

// What counts
eq("internships for 2027", [isInternship("2027 Investment Banking Summer Analyst", [2027]), isInternship("Summer Analyst - IB", [2027]), isInternship("2028 Summer Analyst", [2027]), isInternship("Investment Banking Analyst (Full-Time)", [2027]), isInternship("Sophomore Early Insights Program", [2027])], [true, true, false, false, true]);
eq("banking roles", [isBankingRole("2027 Summer Analyst"), isBankingRole("Software Engineering Intern"), isBankingRole("M&A Intern"), isBankingRole("Operations Summer Analyst"), isBankingRole("Marketing Intern")], [true, false, true, false, false]);
eq("Citi's divisions", [isBankingRole("Services - Summer Analyst, Singapore, 2027"), isBankingRole("Functions - Risk, Summer Analyst - Warsaw, 2027"), isBankingRole("Banking - Investment Banking Summer Analyst, New York, 2027"), isBankingRole("Wealth - Citigold, Summer Analyst")], [false, false, true, false]);
eq("US only", [inUS("New York, NY"), inUS("Menlo Park, CA"), inUS("Singapore Singapore"), inUS("London United Kingdom"), inUS(""), inUS("2 Locations"), inUS("New York New York United States"), inUS("Remote, in India")], [true, true, false, false, true, true, true, true]);
eq("result titles", [parseResultTitle("2027 Summer Analyst - Investment Banking - Goldman Sachs | Workday"), parseResultTitle("Job Application for Summer Analyst at Evercore")], [{ title: "2027 Summer Analyst", company: "Goldman Sachs" }, { title: "Summer Analyst", company: "Evercore" }]);
const qs = searchQueries("summer analyst", [2027], ["Goldman Sachs", "Evercore", "Moelis", "PJT Partners", "Lazard"]);
eq("queries: one general + one per 4 banks, ≤ 30 words", [qs.length, qs.every((q) => q.split(/\s+/).length <= 30)], [3, true]);

const f = (key: string, company: string, title: string, at = "2026-10-24T00:00:00Z"): FoundJob => ({ key, company, title, url: `https://x/${key}`, source: "search", foundAt: at });
const found = [f("a", "Evercore", "Summer Analyst"), f("b", "Random Co", "Summer Analyst", "2026-10-25T00:00:00Z"), f("c", "Moelis", "2027 Summer Analyst"), f("a", "Evercore", "Summer Analyst")];
const fresh = freshJobs(found, [{ url: "https://y", company: "Moelis & Company", role: "2027 summer analyst" }], ["zzz"]);
eq("freshJobs drops tracked (firm + title) and repeats", fresh.map((x) => x.key), ["a", "b"]);
eq("rankJobs puts your firms first", rankJobs(fresh, ["Evercore"]).map((x) => x.company), ["Evercore", "Random Co"]);

// Recruiters
eq("recruiters", [
  isRecruiter({ position: "Campus Recruiter" }),
  isRecruiter({ position: "Talent Acquisition Partner, Early Careers" }),
  isRecruiter({ position: "Investment Banking Analyst" }),
  isRecruiter({ position: "Associate, Campus Recruiting Lead" }),
  isRecruiter({ position: "", headline: "University Relations @ Capital One" }),
], [true, true, false, false, true]);

// AI job review: the verdict is code, from the AI's fields + your settings (owner, 2026-10-26)
const rules = rulesOf(undefined, "2029-06");
const rv = (o: Partial<JobReview>): JobReview => ({ roleType: "ib", classYears: [], internship: true, us: true, firmKnown: true, reason: "", at: "2026-10-26T00:00:00Z", version: 1, ...o });
eq("class years default from graduation: that class and the one before", rules.classYears, [2028, 2029]);
eq(
  "owner's defaults: S&T maybe, quant skip, wealth/AM skip, IB/corp banking/ER apply",
  ["sales_trading", "quant", "wealth", "asset_management", "ib", "corporate_banking", "equity_research"].map((id) => DEFAULT_ROLE_TYPES.find((t) => t.id === id)?.verdict),
  ["maybe", "skip", "skip", "skip", "apply", "apply", "apply"],
);
eq("IB internship, year unclear → apply (tagged unclear)", [judge(rv({}), rules).verdict, judge(rv({}), rules).yearUnclear], ["apply", true]);
eq("class of 2028 or 2029 → apply", [judge(rv({ classYears: [2028] }), rules).verdict, judge(rv({ classYears: [2029, 2030] }), rules).verdict], ["apply", "apply"]);
eq("only class of 2027 → skip", judge(rv({ classYears: [2027] }), rules).verdict, "skip");
eq("full-time / non-US → skip whatever the role", [judge(rv({ internship: false }), rules).verdict, judge(rv({ us: false }), rules).verdict, judge(rv({}), rules, "London, United Kingdom").verdict], ["skip", "skip", "skip"]);
eq(
  "sales & trading → maybe; quant → skip; unknown id → not finance (skip)",
  [judge(rv({ roleType: "sales_trading" }), rules).verdict, judge(rv({ roleType: "quant" }), rules).verdict, judge(rv({ roleType: "made_up" }), rules).verdict],
  ["maybe", "skip", "skip"],
);
const flipped = { ...rules, roleTypes: rules.roleTypes.map((t) => (t.id === "sales_trading" ? { ...t, verdict: "apply" as const } : t)) };
eq("changing a verdict re-sorts stored reviews without the AI", judge(rv({ roleType: "sales_trading" }), flipped).verdict, "apply");
eq("Not finance can't go missing", rulesOf({ roleTypes: [{ id: "ib", label: "IB", covers: "", verdict: "apply" }] }).roleTypes.map((t) => t.id), ["ib", "not_finance"]);
eq(
  "quick skips: VP title, London; an intern title isn't skipped",
  [quickReview({ title: "Vice President, M&A", location: "New York, NY" }, 1, "x")?.internship, quickReview({ title: "Summer Analyst", location: "London, UK" }, 1, "x")?.us, quickReview({ title: "Senior Summer Intern Program", location: "" }, 1, "x")],
  [false, false, null],
);
eq(
  "junior resume for class-of-2028-only postings; main otherwise",
  [resumeFor(rv({ classYears: [2028] }), [{ id: "jr", classYear: 2028 }]), resumeFor(rv({ classYears: [2028, 2029] }), [{ id: "jr", classYear: 2028 }]), resumeFor(rv({ classYears: [] }), [{ id: "jr", classYear: 2028 }])],
  ["jr", undefined, undefined],
);
eq(
  "sort: apply before maybe, then role priority, then known firm",
  sortReviewed(
    [
      { company: "Unknown LLC", foundAt: "1", review: rv({ roleType: "ib", firmKnown: false }) },
      { company: "Citi", foundAt: "1", review: rv({ roleType: "sales_trading" }) },
      { company: "Edward Jones", foundAt: "1", review: rv({ roleType: "ib", firmKnown: true }) },
    ],
    rules,
    new Set(),
  ).map((j) => j.company),
  ["Edward Jones", "Unknown LLC", "Citi"],
);
eq("role type id from a label, unique", roleTypeId("Real estate investing", ["real_estate_investing"]), "real_estate_investing_2");
eq(
  "known ids skip found / dismissed / tracked",
  knownIds([{ key: "linkedin:111" } as FoundJob], ["linkedin:222", "handshake:9"], [{ url: "https://www.linkedin.com/jobs/view/333/", company: "x", role: "y" }], "linkedin").sort(),
  ["111", "222", "333"],
);
eq("handshake job key", [jobKey("https://app.joinhandshake.com/jobs/9876543?searchId=x"), jobKey("https://ucla.joinhandshake.com/stu/jobs/123456")], ["handshake:9876543", "handshake:123456"]);

// 9 PM "press Search" reminder line
eq(
  "reminder: never searched / 2 days / searched today / every 3 days",
  [
    !!jobRunLine({ everyDays: 1 }, "2026-10-26", "https://x"),
    jobRunLine({ lastAt: "2026-10-24T20:00:00Z", everyDays: 1 }, "2026-10-26", "https://x")?.includes("2 days ago"),
    jobRunLine({ lastAt: "2026-10-26T10:00:00Z", everyDays: 1 }, "2026-10-26", "https://x"),
    jobRunLine({ lastAt: "2026-10-24T10:00:00Z", everyDays: 3 }, "2026-10-26", "https://x"),
  ],
  [true, true, null, null],
);

// Jobs → the applications tab (the owner's APP ('27) layout)
const cells: SheetSnapshot["cells"] = {};
["#", "Program Type", "Institution Name", "Institution Type", "Application Link", "Application\nOpen Date", "Application\nSubmitted Date", "Application \nStatus", "Target Location"].forEach((h, i) => (cells[`2:${i + 2}`] = { v: h }));
[["1", "", "Uber", "", "", "", "", "IN PROCESS"], ["2", "", "Robinhood", "", "", "", "", "REJECTED"], ["3"], ["4"]].forEach((r, i) =>
  r.forEach((v, c) => {
    if (v) cells[`${3 + i}:${c + 2}`] = { v };
  }),
);
const snaps: SheetSnapshot[] = [{ name: "APP ('27)", rows: 162, cols: 10, cells }];
const t = findAppsTable(snaps);
eq("finds the applications tab", [t?.sheet, t?.header, t?.cols.name, t?.cols.status, t?.last], ["APP ('27)", 2, 4, 9, 6]);
const job = (o: Partial<JobApplication>): JobApplication => ({ id: "j1", company: "Goldman Sachs", role: "2027 IB Summer Analyst", url: "https://hdpc.fa.us2.oraclecloud.com/x", status: "saved", createdAt: "2026-10-26", ...o });
const rows = assignJobRows([job({}), job({ id: "j2", company: "Robinhood", role: "" }), job({ id: "ai", addedBy: "ai" }), job({ id: "j3", company: "Citi" }), job({ id: "j4", company: "MS" })], snaps);
eq("rows: same firm + program row, free numbered rows, then below the list; AI-added jobs get none", [rows.get("j1")?.row, rows.get("j2")?.row, rows.get("ai"), rows.get("j3")?.row, rows.get("j4")?.row], [5, 4, undefined, 6, 7]);
const pt = jobPatches([job({ sheetRef: { sheet: "APP ('27)", row: 5 }, status: "submitted", submittedAt: "2026-10-20T18:00:00Z", location: "NY" })], snaps, () => "Bulge Bracket")["APP ('27)"];
eq(
  "writes firm, program, tier, link, date, status, location",
  [pt["5:4"]?.v, pt["5:3"]?.v, pt["5:5"]?.v, pt["5:6"]?.link, pt["5:8"]?.v, pt["5:9"]?.v, pt["5:10"]?.v],
  ["Goldman Sachs", "2027 IB Summer Analyst", "Bulge Bracket", "https://hdpc.fa.us2.oraclecloud.com/x", "10/20/2026", "IN PROCESS", "NY"],
);
const down = jobPatches([job({ company: "Robinhood", sheetRef: { sheet: "APP ('27)", row: 4 }, status: "submitted" })], snaps)["APP ('27)"] ?? {};
eq("a status is never moved backwards (REJECTED stays)", down["4:9"], undefined);
const below = jobPatches([job({ sheetRef: { sheet: "APP ('27)", row: 8 } })], snaps)["APP ('27)"];
eq("a new row below the list gets the next number; saved = no status", [below["8:2"]?.v, below["8:9"]], ["5", undefined]);
eq("a row now holding another firm is left alone", jobPatches([job({ company: "Citi", sheetRef: { sheet: "APP ('27)", row: 3 } })], snaps)["APP ('27)"], undefined);


// Application emails in Gmail → Off. applied + labels by summer (owner, 2026-10-26)
const now = new Date("2026-10-26T12:00:00Z");
eq(
  "summer from the email",
  [
    summerOf("Thank you for applying to the 2027 Summer Analyst Program", now),
    summerOf("Summer 2028 Investment Banking Internship", now),
    summerOf("Summer Analyst 2027 - IB", now),
    summerOf("This program is for the class of 2028", now),
    summerOf("Thanks for applying to Analyst Program", now),
    summerOf("Summer 2027 and Summer 2028 programs", now),
  ],
  [2027, 2028, 2027, 2027, undefined, undefined],
);
eq(
  "kind of email",
  [
    kindOf("Thank you for applying!", "We have received your application for 2027 Summer Analyst."),
    kindOf("Your application", "Unfortunately, we will not be moving forward with your candidacy."),
    kindOf("Next steps: HireVue", "Please complete the HireVue video interview by Friday."),
    kindOf("Superday invitation", "We'd like to invite you to an interview for our superday."),
    kindOf("New jobs for you", "Check out these openings"),
  ],
  ["confirmation", "rejection", "assessment", "interview", "other"],
);
eq(
  "firm from the sender",
  [companyOf('"Goldman Sachs Recruiting" <noreply@gs.com>', ""), companyOf("Evercore via Workday <evercore@myworkday.com>", ""), companyOf("Workday <noreply@myworkday.com>", "Thank you for applying to Jefferies")],
  ["Goldman Sachs", "Evercore", "Jefferies"],
);
eq("label by summer", [labelFor(2027), labelFor(undefined)], ["Applications/Summer 2027", "Applications/Year unclear"]);
const tracked = (o: Partial<JobApplication>): JobApplication => ({ id: "a", company: "Evercore", role: "2027 Investment Banking Summer Analyst", url: "", status: "submitted", createdAt: "x", ...o });
eq(
  "matches the tracked job at that firm (closest role, same summer)",
  matchJob({ id: "m", kind: "confirmation", company: "Evercore", role: "Investment Banking Summer Analyst", summer: 2027 }, [
    tracked({ id: "rx", role: "Restructuring Summer Analyst", summer: 2028 }),
    tracked({ id: "ib", summer: 2027 }),
  ])?.id,
  "ib",
);
eq("no firm → no match", matchJob({ id: "m", kind: "confirmation", company: "", role: "" }, [tracked({})]), undefined);
eq(
  "status: confirmation → Off. applied; never backwards; rejection ends it",
  [statusAfter("submitted", "confirmation"), statusAfter("saved", "confirmation"), statusAfter("interview", "confirmation"), statusAfter("interview", "rejection"), statusAfter("confirmed", "other")],
  ["confirmed", "confirmed", "interview", "rejected", "confirmed"],
);
eq("the search covers ATS senders and confirmation subjects, never sent mail", [applicationQuery().includes("from:myworkday.com"), applicationQuery().includes('subject:"thank you for applying"'), applicationQuery().includes("-in:sent")], [true, true, true]);

console.log(failed ? `\n${failed} failed` : "\njob finder OK");
process.exit(failed ? 1 : 0);

/**
 * Job finder (src/lib/jobFinder.ts) and recruiter detection (src/lib/recruiters.ts). No browser, no network.
 *   npm run check:jobs
 */
import { boardOf, freshJobs, inUS, isBankingRole, isInternship, jobKey, mergeBoards, parseResultTitle, rankJobs, searchQueries, type FoundJob } from "../src/lib/jobFinder";
import { isRecruiter } from "../src/lib/recruiters";

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

console.log(failed ? `\n${failed} failed` : "\njob finder OK");
process.exit(failed ? 1 : 0);

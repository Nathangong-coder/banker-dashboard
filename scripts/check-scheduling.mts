/**
 * Scheduling calls, without a browser or Google: availability in your zone shown in theirs, calendar events taken
 * out, "afternoons next week" narrowing, hour parsing, phone scraping, quoted-reply stripping, and the invite text.
 *   npm run check:scheduling
 */
import { DEFAULT_AVAILABILITY, formatWindows, freeWindows, narrowTo, parseRanges, phonesIn, rangesText, type Availability } from "../src/lib/availability";
import { fillScheduling, DEFAULT_INVITE_DESCRIPTION, DEFAULT_INVITE_TITLE } from "../src/lib/scheduling";
import { looksLikeDecline, stripQuoted } from "../src/lib/gmail";
import { isVpPlus, vpPlusWarning } from "../src/lib/seniority";
import { zonedDate } from "../src/lib/sendWindow";
import { DEFAULT_SETTINGS } from "../src/lib/defaults";

let failed = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok && detail ? `\n       got: ${detail}` : ""}`);
};

const PT = "America/Los_Angeles";
const ET = "America/New_York";
const h = (x: number) => x * 60;
// You: 7–10 AM Pacific on weekdays.
const av: Availability = { ...DEFAULT_AVAILABILITY(PT), weekly: { 0: [], 1: [{ start: h(7), end: h(10) }], 2: [{ start: h(7), end: h(10) }], 3: [{ start: h(7), end: h(10) }], 4: [{ start: h(7), end: h(10) }], 5: [{ start: h(7), end: h(10) }], 6: [] }, minNoticeHours: 0 };
// "Now" = Sunday Oct 11, 2026 noon PT; look at Mon–Fri Oct 12–16.
const now = zonedDate(2026, 10, 11, 12, 0, PT);
const to = zonedDate(2026, 10, 16, 23, 59, PT);
const free = freeWindows(av, [], now, to, now);
const etLines = formatWindows(free, ET);
const ptLines = formatWindows(free, PT);
check("7–10 AM PT reads as 10 AM – 1 PM ET", etLines[0] === "Monday, Oct 12: 10 AM – 1 PM ET", etLines[0]);
check("…and 7 AM – 10 AM PT for a SF banker", ptLines[0] === "Monday, Oct 12: 7 AM – 10 AM PT", ptLines[0]);
check("weekdays only, five days", etLines.length === 5, String(etLines.length));

// A calendar event Tuesday 8:00–8:30 PT splits that morning.
const busy = [{ start: zonedDate(2026, 10, 13, 8, 0, PT), end: zonedDate(2026, 10, 13, 8, 30, PT) }];
const tue = formatWindows(freeWindows(av, busy, now, to, now), ET)[1];
check("calendar events are left out", tue === "Tuesday, Oct 13: 10 AM – 11 AM, 11:30 AM – 1 PM ET", tue);

// A different week: Wednesday off, Thursday afternoon instead.
const wk: Availability = { ...av, overrides: { "2026-10-14": [], "2026-10-15": [{ start: h(13), end: h(15) }] } };
const wkLines = formatWindows(freeWindows(wk, [], now, to, now), ET);
check("a day marked off disappears", !wkLines.some((l) => l.startsWith("Wednesday")), wkLines.join(" | "));
check("a changed day uses the new hours", wkLines.some((l) => l === "Thursday, Oct 15: 4 PM – 6 PM ET"), wkLines.join(" | "));

// "Thursday or Friday, after 11 my time (ET)".
const narrowed = formatWindows(narrowTo(free, { weekdays: [4, 5], earliest: h(11) }, ET), ET);
check("narrowed to Thu/Fri after 11 AM ET", narrowed.join(" | ") === "Thursday, Oct 15: 11 AM – 1 PM ET | Friday, Oct 16: 11 AM – 1 PM ET", narrowed.join(" | "));

// Notice period: nothing within 12 hours.
const soon = freeWindows({ ...av, minNoticeHours: 12 }, [], zonedDate(2026, 10, 12, 0, 0, PT), to, zonedDate(2026, 10, 12, 0, 0, PT));
check("no times inside the notice period", soon[0].start.getTime() >= zonedDate(2026, 10, 13, 7, 0, PT).getTime(), soon[0]?.start.toISOString());

// Typing hours.
const cases: [string, string][] = [
  ["7-10am", "7am-10am"],
  ["9:00-12:00", "9am-12pm"],
  ["2pm-4:30pm, 7-8pm", "2pm-4:30pm, 7pm-8pm"],
  ["11-1pm", "11am-1pm"],
  ["off", "off"],
];
for (const [input, want] of cases) {
  let got = "";
  try {
    got = rangesText(parseRanges(input));
  } catch (e) {
    got = `error: ${(e as Error).message}`;
  }
  check(`"${input}" → ${want}`, got === want, got);
}
let threw = false;
try {
  parseRanges("10am-9am");
} catch {
  threw = true;
}
check("a range that ends before it starts is rejected", threw);

// Their phone from the signature, never yours.
const sig = "Thanks,\nElixa Acuña\nLincoln International\nM: (415) 701-1213 | O: 312.580.8339\nNathan's number: 425-394-3467";
check("their phone numbers found, yours skipped", JSON.stringify(phonesIn(sig, ["425-394-3467"])) === '["415-701-1213","312-580-8339"]', JSON.stringify(phonesIn(sig, ["425-394-3467"])));

// Only their new text.
const thread = "Hi Nathan,\n\nHappy to chat. Does Thursday afternoon work?\n\nElixa\n\nOn Mon, Oct 5, 2026 at 7:00 PM Nathan Gong <nagong1@g.ucla.edu> wrote:\n> Hi Elixa,\n> I hope this email finds you well!";
check("quoted history is cut", stripQuoted(thread) === "Hi Nathan,\n\nHappy to chat. Does Thursday afternoon work?\n\nElixa", JSON.stringify(stripQuoted(thread)));

// The invite, in the owner's words.
const me = { ...DEFAULT_SETTINGS.profile, name: "Nathan Gong", phone: "425-394-3467" };
const elixa = { firstName: "Elixa", name: "Elixa Acuña", bank: "Lincoln International", phone: "415-701-1213" };
const at = zonedDate(2026, 10, 15, 10, 0, PT);
const title = fillScheduling(DEFAULT_INVITE_TITLE, elixa, me, { theirTz: PT, at });
const desc = fillScheduling(DEFAULT_INVITE_DESCRIPTION, elixa, me, { theirTz: PT, at });
check("invite title", title === "Nathan<>Elixa Coffee Chat", title);
check("invite description", desc === "Nathan (425-394-3467) to call Elixa (415-701-1213) at 10 AM PT", desc);
const descNy = fillScheduling(DEFAULT_INVITE_DESCRIPTION, elixa, me, { theirTz: ET, at });
check("same call for a NY banker reads 1 PM ET", descNy.endsWith("at 1 PM ET"), descNy);

// VP and above (your rule: don't email them).
const vp: [string, boolean][] = [
  ["Vice President, Technology", true],
  ["VP - Software IB", true],
  ["Director", true],
  ["Executive Director", true],
  ["Managing Director - Head of Consumer", true],
  ["MD", true],
  ["Principal", true],
  ["Partner", true],
  ["Head of TMT", true],
  ["Analyst", false],
  ["Associate", false],
  ["Senior Associate", false],
  ["Investment Banking Analyst, former VP at a startup", false],
  ["Associate (ex-Director at Acme)", false],
  ["Summer Analyst, MD&A team", false],
];
for (const [title, want] of vp) check(`${want ? "VP+" : "not VP+"}: ${title}`, isVpPlus(title) === want);
check("an MD with a UCLA tie is still warned, softly", !!vpPlusWarning({ position: "Managing Director", comment: "UCLA", location: "" }, DEFAULT_SETTINGS.outreach)?.tie);
check("an MD with no tie is warned hard", !vpPlusWarning({ position: "Managing Director", comment: "", location: "" }, DEFAULT_SETTINGS.outreach)?.tie);

// A "no" vs. a yes that happens to contain "unfortunately".
const replies: [string, boolean][] = [
  ["Thanks for reaching out, but I'm not able to help with recruiting. Please reach out to our campus team.", true],
  ["I'm not involved in recruiting anymore, sorry!", true],
  ["Unfortunately I don't have the bandwidth right now. Best of luck!", true],
  ["Unfortunately I'm slammed this week, but happy to chat next week. Send me some times.", false],
  ["Happy to chat! Does Thursday at 2 work?", false],
  ["Thanks Nathan, let's find a time next week.", false],
];
for (const [text, want] of replies) check(`${want ? "reads as a no" : "not a no"}: "${text.slice(0, 50)}…"`, looksLikeDecline(text) === want);

if (failed) {
  console.error(`\n${failed} scheduling check(s) failed`);
  process.exit(1);
}
console.log("\nscheduling OK");

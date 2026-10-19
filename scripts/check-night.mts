/**
 * The 9 PM text, without a browser, Google or WhatsApp: which nights it goes out, how far ahead it looks, thank-yous /
 * replies / check-ins for people who replied, follow-up #2 timed from follow-up #1, and calendar-event matching.
 *   npm run check:night
 */
import { LABELS, digestMessages, isTextDay, nextTextDay } from "../src/lib/digestFormat";
import { relationshipItem } from "../src/lib/reminders";
import { nextAction } from "../src/lib/followups";
import { matchEvent, looksLikeChat } from "../src/lib/calendarMatch";
import { latestIso } from "../src/lib/util";
import { DEFAULT_SETTINGS } from "../src/lib/defaults";
import type { Contact } from "../src/lib/types";

let failed = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok && detail ? `\n       got: ${detail}` : ""}`);
};

// Text nights: Mon–Thu. Oct 19, 2026 is a Monday.
check("Mon–Thu are text nights", ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"].every(isTextDay));
check("Fri–Sun are not", !["2026-10-23", "2026-10-24", "2026-10-25"].some(isTextDay));
check("Monday night looks through Tuesday", nextTextDay("2026-10-19") === "2026-10-20", nextTextDay("2026-10-19"));
check("Thursday night looks through Monday", nextTextDay("2026-10-22") === "2026-10-26", nextTextDay("2026-10-22"));

const base: Contact = {
  id: "s:MS:28", name: "Michael Bender", firstName: "Michael", lastName: "Bender", bank: "Morgan Stanley", region: "NY", location: "NY",
  position: "Analyst", email: "michael.bender@morganstanley.com", linkedin: "", comment: "", status: "followed_up", source: "sheet", followUps: 1, history: [],
};
const local = (s: string) => new Date(s).toISOString();

// The reported bug: first email 10/1, follow-up #1 10/13 → follow-up #2 is due 10/20 (7 days after #1), not overdue since 10/8.
const fu = DEFAULT_SETTINGS.followUp;
const mb = { ...base, sentAt: local("2026-10-01T17:00:00"), lastTouchAt: local("2026-10-13T06:00:00") };
const a = nextAction(mb, fu);
check("follow-up #2 is timed from follow-up #1", a.label === "Follow-up #2" && a.due!.toISOString().slice(0, 10) === addDaysIso("2026-10-13T06:00:00", fu.nextAfterDays), `${a.label} ${a.due?.toISOString()}`);
// A re-import of a Contacted cell saved before the follow-up ("10/1/2026") must not move the last touch back.
check("re-import keeps the later last-touch date", latestIso(local("2026-10-01T00:00:00"), mb.lastTouchAt) === mb.lastTouchAt);

// People who replied.
const replied = { ...base, status: "replied" as const, sentAt: local("2026-10-01T17:00:00"), repliedAt: local("2026-10-03T10:00:00") };
const mon = "2026-10-19";
const horizon = new Date("2026-10-20T23:59:59.999");
const label = (c: Contact, day = mon, h = horizon) => relationshipItem(c, day, h)?.label ?? "(none)";
check("call today, not thanked → thank-you tonight", label({ ...replied, status: "call_scheduled", call: { at: local("2026-10-19T14:00:00"), eventId: "e", link: "", invited: true }, lastEmailedAt: local("2026-10-18T10:00:00") }) === LABELS.thankToday);
check("call today, emailed after → nothing / check-in later", label({ ...replied, status: "call_scheduled", call: { at: local("2026-10-19T14:00:00"), eventId: "e", link: "", invited: true }, lastEmailedAt: local("2026-10-19T20:00:00") }) === "(none)");
check("call 3 days ago, never thanked → thank-you owed", label({ ...replied, call: { at: local("2026-10-16T14:00:00"), eventId: "e", link: "", invited: true }, lastEmailedAt: local("2026-10-15T10:00:00") }) === LABELS.thankOwed);
check("logged chat today counts as a call", label({ ...replied, chats: [{ id: "x", at: local("2026-10-19T12:00:00") }], lastEmailedAt: local("2026-10-10T10:00:00") }) === LABELS.thankToday);
check("they wrote after your last email → reply owed", label({ ...replied, lastEmailedAt: local("2026-10-15T10:00:00"), lastHeardAt: local("2026-10-17T10:00:00") }) === LABELS.replyOwed);
check("last email 9 days ago → check in", label({ ...replied, lastEmailedAt: local("2026-10-10T10:00:00"), lastHeardAt: local("2026-10-09T10:00:00") }) === LABELS.checkIn);
check("last email 6 days ago, due tomorrow → in tonight's text (not day of)", label({ ...replied, lastEmailedAt: local("2026-10-13T10:00:00"), lastHeardAt: local("2026-10-12T10:00:00") }) === LABELS.checkIn);
check("last email 2 days ago → not yet", label({ ...replied, lastEmailedAt: local("2026-10-17T10:00:00"), lastHeardAt: local("2026-10-16T10:00:00") }) === "(none)");
check("referred → no more check-ins", label({ ...replied, lastEmailedAt: local("2026-10-01T10:00:00"), referral: { at: local("2026-10-05T10:00:00") } }) === "(none)");
check("marked done → nothing", label({ ...replied, status: "done", lastEmailedAt: local("2026-10-01T10:00:00") }) === "(none)");
check("call still ahead → nothing to chase", label({ ...replied, status: "call_scheduled", call: { at: local("2026-10-22T14:00:00"), eventId: "e", link: "", invited: true }, lastEmailedAt: local("2026-10-01T10:00:00") }) === "(none)");
check("cold outreach isn't a check-in", label({ ...base, status: "sent", sentAt: local("2026-10-01T10:00:00") }) === "(none)");

// Text layout: thank-yous first, the tracker reminder at the end.
const msgs = digestMessages(
  [
    { contactId: "1", name: "A", label: "Follow-up #1" },
    { contactId: "2", name: "B", label: LABELS.checkIn },
    { contactId: "3", name: "C", label: LABELS.thankToday },
  ],
  ["📝 Update the tracker"],
);
const text = msgs.join("\n");
check("sections: thank-you, check-in, follow-up, then extras", text.indexOf("Thank-you") < text.indexOf("Check in") && text.indexOf("Check in") < text.indexOf("Follow-up #1") && text.trim().endsWith("📝 Update the tracker"), text);

// Calendar matching.
const people = [
  { contactId: "1", name: "Elixa Kim", email: "elixa.kim@bank.com" },
  { contactId: "2", name: "Michael Bender", email: "michael.bender@morganstanley.com" },
  { contactId: "3", name: "Michael Chen", email: "mchen@x.com" },
];
const ev = (summary: string, attendees: string[] = [], description = "") => ({ summary, description, attendees });
check("attendee email", matchEvent(ev("Coffee chat", ["elixa.kim@bank.com"]), people)?.contactId === "1");
check("first name in the dashboard's invite title", matchEvent(ev("Nathan<>Elixa Coffee Chat"), people, { firstName: "Nathan" })?.contactId === "1");
check("full name in the title", matchEvent(ev("Call w/ Michael Bender (MS)"), people)?.contactId === "2");
check("ambiguous first name → no match", matchEvent(ev("Call with Michael"), people) === null);
check("unrelated event → no match", matchEvent(ev("Econ 101 midterm"), people) === null);
check("chat-like titles", looksLikeChat("Nathan<>Sam") && looksLikeChat("Coffee chat") && !looksLikeChat("Econ 101 midterm"));

function addDaysIso(iso: string, n: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

console.log(failed ? `\n${failed} failed` : "\nall night-text checks passed");
process.exit(failed ? 1 : 0);

/**
 * The 9 PM text, without a browser, Google or WhatsApp: which nights it goes out, how far ahead it looks, thank-yous /
 * replies / check-ins for people who replied, follow-up #2 timed from follow-up #1, and calendar-event matching.
 *   npm run check:night
 */
import { LABELS, digestMessages, isTextDay, nextTextDay } from "../src/lib/digestFormat";
import { relationshipItem } from "../src/lib/reminders";
import { earliestSend, nextAction } from "../src/lib/followups";
import { DEFAULT_SEND_WINDOW, planBatch, planSends, zonedDate } from "../src/lib/sendWindow";
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

// Info sessions: people met tonight get a thank-you line until it's sent or queued.
const met = { ...base, status: "new" as const, followUps: 0, metAt: [{ sessionId: "ev1", at: local("2026-10-19T18:00:00") }] };
check("met at an info session today, nothing sent → info-session thank-you", label(met) === LABELS.infoSession, label(met));
check("info-session thank-you already queued → not listed", label({ ...met, status: "drafted", serverSend: { draftId: "d", step: 0, sendAt: local("2026-10-19T21:05:00"), queuedAt: local("2026-10-19T20:00:00") } }) === "(none)");

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

// Scheduling. "Now" = Mon 10/19/2026 noon PT; window 9–11 AM their time, Tue–Thu.
const ET = "America/New_York";
const now = zonedDate(2026, 10, 19, 12, 0, "America/Los_Angeles");
const etDay = (d?: Date) => d?.toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "numeric", day: "numeric" }) ?? "(none)";
// Will Yi (Evercore NY): first 10/7, follow-up #1 Thu 10/15 9:20 AM ET → #2 at least 6 days later (Wed 10/21 at the
// earliest; the planner picks 6, 7 or 8 days at random, owner 2026-10-20), never Tue 10/20.
const will = { ...base, id: "will", name: "Will Yi", bank: "Evercore", sentAt: "2026-10-07T14:29:00Z", lastTouchAt: "2026-10-15T13:20:00Z", followUps: 1 };
const nb = (c: Contact) => earliestSend(c, fu, c.followUps + 1);
const willAt = planSends([will], DEFAULT_SEND_WINDOW, { now, jitter: () => 0, notBefore: nb }).get("will");
check("Will Yi's follow-up #2 waits at least 6 days (Wed at the earliest, not Tue)", etDay(willAt) === "Wed, 10/21", etDay(willAt));
const willNoSpacing = planSends([will], DEFAULT_SEND_WINDOW, { now, jitter: () => 0 }).get("will");
check("(without the spacing it was Tue, the reported bug)", etDay(willNoSpacing) === "Tue, 10/20", etDay(willNoSpacing));
// Gmail's lastEmailedAt wins over a stale lastTouchAt.
const stale = { ...will, lastTouchAt: will.sentAt, lastEmailedAt: "2026-10-15T13:20:00Z" };
check("spacing uses Gmail's last-emailed date even if lastTouchAt went stale", etDay(nb(stale)) === "Wed, 10/21", etDay(nb(stale)));
// A picked day that's too soon is flagged in the batch preview.
const pick = planBatch([will], { day: { mode: "date", date: "2026-10-20" }, time: { mode: "spread" }, basis: "recipient", gap: 4 }, DEFAULT_SEND_WINDOW, new Map(), now, nb).get("will");
check("picking Tue for Will warns 'too soon'", /too soon/.test(pick?.warn ?? ""), pick?.warn);
// Tara Goel (PJT NY): #2 due Tue 10/20 with 20 NY sends already queued Tue 9–11 AM ET: no cap any more, so still Tue.
const tara = { ...base, id: "tara", name: "Tara Goel", bank: "PJT Partners", sentAt: "2026-10-02T00:00:00Z", lastTouchAt: "2026-10-13T13:09:01Z", followUps: 1 };
const tueFull = Array.from({ length: 20 }, (_, i) => zonedDate(2026, 10, 20, 9, i * 6, ET));
const why = new Map<string, string>();
const taraAt = planSends([tara], DEFAULT_SEND_WINDOW, { now, jitter: () => 0, notBefore: nb, taken: tueFull, why }).get("tara");
check("Tara still goes Tue with 20 already queued (no cap), 3+ min from each", etDay(taraAt) === "Tue, 10/20" && tueFull.every((t) => Math.abs(t.getTime() - taraAt!.getTime()) >= 3 * 60_000), etDay(taraAt));
check("…and the reason says the gap", /Tue, 7 days after your last email/.test(why.get("tara") ?? ""), why.get("tara"));
const taraFree = planSends([tara], DEFAULT_SEND_WINDOW, { now, jitter: () => 0, notBefore: nb }).get("tara");
check("with room on Tue, Tara goes Tue (due that morning)", etDay(taraFree) === "Tue, 10/20", etDay(taraFree));

function addDaysIso(iso: string, n: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

console.log(failed ? `\n${failed} failed` : "\nall night-text checks passed");
process.exit(failed ? 1 : 0);

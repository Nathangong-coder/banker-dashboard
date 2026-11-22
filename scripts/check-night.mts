/**
 * The 9 PM text, without a browser, Google or WhatsApp: which nights it goes out, how far ahead it looks, thank-yous /
 * replies / check-ins for people who replied, follow-up #2 timed from follow-up #1, and calendar-event matching.
 *   npm run check:night
 */
import { LABELS, digestMessages, isTextDay, nextTextDay, nightMessages, type DigestItem } from "../src/lib/digestFormat";
import { bankHealth, healthColor } from "../src/lib/bankHealth";
import { chatCount, thanksEvidence, withEvidence } from "../src/lib/chatEvidence";
import { callPatches, chatsIn } from "../src/lib/calendarDay";
import { programKind, summerOf, targetSummer } from "../src/lib/programs";
import { appState } from "../src/lib/nightProgress";
import { isBankFirm } from "../src/lib/processTracker";
import { canonBank } from "../src/lib/banks";
import { nightPlan, relationshipItem } from "../src/lib/reminders";
import { laterDate, laterMentions, reminderRows, unansweredReplies, wentQuiet, dueReminders } from "../src/lib/thinkAbout";
import { earliestSend, nextAction } from "../src/lib/followups";
import { DEFAULT_SEND_WINDOW, planBatch, planSends, zonedDate } from "../src/lib/sendWindow";
import { matchEvent, looksLikeChat } from "../src/lib/calendarMatch";
import { latestIso } from "../src/lib/util";
import { DEFAULT_SETTINGS } from "../src/lib/defaults";
import type { Contact } from "../src/lib/types";

let failed = 0;
const check = (what: string, ok: boolean, detail: unknown = "") => {
  if (!ok) failed++;
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok && d ? `\n       got: ${d}` : ""}`);
};

// Text nights: every night (owner, 2026-11-21; it was Mon–Thu). Oct 19, 2026 is a Monday.
check("every night is a text night", ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].every(isTextDay));
check("Monday night looks through Tuesday", nextTextDay("2026-10-19") === "2026-10-20", nextTextDay("2026-10-19"));
check("Thursday night looks through Friday", nextTextDay("2026-10-22") === "2026-10-23", nextTextDay("2026-10-22"));

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
// Replied, you answered, no chat yet: "went quiet" after 4 days (owner, 2026-11-21: Colin Bryant at DB); after a chat: check in at 7.
const chatted = { ...replied, chats: [{ id: "old", at: local("2026-10-05T12:00:00") }] };
check("after a chat, last email 9 days ago → check in", label({ ...chatted, lastEmailedAt: local("2026-10-10T10:00:00"), lastHeardAt: local("2026-10-09T10:00:00") }) === LABELS.checkIn);
check("after a chat, last email 6 days ago, due tomorrow → in tonight's text (not day of)", label({ ...chatted, lastEmailedAt: local("2026-10-13T10:00:00"), lastHeardAt: local("2026-10-12T10:00:00") }) === LABELS.checkIn);
check("after a chat, last email 4 days ago → not yet", label({ ...chatted, lastEmailedAt: local("2026-10-15T10:00:00"), lastHeardAt: local("2026-10-14T10:00:00") }) === "(none)");
check("no chat yet, last email 9 days ago → went quiet", label({ ...replied, lastEmailedAt: local("2026-10-10T10:00:00"), lastHeardAt: local("2026-10-09T10:00:00") }) === LABELS.quiet);
check("no chat yet, last email 3 days ago, due tomorrow → went quiet tonight", label({ ...replied, lastEmailedAt: local("2026-10-16T10:00:00"), lastHeardAt: local("2026-10-15T10:00:00") }) === LABELS.quiet);
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

// Three messages (owner, 2026-11-21): big banks, to-do, outreach; each section capped with "+N more" and a link.
const many: DigestItem[] = [
  ...Array.from({ length: 25 }, (_, i) => ({ contactId: `f${i}`, name: `Follow ${i}`, label: "Follow-up #1" })),
  ...Array.from({ length: 20 }, (_, i) => ({ contactId: `k${i}`, name: `Check ${i}`, label: LABELS.checkIn })),
  ...Array.from({ length: 21 }, (_, i) => ({ contactId: `o${i}`, name: `Bank ${i}: SF 0/2`, label: LABELS.fillOffices })),
  { contactId: "r1", name: "Reply Person", email: "r@x.com", label: LABELS.replyOwed },
  { contactId: "t1", name: "Thank Person", label: LABELS.thankToday },
  { contactId: "p1", name: "Jane (GS) at 10:00 AM", label: LABELS.prepTomorrow },
];
const progress = {
  at: "2026-10-19T20:00:00Z",
  banks: [
    { bank: "Goldman Sachs", score: 100, column: "First round", chats: 3, emailed: 4, live: 1, app: "applied" as const, next: "Reply to Jane" },
    { bank: "Citi", score: null, chats: 0, emailed: 0, live: 0 },
    { bank: "Barclays", score: 15, chats: 0, emailed: 3, live: 0, app: "open" as const },
  ],
  tips: ["Nobody emailed yet at Citi: start there."],
  week: { emails: 6, replies: 2, chats: 1 },
};
const three = nightMessages({ items: many, progress, app: "https://x.app", todoExtra: ["📝 Update the tracker"], outreachExtra: ["Already scheduled before tomorrow night: 4"] });
check("three messages: big banks, to-do, outreach", three.length === 3 && three[0].startsWith("📊") && three[1].startsWith("✅") && three[2].startsWith("📬"), three.map((m) => m.slice(0, 12)).join(" | "));
check("big banks: colors, column, app, next step, tips", /🟢 Goldman Sachs \(First round\): 3 chats · applied → Reply to Jane/.test(three[0]) && /⚪ Citi: nobody emailed/.test(three[0]) && /🔴 Barclays/.test(three[0]) && /Do better/.test(three[0]), three[0]);
check("to-do holds thank-you, reply, check-in, prep; not follow-ups", /Thank-you/.test(three[1]) && /They wrote back/.test(three[1]) && /Check in/.test(three[1]) && /Calls tomorrow/.test(three[1]) && !/Follow-up #1/.test(three[1]), three[1]);
check("outreach holds follow-ups, then offices, ends with the scheduled line", /Follow-up #1\* \(25\)/.test(three[2]) && three[2].indexOf("Follow-up #1") < three[2].indexOf("Offices to fill") && three[2].trim().endsWith("Already scheduled before tomorrow night: 4"), three[2]);
check("sections capped at 8 with +N more", /\+17 more: https:\/\/x.app\/followups/.test(three[2]) && /\+12 more/.test(three[1]) && /\+13 more: https:\/\/x.app\/coverage/.test(three[2]), three[2]);
check("each message fits one WhatsApp send (≤1500)", three.every((m) => m.length <= 1500), three.map((m) => m.length).join(","));
check("nothing to say → no messages", nightMessages({ items: [], app: "x" }).length === 0);

// Bank health (Process tracker colors + the Big banks emoji).
const hb = (over: Partial<Contact>[]) => bankHealth(over.map((o, i) => ({ ...base, id: `h${i}`, status: "new" as const, sentAt: undefined, followUps: 0, ...o })));
check("nobody emailed → no score (white)", hb([{}]).score === null && healthColor(null).tone === "none");
check("emailed, no chat → 30 (neutral)", hb([{ status: "sent", sentAt: local("2026-10-01T10:00:00") }]).score === 30);
check("all moved on with no reply → red", (hb([{ status: "ignored", sentAt: local("2026-10-01T10:00:00") }]).score ?? 99) < 30);
check("two chats → green", (hb([{ status: "done", sentAt: local("2026-10-01T10:00:00"), chats: [{ id: "1", at: local("2026-10-05T10:00:00") }, { id: "2", at: local("2026-10-09T10:00:00") }] }]).score ?? 0) >= 60);
check("referral from a VP → 100", hb([{ status: "done", position: "Vice President", sentAt: local("2026-10-01T10:00:00"), referral: { at: local("2026-10-05T10:00:00") } }]).score === 100);
check("referral from an analyst → 88+", (hb([{ status: "done", position: "Analyst", sentAt: local("2026-10-01T10:00:00"), referral: { at: local("2026-10-05T10:00:00") } }]).score ?? 0) >= 88);

// Counting chats (owner, 2026-11-21): two chats at Bank of America, Eli Sanchez and Charles Kirby both calendar guests,
// both thanked in one email chain. It showed one chat.
{
  const eli = { ...base, id: "eli", name: "Eli Sanchez", bank: "Bank of America", email: "eli.sanchez@bofa.com", status: "replied" as const, repliedAt: local("2026-10-20T10:00:00") };
  const charles = { ...base, id: "charles", name: "Charles Kirby", bank: "Bank of America", email: "charles.kirby@bofa.com", status: "replied" as const, repliedAt: local("2026-10-21T10:00:00") };
  const cold = { ...base, id: "cold", name: "Pat Cold", bank: "Bank of America", email: "pat.cold@bofa.com", status: "sent" as const };
  const ev = { id: "ev1", title: "Nathan <> BofA", start: local("2026-10-28T15:00:00"), end: local("2026-10-28T15:30:00"), allDay: false, attendees: ["eli.sanchez@bofa.com", "charles.kirby@bofa.com"] };
  const chats = chatsIn([ev], [eli, charles, cold], "Nathan");
  check("an event with two bank guests is a chat with each", JSON.stringify(chats[0]?.contactIds?.slice().sort()) === JSON.stringify(["charles", "eli"]), chats);
  const patches = callPatches(chats, [eli, charles], Date.parse("2026-11-21T00:00:00Z"));
  check("both get the chat recorded", patches.length === 2 && patches.every((p) => p.patch.chatEvidence?.length === 1), patches);
  const withCal = [eli, charles].map((c) => ({ ...c, ...patches.find((p) => p.id === c.id)!.patch }));
  const sent = [
    { id: "m1", email: "eli.sanchez@bofa.com", at: Date.parse(local("2026-10-28T20:00:00")) },
    { id: "m2", email: "charles.kirby@bofa.com", at: Date.parse(local("2026-10-29T09:00:00")) },
    { id: "m3", email: "pat.cold@bofa.com", at: Date.parse(local("2026-10-29T09:00:00")) },
  ];
  const thanks = thanksEvidence(sent, [...withCal, cold]);
  check("thank-yous count for people who'd replied, never a cold email", thanks.map((t) => t.id).sort().join() === "charles,eli", thanks);
  const final = withCal.map((c) => ({ ...c, chatEvidence: withEvidence(c, thanks.find((t) => t.id === c.id)!.add) }));
  check("a thank-you the day after the call is the same chat (1 each)", final.every((c) => chatCount(c) === 1), final.map((c) => chatCount(c)));
  check("Bank of America: 2 chats", bankHealth(final).chats === 2, bankHealth(final));
  const thanksOnly = { ...eli, call: undefined, chatEvidence: [{ at: local("2026-11-10T10:00:00"), source: "thanks" as const, ref: "m9" }] };
  check("a thank-you with no calendar event still counts as a chat", chatCount(thanksOnly) === 1);
}

// Summer Analyst vs insight programs (owner, 2026-11-21: JP Morgan showed Applied from an insight program).
{
  check("insight program", programKind({ role: "2027 Early Insight Program - Investment Banking" }) === "insight");
  check("sophomore program", programKind({ role: "Sophomore Summer Analyst Program 2027" }) === "insight");
  check("summer analyst", programKind({ role: "2028 Investment Banking Summer Analyst - New York" }) === "sa");
  check("your override wins", programKind({ role: "Early Insight", program: "sa" }) === "sa");
  check("summer from the title", summerOf({ role: "Summer Analyst 2028" }) === 2028 && summerOf({ role: "IB Summer Analyst '28" }) === 2028 && summerOf({ role: "Summer Analyst" }) === undefined);
  check("class of 2029 recruits for Summer 2028", targetSummer("2029-06-15") === 2028 && targetSummer(["", "Class of 2029"]) === 2028);
  const jobs = [
    { company: "JP Morgan", status: "submitted" as const, role: "Early Insight Program 2027" },
    { company: "Goldman Sachs", status: "submitted" as const, role: "2028 Summer Analyst" },
    { company: "Evercore", status: "submitted" as const, role: "Summer Analyst 2027" },
  ];
  const row = (name: string) => ({ key: canonBank(name), applied: [] });
  check("JPM insight program is not an application for Summer 2028", appState(row("JP Morgan"), jobs, { cycle: 2028, target: 2028 }) === undefined);
  check("…but it is on the Summer 2027 board", appState(row("JP Morgan"), jobs, { cycle: 2027, target: 2028 }) === "applied");
  check("GS 2028 summer analyst counts", appState(row("Goldman Sachs"), jobs, { cycle: 2028, target: 2028 }) === "applied");
  check("a 2027 summer analyst doesn't count for 2028", appState(row("Evercore"), jobs, { cycle: 2028, target: 2028 }) === undefined);
  check("RCLCO isn't a bank; Piper Sandler is", !isBankFirm({ key: canonBank("RCLCO") }, { added: [] }) && isBankFirm({ key: canonBank("Piper Sandler"), tier: "Middle Market" }, { added: [] }));
  check("…unless you say so", isBankFirm({ key: canonBank("RCLCO") }, { added: [], firmKind: { [canonBank("RCLCO")]: "bank" } }));
}

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

// Things to think about (owner, 2026-11-21).
const said = new Date("2026-11-03T10:00:00");
check("'reach out in January' (said in Nov) → Jan 5 next year", laterDate("Feel free to reach out in January.", said)?.due === "2027-01-05", laterDate("Feel free to reach out in January.", said));
check("'after the new year' → Jan 5", laterDate("Let's reconnect after the new year", said)?.due === "2027-01-05");
check("'mid-February' → Feb 15", laterDate("ping me mid-February", said)?.due === "2027-02-15");
check("'in a few weeks' → +3 weeks", laterDate("check back in a few weeks", said)?.due === "2026-11-24", laterDate("check back in a few weeks", said));
check("'after Thanksgiving' → the Monday after", laterDate("follow up after Thanksgiving", said)?.due === "2026-11-30", laterDate("follow up after Thanksgiving", said));
check("'next spring' → Mar 1", laterDate("touch base next spring", said)?.due === "2027-03-01");
check("'you may want…' is not May", laterMentions("You may want to reach out to our recruiter.", said).length === 0);
check("a month with no reach-out wording is ignored", laterMentions("I joined the team in January after two years at Lazard.", said).length === 0);
const busy = laterMentions("Our team is heads-down on a deal through December, so feel free to reach out in January and we can find 20 minutes.", said);
check("'busy through December, so reach out in January' → January, not December", busy.length === 1 && busy[0].due === "2027-01-05" && busy[0].phrase === "January", busy);
check("notes: 'told me to reach out in January' is found", laterMentions("Great chat. He told me to reach out in January once staffing settles.", said).length === 1);
const colin = { ...replied, id: "colin", name: "Colin Bryant", bank: "Deutsche Bank", email: "colin.bryant@db.com", lastHeardAt: "2026-11-10T15:00:00Z", lastEmailedAt: "2026-11-11T02:00:00Z" };
const q = wentQuiet([colin], Date.parse("2026-11-16T12:00:00Z"));
check("Colin Bryant (replied, you answered, no chat) → went quiet, nudge due", q.length === 1 && !q[0].chatted && Date.parse(q[0].due) <= Date.parse("2026-11-16T12:00:00Z"), q[0]);
check("…a call ahead → not quiet", wentQuiet([{ ...colin, call: { at: "2026-11-20T18:00:00Z", eventId: "e", link: "", invited: true } }], Date.parse("2026-11-16T12:00:00Z")).length === 0);
const owed = { ...colin, lastHeardAt: "2026-11-15T15:00:00Z", lastReply: { at: "2026-11-15T15:00:00Z", messageId: "m1", text: "Thanks Nathan, happy to chat. Reach out in January and we can find time.", needsReply: true } };
const ur = unansweredReplies([owed], Date.parse("2026-11-16T12:00:00Z"));
check("they wrote after you → reply to answer, with their message, 'last day'", ur.length === 1 && ur[0].age === "day" && /happy to chat/.test(ur[0].text ?? ""), ur[0]);
check("…done by hand settles it", unansweredReplies([{ ...owed, handledAt: "2026-11-16T00:00:00Z" }], Date.parse("2026-11-16T12:00:00Z")).length === 0);
check("…an older stored text isn't shown as this email", unansweredReplies([{ ...owed, lastReply: { ...owed.lastReply, at: "2026-11-01T00:00:00Z" } }], Date.parse("2026-11-16T12:00:00Z"))[0].text === undefined);
const rr = reminderRows([owed], {});
check("their 'reach out in January' becomes a found reminder for Jan 5", rr.length === 1 && rr[0].due === "2027-01-05" && rr[0].found && rr[0].contactId === "colin", rr);
const rrDone = reminderRows([owed], { [rr[0].id]: { id: rr[0].id, due: rr[0].due, note: rr[0].note, createdAt: "", done: "2026-11-16T00:00:00Z", source: "found" } });
check("…marking it done sticks", !!rrDone[0].done && dueReminders(rrDone, "2027-02-01").length === 0);
const manual = reminderRows([], { man_1: { id: "man_1", due: "2026-12-01", note: "Email Evercore SF", bank: "Evercore", createdAt: "", source: "manual" } });
check("a reminder you added is listed", manual.length === 1 && manual[0].note === "Email Evercore SF" && !manual[0].found);
const planR = nightPlan([], {}, fu, 40, manual);
check("…and goes in the 9 PM text the night before it's due", (planR["2026-11-30"]?.items ?? []).some((i) => i.label === LABELS.reminder && /Evercore: Email Evercore SF/.test(i.name)) || new Date() > new Date("2026-11-30"), planR["2026-11-30"]);

function addDaysIso(iso: string, n: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

console.log(failed ? `\n${failed} failed` : "\nall night-text checks passed");
process.exit(failed ? 1 : 0);

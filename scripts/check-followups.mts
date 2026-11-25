/**
 * Follow-ups overviews + Gmail scheduling hand-off (owner, 2026-11-23): Gmail links, Scheduled rows, overview numbers,
 * the calendar, the hand-off list.
 *   npm run check:followups
 */
import { dayLinks, gmailDraftUrl, gmailSearchUrl, gmailThreadUrl, personQuery } from "../src/lib/gmailLinks";
import { scheduledRows } from "../src/lib/scheduledRows";
import { calendarDays, coldBankPeople, coldByBank, coldDueCount, dayKey, warmByBank } from "../src/lib/followupsOverview";
import { followUpKey, todoGroup, todoItems } from "../src/lib/todoList";
import { todoFor } from "../src/lib/thinkAbout";
import { DEFAULT_SETTINGS } from "../src/lib/defaults";
import { nextAction } from "../src/lib/followups";
import { confirmHandoff, handoffItems } from "../src/lib/handoff";
import type { Contact } from "../src/lib/types";

let failed = 0;
const check = (what: string, ok: boolean, detail: unknown = "") => {
  if (!ok) failed++;
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok && d ? `\n       got: ${d}` : ""}`);
};

export const base: Contact = {
  id: "s:JPM:20", name: "Varsha Raghu", firstName: "Varsha", lastName: "Raghu", bank: "JP Morgan", region: "SF", location: "",
  position: "Analyst", email: "varsha@jpmorgan.com", linkedin: "", comment: "", status: "sent", source: "sheet", followUps: 0, history: [],
};

/* ---- Task 1: Gmail links ---- */
const query = (url: string) => decodeURIComponent(url.split("#search/")[1] ?? "");
check("search URL opens Gmail search with the query", gmailSearchUrl("in:scheduled") === "https://mail.google.com/mail/u/0/#search/in%3Ascheduled", gmailSearchUrl("in:scheduled"));
check("thread URL", gmailThreadUrl("18c2a") === "https://mail.google.com/mail/u/0/#all/18c2a");
check("draft URL", gmailDraftUrl("18c2b") === "https://mail.google.com/mail/u/0/#drafts?compose=18c2b");
const pq = personQuery({ ...base, aliases: ["vr@jpmchase.com"] });
check("person query has every address both ways + the name", ["from:varsha@jpmorgan.com", "to:varsha@jpmorgan.com", "from:vr@jpmchase.com", "to:vr@jpmchase.com", '"Varsha Raghu"'].every((x) => pq.includes(x)), pq);
const day = new Date(2026, 10, 10, 15, 0);
const one = dayLinks(day, { to: ["a@gs.com"] });
const start = new Date(2026, 10, 10).getTime() / 1000;
const end = new Date(2026, 10, 11).getTime() / 1000;
check("one person → one link for that local day (epoch seconds)", one.length === 1 && query(one[0]).includes(`after:${start}`) && query(one[0]).includes(`before:${end}`) && query(one[0]).includes("to:a@gs.com"), one);
check("someone who wrote you → from:", query(dayLinks(day, { from: ["b@ms.com"] })[0]).includes("from:b@ms.com"));
const many = dayLinks(day, { to: Array.from({ length: 60 }, (_, i) => `banker.number${i}@goldmansachs.com`) });
check("60 people → several links, none over 1,800 chars", many.length >= 2 && many.every((u) => query(u).length <= 1800), many.map((u) => query(u).length));
check("every address lands in some link", Array.from({ length: 60 }, (_, i) => `banker.number${i}@goldmansachs.com`).every((a) => many.some((u) => query(u).includes(a))));
check("nobody → no link", dayLinks(day, {}).length === 0);

/* ---- Task 3: Scheduled = Gmail's Scheduled folder + Coverage's queue ---- */
const HOUR = 3_600_000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const gItem = (to: string, h: number, labels: string[] = []) => ({ at: at(h), to: [to], subject: "Re: Fellow Bruin", labels, threadId: `t${h}` });
const jane: Contact = { ...base, id: "s:GS:5", name: "Jane Park", email: "jane@gs.com", aliases: ["jpark@gs.com"], bank: "Goldman Sachs" };
const two = scheduledRows([gItem("jane@gs.com", 20), gItem("jane@gs.com", 50)], [jane]);
check("two scheduled emails to one person → two rows", two.length === 2 && two.every((r) => r.contact?.id === jane.id), two.map((r) => r.contact?.id));
check("an alias address still finds the person", scheduledRows([gItem("jpark@gs.com", 5)], [jane])[0]?.contact?.id === jane.id);
const stranger = scheduledRows([gItem("x@ms.com", 5)], [jane]);
check("someone not in the tracker is still a row", stranger.length === 1 && !stranger[0].contact && stranger[0].to === "x@ms.com", stranger);
check("an email already sent (past) is dropped", scheduledRows([gItem("jane@gs.com", -2)], [jane]).length === 0);
const both = scheduledRows([gItem("jane@gs.com", 20)], [{ ...jane, serverSend: { draftId: "d1", sendAt: new Date(Date.parse(at(20)) + 60_000).toISOString(), step: 1, queuedAt: at(-1) } }]);
check("a Coverage send that's the same email Gmail shows → one row", both.length === 1, both);
const cov = scheduledRows([], [{ ...jane, serverSend: { draftId: "d1", sendAt: at(30), step: 2, queuedAt: at(-1) } }]);
check("a Coverage send alone → its own row, via coverage", cov.length === 1 && cov[0].via === "coverage" && cov[0].step === 2, cov);
check("rows come soonest first", scheduledRows([gItem("jane@gs.com", 50), gItem("x@ms.com", 5)], [jane]).map((r) => r.to).join() === "x@ms.com,jane@gs.com");
const never = scheduledRows(undefined, [{ ...jane, scheduledAt: at(10) }]);
check("Gmail never read yet → contacts' own scheduledAt are the Gmail rows", never.length === 1 && never[0].via === "gmail" && never[0].contact?.id === jane.id, never);
check("a HOLD label is flagged", scheduledRows([gItem("jane@gs.com", 5, ["HOLD"])], [jane])[0]?.stop === true);

/* ---- Task 4: overview numbers + calendar ---- */
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const fu = DEFAULT_SETTINGS.followUp;
const mix: Contact[] = [
  { ...base, id: "a", name: "Due Person", bank: "Goldman Sachs", email: "a@gs.com", status: "sent", sentAt: ago(fu.firstAfterDays + 1), lastTouchAt: ago(fu.firstAfterDays + 1) },
  { ...base, id: "b", name: "Cold Person", bank: "Goldman Sachs & Co.", email: "b@gs.com", status: "sent", sentAt: ago(fu.firstAfterDays + 20), lastTouchAt: ago(fu.firstAfterDays + 20) },
  { ...base, id: "c", name: "Draft Person", bank: "Morgan Stanley", email: "c@ms.com", status: "drafted", draft: { subject: "s", body: "b", createdAt: ago(2) } as Contact["draft"] },
  { ...base, id: "d", name: "Fresh Person", bank: "Morgan Stanley", email: "d@ms.com", status: "sent", sentAt: ago(1), lastTouchAt: ago(1) },
];
const ov = coldByBank(mix, {}, fu, []);
check("overview's due total = the nav count (went cold not in it)", ov.totals.due === coldDueCount(mix, {}, fu) && ov.totals.due === 1, { totals: ov.totals, nav: coldDueCount(mix, {}, fu) });
check("went cold counted apart", ov.totals.cold === 1, ov.totals);
check("'Goldman Sachs & Co.' and 'Goldman Sachs' are one bank row", ov.rows.filter((r) => /goldman/i.test(r.bank)).length === 1, ov.rows.map((r) => r.bank));
check("bank rows sorted by total, biggest first", ov.rows[0].total >= ov.rows[ov.rows.length - 1].total);
const schedOv = coldByBank(mix, {}, fu, [{ key: "g1", at: ago(-1), to: "d@ms.com", contact: mix[3], via: "gmail" }]);
check("scheduled emails counted on the person's bank", schedOv.rows.find((r) => /morgan/i.test(r.bank))?.scheduled === 1, schedOv.rows);

const month = new Date(); month.setDate(1);
const emailedDay = new Date(Date.now() - 3 * DAY);
const waiting: Contact = { ...base, id: "w", status: "sent", sentAt: emailedDay.toISOString(), lastTouchAt: emailedDay.toISOString() };
const cal = calendarDays([waiting], new Date(emailedDay.getFullYear(), emailedDay.getMonth(), 1));
check("an email with no reply → green on that day", cal.get(dayKey(emailedDay))?.green.some((c) => c.id === "w") === true, [...cal.keys()]);
const answered: Contact = { ...waiting, id: "r", status: "replied", repliedAt: ago(1), lastHeardAt: ago(1) };
const cal2 = calendarDays([answered], new Date(emailedDay.getFullYear(), emailedDay.getMonth(), 1));
check("they replied since → not green on the old day", !cal2.get(dayKey(emailedDay))?.green.length);
const heardDay = new Date(Date.now() - 2 * DAY);
const owe: Contact = { ...base, id: "o", status: "replied", sentAt: ago(6), lastTouchAt: ago(6), lastEmailedAt: ago(6), repliedAt: heardDay.toISOString(), lastHeardAt: heardDay.toISOString() };
const cal3 = calendarDays([owe], new Date(heardDay.getFullYear(), heardDay.getMonth(), 1));
check("they wrote and you didn't answer → red on that day", cal3.get(dayKey(heardDay))?.red.some((c) => c.id === "o") === true, [...cal3.entries()].map(([k, v]) => [k, v.red.length, v.green.length]));
const done = calendarDays([{ ...owe, handledAt: ago(0) }], new Date(heardDay.getFullYear(), heardDay.getMonth(), 1));
check("'No reply needed' (done by hand) → not red", !done.get(dayKey(heardDay))?.red.length);
const moved = calendarDays([{ ...waiting, status: "ignored" }], new Date(emailedDay.getFullYear(), emailedDay.getMonth(), 1));
check("moved on → not green", !moved.get(dayKey(emailedDay))?.green.length);

const warm = warmByBank([owe, { ...mix[0] }, { ...base, id: "x", name: "Chat Person", bank: "Goldman Sachs", chats: [{ id: "k", at: ago(30), notes: "" } as never], lastEmailedAt: ago(28) }]);
const gs = warm.find((g) => /goldman/i.test(g.bank));
check("warm: only people in a conversation (not cold ones)", warm.flatMap((g) => g.people).every((p) => p.c.id !== "a"), warm.map((g) => g.people.map((p) => p.c.id)));
check("warm: someone who wrote you is listed with what's owed", warm.flatMap((g) => g.people).find((p) => p.c.id === "o")?.owed === "reply");
check("warm: how you know them is said (chat)", /chat/i.test(gs?.people.find((p) => p.c.id === "x")?.how ?? ""), gs?.people);

/* ---- Task 6: the hand-off list (to schedule in Gmail) ---- */
const slot = at(30);
const hs = (state: "waiting" | "scheduled" | "failed", when = slot) => ({ draftId: "r-1", messageId: "m-1", subject: "Re: Fellow Bruin", step: 1, at: when, state, updatedAt: at(-1) });
const waitingJane: Contact = { ...jane, gmailSchedule: hs("waiting") };
const items = handoffItems([waitingJane, { ...jane, id: "y", gmailSchedule: hs("scheduled") }]);
check("only waiting ones are on the list", items.length === 1 && items[0].id === jane.id && items[0].to === "jane@gs.com" && items[0].messageId === "m-1", items);
check("someone queued for Coverage sending is never also handed to Gmail", handoffItems([{ ...waitingJane, serverSend: { draftId: "d", sendAt: slot, step: 1, queuedAt: at(-1) } }]).length === 0);
const near = { at: new Date(Date.parse(slot) + 60_000).toISOString(), to: ["jane@gs.com"], subject: "Re: Fellow Bruin", labels: [], threadId: "t" };
const far = { ...near, at: new Date(Date.parse(slot) + 10 * 60_000).toISOString() };
const ok1 = confirmHandoff([waitingJane], [near]);
check("in Gmail's Scheduled 1 minute off → confirmed", ok1.length === 1 && ok1[0].patch.gmailSchedule?.state === "scheduled", ok1);
check("10 minutes off → not confirmed", confirmHandoff([waitingJane], [far]).length === 0);
check("an alias address confirms too", confirmHandoff([waitingJane], [{ ...near, to: ["jpark@gs.com"] }]).length === 1);
const gone = confirmHandoff([{ ...jane, gmailSchedule: hs("scheduled") }], []);
check("confirmed, then gone from Gmail before its time → back to waiting", gone.length === 1 && gone[0].patch.gmailSchedule?.state === "waiting", gone);
check("confirmed and its time passed (it went out) → left alone", confirmHandoff([{ ...jane, gmailSchedule: hs("scheduled", at(-2)) }], []).length === 0);

/* ---- Final review: a draft waiting on the Gmail list counts as handled ---- */
const dueWaiting: Contact = { ...mix[0], gmailSchedule: { draftId: "r", messageId: "m", subject: "", step: 1, at: at(20), state: "waiting", updatedAt: at(-1) } };
check("a follow-up waiting on the Gmail list isn't in Due or the nav count", coldDueCount([dueWaiting], {}, fu) === 0, nextAction(dueWaiting, fu));
check("…and it shows as scheduled", nextAction(dueWaiting, fu).kind === "scheduled");
check("a failed one is due again", coldDueCount([{ ...dueWaiting, gmailSchedule: { ...dueWaiting.gmailSchedule!, state: "failed" } }], {}, fu) === 1);

/* ---- Round 2 (owner, 2026-11-24) ---- */
// Cold calendar: only each person's most recent email.
const twoEmails: Contact = { ...base, id: "t2", status: "followed_up", followUps: 1, sentAt: ago(9), lastTouchAt: ago(2), lastEmailedAt: ago(2) };
const m2 = new Date(Date.now() - 2 * DAY);
const calCold = calendarDays([twoEmails], new Date(m2.getFullYear(), m2.getMonth(), 1), Date.now(), "cold");
const calColdPrev = calendarDays([twoEmails], new Date(new Date(Date.now() - 9 * DAY).getFullYear(), new Date(Date.now() - 9 * DAY).getMonth(), 1), Date.now(), "cold");
check("cold calendar: only the most recent email is green", calCold.get(dayKey(m2))?.green.length === 1 && !calColdPrev.get(dayKey(new Date(Date.now() - 9 * DAY)))?.green.length, [...calCold.keys()]);
// Warm calendar: chat days green; a chat with no follow-up red.
const chatDay = new Date(Date.now() - 3 * DAY);
const chatted: Contact = { ...base, id: "ch", status: "call_scheduled", repliedAt: ago(10), lastHeardAt: ago(10), lastEmailedAt: ago(11), chats: [{ id: "k1", at: chatDay.toISOString(), kind: "coffee_chat", notes: "" } as never] };
const warmCal = calendarDays([chatted], new Date(chatDay.getFullYear(), chatDay.getMonth(), 1), Date.now(), "warm");
check("warm calendar: a chat day is green", warmCal.get(dayKey(chatDay))?.green.some((c) => c.id === "ch") === true, [...warmCal.entries()].map(([k, v]) => [k, v.green.length, v.red.length]));
check("warm calendar: no thank-you since → red on the chat day", warmCal.get(dayKey(chatDay))?.red.some((c) => c.id === "ch") === true);
const thanked = calendarDays([{ ...chatted, lastEmailedAt: ago(2) }], new Date(chatDay.getFullYear(), chatDay.getMonth(), 1), Date.now(), "warm");
check("warm calendar: thanked → green only", thanked.get(dayKey(chatDay))?.green.length === 1 && !thanked.get(dayKey(chatDay))?.red.length);

// Dismissing a nudge.
const dueOne = mix[0];
const key = followUpKey(dueOne)!;
check("a follow-up nudge has a key", !!key && key.startsWith("fu:1:"), key);
check("dismissed follow-up → not due, not counted", coldDueCount([{ ...dueOne, dismissed: [key] }], {}, fu) === 0 && nextAction({ ...dueOne, dismissed: [key] }, fu).isDue === false);
const ownRow = todoFor(owe, Date.now());
check("dismissed reply nudge → gone from the warm list", !!ownRow && todoFor({ ...owe, dismissed: [ownRow.key] }, Date.now()) === null);
check("…until they write again (a new email = a new key)", !!todoFor({ ...owe, dismissed: [ownRow!.key], lastHeardAt: ago(0), repliedAt: ago(0) }, Date.now()));

// The master to-do list.
const tItems = todoItems([owe, dueOne, mix[3]], {}, fu, undefined);
check("to-do: a reply owed and a follow-up due, nothing for someone just emailed", tItems.some((i) => i.kind === "reply" && i.c?.id === "o") && tItems.some((i) => i.kind === "follow_up" && i.c?.id === "a") && !tItems.some((i) => i.c?.id === "d"), tItems.map((i) => `${i.kind}:${i.c?.id}`));
check("to-do: a dismissed follow-up is left out", !todoItems([{ ...dueOne, dismissed: [key] }], {}, fu, undefined).length);
check("to-do groups: yesterday → overdue, today → today, in 3 days → this week", todoGroup(ago(1)) === "overdue" && todoGroup(new Date().toISOString()) === "today" && todoGroup(ago(-3)) === "week");

// Cold by bank: teams and who you emailed.
const cb = coldBankPeople([{ ...mix[0], team: "Tech" }, { ...mix[1], team: "Tech", region: "NY" }, mix[2], owe]);
const gsb = cb.find((b) => /goldman/i.test(b.bank));
check("cold by bank: grouped by office · team, only people you emailed", !!gsb && gsb.teams.length === 2 && gsb.emailed === 2 && !cb.some((b) => b.teams.some((t) => t.people.some((p) => p.c.id === "c"))), gsb?.teams.map((t) => t.label));
check("cold by bank: each person says where it stands", gsb?.teams.flatMap((t) => t.people).every((p) => /Emailed|Follow-up|Replied|Scheduled/.test(p.state)) === true, gsb?.teams.flatMap((t) => t.people.map((p) => p.state)));

console.log(failed ? `\n${failed} FAILED` : "\nall ok");
if (failed) process.exit(1);

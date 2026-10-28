/**
 * Names First Last, automatic move-on at the end of the work week, the follow-up count written to the sheet, and the
 * referral / live / awaiting office slots (owner, 2026-10-27; Houlihan Lokey's Mohammed was "Followed up (1x)" after #2):
 *   npm run check:moveon
 */
import { personName, splitName } from "../src/lib/util";
import { moveOnDate, nextAction } from "../src/lib/followups";
import { upkeepPatches } from "../src/lib/contactUpkeep";
import { liveKind, officeSlots } from "../src/lib/bankWork";
import { contactPatches, STATUS_TO_SHEET } from "../src/lib/workbook";
import type { Contact, Settings } from "../src/lib/types";
import type { SheetSnapshot } from "../src/lib/types";

let failed = 0;
const check = (what: string, ok: boolean, detail: unknown = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok ? `\n       got: ${JSON.stringify(detail)}` : ""}`);
};

const fu: Settings["followUp"] = { firstAfterDays: 7, nextAfterDays: 7, maxFollowUps: 2, moveOnAfterDays: 7, livePerBank: 2 };
const person = (p: Partial<Contact>): Contact =>
  ({ id: "x", name: "Mohammed Ali", firstName: "Mohammed", lastName: "Ali", bank: "Houlihan Lokey", region: "SF", location: "SF", position: "Analyst", email: "m@hl.com", linkedin: "", comment: "", status: "followed_up", followUps: 2, source: "sheet", history: [], ...p }) as Contact;
const local = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).toISOString();

// Names
check("Zhu, Kevin → Kevin Zhu", personName("Zhu, Kevin") === "Kevin Zhu", personName("Zhu, Kevin"));
check("extra spaces collapse", personName("  Zhu ,  Kevin ") === "Kevin Zhu", personName("  Zhu ,  Kevin "));
check("John Smith, CFA stays", personName("John Smith, CFA") === "John Smith, CFA");
check("Smith, Jr. stays", personName("Smith, Jr.") === "Smith, Jr.");
check("Maggie Han — Analyst, IBD → Maggie Han", personName("Maggie Han — Analyst, IBD") === "Maggie Han", personName("Maggie Han — Analyst, IBD"));
check("Lexa Lemberg — Analyst, Strategic Insights — → Lexa Lemberg", personName("Lexa Lemberg — Analyst, Strategic Insights —") === "Lexa Lemberg");
const titled = upkeepPatches([person({ name: "Maggie Han — Analyst, IBD", position: "", status: "new", followUps: 0 })], fu)[0];
check("…and the title becomes the position", titled?.patch.position === "Analyst, IBD", titled);
check("plain names untouched", personName("Kevin Zhu") === "Kevin Zhu");
check("splitName reads Last, First", splitName("Zhu, Kevin").first === "Kevin" && splitName("Zhu, Kevin").last === "Zhu", splitName("Zhu, Kevin"));
const named = upkeepPatches([person({ name: "Zhu, Kevin", firstName: "Zhu", lastName: "", status: "new", followUps: 0 })], fu);
check("upkeep renames Zhu, Kevin", named[0]?.patch.name === "Kevin Zhu" && named[0]?.patch.firstName === "Kevin", named);

// Move-on date: the end of the work week of the last follow-up
const tue = local(2026, 10, 20);
const d1 = moveOnDate(person({ sentAt: local(2026, 10, 6), lastTouchAt: tue }), fu)!;
check("Tue final check-in → Fri that week", d1.getDay() === 5 && d1.getDate() === 23, d1.toString());
const fri = moveOnDate(person({ sentAt: local(2026, 10, 2), lastTouchAt: local(2026, 10, 16) }), fu)!;
check("Fri final check-in → next Fri", fri.getDate() === 23, fri.toString());
check("not before the follow-ups are used up", moveOnDate(person({ followUps: 1, lastTouchAt: tue }), fu) === undefined);
const late = moveOnDate(person({ sentAt: local(2026, 10, 1), lastTouchAt: local(2026, 10, 8), lastEmailedAt: tue }), fu)!;
check("Gmail's later sent date wins (follow-up #2 sent by Schedule send)", late.getDate() === 23, late.toString());

// Never a to-do
const a = nextAction(person({ sentAt: local(2026, 10, 6), lastTouchAt: tue }), fu);
check("nextAction: move_on, never due, says when", a.kind === "move_on" && !a.isDue && /Moves on/.test(a.label), a);

// Automatic move-on
const now = new Date(2026, 9, 27, 12);
const hl = person({ sentAt: local(2026, 10, 6), lastTouchAt: local(2026, 10, 13) });
const moved = upkeepPatches([hl], fu, {}, now)[0];
check("HL: #2 on Tue 10/13, no reply → moved on", moved?.patch.status === "ignored" && moved.patch.outcome?.kind === "no_reply", moved);
check("…the sheet says so", STATUS_TO_SHEET.ignored({ ...hl, ...moved?.patch } as Contact) === "Moved on (no reply)");
check("a reply stops it", !upkeepPatches([{ ...hl, repliedAt: local(2026, 10, 14), status: "replied" }], fu, {}, now).length);
check("a call stops it", !upkeepPatches([{ ...hl, call: { at: local(2026, 10, 30), eventId: "e", link: "", invited: true } }], fu, {}, now).length);
check("a queued email stops it", !upkeepPatches([{ ...hl, serverSend: { draftId: "d", step: 3, sendAt: local(2026, 10, 29), queuedAt: local(2026, 10, 26) } }], fu, {}, now).length);
check("one follow-up isn't enough", !upkeepPatches([{ ...hl, followUps: 1, status: "followed_up" }], fu, {}, now).length);
check("a paused bank is left alone", !upkeepPatches([hl], fu, { "Houlihan Lokey|SF": { key: "Houlihan Lokey|SF", name: "Houlihan Lokey", region: "SF", status: "paused" } }, now).length);
check("idempotent", !upkeepPatches([{ ...hl, ...moved!.patch } as Contact], fu, {}, now).length);

// The follow-up count reaches the sheet
const snap: SheetSnapshot = { name: "HL", cells: { "19:2": { v: "Mohammed Ali" }, "19:8": { v: "Followed up (1x)" } } } as unknown as SheetSnapshot;
const ref = { sheet: "HL", row: 19, cols: { name: 2, status: 8 } } as Contact["ref"];
const p2 = contactPatches([person({ ref, sheetStatus: "Followed up (1x)" })], [snap]);
check("Followed up (1x) → (2x)", p2.HL?.["19:8"]?.v === "Followed up (2x)", p2);
const p3 = contactPatches([person({ ref, followUps: 1, sheetStatus: "Followed up (1x)" })], [snap]);
check("(1x) with one follow-up isn't rewritten", !p3.HL?.["19:8"], p3);
const flipped: SheetSnapshot = { name: "HL", cells: { "19:2": { v: "Zhu, Kevin" }, "19:8": { v: "Sent" } } } as unknown as SheetSnapshot;
const p4 = contactPatches([person({ ref, name: "Kevin Zhu", status: "sent", followUps: 0 })], [flipped]);
check("the sheet's 'Zhu, Kevin' is written Kevin Zhu", p4.HL?.["19:2"]?.v === "Kevin Zhu", p4);

// Referral / live / awaiting, per office
const t = now.getTime();
check("referral", liveKind(person({ referral: { at: local(2026, 10, 1) } }), t) === "referral");
check("chatted = live", liveKind(person({ status: "call_scheduled", chats: [{ id: "c", at: local(2026, 9, 1) } as never] }), t) === "live");
check("replied this week = live", liveKind(person({ status: "replied", repliedAt: local(2026, 10, 24) }), t) === "live");
check("replied 3 weeks ago, no chat = neither", liveKind(person({ status: "replied", repliedAt: local(2026, 10, 1) }), t) === undefined);
check("emailed, no reply = awaiting", liveKind(person({ sentAt: local(2026, 10, 20) }), t) === "awaiting");
check("moved on = none", liveKind(person({ status: "ignored", outcome: { kind: "no_reply", at: local(2026, 10, 23), confirmed: true } }), t) === undefined);
const offices = [{ office: "SF", team: "Tech" }, { office: "NY", team: "Generalist" }, { office: "LA", team: "Tech" }];
const slots = officeSlots(
  [
    person({ id: "a", region: "SF", sentAt: local(2026, 10, 20) }),
    person({ id: "b", region: "SF", sentAt: local(2026, 10, 21) }),
    person({ id: "c", region: "NY", status: "replied", repliedAt: local(2026, 10, 25) }),
    person({ id: "d", region: "LA", sentAt: local(2026, 10, 20) }),
  ],
  offices,
  2,
  t,
);
check("HL SF: 2 awaiting = maxed", slots[0].full, slots[0]);
check("HL NY: live = maxed", slots[1].full, slots[1]);
check("HL LA: 1 of 2 awaiting = to fill", !slots[2].full && slots[2].open === 1, slots[2]);

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall move-on checks passed");

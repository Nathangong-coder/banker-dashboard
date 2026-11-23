/**
 * The Cold outreach accuracy pass (owner, 2026-11-23): offices from evidence, "Went cold" follow-ups, Needs new
 * contact, Ongoing threads, Gmail labels, Corrections' "needs a look" list.
 *   npm run check:accuracy
 */
import { bestOffice, officePatch, ownText } from "../src/lib/officeEvidence";
import { nextAction } from "../src/lib/followups";
import { ongoingRows } from "../src/lib/ongoing";
import { planLabels, stateLabel, wantedLabels, STATE } from "../src/lib/gmailLabels";
import { DEFAULT_SETTINGS } from "../src/lib/defaults";
import type { Contact } from "../src/lib/types";
import type { LedgerMsg } from "../src/lib/mailLedger";

let failed = 0;
const check = (what: string, ok: boolean, detail: unknown = "") => {
  if (!ok) failed++;
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok && d ? `\n       got: ${d}` : ""}`);
};

const base: Contact = {
  id: "s:JPM:20", name: "Varsha Raghu", firstName: "Varsha", lastName: "Raghu", bank: "JP Morgan", region: "SF", location: "",
  position: "Analyst", email: "varsha@jpmorgan.com", linkedin: "", comment: "", status: "sent", source: "sheet", followUps: 0, history: [],
};
const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
const msg = (dir: "in" | "out", daysAgo: number, threadId = "t1", subject = "Fellow Bruin Seeking to Connect"): LedgerMsg => ({ id: `${dir}${daysAgo}${threadId}`, threadId, at: iso(daysAgo), dir, subject, snippet: "…" });

// Offices.
check("Location 'LA' beats an old SF office", officePatch({ ...base, location: "LA" })?.region === "LA", officePatch({ ...base, location: "LA" }));
check("no location anywhere → kept, marked a guess", bestOffice(base).source === "default" && bestOffice(base).region === "SF");
const sig = { ...base, mail: { checkedAt: iso(0), messages: [], lastIn: { id: "x", at: iso(1), text: "Happy to chat!\n\nBest,\nJane\n383 Madison Avenue\nNew York, NY 10179\n\nOn Mon, Oct 5, 2026 at 9:00 AM Nathan Gong <n@ucla.edu> wrote:\n> Los Angeles, CA" } } };
check("their signature (not the quoted thread) gives NY", bestOffice(sig).region === "NY" && bestOffice(sig).source === "signature", bestOffice(sig));
check("quoted text is cut", !ownText(sig.mail.lastIn.text).includes("Los Angeles"));
const phone = { ...base, mail: { checkedAt: iso(0), messages: [], lastIn: { id: "x", at: iso(1), text: "Thanks,\nJane\n(212) 555-0100" } } };
check("a 212 number gives NY", bestOffice(phone).region === "NY" && bestOffice(phone).source === "phone", bestOffice(phone));
check("your own number never counts", bestOffice({ ...base, phone: "425-394-3467" }, "425-394-3467").source === "default");
check("you set it → never changed", officePatch({ ...base, location: "NY", regionSource: "manual" }) === null);
const conflict = bestOffice({ ...base, location: "SF", mail: phone.mail });
check("a weaker clue that disagrees is shown, not applied", conflict.region === "SF" && conflict.conflict?.region === "NY", conflict);

// Went cold.
const fu = DEFAULT_SETTINGS.followUp;
const cold = nextAction({ ...base, sentAt: iso(26), lastTouchAt: iso(26) }, fu);
check("follow-up due 19 days ago → went cold (not Due)", cold.kind === "follow_up" && cold.isDue && !!cold.stale, cold);
const fresh = nextAction({ ...base, sentAt: iso(9), lastTouchAt: iso(9) }, fu);
check("follow-up due 2 days ago → still Due", fresh.isDue && !fresh.stale, fresh);
const snoozed = nextAction({ ...base, sentAt: iso(26), lastTouchAt: iso(26), snoozeUntil: iso(1) }, fu);
check("snoozed → never 'went cold'", !snoozed.stale);
check("Gmail Schedule send ahead → scheduled, not due", nextAction({ ...base, sentAt: iso(26), lastTouchAt: iso(26), scheduledAt: new Date(Date.now() + DAY).toISOString() }, fu).kind === "scheduled");

// Ongoing threads.
const rows = ongoingRows([
  { ...base, id: "a", name: "Your Move", status: "replied", repliedAt: iso(3), mail: { checkedAt: iso(0), messages: [msg("out", 5), msg("in", 3)] } },
  { ...base, id: "b", name: "Waiting", status: "replied", repliedAt: iso(6), mail: { checkedAt: iso(0), messages: [msg("out", 8), msg("in", 6), msg("out", 2)] } },
  { ...base, id: "c", name: "Queued", status: "replied", repliedAt: iso(20), scheduledAt: new Date(Date.now() + DAY).toISOString(), mail: { checkedAt: iso(0), messages: [msg("out", 22), msg("in", 20)] } },
  { ...base, id: "d", name: "Cold one-way", mail: { checkedAt: iso(0), messages: [msg("out", 10)] } },
  { ...base, id: "e", name: "Handled", status: "replied", repliedAt: iso(3), handledAt: iso(1), mail: { checkedAt: iso(0), messages: [msg("out", 5), msg("in", 3)] } },
]);
const g = (n: string) => rows.find((r) => r.c.name === n)?.group ?? "(none)";
check("they wrote last → your move", g("Your Move") === "yours", g("Your Move"));
check("you wrote last → waiting on them", g("Waiting") === "waiting");
check("something queued → scheduled", g("Queued") === "scheduled");
check("a one-way cold email isn't an ongoing thread", g("Cold one-way") === "(none)");
check("marked handled → waiting, not your move", g("Handled") === "waiting");

// Gmail labels.
const rules = { state: true, office: true, auto: false };
const replied = { ...base, status: "replied" as const, repliedAt: iso(3), team: "Tech", bank: "Houlihan Lokey", mail: { checkedAt: iso(0), messages: [msg("out", 5), msg("in", 3)] } };
check("replied → Outreach/Replied", stateLabel(replied) === STATE.replied);
check("your own bank label is reused", wantedLabels(replied, rules, ["IB/SF/Bank/Houlihan"]).includes("IB/SF/Bank/Houlihan"), wantedLabels(replied, rules, ["IB/SF/Bank/Houlihan"]));
const plan = planLabels([replied], rules, new Map([["t1", ["INBOX", STATE.waiting, "Outreach/HOLD - desk full"]]]), []);
check("Sent - waiting comes off, Replied goes on", plan[0]?.remove.includes(STATE.waiting) && plan[0].add.includes(STATE.replied), plan);
check("your own labels are never removed", !plan[0]?.remove.includes("Outreach/HOLD - desk full"));
check("nothing to change → no row", planLabels([replied], rules, new Map([["t1", [STATE.replied, "IB/SF", "IB/SF/Bank/Houlihan Lokey", "IB/SF/Group/Tech"]]]), []).length === 0);

console.log(failed ? `\n${failed} FAILED` : "\nall accuracy checks passed");
process.exit(failed ? 1 : 0);

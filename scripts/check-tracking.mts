/**
 * Reply / thank-you / referral detection (lib/replyTracking.ts) on cases shaped like the owner's real mail (Oct 2026):
 *   npm run check:tracking
 */
import { analyzePerson, parseAddrs, personQuery, thankedAfter, type MailMsg } from "../src/lib/replyTracking";

let failed = 0;
const check = (what: string, ok: boolean, detail: unknown = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok ? `\n       got: ${JSON.stringify(detail)}` : ""}`);
};

const ME = "nagong1@g.ucla.edu";
let n = 0;
const msg = (o: { thread: string; at: string; from: string; to?: string; cc?: string; bcc?: string; subject?: string; snippet?: string; sent?: boolean }): MailMsg => ({
  id: `m${++n}`,
  threadId: o.thread,
  at: Date.parse(o.at),
  labels: o.sent ? ["SENT"] : ["INBOX"],
  from: parseAddrs(o.from)[0],
  to: parseAddrs(o.to),
  cc: parseAddrs(o.cc),
  bcc: parseAddrs(o.bcc),
  subject: o.subject ?? "",
  snippet: o.snippet ?? "",
});

// Addresses
const a = parseAddrs('"Shen, Kevin" <Kevin.Shen@psc.com>, b@x.com, NATHAN GONG <nagong1@g.ucla.edu>');
check("parseAddrs: quoted 'Last, First' names and lowercased emails", a.length === 3 && a[0].email === "kevin.shen@psc.com" && a[0].name === "Shen, Kevin", a);

// Benjamin Hon: thank-you in a new thread, he replies cc'ing Kevin Zhu, you email Kevin and bcc Benjamin.
{
  const t = "ben";
  const msgs = [
    msg({ thread: "out", at: "2026-09-29T16:00:00Z", from: ME, to: "benjamin.hon@mizuhogroup.com", subject: "Fellow Bruin Seeking to Connect", sent: true }),
    msg({ thread: t, at: "2026-10-17T00:10:02Z", from: ME, to: "benjamin.hon@mizuhogroup.com", subject: "Thanks!", sent: true }),
    msg({ thread: t, at: "2026-10-17T01:50:54Z", from: "Benjamin Hon <benjamin.hon@mizuhogroup.com>", to: ME, cc: "Kevin Zhu <kevin.zhu@mizuhogroup.com>", subject: "RE: Thanks!", snippet: "Feel free to reach out to Kevin cc'd here." }),
    msg({ thread: t, at: "2026-10-17T02:24:22Z", from: ME, to: "kevin.zhu@mizuhogroup.com", bcc: "benjamin.hon@mizuhogroup.com", subject: "Re: Thanks!", sent: true }),
  ];
  const r = analyzePerson({ contactId: "ben", name: "Benjamin Hon", emails: ["benjamin.hon@mizuhogroup.com"] }, msgs, [ME]);
  check("Benjamin: the bcc'd email counts as emailing him", r.lastEmailedAt === "2026-10-17T02:24:22.000Z", r.lastEmailedAt);
  check("Benjamin: thank-you after a 10/16 chat is detected", thankedAfter(r.lastEmailedAt, "2026-10-16T19:00:00Z"));
  check("Benjamin: intro to Kevin Zhu found, dated 10/16 (PT), with your email to Kevin", r.intros.length === 1 && r.intros[0].people[0].email === "kevin.zhu@mizuhogroup.com" && r.intros[0].youWroteAt === "2026-10-17T02:24:22.000Z", r.intros);
  check("Benjamin: Kevin Zhu isn't taken for Benjamin", !r.aliases.length, r.aliases);
}

// Isaiah: emailed at iestrella@, replies from IDeLaCruz@ in the same thread; thank-you goes to the new address.
{
  const t = "isa";
  const msgs = [
    msg({ thread: t, at: "2026-10-06T17:36:00Z", from: ME, to: "iestrella@lincolninternational.com", subject: "UCLA Student Seeking to Connect", sent: true }),
    msg({ thread: t, at: "2026-10-15T16:06:00Z", from: ME, to: "iestrella@lincolninternational.com", subject: "Re: UCLA Student Seeking to Connect", sent: true }),
    msg({ thread: t, at: "2026-10-15T19:25:30Z", from: "Isaiah De La Cruz <IDeLaCruz@lincolninternational.com>", to: ME, subject: "Re: UCLA Student Seeking to Connect", snippet: "I'd be happy to connect." }),
    msg({ thread: t, at: "2026-10-15T19:43:41Z", from: ME, to: "IDeLaCruz@lincolninternational.com", subject: "Re: UCLA Student Seeking to Connect", sent: true }),
    msg({ thread: "thx", at: "2026-10-20T20:00:00Z", from: ME, to: "IDeLaCruz@lincolninternational.com", subject: "Thanks!", sent: true }),
  ];
  const r = analyzePerson({ contactId: "isa", name: "Isaiah Estrella", emails: ["iestrella@lincolninternational.com"] }, msgs, [ME]);
  check("Isaiah: his new address is learned (same firm, first name, same thread)", r.aliases.includes("idelacruz@lincolninternational.com"), r.aliases);
  check("Isaiah: his reply counts (replied 10/15)", r.repliedAt === "2026-10-15T19:25:30.000Z", r.repliedAt);
  check("Isaiah: thank-you to the new address counts", r.lastEmailedAt === "2026-10-20T20:00:00.000Z", r.lastEmailedAt);
  check("Isaiah: outreach = first email + 1 follow-up", r.outreachCount === 2, r.outreachCount);
}

// Isaiah again, as the Gmail connector showed it: no display name on his new address, and his tracker name is
// "Isaiah Estrella" (nothing in "IDeLaCruz" to match). He answers your 1:1 thread, to you only: still him.
{
  const t = "isa2";
  const msgs = [
    msg({ thread: t, at: "2026-10-06T17:36:00Z", from: ME, to: "iestrella@lincolninternational.com", sent: true }),
    msg({ thread: t, at: "2026-10-15T16:06:00Z", from: ME, to: "iestrella@lincolninternational.com", sent: true }),
    msg({ thread: t, at: "2026-10-15T19:25:30Z", from: "IDeLaCruz@lincolninternational.com", to: ME }),
  ];
  const r = analyzePerson({ contactId: "isa", name: "Isaiah Estrella", emails: ["iestrella@lincolninternational.com"] }, msgs, [ME]);
  check("Isaiah (no display name): learned from answering your 1:1 thread", r.aliases.includes("idelacruz@lincolninternational.com") && !!r.repliedAt, r);
}

// Kevin Zhu later answers in Benjamin's thread (to you only): he was cc'd before, so he isn't Benjamin.
{
  const t = "ben2";
  const msgs = [
    msg({ thread: t, at: "2026-10-17T00:10:02Z", from: ME, to: "benjamin.hon@mizuhogroup.com", sent: true }),
    msg({ thread: t, at: "2026-10-17T01:50:54Z", from: "benjamin.hon@mizuhogroup.com", to: ME, cc: "kevin.zhu@mizuhogroup.com" }),
    msg({ thread: t, at: "2026-10-17T02:24:22Z", from: ME, to: "kevin.zhu@mizuhogroup.com", bcc: "benjamin.hon@mizuhogroup.com", sent: true }),
    msg({ thread: t, at: "2026-10-20T15:00:00Z", from: "kevin.zhu@mizuhogroup.com", to: ME }),
  ];
  const r = analyzePerson({ contactId: "ben", name: "Benjamin Hon", emails: ["benjamin.hon@mizuhogroup.com"] }, msgs, [ME]);
  check("Kevin Zhu's reply isn't counted as Benjamin's", !r.aliases.length && r.lastHeardAt === "2026-10-17T01:50:54.000Z", r);
}

// Sherrick: thank-you as a reply in the original chain; he answers with program info (no new people → no intro).
{
  const t = "sh";
  const msgs = [
    msg({ thread: t, at: "2026-10-06T17:04:00Z", from: ME, to: "smurdoff@cgf.com", sent: true }),
    msg({ thread: t, at: "2026-10-06T18:06:51Z", from: "Sherrick Murdoff <smurdoff@cgf.com>", to: ME }),
    msg({ thread: t, at: "2026-10-16T16:45:58Z", from: ME, to: "smurdoff@cgf.com", subject: "Re: Fellow Bruin Seeking to Connect", sent: true }),
    msg({ thread: t, at: "2026-10-16T18:39:08Z", from: "Sherrick Murdoff <smurdoff@cgf.com>", to: ME }),
  ];
  const r = analyzePerson({ contactId: "sh", name: "Sherrick Murdoff", emails: ["smurdoff@cgf.com"] }, msgs, [ME]);
  check("Sherrick: in-chain thank-you counts (no 'thanks' needed in the subject)", thankedAfter(r.lastEmailedAt, "2026-10-15T21:00:00Z"));
  check("Sherrick: no intro", !r.intros.length, r.intros);
}

// A same-firm colleague with a different name in the thread isn't taken for them; a calendar notice isn't an intro.
{
  const t = "x";
  const msgs = [
    msg({ thread: t, at: "2026-10-01T16:00:00Z", from: ME, to: "kevin.shen@psc.com", sent: true }),
    msg({ thread: t, at: "2026-10-02T16:00:00Z", from: "Assistant Person <apers@psc.com>", to: ME, cc: "kevin.shen@psc.com" }),
    msg({ thread: t, at: "2026-10-03T16:00:00Z", from: "Kevin Shen <Kevin.Shen@psc.com>", to: ME, cc: "noreply@calendar.google.com" }),
  ];
  const r = analyzePerson({ contactId: "ks", name: "Kevin Shen", emails: ["kevin.shen@psc.com"] }, msgs, [ME]);
  check("colleague not learned as Kevin", !r.aliases.length, r.aliases);
  check("noreply/calendar addresses aren't intros", !r.intros.length, r.intros);
  check("Kevin's capitalised address still matches", r.repliedAt === "2026-10-03T16:00:00.000Z", r.repliedAt);
}

// Out of office isn't a reply; one saying they left is noted.
{
  const msgs = [
    msg({ thread: "o", at: "2026-10-01T16:00:00Z", from: ME, to: "a.b@bank.com", sent: true }),
    msg({ thread: "o", at: "2026-10-01T16:05:00Z", from: "A B <a.b@bank.com>", to: ME, subject: "Automatic reply: hello", snippet: "I am no longer with the firm." }),
  ];
  const r = analyzePerson({ contactId: "ab", name: "Alex Bee", emails: ["a.b@bank.com"] }, msgs, [ME]);
  check("auto-reply isn't a reply, 'left' noted", !r.repliedAt && !!r.leftNote, r);
}

check("query covers both directions and cc/bcc", personQuery(["a@x.com"], "2026-09-01T00:00:00Z") === "{from:a@x.com to:a@x.com cc:a@x.com bcc:a@x.com} after:2026/09/01");

console.log(failed ? `\n${failed} check(s) failed` : "\nall tracking checks passed");
process.exit(failed ? 1 : 0);

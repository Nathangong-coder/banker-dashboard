/**
 * The Conversation table (lib/conversations.ts + workbook.ts), without a browser: rows link to people instead of creating
 * them, one row per person, the app only replaces its own "• " lines, and writing twice changes nothing.
 *   npm run check:conversations
 */
import { allocateConversationRow, applyPatches, contactPatches, parseSnapshots } from "../src/lib/workbook";
import { kindFromText, kindsSummary, withSheetChat } from "../src/lib/conversations";
import type { ChatLog, Contact, SheetSnapshot } from "../src/lib/types";

let failed = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok && detail ? `\n       got: ${detail}` : ""}`);
};

// The owner's bank-tab layout: title, Conversation table (rows 5–15), Contact Information table (row 18 down).
const cells: SheetSnapshot["cells"] = {};
const put = (r: number, c: number, v: string) => (cells[`${r}:${c}`] = { v });
put(1, 1, "Morgan Stanley Application Tracker");
put(4, 1, "Contact");
put(4, 7, "Conversation");
["#", "Name", "", "Email", "Position", "Location", "Date", "Conversation", "Notes", "Comments"].forEach((h, i) => h && put(5, i + 1, h));
for (let i = 1; i <= 10; i++) put(5 + i, 1, String(i));
put(17, 1, "Contact");
put(17, 6, "Information");
["#", "Name", "Location", "Email", "Position", "LinkedIn", "Team", "", "Status", "Connection / Comment"].forEach((h, i) => h && put(18, i + 1, h));
const people = [
  ["Alex Cheung", "Menlo Park", "alex.cheung@morganstanley.com", "Associate", "Tech", "Sent"],
  ["Samantha Lee", "SF", "samantha.lee@morganstanley.com", "Analyst", "Tech", "Sent"],
  ["Michael Bender", "NY", "michael.bender@morganstanley.com", "Analyst", "", "Sent"],
];
people.forEach(([name, loc, email, pos, team, status], i) => {
  const r = 19 + i;
  put(r, 1, String(i + 1));
  put(r, 2, name);
  put(r, 3, loc);
  put(r, 4, email);
  put(r, 5, pos);
  put(r, 6, `https://www.linkedin.com/in/x${i}`);
  if (team) put(r, 7, team);
  put(r, 9, status);
});
// Typed by hand: Alex by email (a different spelling of the name), "Sam Lee" by name only, and someone not in the list.
put(6, 2, "Alex C.");
put(6, 4, "alex.cheung@morganstanley.com");
put(6, 7, "10/10/2026");
put(6, 8, "Coffee chat");
put(6, 9, "Great chat about TMT. Said he'd refer me.");
put(7, 2, "Sam Lee");
put(7, 8, "Phone call");
put(8, 2, "Jordan Park");

const snap: SheetSnapshot = { name: "MS", rows: 30, cols: 10, cells };
const parsed = parseSnapshots([snap]);

check("conversation rows don't become contacts", parsed.contacts.length === 3, parsed.contacts.map((c) => c.name).join(", "));
const conv = parsed.tables.find((t) => t.kind === "conversation");
check("the Conversation table is recognised", !!conv && conv.convCols?.notes === 9 && conv.convCols?.comments === 10, JSON.stringify(conv?.convCols));
check("the Contact Information table isn't", parsed.tables.filter((t) => t.kind === "conversation").length === 1);
const alex = parsed.contacts.find((c) => c.name === "Alex Cheung")!;
check("linked by email despite another spelling", alex.convRef?.row === 6, JSON.stringify(alex.convRef));
check("the hand-typed conversation is kept on the person", alex.chats?.length === 1 && alex.chats[0].source === "spreadsheet" && /refer me/.test(alex.chats[0].notes ?? ""), JSON.stringify(alex.chats));
check("…with its kind and date", alex.chats?.[0].kind === "coffee_chat" && alex.chats[0].at.startsWith("2026-10-1"), alex.chats?.[0].at);
const sam = parsed.contacts.find((c) => c.name === "Samantha Lee")!;
check("linked by last name + first initial (Sam Lee → Samantha Lee)", sam.convRef?.row === 7, JSON.stringify(sam.convRef));
check("someone not in Contact Information is an orphan, not a contact", parsed.orphans?.length === 1 && parsed.orphans[0].name === "Jordan Park", JSON.stringify(parsed.orphans));

// The app logs a coffee chat with a grade for Alex, and a first conversation for Michael (gets the next free row).
const at = new Date(2026, 9, 19, 14).toISOString();
const graded: ChatLog = {
  id: "c1",
  at,
  kind: "coffee_chat",
  notes: "Second chat: walked through his move from LionTree.",
  docUrl: "https://docs.google.com/document/d/abc",
  source: "log",
  grade: { gradedAt: at, score: 84, letter: "B+", summary: "Strong questions. Intro ran long.", rubric: [], strengths: [], improvements: [], commitments: ["Intro to Priya"], thankYouPoints: [] },
};
const mike = parsed.contacts.find((c) => c.name === "Michael Bender")!;
const taken = new Set(parsed.contacts.flatMap((c) => (c.convRef ? [`${c.convRef.sheet}:${c.convRef.row}`] : [])));
const mikeRow = allocateConversationRow(mike, parsed.tables, taken);
check("a new person gets the first blank numbered row (row 9)", mikeRow?.row === 9, JSON.stringify(mikeRow));
const contacts: Contact[] = parsed.contacts.map((c) =>
  c.id === alex.id ? { ...c, chats: [...(c.chats ?? []), graded] } : c.id === mike.id ? { ...c, convRef: mikeRow, chats: [{ id: "c2", at, kind: "call", notes: "Quick call", source: "log" }] } : c,
);
const patches = contactPatches(contacts, [snap]);
const after = applyPatches([snap], patches)[0];
const cell = (r: number, c: number) => after.cells[`${r}:${c}`]?.v ?? "";
check("Name copied from Contact Information", cell(6, 2) === "Alex Cheung", cell(6, 2));
check("Date = latest conversation", cell(6, 7) === "10/19/2026", cell(6, 7));
check("Conversation = kinds and count", cell(6, 8) === "Coffee chat ×2", cell(6, 8));
const notes = cell(6, 9).split("\n");
check("Notes keep the owner's text first", notes[0] === "Great chat about TMT. Said he'd refer me.", notes[0]);
check("…then one app line per conversation, with the Doc link", notes.length === 2 && notes[1].startsWith("• 10/19 Coffee chat: Second chat") && notes[1].endsWith("docs.google.com/document/d/abc"), notes[1]);
check("Comments = grade + promises", /^• 10\/19 B\+ \(84\): Strong questions\. Promised: Intro to Priya$/.test(cell(6, 10)), cell(6, 10));
check("Michael's new row gets his name, email and the call", cell(9, 2) === "Michael Bender" && cell(9, 4) === mike.email && cell(9, 8) === "Phone call", `${cell(9, 2)} | ${cell(9, 4)} | ${cell(9, 8)}`);
check("Sam's row (no app conversations) only gets the name copied", cell(7, 2) === "Samantha Lee" && cell(7, 8) === "Phone call" && !cell(7, 9), `${cell(7, 2)} | ${cell(7, 8)} | ${cell(7, 9)}`);
check("Contact Information rows untouched by conversation writes", !Object.keys(patches.MS ?? {}).some((k) => Number(k.split(":")[0]) >= 18 && [7, 8, 9, 10].includes(Number(k.split(":")[1]))));

// Saved and re-imported: still 3 people, the app's lines aren't read back as a new conversation, and a second write is a no-op.
const reparsed = parseSnapshots([after]);
check("re-import: still 3 people, no orphans added", reparsed.contacts.length === 3 && reparsed.orphans?.length === 1, `${reparsed.contacts.length} / ${reparsed.orphans?.length}`);
const alex2 = reparsed.contacts.find((c) => c.name === "Alex Cheung")!;
check("re-import: the sheet conversation is only the owner's text", alex2.chats?.length === 1 && alex2.chats[0].notes === "Great chat about TMT. Said he'd refer me.", JSON.stringify(alex2.chats?.map((c) => c.notes)));
const mike2 = reparsed.contacts.find((c) => c.name === "Michael Bender")!;
check("re-import: Michael's app-written row isn't mistaken for a typed conversation", mike2.convRef?.row === 9 && !mike2.chats, JSON.stringify(mike2.chats));
const merged = reparsed.contacts.map((c) => {
  const prev = contacts.find((x) => x.name === c.name)!;
  return { ...c, convRef: c.convRef ?? prev.convRef, chats: withSheetChat(prev.chats, c.chats?.find((x) => x.source === "spreadsheet")) };
});
const again = contactPatches(merged, [after]);
check("second write changes nothing", !Object.keys(again.MS ?? {}).length, JSON.stringify(again));

// The GS tab's template rows: "(First Last)" · "(email)" · "x/10" · "(link)" are free slots, and placeholders get cleared.
const tpl: SheetSnapshot = { name: "GS", rows: 30, cols: 10, cells: { ...cells } };
for (let r = 6; r <= 15; r++) {
  ["(First Last)", "", "(email)", "(role)", "(city)", "(date)", "x/10", "(link)", "(notes)"].forEach((v, i) => {
    if (v) tpl.cells[`${r}:${i + 2}`] = { v };
    else delete tpl.cells[`${r}:${i + 2}`];
  });
}
tpl.cells["1:1"] = { v: "Goldman Sachs Application Tracker" };
const gs = parseSnapshots([tpl]);
const gsConv = gs.tables.find((t) => t.kind === "conversation")!;
check("template rows count as free slots", gsConv.emptyRows.length === 10 && gs.contacts.length === 3, `${gsConv.emptyRows.length} free, ${gs.contacts.length} people`);
const leo = { ...gs.contacts[0], convRef: { sheet: "GS", row: 6 }, chats: [{ id: "g1", at, kind: "coffee_chat" as const, notes: "Good chat", source: "log" }] };
const gsAfter = applyPatches([tpl], contactPatches([leo, ...gs.contacts.slice(1)], [tpl]))[0];
const g = (c: number) => gsAfter.cells[`6:${c}`]?.v ?? "";
check("placeholders replaced or cleared", g(2) === leo.name && g(5) === leo.position && g(8) === "Coffee chat" && g(9).startsWith("• 10/19 Coffee chat") && g(10) === "", [2, 4, 5, 6, 7, 8, 9, 10].map(g).join(" | "));
check("other template rows untouched", (gsAfter.cells["7:2"]?.v ?? "") === "(First Last)");

check("kind guesses", kindFromText("coffee w/ Sam") === "coffee_chat" && kindFromText("Zoom call") === "call" && kindFromText("Info session") === "info_session" && kindFromText("lunch") === "in_person");
check("kinds summary", kindsSummary([{ id: "a", at, kind: "call" }, { id: "b", at }, { id: "c", at }]) === "Phone call · Coffee chat ×2");

console.log(failed ? `\n${failed} failed` : "\nall conversation checks passed");
process.exit(failed ? 1 : 0);

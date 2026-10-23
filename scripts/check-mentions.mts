/**
 * Smart mentions (lib/smartMention.ts): which chat gets named, ratings vs dates, and where the sentence goes.
 *   npm run check:mentions
 */
import { chatRating, mentionFor, mentionSentence, withMention, dropMentionSlot } from "../src/lib/smartMention";
import { docJsonText, findDocUrl, pickDoc, type DocPick, type DriveDoc } from "../src/lib/docMatch";
import { withSheetChat } from "../src/lib/conversations";
import type { ChatLog, Contact } from "../src/lib/types";

let failed = 0;
const check = (what: string, ok: boolean, detail: unknown = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok ? `\n       got: ${JSON.stringify(detail)}` : ""}`);
};

const person = (id: string, name: string, bank: string, chats: Partial<ChatLog>[] = [], extra: Partial<Contact> = {}): Contact =>
  ({
    id,
    name,
    firstName: name.split(" ")[0],
    lastName: name.split(" ").slice(1).join(" "),
    bank,
    email: "",
    status: "sent",
    followUps: 0,
    region: "SF",
    location: "SF",
    position: "Analyst",
    linkedin: "",
    comment: "",
    source: "sheet",
    history: [],
    chats: chats.map((c, i) => ({ id: `${id}${i}`, at: "2026-10-16T19:00:00Z", ...c })),
    ...extra,
  }) as unknown as Contact;

// Ratings
check("'Your rating: 8/10' → 8", chatRating({ id: "a", at: "", notes: "Your rating: 8/10" }) === 8);
check("'rated 7.5 / 10' → 7.5", chatRating({ id: "a", at: "", notes: "honestly rated 7.5 / 10" }) === 7.5);
check("a line that is just '6/10' → 6", chatRating({ id: "a", at: "", notes: "Talked about tech\n6/10\n" }) === 6);
check("'9/10 Coffee chat: …' is a date, not a rating", chatRating({ id: "a", at: "", notes: "9/10 Coffee chat: great culture" }) === undefined);
check("no rating → the grade / 10", chatRating({ id: "a", at: "", grade: { score: 84 } as ChatLog["grade"] }) === 8.4);

const ben = person("ben", "Benjamin Hon", "Mizuho", [{ notes: "Your rating: 8/10\nGreat work/life balance, mentorship-based culture, small tech team." }]);
const pat = person("pat", "Patrick Lin", "Mizuho", [{ at: "2026-10-20T19:00:00Z", notes: "Your rating: 4/10\nRushed." }]);
const kevin = person("kevin", "Kevin Zhu", "Mizuho Greenhill", [], { team: "Tech", referredBy: { contactId: "ben", name: "Benjamin Hon", at: "" } });
const ana = person("ana", "Ana Ruiz", "Mizuho", [], { team: "Tech" });
const evr = person("evr", "Eve R", "Evercore");
const all = [ben, pat, kevin, ana, evr];

const m = mentionFor(ana, all);
check("Ana (Mizuho Tech): Benjamin's 8/10 chat is named, not Patrick's newer 4/10", m?.name === "Benjamin Hon" && m.rating === 8, m);
check("notes passed without the rating line", !!m && /mentorship-based culture/.test(m.notes) && !/8\/10/.test(m.notes), m?.notes);
check("Kevin (referred by Benjamin) gets no mention of Benjamin", mentionFor(kevin, all) === undefined);
check("Evercore: no good chat there → nothing", mentionFor(evr, all) === undefined);
check("Benjamin is never mentioned to himself", mentionFor(ben, all)?.name !== "Benjamin Hon");
check("min rating 9 → nothing", mentionFor(ana, all, 9) === undefined);

const plain = mentionSentence(m!, ana, { ai: false });
check("no AI: names the person, invents nothing", plain === "I recently had a great conversation with Benjamin Hon about Benjamin's experience at Mizuho, and I would love to hear your perspective on Tech at Mizuho as well.", plain);
const slot = mentionSentence(m!, ana, { ai: true });
check("AI: one [[AI: …]] slot carrying the notes and the no-invention rule", /^\[\[AI:[\s\S]*ONLY from the notes[\s\S]*mentorship-based culture[\s\S]*\]\]$/.test(slot) && (slot.match(/\]\]/g) ?? []).length === 1);

const first = "Hi Ana,\n\nI hope this email finds you well! My name is Nathan.\n\nYour path stood out. If you happen to be available…\n\nThank you for your time!\n\nSincerely,\nNathan";
const out = withMention(first, "MENTION.", "initial");
check("first email: at the start of the hook paragraph", out.split("\n\n")[2].startsWith("MENTION. Your path"), out);
const fu = "Hi Ana,\n\nI wanted to follow up on my previous email.\n\nRegards,\nNathan";
check("follow-up: its own paragraph after the first", withMention(fu, "MENTION.", "follow_up").split("\n\n")[2] === "MENTION.");
check("a template's {{chat_mention}} wins", withMention("Hi,\n\nA {{chat_mention}} B\n\nC", "X", "initial") === "Hi,\n\nA X B\n\nC");
check("unused {{chat_mention}} slot is removed cleanly", dropMentionSlot("A {{chat_mention}} B") === "A B");

// Chats ↔ Google Docs (lib/docMatch.ts)
const doc = (id: string, name: string, extra: Partial<DriveDoc> = {}): DriveDoc => ({ id: id.padEnd(25, "x"), name, url: `https://docs.google.com/document/d/${id.padEnd(25, "x")}/edit`, via: "name", ...extra });
const one = (p: DocPick) => (p && "doc" in p ? p.doc.name : p ? `choices:${p.candidates.length}` : "none");
check("title with the full name wins", one(pickDoc([doc("a", "Benjamin Hon coffee chat"), doc("b", "Hon family recipes"), doc("c", "Coffee chat notes", { via: "text" })], "Benjamin Hon")) === "Benjamin Hon coffee chat");
check("'Hon, Benjamin - Mizuho' counts", one(pickDoc([doc("a", "Hon, Benjamin - Mizuho")], "Benjamin Hon")) === "Hon, Benjamin - Mizuho");
check("nickname 'Ben Hon' counts", one(pickDoc([doc("a", "Ben Hon chat")], "Benjamin Hon")) === "Ben Hon chat");
check("a last name alone is not enough", one(pickDoc([doc("a", "Hon family recipes")], "Benjamin Hon")) === "none");
check(
  "two titled docs → the one edited near the chat",
  one(pickDoc([doc("a", "Benjamin Hon", { modifiedTime: "2026-09-01T00:00:00Z" }), doc("b", "Benjamin Hon 2", { modifiedTime: "2026-10-16T22:00:00Z" })], "Benjamin Hon", { chatAt: "2026-10-16T19:00:00Z" })) === "Benjamin Hon 2",
);
check("two titled docs, no way to tell → choices", one(pickDoc([doc("a", "Benjamin Hon"), doc("b", "Benjamin Hon notes")], "Benjamin Hon")) === "choices:2");
check("one running doc that mentions them → it", one(pickDoc([doc("c", "Coffee chat notes", { via: "text" })], "Benjamin Hon")) === "Coffee chat notes");
check("docs API JSON → text (tabs, tables)", docJsonText({ tabs: [{ tabProperties: { title: "Mizuho" }, documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: "Ben: mentorship culture\n" } }] } }, { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "WLB" } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: "great" } }] } }] }] }] } }] } } }] }) === "Ben: mentorship culture\nWLB | great");
check("a docs link is found in a cell", findDocUrl("notes here https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit?usp=sharing more") === "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit?usp=sharing");
const sheetOld = { id: "sheet:MIZ:6", at: "2026-10-16T00:00:00Z", source: "spreadsheet", notes: "old", docUrl: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit", docSource: "drive" } as ChatLog;
const reread = withSheetChat([sheetOld], { id: "sheet:MIZ:6", at: "2026-10-16T00:00:00Z", source: "spreadsheet", notes: "new" });
check("a Drive-linked doc survives a re-import of the sheet row", reread?.[0].docUrl === sheetOld.docUrl && reread?.[0].notes === "new");
check("the row's own link wins over a Drive one", withSheetChat([sheetOld], { id: "sheet:MIZ:6", at: "", source: "spreadsheet", docUrl: "https://docs.google.com/document/d/2ZZZZZZZZZZZZZZZZZZZZZZZZ/edit", docSource: "sheet" })?.[0].docSource === "sheet");

console.log(failed ? `\n${failed} check(s) failed` : "\nall mention checks passed");
process.exit(failed ? 1 : 0);

/**
 * Smart mentions (lib/smartMention.ts): which chat gets named, ratings vs dates, and where the sentence goes.
 *   npm run check:mentions
 */
import { chatRating, mentionFor, mentionSentence, withMention, dropMentionSlot } from "../src/lib/smartMention";
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

console.log(failed ? `\n${failed} check(s) failed` : "\nall mention checks passed");
process.exit(failed ? 1 : 0);

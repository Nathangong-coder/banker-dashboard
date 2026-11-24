/**
 * Follow-ups overviews + Gmail scheduling hand-off (owner, 2026-11-23): Gmail links, Scheduled rows, overview numbers,
 * the calendar, the hand-off list.
 *   npm run check:followups
 */
import { dayLinks, gmailDraftUrl, gmailSearchUrl, gmailThreadUrl, personQuery } from "../src/lib/gmailLinks";
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

console.log(failed ? `\n${failed} FAILED` : "\nall ok");
if (failed) process.exit(1);

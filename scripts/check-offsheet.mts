/**
 * Bankers emailed but not in the tracker (lib/offSheet.ts), on cases shaped like the owner's sent mail (Oct 2026):
 *   npm run check:offsheet
 */
import { bankForDomain, bankDomains, offSheetPeople, type SentRecipient } from "../src/lib/offSheet";
import type { Contact } from "../src/lib/types";

let failed = 0;
const check = (what: string, ok: boolean, detail: unknown = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok ? `\n       got: ${JSON.stringify(detail)}` : ""}`);
};

const contact = (name: string, bank: string, email = ""): Contact =>
  ({ id: name, name, firstName: name.split(" ")[0], lastName: name.split(" ").slice(1).join(" "), bank, email, status: "sent", followUps: 0, region: "SF", location: "", position: "", linkedin: "", comment: "", source: "sheet", history: [] }) as unknown as Contact;

const contacts = [
  contact("Benjamin Hon", "Mizuho", "benjamin.hon@mizuhogroup.com"),
  contact("Sherrick Murdoff", "Cascadia", "smurdoff@cgf.com"),
  contact("Isaiah Estrella", "Lincoln International", "iestrella@lincolninternational.com"),
  contact("Taylor Brooks", "TD Securities"), // in the sheet, no email yet
];
const banks = ["Morgan Stanley", "TD Securities", "BNP Paribas", "Citizens", "Mizuho", "Guggenheim", "CIBC", "MS"];
const at = (d: string) => Date.parse(d);
const r = (email: string, name = "", d = "2026-10-05T17:00:00Z", subject = "Hi"): SentRecipient => ({ email, name, at: at(d), subject, threadId: email });

const sent = [
  r("justin.james@morganstanley.com", "", "2026-10-05T17:00:00Z", "Great meeting you at Morgan Stanley Info Session!"),
  r("kevin.zhu@mizuhogroup.com", "Kevin Zhu", "2026-10-17T02:24:22Z"),
  r("benjamin.hon@mizuhogroup.com", "Benjamin Hon"),
  r("IDeLaCruz@lincolninternational.com", "Isaiah De La Cruz"),
  r("taylor.brooks@tdsecurities.com", "Brooks, Taylor"),
  r("jane.doe@us.bnpparibas.com", "Jane Doe"),
  r("ana.ruiz@guggenheimsecurities.com", "Ana Ruiz"),
  r("sam.lee@citizensbank.com", "Sam Lee"),
  r("friend@gmail.com", "Friend"),
  r("classmate@g.ucla.edu", "Classmate"),
  r("noreply@simplify.us", ""),
  r("pat@simplify.us", "Pat Q"),
  r("recruiting@evercore.com", ""),
  r("nagong1@g.ucla.edu", "Me"),
  r("justin.james@morganstanley.com", "", "2026-10-06T17:00:00Z"),
];
const list = offSheetPeople(sent, contacts, { me: ["nagong1@g.ucla.edu"], banks });
const by = (e: string) => list.find((p) => p.email === e);

const justin = by("justin.james@morganstanley.com");
check("Justin James (no display name) found at Morgan Stanley, named from his address", justin?.name === "Justin James" && justin.bank === "Morgan Stanley" && justin.bankDomain, justin);
check("Justin: 2 emails, first 10/5", justin?.count === 2 && justin.firstAt.startsWith("2026-10-05"), justin);
check("Kevin Zhu (intro, not in the tracker) is listed under Mizuho via the tracker's domain", by("kevin.zhu@mizuhogroup.com")?.bank === "Mizuho");
check("Benjamin (in the tracker) isn't listed", !by("benjamin.hon@mizuhogroup.com"));
check("Isaiah's second address, once reply tracking learned it, isn't listed", !offSheetPeople(sent, contacts.map((c) => (c.name === "Isaiah Estrella" ? { ...c, aliases: ["idelacruz@lincolninternational.com"] } : c)), { me: [], banks }).some((p) => p.email.startsWith("idelacruz")));
check("Taylor Brooks ('Brooks, Taylor'), in the sheet without an email, isn't listed", !by("taylor.brooks@tdsecurities.com"), list.map((p) => p.email));
check("subdomain us.bnpparibas.com → BNP Paribas by name", by("jane.doe@us.bnpparibas.com")?.bank === "BNP Paribas", by("jane.doe@us.bnpparibas.com"));
check("guggenheimsecurities.com → Guggenheim", by("ana.ruiz@guggenheimsecurities.com")?.bank === "Guggenheim", by("ana.ruiz@guggenheimsecurities.com"));
check("citizensbank.com → Citizens (suffix stripped), not Citi", by("sam.lee@citizensbank.com")?.bank === "Citizens", by("sam.lee@citizensbank.com"));
check("personal, school, own and role addresses never listed", !["friend@gmail.com", "classmate@g.ucla.edu", "noreply@simplify.us", "recruiting@evercore.com", "nagong1@g.ucla.edu"].some(by));
const pat = by("pat@simplify.us");
check("unknown company kept apart (bankDomain false), after the banks", pat?.bankDomain === false && list[list.length - 1].email === "pat@simplify.us", pat);
check("'ms' doesn't match msci.com", bankForDomain("msci.com", bankDomains([]), banks) === null);
check("ignored addresses are dropped", !offSheetPeople(sent, contacts, { me: [], banks, ignored: ["Justin.James@morganstanley.com"] }).some((p) => p.email.startsWith("justin")));

console.log(failed ? `\n${failed} check(s) failed` : "\nall off-sheet checks passed");
process.exit(failed ? 1 : 0);

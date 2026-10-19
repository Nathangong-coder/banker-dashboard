import { generateText, Output } from "ai";
import { z } from "zod";
import { aiJson, aiErrorResponse, HttpError, withAi } from "@/lib/server/ai";
import { keysFrom } from "@/lib/server/keys";
import { webSearch, type Organic } from "@/lib/server/search";

export const maxDuration = 120;

/**
 * Bank brief for coffee chats (/prep, components/BankBrief.tsx): recent standout deals the bank advised on in the
 * user's sub-verticals, found by web search, plus a "Why <Bank>" answer grounded in the user's own notes when there are any.
 */
const Body = z.object({
  bank: z.string().trim().min(1).max(120),
  interests: z
    .array(z.object({ sector: z.string().max(60), subVerticals: z.array(z.string().max(60)).max(12) }))
    .max(8),
  /** The user's own notes about this bank: firm notes, contact comments, call notes, chat grades. `who` = where it came from. */
  notes: z.array(z.object({ who: z.string().max(160), text: z.string().max(1500) })).max(40),
  me: z.record(z.string(), z.string().max(600)),
});

const Deal = z.object({
  target: z.string().describe("Company acquired / merged / invested in, exactly as in the source"),
  acquirer: z.string().describe("Buyer or merger partner, exactly as in the source; 'not found in results' if the source doesn't say"),
  value: z.string().describe("Deal value as in the source (e.g. '$2.1B'), or 'undisclosed'"),
  date: z.string().describe("Announced or closed date as in the source (e.g. 'Mar 2026'); 'not found in results' if missing"),
  subVertical: z.string().describe("Which of the student's sub-verticals it fits (e.g. 'Software')"),
  bankRole: z.string().describe("The bank's role as the source states it, e.g. 'advised the seller', 'financial advisor to Adobe'"),
  whyNotable: z.string().describe("One line: why this deal stands out (size, strategic logic, competitive process, market reaction)"),
  talkingPoint: z.string().describe("One line the student could say or ask about it in a coffee chat, curious and humble, not a claim of insider knowledge"),
  sourceIndex: z.number().int().describe("The [n] number of the search result that supports this deal"),
});

const Brief = z.object({
  deals: z.array(Deal).max(6).describe("Up to 6 deals, most eye-popping first. Empty if the results support none."),
  dealsNote: z.string().describe("One short line on what the search found, e.g. 'Only 2 software deals with an explicit role found in results'. Empty if 4+ deals."),
  why: z.object({
    bullets: z
      .array(
        z.object({
          text: z.string().describe("One bullet of the answer to 'Why <Bank>?', first person, specific to this bank"),
          fromNotes: z.boolean().describe("True only if this bullet is grounded in the student's own notes"),
          source: z.string().describe("If fromNotes: whose chat / which note (e.g. 'Your chat with Jane Doe'). Else the web result number like '[3]', or '' for well-known public facts."),
        }),
      )
      .min(3)
      .max(5),
    spoken: z.string().describe("About 60 words, first person, how the student would say it out loud in a chat"),
  }),
});

export async function POST(req: Request) {
  try {
    const input = Body.parse(await req.json());
    const serper = keysFrom(req, "serper");
    const brave = keysFrom(req, "brave");
    if (!serper.length && !brave.length)
      throw new HttpError(400, "The bank brief searches the web for recent deals. Add a Serper key (or Brave Search as the backup) in Settings → Data, then try again.");

    const bank = input.bank;
    const subs = [...new Set(input.interests.flatMap((i) => (i.subVerticals.length ? i.subVerticals : [i.sector])).map((s) => s.trim()).filter(Boolean))].slice(0, 4);
    const sectors = [...new Set(input.interests.map((i) => i.sector.trim()).filter(Boolean))];
    const year = new Date().getFullYear();

    // Deal searches per sub-vertical, one broad sector search, and one about the bank itself (for "Why X").
    const queries = [
      ...subs.map((s, i) => (i % 2 ? `"${bank}" financial advisor ${s} acquisition ${year - 1} OR ${year}` : `"${bank}" advised acquisition ${s} ${year}`)),
      sectors.length ? `"${bank}" "financial advisor" ${sectors.join(" OR ")} deal ${year}` : `"${bank}" "financial advisor" acquisition ${year}`,
      `"${bank}" investment banking culture analyst program groups`,
    ].slice(0, 6);

    const warnings: string[] = [];
    const run = (q: string) =>
      webSearch(serper, brave, q, 8, warnings).catch((e: Error) => {
        warnings.push(`A search failed: ${e.message}`);
        return [] as Organic[];
      });
    // Brave's free plan is 1 request/second, so without Serper the searches go one at a time.
    const pages: Organic[][] = [];
    if (serper.length) pages.push(...(await Promise.all(queries.map(run))));
    else for (const q of queries) pages.push(await run(q));

    const seen = new Set<string>();
    const sources: { title: string; link: string; snippet: string }[] = [];
    for (const r of pages.flat()) {
      if (!r.link || !r.title || seen.has(r.link) || /linkedin\.com/i.test(r.link)) continue;
      seen.add(r.link);
      sources.push({ title: r.title, link: r.link, snippet: (r.snippet ?? "").slice(0, 450) });
      if (sources.length >= 36) break;
    }
    if (!sources.length && warnings.length) throw new HttpError(502, warnings[0]);

    const notes = input.notes.filter((n) => n.text.trim());
    const today = new Date().toISOString().slice(0, 10);

    const { output } = await withAi(req, (model, opts) =>
      generateText({
        ...opts,
        model,
        output: Output.object({ schema: Brief }),
        system:
          `Today is ${today}. You help a college student prepare for coffee chats with investment bankers at ${bank}. ` +
          "PART 1, DEALS: list recent (about the last 12-18 months) M&A deals that this bank advised on, in the student's sub-verticals, most " +
          "eye-popping first (biggest, most talked-about). Use ONLY deals supported by the numbered search results, and give the result number " +
          "that supports each one. Never invent deals, values, dates, buyers or the bank's role. If a field isn't in the result, write " +
          "'not found in results' (or 'undisclosed' for the value) rather than guessing. Prefer deals where the bank's role is stated " +
          "explicitly; skip deals where the bank isn't clearly an advisor. Fewer real deals are better than padded ones; an empty list is fine. " +
          "PART 2, WHY THIS BANK: a 3-5 bullet answer to 'Why " + bank + "?' and a spoken version of about 60 words. " +
          (notes.length
            ? "Ground it in the student's own notes first: say who it came from (e.g. 'From your chat with Jane: ...' in `source`) and set fromNotes. " +
              "Then add the bank's real differentiators from the results or well-known public facts. "
            : "The student has no notes on this bank yet, so write a version anyone could use: the bank's real differentiators (culture, deal flow, " +
              "group structure, lean staffing, generalist program, sector strength) from the search results or well-known public facts. fromNotes is false for every bullet. ") +
          "Tie it to the student's interests when it fits (a deal from Part 1 is a good hook). Never claim experiences, conversations or " +
          "facts about the student that aren't in what's given. Don't state uncertain facts as certain. Plain, humble, specific; avoid em dashes.",
        prompt: [
          `THE BANK\n${bank}`,
          `THE STUDENT'S INTERESTS\n${input.interests.map((i) => `${i.sector}: ${i.subVerticals.join(", ") || "(any)"}`).join("\n") || "(none given: use the bank's core strengths)"}`,
          `THE STUDENT\n${JSON.stringify(input.me)}`,
          notes.length ? `THE STUDENT'S OWN NOTES ABOUT ${bank.toUpperCase()}\n${notes.map((n) => `- ${n.who}: ${n.text}`).join("\n")}` : "THE STUDENT'S OWN NOTES\n(none)",
          `SEARCH RESULTS\n${sources.map((s, i) => `[${i + 1}] ${s.title} (${s.link})\n${s.snippet}`).join("\n\n") || "(no results)"}`,
        ].join("\n\n"),
      }),
    );

    // A deal must point at a real result: anything citing a number we didn't send is dropped.
    const deals = output.deals
      .filter((d) => d.sourceIndex >= 1 && d.sourceIndex <= sources.length)
      .map(({ sourceIndex, ...d }) => ({ ...d, sourceTitle: sources[sourceIndex - 1].title, sourceLink: sources[sourceIndex - 1].link }));
    const dropped = output.deals.length - deals.length;
    const bullets = output.why.bullets.map((b) => ({ ...b, fromNotes: notes.length > 0 && b.fromNotes, source: b.source || undefined }));

    return aiJson(req, {
      bank,
      interests: subs,
      deals,
      dealsNote: [output.dealsNote, dropped ? `${dropped} deal(s) without a matching source were left out.` : ""].filter(Boolean).join(" ") || undefined,
      why: { bullets, spoken: output.why.spoken, generic: !bullets.some((b) => b.fromNotes) },
      sources: sources.map(({ title, link }) => ({ title, link })),
      warnings,
    });
  } catch (e) {
    return aiErrorResponse(req, e);
  }
}

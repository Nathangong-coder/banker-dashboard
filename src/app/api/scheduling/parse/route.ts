import { generateText, Output } from "ai";
import { z } from "zod";
import { aiJson, aiErrorResponse, withAi } from "@/lib/server/ai";

export const maxDuration = 60;

const Body = z.object({
  /** Their latest email, quoted history already removed. */
  message: z.string().min(1).max(6000),
  /** Their signature area, for a phone number. */
  signature: z.string().max(4000).default(""),
  theirName: z.string().max(120),
  /** Our guess from their office (NY → America/New_York), used when the email doesn't say. */
  theirTzGuess: z.string().max(64),
  /** "Today" in their zone, YYYY-MM-DD + weekday, so "next Tuesday" resolves correctly. */
  today: z.string().max(40),
  myPhone: z.string().max(40).default(""),
});

const Parsed = z.object({
  timezone: z.string().describe("IANA time zone the banker is working in, e.g. America/New_York. Use the email's explicit mention (\"ET\", \"Pacific\", a city) if any, else the guess given."),
  timezoneEvidence: z.string().describe("Short quote or reason for the time zone, e.g. 'says 2pm ET' or 'office guess (NY)'."),
  asksForAvailability: z.boolean().describe("True if they ask when the student is free / to send times / suggest a call without fixing a time."),
  fromDate: z.string().nullable().describe("First date they mean, YYYY-MM-DD in their zone, or null if not said."),
  toDate: z.string().nullable().describe("Last date they mean, YYYY-MM-DD, or null."),
  weekdays: z.array(z.number().int().min(0).max(6)).describe("Days of week they asked for (0=Sunday). Empty if any day."),
  earliest: z.string().nullable().describe("Earliest time of day they mentioned, HH:MM 24h in their zone (\"afternoon\" = 12:00), or null."),
  latest: z.string().nullable().describe("Latest time of day, HH:MM 24h (\"morning\" ends 12:00, \"afternoon\" 17:00), or null."),
  proposed: z
    .array(z.object({ date: z.string().describe("YYYY-MM-DD"), time: z.string().describe("HH:MM 24h") }))
    .describe("Specific times THEY proposed or confirmed (\"Tuesday at 10 works\"), in their zone. Empty if none."),
  phone: z.string().nullable().describe("Their phone number from the email or signature, formatted 415-701-1213. Never the student's own number. Null if none."),
  summary: z.string().describe("One sentence: what they asked for, e.g. 'Asks for 2-3 times next week, afternoons ET.'"),
});

/** Read a banker's scheduling reply: their time zone, which days/times they asked for, times they proposed, their phone. */
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    const { output } = await withAi(req, (model, opts) =>
      generateText({
        ...opts,
        model,
        output: Output.object({ schema: Parsed }),
        system:
          "You read short emails from investment bankers replying to a student who asked for a networking call. Extract scheduling facts " +
          "precisely. Resolve relative dates (\"next week\", \"Thursday\", \"early next week\" = Mon–Tue) against TODAY. \"Next week\" means the " +
          "Monday–Friday after this week. Times are in the banker's zone unless they name another. Don't invent anything: use null / empty " +
          "when the email doesn't say. A phone number must appear in the text; ignore the student's own number.",
        prompt: [
          `TODAY (banker's zone): ${b.today}`,
          `BANKER: ${b.theirName}. Office-based time zone guess: ${b.theirTzGuess}`,
          b.myPhone ? `STUDENT'S OWN NUMBER (never return it): ${b.myPhone}` : "",
          `EMAIL\n${b.message}`,
          b.signature ? `SIGNATURE / REST OF THE EMAIL\n${b.signature}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      }),
    );
    // Reject an unknown zone rather than pass a typo to date math.
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: output.timezone });
    } catch {
      output.timezone = b.theirTzGuess;
      output.timezoneEvidence = "office guess";
    }
    return aiJson(req, output);
  } catch (e) {
    return aiErrorResponse(req, e);
  }
}

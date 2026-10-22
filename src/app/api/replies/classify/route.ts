import { generateText, Output } from "ai";
import { z } from "zod";
import { aiJson, aiErrorResponse, withAi } from "@/lib/server/ai";

export const maxDuration = 60;

const Body = z.object({
  replies: z
    .array(
      z.object({
        id: z.string().max(100),
        /** The banker who wrote it. */
        name: z.string().max(120),
        bank: z.string().max(120).default(""),
        /** Their new text, quoted history removed. */
        text: z.string().min(1).max(2000),
        /** People they added to To/Cc in this email (an intro), if any. */
        added: z.array(z.object({ name: z.string().max(120), email: z.string().max(320) })).max(10).default([]),
      }),
    )
    .min(1)
    .max(12),
});

const Read = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      kind: z
        .enum(["referral", "scheduling", "advice", "decline", "acknowledgement", "other"])
        .describe(
          "referral = they connect the student to someone else or pass the resume / name on (an intro, 'reach out to X', 'I sent your resume to our recruiter', 'I'll mention you to the staffer'). scheduling = times / invites / moving a call. advice = tips or information with no next step. decline = a clear no. acknowledgement = a short 'thanks, good luck' / 'nice chatting'. other = anything else.",
        ),
      referredTo: z
        .array(z.object({ name: z.string(), email: z.string().nullable(), role: z.string().nullable() }))
        .describe("Each person or team they referred the student to (name as written; email only if it appears; role like 'recruiter'). Empty if none."),
      promises: z.array(z.string()).describe("Things the banker said THEY will do ('I'll forward your resume', 'will intro you to Sarah'), short. Empty if none."),
      dates: z.array(z.string()).describe("Dates they mention for events / deadlines, as written ('info session on campus 10/28'). Empty if none."),
      needsReply: z.boolean().describe("True if the email asks the student something or expects an answer."),
      summary: z.string().describe("One short sentence."),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});

/**
 * Read bankers' replies (owner, 2026-10-22): is it a referral / intro, a promise, a no? Used with the server's Gmail
 * tracking (lib/server/gmailTrack.ts) so referrals without a cc ("I passed your resume on") are caught too. Suggestions
 * only: the dashboard asks the user to confirm before anything changes.
 */
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    const { output } = await withAi(req, (model, opts) =>
      generateText({
        ...opts,
        model,
        output: Output.object({ schema: Read }),
        system:
          "You read short emails that investment bankers sent to a college student after networking with them. For each one, " +
          "classify it and pull out referrals, promises and dates exactly as written. Never invent a person, email or date. If the " +
          "email adds people to the thread (listed as ADDED), that is almost always an intro: return them as referredTo. A " +
          "signature line or a sign-off like 'Thanks' means nothing. Return one result per id, same ids.",
        prompt: b.replies
          .map(
            (r) =>
              `ID ${r.id}\nFROM: ${r.name}${r.bank ? ` (${r.bank})` : ""}${r.added.length ? `\nADDED: ${r.added.map((p) => `${p.name || "?"} <${p.email}>`).join(", ")}` : ""}\nEMAIL:\n${r.text}`,
          )
          .join("\n\n---\n\n"),
      }),
    );
    return aiJson(req, output);
  } catch (e) {
    return aiErrorResponse(req, e);
  }
}

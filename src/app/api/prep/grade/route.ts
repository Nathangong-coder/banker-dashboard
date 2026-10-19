import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { aiJson, aiErrorResponse, HttpError, withAi } from "@/lib/server/ai";

export const maxDuration = 120;

// The transcript is the user's private conversation: it is sent to their own AI provider and never logged here.
const Body = z.object({
  transcript: z.string().trim().min(200, "That transcript is too short to grade. Paste the whole call.").max(120_000, "That transcript is over 120k characters. Trim the small talk or split it."),
  contact: z.object({
    name: z.string().min(1).max(120),
    bank: z.string().max(120),
    position: z.string().max(200),
    team: z.string().max(120),
    school: z.string().max(200),
  }),
  me: z.object({
    name: z.string().max(120),
    school: z.string().max(200),
    major: z.string().max(200),
    pitch: z.string().max(1000),
  }),
  /** The prep brief and questions the student planned to ask, if they prepped. */
  prep: z
    .object({
      brief: z.string().max(2000),
      intro: z.string().max(2000),
      questions: z.array(z.string().max(400)).max(20),
    })
    .optional(),
  notes: z.string().max(4000).optional(),
});

const Grade = z.object({
  score: z.number().int().min(0).max(100).describe("Overall 0-100. 90+ = exceptional, 80s = strong, 70s = fine with clear gaps, below 70 = hurt their chances."),
  letter: z.string().describe('Letter grade matching the score, e.g. "A-", "B+", "C".'),
  summary: z.string().describe("2-3 sentences: how the call went overall and the single most important thing to fix."),
  rubric: z
    .array(
      z.object({
        area: z.string(),
        score: z.number().int().min(1).max(5),
        comment: z.string().describe("One line of evidence from the transcript."),
      }),
    )
    .describe("Exactly the seven rubric areas, in the order given."),
  strengths: z.array(z.string()).min(1).max(4).describe("2-4 things done well, each tied to a moment in the call."),
  improvements: z
    .array(
      z.object({
        issue: z.string().describe("What went wrong or was missed."),
        suggestion: z.string().describe("A concrete fix: a rewritten line, a better question, or what to do next time."),
        quote: z.string().optional().describe("A short verbatim quote (under 25 words) from the transcript when relevant. Omit if none."),
      }),
    )
    .min(1)
    .max(6)
    .describe("3-6 improvements, most important first."),
  commitments: z
    .array(z.string())
    .describe("ONLY things the banker explicitly said they would do (refer, intro to someone, pass the resume on, follow up). Empty if none."),
  thankYouPoints: z.array(z.string()).describe("2-4 specific things the banker said that the thank-you email should mention."),
});

const AREAS = [
  "Opening & intro (the 30-second pitch: clear, concise, tailored)",
  "Question quality (specific, researched, not answerable by Google)",
  "Listening & follow-ups (built on their answers instead of reading a list)",
  "Rapport & tone (warm, natural, respectful of their time)",
  "Knowledge of the firm/group (knew what the group does, recent deals, the firm's culture)",
  "Asks & next steps (asked for advice, who else to talk to, or a referral when appropriate; not pushy)",
  "Close & time management (kept to time, wrapped up gracefully, thanked them, confirmed next steps)",
];

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    // Only the first issue message goes back (never the input itself).
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request.");
    const input = parsed.data;
    const { output } = await withAi(req, (model, opts) =>
      generateText({
        ...opts,
        model,
        output: Output.object({ schema: Grade }),
        system:
          "You are a candid investment banking networking coach. A college student had a coffee chat (usually a 15-30 minute call) with a banker " +
          "they cold-emailed, and you are grading how the STUDENT did from the transcript. Be honest and specific, not flattering: a forgettable call " +
          "is a B or C, not an A. Ground every score, strength and improvement in what was actually said; never invent quotes, facts or events. " +
          "Quotes must be copied verbatim from the transcript. Speaker labels may be names, 'Speaker 1', or missing: work out which speaker is the " +
          "student from context (the one asking about recruiting and introducing themself). If the transcript is partial, grade what is there and say so in the summary. " +
          `Score each of these rubric areas 1-5, using these exact area names (the text before the parenthesis): ${AREAS.map((a, i) => `${i + 1}. ${a}`).join("; ")}. ` +
          "Improvements must give a concrete rewrite or a better question the student could have used, angled at this banker. " +
          "Commitments: only what the banker explicitly said they would do; if they made no promise, return an empty list. " +
          "Thank-you points: specific advice, stories or names the banker mentioned, so the thank-you email shows the student listened. Avoid em dashes.",
        prompt: [
          `THE BANKER\n${JSON.stringify(input.contact)}`,
          `THE STUDENT\n${JSON.stringify(input.me)}`,
          input.prep
            ? `WHAT THE STUDENT PREPARED\nBrief: ${input.prep.brief}\nPlanned intro: ${input.prep.intro}\nPlanned questions:\n${input.prep.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
            : "",
          input.notes ? `THE STUDENT'S OWN NOTES\n${input.notes}` : "",
          `TRANSCRIPT\n${input.transcript}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      }),
    );

    const score = Math.max(0, Math.min(100, Math.round(output.score)));
    return aiJson(req, {
      ...output,
      score,
      rubric: output.rubric.map((r) => ({ ...r, score: Math.max(1, Math.min(5, Math.round(r.score))) })),
      improvements: output.improvements.map((i) => ({ ...i, quote: i.quote?.trim() || undefined })),
    });
  } catch (e) {
    return aiErrorResponse(req, e);
  }
}

import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { aiJson, aiErrorResponse, HttpError, withAi } from "@/lib/server/ai";
import { RUBRIC_LIMITS, cleanRubric, letterOf, overallScore } from "@/lib/gradeRubric";

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
  /** How it felt, in the student's words ("he was laughing the whole time"): tone the transcript doesn't carry. */
  feel: z.string().max(1000).optional(),
  /** The student's own beliefs about a good chat; they outrank the rubric below. */
  rules: z.array(z.string().max(500)).max(40).optional(),
  /** The rubric (admin setting); the default when missing. */
  rubric: z
    .array(
      z.object({
        area: z.string().max(RUBRIC_LIMITS.area),
        weight: z.number().min(0).max(RUBRIC_LIMITS.maxWeight),
        anchors: z.string().max(RUBRIC_LIMITS.anchors),
      }),
    )
    .max(RUBRIC_LIMITS.maxAreas)
    .optional(),
});

const Grade = z.object({
  summary: z.string().describe("2-3 sentences: how the call went overall (lead with how the banker responded) and the single most important thing to fix."),
  toneRead: z
    .string()
    .describe(
      "1-2 sentences on how the call FELT and what that is based on (laughter, banter, long stories, running over time, the student's own note). " +
        "If the text gives no tone signal, say tone can't be judged from this transcript.",
    ),
  rubric: z
    .array(
      z.object({
        area: z.string(),
        score: z.number().int().min(1).max(5),
        comment: z.string().describe("One line of evidence from the transcript."),
      }),
    )
    .describe("Exactly the rubric areas, in the order given."),
  strengths: z.array(z.string()).min(1).max(4).describe("2-4 things done well, each tied to a moment in the call."),
  theirAdvice: z
    .array(z.string())
    .max(6)
    .describe("Advice or feedback the BANKER gave the student directly (recruiting tips, comments on their pitch). Empty if none."),
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
    .describe(
      "1-5 of YOUR OWN coaching observations about how the student ran the call, most important first. Never restate the banker's advice " +
        "(that goes in theirAdvice). Fewer is fine: a great call may have only one real fix. Never invent a problem to fill the list.",
    ),
  commitments: z
    .array(z.string())
    .describe("ONLY things the banker explicitly said they would do (refer, intro to someone, pass the resume on, follow up). Empty if none."),
  thankYouPoints: z.array(z.string()).describe("2-4 specific things the banker said that the thank-you email should mention."),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    // Only the first issue message goes back (never the input itself).
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request.");
    const input = parsed.data;
    const AREAS = cleanRubric(input.rubric);
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
          `Score each rubric area 1-5 with these exact names, in this order, using the anchors: ${AREAS.map((a, i) => `${i + 1}. ${a.area}: ${a.anchors}`).join(" ")} ` +
          "TONE: transcripts (Zoom, Granola, notes) usually drop laughter and voice. Read it from what's there: [laughter] / 'haha' / 'lol', banter " +
          "and jokes, the banker telling long stories unprompted, callbacks to earlier jokes, the call running past its planned length, the banker " +
          "offering help or another call. The student's own 'how it felt' note is first-hand evidence about tone: trust it. With no signal either way, " +
          "score any tone-based area (how it felt, energy, connection) 3 and say tone couldn't be judged; never mark it down for a lack of evidence. " +
          "Improvements are your own observations about what the STUDENT did, each with a concrete rewrite or a better question angled at this " +
          "banker. Advice the banker gave the student goes in theirAdvice, never in improvements. " +
          "Commitments: only what the banker explicitly said they would do; if they made no promise, return an empty list. " +
          "Thank-you points: specific advice, stories or names the banker mentioned, so the thank-you email shows the student listened. Avoid em dashes.",
        prompt: [
          `THE BANKER\n${JSON.stringify(input.contact)}`,
          `THE STUDENT\n${JSON.stringify(input.me)}`,
          input.prep
            ? `WHAT THE STUDENT PREPARED\nBrief: ${input.prep.brief}\nPlanned intro: ${input.prep.intro}\nPlanned questions:\n${input.prep.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
            : "",
          input.rules?.length
            ? `THE STUDENT'S COACHING RULES (their own view of a good chat; they override the rubric and your defaults, never contradict them)\n${input.rules.map((r) => `- ${r}`).join("\n")}`
            : "",
          input.notes ? `THE STUDENT'S OWN NOTES\n${input.notes}` : "",
          input.feel ? `HOW IT FELT (the student's words)\n${input.feel}` : "",
          `TRANSCRIPT\n${input.transcript}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      }),
    );

    const rubric = output.rubric.slice(0, AREAS.length).map((r) => ({ ...r, score: Math.max(1, Math.min(5, Math.round(r.score))) }));
    const score = overallScore(AREAS, rubric.map((r) => r.score));
    return aiJson(req, {
      ...output,
      score,
      letter: letterOf(score),
      rubric,
      improvements: output.improvements.map((i) => ({ ...i, quote: i.quote?.trim() || undefined })),
    });
  } catch (e) {
    return aiErrorResponse(req, e);
  }
}

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
  /** How it felt, in the student's words ("he was laughing the whole time"): tone the transcript doesn't carry. */
  feel: z.string().max(1000).optional(),
  /** The student's own beliefs about a good chat; they outrank the rubric below. */
  rules: z.array(z.string().max(500)).max(40).optional(),
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

/**
 * The rubric: weight in the overall score, and what a 5 / 3 / 1 looks like so scores mean the same thing every time.
 * The overall score is computed here from these (the model's own overall number drifted between calls).
 */
const AREAS = [
  {
    area: "Connection & energy",
    weight: 25,
    anchors:
      "How the call felt and how the banker responded. 5 = they clearly enjoyed it: laughing, banter, telling stories unprompted, " +
      "the call ran over, they offered help or another call. 3 = polite and pleasant but transactional. 1 = awkward, flat or cut short.",
  },
  {
    area: "Personal rapport & common ground",
    weight: 20,
    anchors:
      "Found and built on shared ground (school, hometown, interests, background) and let the conversation get personal. Long personal " +
      "stretches the banker engages in raise this score; they are never time wasted. 5 = a real personal connection. 3 = a little. 1 = none.",
  },
  {
    area: "Listening & follow-ups",
    weight: 15,
    anchors: "5 = follow-ups built on what they just said and the conversation flowed. 3 = some follow-ups, some list-reading. 1 = read questions off a list.",
  },
  {
    area: "Question quality & preparation",
    weight: 15,
    anchors: "Specific questions showing they knew the firm, group and this banker's path. 5 = researched and insightful. 3 = generic but fine. 1 = Google-able or none.",
  },
  {
    area: "Opening & story",
    weight: 10,
    anchors: "The intro and the student's own story: clear, natural, tailored to this banker. 5 = memorable. 3 = fine. 1 = rambling or missing.",
  },
  {
    area: "Asks & next steps",
    weight: 10,
    anchors: "Asked for advice, who else to talk to or a next step at the right moment, without being pushy. 5 = natural ask that landed. 3 = vague. 1 = none, or pushy.",
  },
  {
    area: "Close",
    weight: 5,
    anchors:
      "Wrapped up warmly, thanked them, confirmed next steps. Only mark down for time when the BANKER signalled they had to go and the " +
      "student kept going; a call that runs long because the banker is enjoying it is a good sign.",
  },
];

/** 1-5 per area to 0-100: all 3s = 69 (a forgettable call is a C/B-), all 4s = 84, all 5s = 98. */
function overall(scores: number[]) {
  const total = AREAS.reduce((n, a) => n + a.weight, 0);
  const avg = AREAS.reduce((n, a, i) => n + a.weight * (scores[i] ?? 3), 0) / total;
  return Math.round(40 + ((avg - 1) / 4) * 58);
}

function letterOf(score: number) {
  const bands: [number, string][] = [[93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"], [77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [60, "D"]];
  return bands.find(([min]) => score >= min)?.[1] ?? "F";
}

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
          `Score each rubric area 1-5 with these exact names, in this order, using the anchors: ${AREAS.map((a, i) => `${i + 1}. ${a.area}: ${a.anchors}`).join(" ")} ` +
          "TONE: transcripts (Zoom, Granola, notes) usually drop laughter and voice. Read it from what's there: [laughter] / 'haha' / 'lol', banter " +
          "and jokes, the banker telling long stories unprompted, callbacks to earlier jokes, the call running past its planned length, the banker " +
          "offering help or another call. The student's own 'how it felt' note is first-hand evidence about tone: trust it. With no signal either way, " +
          "score Connection & energy 3 and say tone couldn't be judged; never mark it down for a lack of evidence. " +
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
    const score = overall(rubric.map((r) => r.score));
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

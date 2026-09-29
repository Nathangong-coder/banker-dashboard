import { generateText, Output } from "ai";
import { z } from "zod";
import { aiJson, aiErrorResponse, withAi } from "@/lib/server/ai";

export const maxDuration = 120;

const Body = z.object({
  criteria: z.string().min(10).max(8000),
  candidates: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        bank: z.string(),
        title: z.string(),
        snippet: z.string(),
      }),
    )
    .min(1)
    .max(20),
});

const Verdict = z.object({
  id: z.string(),
  verdict: z.enum(["match", "maybe", "no"]),
  score: z.number().describe("0-100 fit score"),
  firstName: z.string(),
  lastName: z.string(),
  position: z
    .string()
    .describe("CURRENT title only (Analyst / Associate / VP / Director / MD…), taken from the headline or current role. Ignore former, past or incoming roles. Empty if unknown"),
  team: z.string().describe("Coverage group, e.g. Technology, Generalist, Healthcare; empty if unknown"),
  school: z.string().describe("Undergrad school if visible, else empty"),
  location: z.string().describe("Current city/state if visible, else empty"),
  region: z.enum(["SF", "LA", "NY", "CHI", "Other"]).describe("SF = San Francisco Bay Area, LA = Los Angeles / Southern California, NY = New York, CHI = Chicago, Other = anywhere else or unknown"),
  reasons: z.string().describe("One short sentence citing the evidence for each criteria group"),
  employer: z.string().describe("Current employer as written in the snippet (e.g. 'Goldman Sachs'), empty if unclear"),
});

export async function POST(req: Request) {
  try {
    const { criteria, candidates } = Body.parse(await req.json());

    const { output } = await withAi(req, (model, opts) =>
      generateText({
      ...opts,
      model,
      output: Output.object({ schema: z.object({ results: z.array(Verdict) }) }),
      system:
        "You screen investment banking networking prospects from public LinkedIn search snippets. " +
        "Judge only from the evidence given; never invent schools, groups or locations. " +
        "Return exactly one result per candidate, using the candidate's id.",
      prompt: `CRITERIA\n${criteria}\n\nCANDIDATES (JSON)\n${JSON.stringify(candidates, null, 1)}`,
      }),
    );

    return aiJson(req, { results: output.results });
  } catch (e) {
    return aiErrorResponse(req, e);
  }
}

import { generateText, Output } from "ai";
import { z } from "zod";
import { errorResponse, modelFromRequest } from "@/lib/server/ai";

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
  position: z.string().describe("Analyst / Associate / VP / Director / MD etc., empty if unknown"),
  team: z.string().describe("Coverage group, e.g. Technology, Generalist, Healthcare; empty if unknown"),
  school: z.string().describe("Undergrad school if visible, else empty"),
  location: z.string().describe("Current city/state if visible, else empty"),
  region: z.enum(["SF", "NY", "Other"]).describe("SF = California, NY = New York"),
  reasons: z.string().describe("One short sentence citing the evidence for each criteria group"),
});

export async function POST(req: Request) {
  try {
    const model = modelFromRequest(req);
    const { criteria, candidates } = Body.parse(await req.json());

    const { output } = await generateText({
      model,
      output: Output.object({ schema: z.object({ results: z.array(Verdict) }) }),
      system:
        "You screen investment banking networking prospects from public LinkedIn search snippets. " +
        "Judge only from the evidence given; never invent schools, groups or locations. " +
        "Return exactly one result per candidate, using the candidate's id.",
      prompt: `CRITERIA\n${criteria}\n\nCANDIDATES (JSON)\n${JSON.stringify(candidates, null, 1)}`,
    });

    return Response.json({ results: output.results });
  } catch (e) {
    return errorResponse(e);
  }
}

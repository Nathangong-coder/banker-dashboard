import { generateText, Output } from "ai";
import { z } from "zod";
import { errorResponse, withAi } from "@/lib/server/ai";

export const maxDuration = 120;

/**
 * Optional AI pass over parsed templates: better names + "when to use" rules, and resolve blanks the
 * deterministic parser flagged. The client re-checks the wording (sameWording) and rejects any rewrite.
 */
const Body = z.object({
  placeholders: z.array(z.string()).max(60),
  candidates: z
    .array(
      z.object({
        key: z.string(),
        tab: z.string(),
        heading: z.string(),
        name: z.string(),
        whenToUse: z.string(),
        subject: z.string().max(400),
        body: z.string().max(8000),
        unknownBlanks: z.array(z.string()),
      }),
    )
    .min(1)
    .max(30),
});

export async function POST(req: Request) {
  try {
    const { candidates, placeholders } = Body.parse(await req.json());
    const { output } = await withAi(req, (model) =>
      generateText({
        model,
        output: Output.object({
          schema: z.object({
            templates: z.array(
              z.object({
                key: z.string(),
                name: z.string().describe("Short, human name, e.g. 'UCLA alum' or 'VP / MD and above'"),
                whenToUse: z.string().describe("One sentence rule an assistant can apply to a contact, e.g. 'Contact went to UCLA for undergrad.'"),
                subject: z.string(),
                body: z.string(),
              }),
            ),
          }),
        }),
        system:
          "You organize a student's cold-email templates for investment banking networking. For each template: " +
          "(1) give a short name and a one-sentence 'whenToUse' rule based on its section heading and content; " +
          "(2) in subject and body, replace any [[AI: fill in \"X\" …]] slot with the best matching {{placeholder}} from the allowed list, " +
          "or keep it as an [[AI: clear instruction]] if no placeholder fits. " +
          "DO NOT change any other wording, punctuation, or line breaks. Do not add or remove sentences. Return every template by key.",
        prompt: `ALLOWED PLACEHOLDERS\n${placeholders.map((p) => `{{${p}}}`).join(", ")}\n\nTEMPLATES\n${JSON.stringify(candidates, null, 1)}`,
      }),
    );
    return Response.json(output);
  } catch (e) {
    return errorResponse(e);
  }
}

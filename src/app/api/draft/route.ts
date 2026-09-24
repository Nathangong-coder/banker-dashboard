import { generateText, Output } from "ai";
import { z } from "zod";
import { errorResponse, modelFromRequest } from "@/lib/server/ai";

export const maxDuration = 120;

const ContactFacts = z.object({
  id: z.string(),
  name: z.string(),
  bank: z.string(),
  position: z.string(),
  location: z.string(),
  region: z.string(),
  school: z.string().optional(),
  headline: z.string().optional(),
  comment: z.string(),
});

const Body = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("assign"),
    templates: z.array(z.object({ id: z.string(), name: z.string(), whenToUse: z.string() })).min(1).max(30),
    contacts: z.array(ContactFacts).min(1).max(25),
  }),
  z.object({
    mode: z.literal("fill"),
    contact: ContactFacts,
    sender: z.record(z.string(), z.string()),
    subject: z.string().max(500),
    body: z.string().max(10000),
  }),
]);

export async function POST(req: Request) {
  try {
    const model = modelFromRequest(req);
    const input = Body.parse(await req.json());

    if (input.mode === "assign") {
      const { output } = await generateText({
        model,
        output: Output.object({
          schema: z.object({
            assignments: z.array(z.object({ contactId: z.string(), templateId: z.string(), why: z.string() })),
          }),
        }),
        system:
          "Assign the single best email template to each networking contact based on the template's 'whenToUse' " +
          "rule and the contact's facts (school, notes, location, role). Notes are the sender's private shorthand, " +
          "e.g. 'Berkley kid -> UC connect email' means use the UC template. Return one assignment per contact.",
        prompt: `TEMPLATES\n${JSON.stringify(input.templates)}\n\nCONTACTS\n${JSON.stringify(input.contacts)}`,
      });
      return Response.json(output);
    }

    const { output } = await generateText({
      model,
      output: Output.object({ schema: z.object({ subject: z.string(), body: z.string() }) }),
      system:
        "You finalize cold networking emails from a college student to investment bankers. " +
        "The draft contains [[AI: instruction]] slots: replace each slot with text following its instruction. " +
        "Leave all other wording exactly as written (keep line breaks). Any leftover {{placeholder}} you cannot fill " +
        "from the facts should be removed gracefully. Use ONLY the facts provided — never invent shared schools, " +
        "mutual connections, deals or groups. Keep the tone concise, warm and professional; avoid em dashes and flattery.",
      prompt:
        `CONTACT FACTS\n${JSON.stringify(input.contact)}\n\nSENDER\n${JSON.stringify(input.sender)}\n\n` +
        `DRAFT SUBJECT\n${input.subject}\n\nDRAFT BODY\n${input.body}`,
    });
    return Response.json(output);
  } catch (e) {
    return errorResponse(e);
  }
}

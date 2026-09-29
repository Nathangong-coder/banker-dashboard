import { generateText, Output } from "ai";
import { z } from "zod";
import { aiJson, aiErrorResponse, withAi } from "@/lib/server/ai";

export const maxDuration = 120;

const Body = z.object({
  /** The connection or angle, in the user's words, e.g. "I grew up in Washington; reach out to UW grads about their time there". */
  angle: z.string().min(10).max(1500),
  /** Optional: who it's for, if the user wants to steer it ("UW alumni", "people who switched from consulting"). */
  audience: z.string().max(300),
  me: z.record(z.string(), z.string().max(600)),
  base: z.object({ opener: z.string().max(400), intro: z.string().max(1000), ask: z.string().max(1500), close: z.string().max(600) }),
  /** A couple of the user's existing hooks, for voice. */
  examples: z.array(z.string().max(1200)).max(4),
  placeholders: z.array(z.object({ key: z.string(), desc: z.string() })).max(40),
  variants: z.number().int().min(1).max(3),
});

const Draft = z.object({
  name: z.string().describe("Short template name, e.g. 'UW alum (Washington connection)'"),
  whenToUse: z.string().describe("One sentence the auto-assigner reads: exactly which contacts this template fits"),
  subject: z.string().describe("Subject line, under 60 characters, may use placeholders"),
  hook: z
    .string()
    .describe("The personal paragraph (2-3 sentences) that goes between the base intro and the base ask. Uses placeholders and [[AI: …]] slots for per-person facts."),
  why: z.string().describe("One line on why this angle should earn replies"),
});

export async function POST(req: Request) {
  try {
    const input = Body.parse(await req.json());
    const { output } = await withAi(req, (model, opts) =>
      generateText({
        ...opts,
        model,
        output: Output.object({ schema: z.object({ templates: z.array(Draft).min(1).max(3) }) }),
        system:
          "You write cold-email templates for a college student networking with investment bankers. Every email is assembled as: " +
          "greeting, {{base_opener}} {{base_intro}}, YOUR HOOK, {{base_ask}}, {{base_close}}. You write only the subject, the hook paragraph, " +
          "and the metadata. The hook must make the shared connection specific and genuine, then say what the student wants to learn from " +
          "this person's experience. Use ONLY these placeholders for known facts: " +
          input.placeholders.map((p) => `{{${p.key}}} (${p.desc})`).join(", ") +
          ". For anything that differs per recipient and isn't a placeholder (their high school, a specific group, the year they moved), " +
          "write an [[AI: instruction]] slot, which is filled per person later from their profile. Never invent facts about the student " +
          "beyond the angle and their profile. Keep the student's voice from the examples: warm, direct, no flattery, no em dashes. " +
          "Don't repeat the base's intro or ask inside the hook.",
        prompt: [
          `ANGLE (the student's words)\n${input.angle}`,
          input.audience ? `WHO IT'S FOR\n${input.audience}` : "",
          `THE STUDENT\n${JSON.stringify(input.me)}`,
          `THE BASE (assembled around your hook)\nopener: ${input.base.opener || "(none)"}\nintro: ${input.base.intro}\nask: ${input.base.ask}\nclose: ${input.base.close}`,
          input.examples.length ? `EXISTING HOOKS (for voice)\n${input.examples.map((e) => `- ${e}`).join("\n")}` : "",
          `Write ${input.variants} distinct version${input.variants > 1 ? "s" : ""}${input.variants > 1 ? " that differ in one clear way (subject line framing, or what the hook emphasizes) so they can be A/B tested" : ""}.`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      }),
    );
    return aiJson(req, output);
  } catch (e) {
    return aiErrorResponse(req, e);
  }
}

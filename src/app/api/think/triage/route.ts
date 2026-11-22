import { generateText, Output } from "ai";
import { z } from "zod";
import { aiJson, aiErrorResponse, withAi } from "@/lib/server/ai";

export const maxDuration = 60;

const Msg = z.object({ dir: z.enum(["in", "out"]), at: z.string().max(40), subject: z.string().max(200), text: z.string().max(1600) });
const Body = z.object({
  items: z
    .array(
      z.object({
        id: z.string().max(300),
        kind: z.enum(["reply", "quiet", "check_in"]),
        name: z.string().max(120),
        bank: z.string().max(120).default(""),
        title: z.string().max(160).default(""),
        /** Facts the dashboard knows: chatted on…, referred you to…, your notes. */
        facts: z.array(z.string().max(400)).max(12).default([]),
        /** Newest last. */
        messages: z.array(Msg).max(8),
      }),
    )
    .min(1)
    .max(8),
  /** Your own past decisions, as examples: "Resolved: already thanked (Sherrick, after a chat)". */
  examples: z.array(z.string().max(300)).max(20).default([]),
});

const REASONS = ["needs_reply", "needs_nudge", "scheduling_open", "question_open", "already_thanked", "conversation_closed", "referral_done", "acknowledgement_only", "not_networking", "handled_elsewhere", "other"] as const;

const Read = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      needed: z.boolean().describe("True if the student should still email this person now (answer them / nudge them). When unsure, true."),
      reason: z
        .enum(REASONS)
        .describe(
          "needs_reply / needs_nudge / scheduling_open (a call isn't booked yet) / question_open (they asked something) when needed. " +
            "Not needed: already_thanked (the student already thanked them, no new ask), conversation_closed (it wrapped up naturally: 'good luck', 'happy to help anytime'), " +
            "referral_done (they already referred / introduced the student and nothing is pending with them), acknowledgement_only (their last email is only thanks / you're welcome), " +
            "not_networking (a friend, a classmate, a recruiter blast, a list email: not a banker the student is networking with), handled_elsewhere (the facts say it was done by text / LinkedIn / in person).",
        ),
      why: z.string().describe("One short sentence a student would understand, citing the email or fact."),
      confidence: z.number().min(0).max(1).describe("How sure. Only above 0.8 when the emails make it obvious."),
      asks: z.boolean().describe("True if their LAST email asks the student anything or proposes / asks for times."),
    }),
  ),
});

/**
 * Noise filter for Things to think about and the 9 PM text (owner, 2026-11-22: "a lot of these people actually don't
 * need follow up… filter out at least 30% of the noise while having safeguards"). The model only suggests; the
 * dashboard hides an item only for a hideable reason at ≥ 0.8 confidence, never when their email asks something or
 * mentions times / a resume / a referral (lib/thinkAbout.ts#withHidden), and every hidden item stays one click away.
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
          "You help a college student doing investment banking networking decide which email threads still need an email from them. " +
          "Each item is one banker with the recent emails (IN = the banker wrote, OUT = the student wrote) and facts. kind=reply: the banker wrote last. " +
          "kind=quiet: the banker replied before, the student wrote last, no call yet. kind=check_in: they already talked, the student wrote last. " +
          "Say needed=false only when it is clear nothing more is useful right now. Missing a real follow-up is much worse than listing an extra one: " +
          "when in doubt, needed=true. Never call something closed if a call isn't booked yet and the banker had offered to talk. Use the student's own past " +
          "decisions (EXAMPLES) as the best guide to what they consider done. Return one result per id, same ids.",
        prompt: [
          b.examples.length ? `EXAMPLES (the student's own decisions):\n${b.examples.map((e) => `- ${e}`).join("\n")}` : "",
          ...b.items.map(
            (it) =>
              `ID ${it.id}\nKIND ${it.kind}\nBANKER ${it.name}${it.bank ? ` (${it.bank})` : ""}${it.title ? `, ${it.title}` : ""}\n` +
              (it.facts.length ? `FACTS:\n${it.facts.map((f) => `- ${f}`).join("\n")}\n` : "") +
              `EMAILS (oldest first):\n${it.messages.map((m) => `[${m.dir.toUpperCase()} ${m.at.slice(0, 10)}] ${m.subject}\n${m.text}`).join("\n---\n")}`,
          ),
        ]
          .filter(Boolean)
          .join("\n\n=====\n\n"),
      }),
    );
    return aiJson(req, output);
  } catch (e) {
    return aiErrorResponse(req, e);
  }
}

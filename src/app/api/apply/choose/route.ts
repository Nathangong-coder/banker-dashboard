import "server-only";
import { z } from "zod";
import { errorResponse, HttpError } from "@/lib/server/http";
import { choiceOf, jevAsk, jevKeys, type JevQuestion } from "@/lib/server/jev";

export const maxDuration = 60;

/**
 * Jev picks answers for an application's option questions (dropdowns, radio buttons, "Select One" lists): Applications
 * autofill, before the AI model sees anything, and the extension agent when its wording isn't in a dropdown (owner,
 * 2026-10-26). One request: the student's facts are the state, each question is a Jev "choice" over the options
 * shown. Only an option that was offered can come back; the caller uses it only above its confidence bar.
 *
 * Prompt-injection guard: question labels and options come from a job site. Jev can only return one of the given
 * option keys (it generates no text). Sensitive questions (EEO, demographics) never reach this route (apply.ts).
 */
const Body = z.object({
  facts: z.string().max(12000),
  questions: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        label: z.string().max(600),
        options: z.array(z.object({ value: z.string().max(300), label: z.string().max(300) })).min(2).max(200),
      }),
    )
    .min(1)
    .max(30),
});

export async function POST(req: Request) {
  try {
    const b = Body.safeParse(await req.json());
    if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? "Invalid request.");
    const keys = jevKeys(req);
    if (!keys.length) throw new HttpError(400, "Add a Jev (TypeSafe) key in Settings → Data.");
    // Question names must be simple keys; option keys are their positions (o0, o1…), mapped back to the option values.
    const questions: Record<string, JevQuestion> = {};
    const byName = new Map<string, (typeof b.data.questions)[number]>();
    b.data.questions.forEach((q, i) => {
      const name = `q${i}`;
      byName.set(name, q);
      questions[name] = {
        type: "choice",
        instructions: `Application question: "${q.label.slice(0, 400)}". Which option is the right answer for this student, based only on the facts?`,
        criteria: Object.fromEntries(q.options.map((o, k) => [`o${k}`, o.label.slice(0, 200) || o.value.slice(0, 200)])),
      };
    });
    const answers = await jevAsk(keys, `Student facts:\n${b.data.facts}`, questions);
    const picks = [...byName.entries()].flatMap(([name, q]) => {
      const a = choiceOf(answers[name]);
      const k = Number(a?.choice?.slice(1));
      const opt = a && Number.isInteger(k) ? q.options[k] : undefined;
      return opt ? [{ id: q.id, value: opt.value, label: opt.label, confidence: a!.confidence }] : [];
    });
    return Response.json({ picks });
  } catch (e) {
    return errorResponse(e);
  }
}

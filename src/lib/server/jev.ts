import "server-only";
import { HttpError } from "./http";
import { keysFrom, withFallback } from "./keys";

/**
 * TypeSafe's Jev (owner, 2026-10-26): a "judgment model" that doesn't write text: it takes text (`state`) and named
 * questions and returns, per question, the option it picks (`choice`, with probabilities and confidence), a yes/no
 * probability (`noul`) or a level (`score`). About $0.042 per million input tokens, output free. Text only, no images.
 * Checked against the live API: POST https://api.typesafe.ai/v1/systemone, model "jev-latest", Bearer key.
 *
 * Keys come from the user's vault (`x-jev-keys`, like every other service). A local .env `JEV_API` is used only when
 * not on Vercel (the owner's development key; never a shared key for every user of the deployment).
 */
const URL_ = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; confidence: number };

export function jevKeys(req: Request): string[] {
  const keys = keysFrom(req, "jev");
  if (!keys.length && !process.env.VERCEL && process.env.JEV_API) return [process.env.JEV_API.trim()];
  return keys;
}

/** Ask Jev several questions about one text. Throws HttpError on a bad key / rate limit (so key fallback works). */
export async function jevAsk(keys: string[], state: string, questions: Record<string, JevQuestion>): Promise<Record<string, JevAnswer>> {
  return withFallback(keys, "Jev (TypeSafe)", async (key) => {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, state: state.slice(0, 24000), questions }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 200);
      try {
        const d = JSON.parse(text).detail;
        msg = typeof d === "string" ? d : (d?.message ?? (Array.isArray(d) ? d.map((x: { msg?: string }) => x.msg).join("; ") : msg));
      } catch {
        // keep the raw text
      }
      throw new HttpError(res.status, `Jev: ${msg}`);
    }
    return (JSON.parse(text) as { answers: Record<string, JevAnswer> }).answers ?? {};
  });
}

export const choiceOf = (a: JevAnswer | undefined) => (a?.type === "choice" ? a : undefined);
export const noulOf = (a: JevAnswer | undefined) => (a?.type === "noul" ? a.noul : undefined);

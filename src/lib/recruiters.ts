/**
 * Recruiters (owner, 2026-10-24): campus / university recruiters and talent-acquisition people are who decide many
 * first-round interviews, so they're shown apart from bankers (Applications → "Networking there", per firm).
 * Pure: read from the person's title / headline, nothing stored.
 */
import type { Contact } from "./types";

const RECRUITER = /\b(recruit(er|ing)?|talent acquisition|campus|university relations|early careers?|emerging talent|graduate programs?|student programs?|people partner|human resources|hr (business )?partner|talent partner|staffing)\b/i;
/** Bankers whose titles mention recruiting as a side role ("Analyst, campus recruiting lead") are still bankers. */
const BANKER = /\b(investment banking|m&a|analyst|associate|vice president|\bvp\b|director|managing director)\b/i;

export function isRecruiter(c: Pick<Contact, "position"> & { headline?: string }): boolean {
  const title = c.position || "";
  if (RECRUITER.test(title)) return !(BANKER.test(title) && !/\b(recruiter|talent acquisition|university relations)\b/i.test(title));
  const head = c.headline || "";
  return !title && RECRUITER.test(head) && !BANKER.test(head);
}

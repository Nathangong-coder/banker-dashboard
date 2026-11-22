import type { Contact } from "./types";
import { chatRating } from "./smartMention";
import { isVpPlus } from "./seniority";
import { gotReply, wasEmailed } from "./bankWork";
import { chatCount } from "./chatEvidence";

/**
 * How a bank's process is going, 0–100 (owner, 2026-11-21): the Process tracker colors each bank with it and the
 * 9 PM text's "Big banks" message reads it. Pure.
 *
 * - Nobody emailed yet: no score (`null`, shown white).
 * - Emailed, no chat yet: 30. Replies add a little (+4 each, up to +8).
 * - Each chat +14 (up to three), nudged by how it went (your rating /10 or the AI grade: ±8 around 7/10).
 * - A referral: at least 88; from a VP or above ("top dawg"): 100.
 * - Going badly: everyone emailed moved on with no reply −15; a confirmed "no" −10; a chat rated below 4/10 −8.
 */
export interface BankHealth {
  score: number | null;
  chats: number;
  emailed: number;
  replies: number;
  referrals: number;
  /** A referral from someone VP or above. */
  seniorReferral: boolean;
  /** One line on why ("2 chats (avg 8/10)", "4 emailed, no replies yet"). */
  why: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function bankHealth(contacts: Contact[]): BankHealth {
  const emailed = contacts.filter(wasEmailed);
  const replies = contacts.filter(gotReply).length;
  const chatList = contacts.flatMap((c) => c.chats ?? []);
  // Chats that happened: logged, a past call, past calendar events with them, thank-you emails (chatEvidence.ts, by day).
  const chats = contacts.reduce((n, c) => n + chatCount(c), 0);
  const referrers = contacts.filter((c) => !!c.referral);
  const seniorReferral = referrers.some((c) => isVpPlus(c.position || c.headline));
  const base = { chats, emailed: emailed.length, replies, referrals: referrers.length, seniorReferral };

  if (!emailed.length && !chats && !referrers.length) return { ...base, score: null, why: contacts.length ? "Nobody emailed yet" : "Nobody found yet" };

  let score = 30 + Math.min(8, replies * 4) + Math.min(3, chats) * 14;
  const ratings = chatList.map(chatRating).filter((r): r is number => typeof r === "number");
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : undefined;
  if (avg !== undefined) score += Math.max(-8, Math.min(8, (avg - 7) * 4));
  const movedOnAll = emailed.length > 0 && !replies && !chats && emailed.every((c) => c.status === "ignored");
  if (movedOnAll) score -= 15;
  if (contacts.some((c) => c.outcome?.kind === "declined" && c.outcome.confirmed)) score -= 10;
  if (ratings.some((r) => r < 4)) score -= 8;
  if (referrers.length) score = Math.max(score, seniorReferral ? 100 : 88 + Math.min(8, (referrers.length - 1) * 4));

  const why = referrers.length
    ? `Referral${referrers.length > 1 ? `s ×${referrers.length}` : ""}${seniorReferral ? " (VP+)" : ""}`
    : chats
      ? `${chats} chat${chats > 1 ? "s" : ""}${avg !== undefined ? ` (avg ${Math.round(avg * 10) / 10}/10)` : ""}`
      : movedOnAll
        ? `${emailed.length} emailed, no replies; all moved on`
        : replies
          ? `${replies} repl${replies > 1 ? "ies" : "y"}, no chat yet`
          : `${emailed.length} emailed, no replies yet`;
  return { ...base, score: clamp(score), why };
}

/**
 * The color scale: white = nothing yet; below 30 red (darker = worse); 30 = neutral; above 30 green (darker = better).
 * Returns a CSS color that works on light and dark backgrounds, plus the text color to put on it.
 */
export function healthColor(score: number | null): { bg: string; fg: string; tone: "none" | "bad" | "neutral" | "good" } {
  if (score === null) return { bg: "var(--color-panel)", fg: "var(--color-ink)", tone: "none" };
  if (score < 30) {
    const t = (30 - score) / 30; // 0..1, 1 = worst
    return { bg: `hsl(0 ${55 + t * 20}% ${88 - t * 50}%)`, fg: t > 0.55 ? "#fff" : "#3b0d0d", tone: "bad" };
  }
  if (score === 30) return { bg: "hsl(45 30% 90%)", fg: "#2b2610", tone: "neutral" };
  const t = (score - 30) / 70; // 0..1, 1 = best
  return { bg: `hsl(${130 + t * 15} ${35 + t * 25}% ${86 - t * 60}%)`, fg: t > 0.5 ? "#fff" : "#0f2a14", tone: "good" };
}

export { healthEmoji } from "./digestFormat";

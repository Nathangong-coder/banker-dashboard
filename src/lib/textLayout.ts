import type { ProgressBank } from "./digestFormat";

/**
 * The 9 PM text, your way (owner, 2026-11-24: "I can't customize the text, split it into multiple texts… list which
 * banks I want based on color, or rank by prestige or urgency"; spec docs/superpowers/specs/2026-11-23-text-builder-design.md).
 * A layout is messages (each its own WhatsApp text) made of blocks; every block starts from a preset and has a few
 * options. No layout = the Standard text, byte for byte. Pure: the server renders it (digestFormat.ts#nightMessages)
 * and the Reminders page previews it with the same function.
 */
export type HealthColor = "white" | "red" | "amber" | "green";
export type BankRank = "prestige" | "urgency" | "health" | "activity";
export type BankField = "step" | "chats" | "app" | "next";

export type BanksBlock = { type: "banks"; preset: "starred" | "top_tier" | "urgent" | "needs_help" | "going_well" | "applied"; colors?: HealthColor[]; rank?: BankRank; max?: number; fields?: BankField[] };
export type TodoBlock = { type: "todo"; preset: "everything" | "must_do" | "names_only"; perKind?: number };
export type ColdBlock = { type: "cold"; preset: "followups" | "followups_offices"; perKind?: number; scheduledLine?: boolean };
export type WarmBlock = { type: "warm"; preset: "check_in" | "not_heard" | "holiday"; days?: number; max?: number };
export type Block = BanksBlock | { type: "week" } | { type: "tips"; max?: number } | TodoBlock | ColdBlock | WarmBlock | { type: "links" };
export type BlockType = Block["type"];

export interface TextLayout {
  /** Which whole-text preset it started from (shown in the picker). */
  preset?: string;
  messages: { blocks: Block[] }[];
}

/** One warm person for the Warm block (pushed with the plan; lib/serverSync.ts#progressFor). */
export interface WarmLine {
  name: string;
  bank: string;
  lastAt?: string;
  /** What you owe them now, if anything ("reply", "thank", "check_in", "quiet"). */
  owed?: string;
}

export const colorOf = (score: number | null | undefined): HealthColor => (score === null || score === undefined ? "white" : score < 30 ? "red" : score < 44 ? "amber" : "green");

/** The banks a Banks block lists: the preset's filter, then your colors, then the rank, then the max. */
export function pickBanks(all: ProgressBank[], b: BanksBlock): ProgressBank[] {
  let list = [...all];
  if (b.preset === "starred") {
    const stars = list.filter((x) => x.starred);
    list = stars.length ? stars : list.filter((x) => (x.tier ?? 9) <= 1);
  } else if (b.preset === "top_tier") list = list.filter((x) => (x.tier ?? 9) <= 1);
  else if (b.preset === "needs_help") list = list.filter((x) => ["red", "amber"].includes(colorOf(x.score)));
  else if (b.preset === "going_well") list = list.filter((x) => colorOf(x.score) === "green");
  else if (b.preset === "applied") list = list.filter((x) => x.app === "applied" || /round|superday|offer/i.test(x.column ?? ""));
  if (b.colors?.length) list = list.filter((x) => b.colors!.includes(colorOf(x.score)));
  const rank: BankRank = b.rank ?? (b.preset === "urgent" ? "urgency" : b.preset === "needs_help" ? "health" : b.preset === "going_well" ? "health" : "prestige");
  const health = (x: ProgressBank) => x.score ?? -1;
  const by: Record<BankRank, (a: ProgressBank, z: ProgressBank) => number> = {
    prestige: (a, z) => Number(!!z.starred) - Number(!!a.starred) || (a.tier ?? 9) - (z.tier ?? 9) || a.bank.localeCompare(z.bank),
    urgency: (a, z) => (z.urgency ?? 0) - (a.urgency ?? 0) || a.bank.localeCompare(z.bank),
    // Needs help: worst first; otherwise best first.
    health: b.preset === "needs_help" ? (a, z) => health(a) - health(z) : (a, z) => health(z) - health(a),
    activity: (a, z) => (z.lastAt ?? "").localeCompare(a.lastAt ?? ""),
  };
  return list.sort(by[rank]).slice(0, Math.max(1, Math.min(b.max ?? 10, 30)));
}

/* ---------------- presets ---------------- */

export const BLOCK_LABEL: Record<BlockType, string> = { banks: "Banks", week: "This week", tips: "Do better", todo: "To-do", cold: "Cold outreach", warm: "Warm", links: "Links" };

export const BLOCK_PRESETS: { [K in BlockType]: { id: string; label: string }[] } = {
  banks: [
    { id: "starred", label: "Starred" },
    { id: "top_tier", label: "Top tier by prestige" },
    { id: "urgent", label: "Most urgent" },
    { id: "needs_help", label: "Needs help (red / amber first)" },
    { id: "going_well", label: "Going well (green)" },
    { id: "applied", label: "Applied / interviewing" },
  ],
  week: [{ id: "on", label: "Emails, replies, chats" }],
  tips: [{ id: "on", label: "Up to 3 tips" }],
  todo: [
    { id: "everything", label: "Everything" },
    { id: "must_do", label: "Must-do (thank-yous, replies, calls tomorrow)" },
    { id: "names_only", label: "Names only" },
  ],
  cold: [
    { id: "followups", label: "Follow-ups due" },
    { id: "followups_offices", label: "Follow-ups + offices to fill" },
  ],
  warm: [
    { id: "check_in", label: "Due for a check-in" },
    { id: "not_heard", label: "Haven't heard from in N days" },
    { id: "holiday", label: "Holiday check-in list (everyone, by bank)" },
  ],
  links: [{ id: "on", label: "Process tracker + Follow-ups links" }],
};

/** A fresh block of a type, at its first preset. */
export function newBlock(type: BlockType): Block {
  if (type === "banks") return { type, preset: "urgent", max: 8 };
  if (type === "todo") return { type, preset: "everything" };
  if (type === "cold") return { type, preset: "followups_offices", scheduledLine: true };
  if (type === "warm") return { type, preset: "not_heard", days: 21 };
  if (type === "tips") return { type, max: 3 };
  return { type } as Block;
}

/** The Standard text as a layout (what you start editing from): the same three messages as today. */
export const STANDARD_LAYOUT: TextLayout = {
  preset: "standard",
  messages: [
    { blocks: [{ type: "banks", preset: "starred", max: 10 }, { type: "week" }, { type: "tips", max: 3 }, { type: "links" }] },
    { blocks: [{ type: "todo", preset: "everything" }] },
    { blocks: [{ type: "cold", preset: "followups_offices", scheduledLine: true }] },
  ],
};

/** Whole-text presets. Standard = no layout (today's text exactly). */
export const TEXT_PRESETS: Record<string, { label: string; hint: string; layout?: TextLayout }> = {
  standard: { label: "Standard", hint: "Big banks · to-do · outreach, as three texts (today's text)" },
  short: {
    label: "One short text",
    hint: "Must-dos, then your 5 most urgent banks, in one message",
    layout: { preset: "short", messages: [{ blocks: [{ type: "todo", preset: "must_do", perKind: 5 }, { type: "banks", preset: "urgent", max: 5, fields: ["next"] }] }] },
  },
  banks: {
    label: "Bank focus",
    hint: "Starred banks with everything, then names to act on",
    layout: {
      preset: "banks",
      messages: [{ blocks: [{ type: "banks", preset: "starred", max: 15, fields: ["step", "chats", "app", "next"] }, { type: "week" }, { type: "tips", max: 3 }] }, { blocks: [{ type: "todo", preset: "names_only" }, { type: "cold", preset: "followups" }] }],
    },
  },
  holiday: {
    label: "Holiday",
    hint: "Everyone you're in touch with, by bank, plus must-dos",
    layout: { preset: "holiday", messages: [{ blocks: [{ type: "warm", preset: "holiday", max: 40 }] }, { blocks: [{ type: "todo", preset: "must_do" }] }] },
  },
};

/** A layout from storage or the wire, made safe: known block types only, ≤ 4 messages × 8 blocks; null when unusable. */
export function cleanLayout(raw: unknown): TextLayout | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as TextLayout).messages)) return null;
  const types = new Set(Object.keys(BLOCK_LABEL));
  const messages = (raw as TextLayout).messages
    .slice(0, 4)
    .map((m) => ({ blocks: (Array.isArray(m?.blocks) ? m.blocks : []).filter((b) => b && typeof b === "object" && types.has((b as Block).type)).slice(0, 8) as Block[] }))
    .filter((m) => m.blocks.length);
  return messages.length ? { preset: typeof (raw as TextLayout).preset === "string" ? (raw as TextLayout).preset : undefined, messages } : null;
}

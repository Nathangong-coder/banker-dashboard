export type Region = "SF" | "NY" | "Other";

export type Status =
  | "new"
  | "drafted"
  | "sent"
  | "followed_up"
  | "replied"
  | "call_scheduled"
  | "done"
  | "ignored";

export const STATUS_LABEL: Record<Status, string> = {
  new: "Not contacted",
  drafted: "Drafted",
  sent: "Sent",
  followed_up: "Followed up",
  replied: "Replied",
  call_scheduled: "Call scheduled",
  done: "Done",
  ignored: "Moved on",
};

/** Where a contact lives inside the uploaded workbook, so we can write back. */
export interface CellRef {
  sheet: string;
  row: number;
  cols: Partial<Record<ContactField, number>>;
}

export type ContactField =
  | "name"
  | "email"
  | "position"
  | "location"
  | "linkedin"
  | "status"
  | "comment"
  | "company";

export interface HistoryEvent {
  at: string;
  type: "sent" | "followed_up" | "replied" | "drafted" | "note" | "status" | "enriched";
  note?: string;
}

export interface Contact {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  bank: string;
  region: Region;
  location: string;
  position: string;
  email: string;
  emailSource?: "sheet" | "apollo" | "hunter" | "manual";
  emailStatus?: string;
  linkedin: string;
  comment: string;
  school?: string;
  headline?: string;
  sheetStatus?: string;
  status: Status;
  source: "sheet" | "prospect" | "manual";
  ref?: CellRef;
  templateId?: string;
  draft?: { subject: string; body: string; gmailDraftId?: string; createdAt: string };
  sentAt?: string;
  lastTouchAt?: string;
  followUps: number;
  repliedAt?: string;
  threadId?: string;
  lastMessageId?: string;
  snoozeUntil?: string;
  history: HistoryEvent[];
}

export type BankStatus = "active" | "paused" | "moved_on" | "applied" | "offer";

export interface BankMeta {
  key: string; // `${name}|${region}`
  name: string;
  region: Region;
  status: BankStatus;
  domain?: string;
  deadline?: string;
  notes?: string;
}

export interface Template {
  id: string;
  name: string;
  whenToUse: string;
  subject: string;
  body: string;
  attachResume: boolean;
  kind: "initial" | "follow_up";
  /** Follow-ups only: 1 = first follow-up, 2 = second, … */
  step?: number;
}

export interface Settings {
  profile: {
    name: string;
    school: string;
    year: string;
    major: string;
    email: string;
    phone: string;
    linkedin: string;
    hometown: string;
    signature: string;
    /** 1–2 sentences about your background, used by {{my_pitch}}. */
    pitch: string;
    club: string;
    /** e.g. "Bruin" → "Fellow Bruin". */
    schoolNickname: string;
    /** City your school is in, e.g. "LA". */
    schoolCity: string;
  };
  /** Single-value connections (not rotated). */
  keys: {
    googleClientId: string;
    ntfyTopic: string;
    ntfyServer: string;
    twilioSid: string;
    twilioToken: string;
    twilioFrom: string;
    twilioMessagingServiceSid: string;
    twilioTo: string;
    whatsappPhone: string;
    whatsappApiKey: string;
  };
  /** Services that accept several keys. Order = priority; the next key is tried when one is invalid or out of credits. */
  vault: Record<VaultService, ApiKeyEntry[]>;
  /** Which AI provider/model to use for screening + drafting. */
  ai: { provider: AiProvider; model: string };
  followUp: {
    firstAfterDays: number;
    nextAfterDays: number;
    maxFollowUps: number;
    moveOnAfterDays: number;
    /** Max people "in flight" (drafted/sent/followed up, no reply yet) per bank at once. */
    livePerBank: number;
  };
  prospect: {
    criteria: string;
    queries: string[];
    resultsPerQuery: number;
  };
  enrich: {
    revealPersonalEmails: boolean;
  };
}

export interface Prospect {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  bank: string;
  title: string;
  snippet: string;
  linkedin: string;
  source: "google" | "apollo";
  verdict?: "match" | "maybe" | "no";
  score?: number;
  position?: string;
  team?: string;
  school?: string;
  location?: string;
  region?: Region;
  reasons?: string;
}

export interface WorkbookMeta {
  fileName: string;
  loadedAt: string;
  sheetNames: string[];
  hasHandle: boolean;
  /** File.lastModified when we last read or wrote it; used to detect edits made outside the app. */
  lastModified?: number;
}

/** Snapshot of workbook cells for display (values as strings). */
export interface SheetSnapshot {
  name: string;
  rows: number;
  cols: number;
  cells: Record<string, { v: string; link?: string }>; // key "r:c" (1-based)
}

export type VaultService = "apollo" | "hunter" | "serper" | "ai";

export type AiProvider = "anthropic" | "openai" | "google" | "deepseek" | "glm" | "gateway" | "custom";

export const AI_PROVIDERS: Record<AiProvider, { label: string; keyHint: string; defaultBaseURL?: string; suggested: string[]; docs: string }> = {
  anthropic: { label: "Anthropic (Claude)", keyHint: "sk-ant-…", suggested: ["claude-sonnet-5", "claude-haiku-4-5", "claude-opus-5-5"], docs: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI (GPT)", keyHint: "sk-…", suggested: [], docs: "https://platform.openai.com/api-keys" },
  google: { label: "Google (Gemini)", keyHint: "AIza…", suggested: [], docs: "https://aistudio.google.com/apikey" },
  deepseek: { label: "DeepSeek", keyHint: "sk-…", suggested: ["deepseek-chat"], docs: "https://platform.deepseek.com/api_keys" },
  glm: { label: "GLM (Z.ai / Zhipu)", keyHint: "Z.ai API key", defaultBaseURL: "https://api.z.ai/api/paas/v4", suggested: ["glm-5.3", "glm-5.3-flash"], docs: "https://z.ai/manage-apikey/apikey-list" },
  gateway: { label: "Vercel AI Gateway (any model)", keyHint: "AI Gateway key", suggested: ["anthropic/claude-sonnet-5"], docs: "https://vercel.com/docs/ai-gateway" },
  custom: { label: "Other OpenAI-compatible", keyHint: "API key", suggested: [], docs: "" },
};

export interface ApiKeyEntry {
  id: string;
  value: string;
  label?: string;
  addedAt: string;
  checkedAt?: string;
  ok?: boolean;
  note?: string;
  /** AI entries only. */
  provider?: AiProvider;
  baseURL?: string;
  models?: string[];
}

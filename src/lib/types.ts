/** Office regions. SF covers the Bay Area (Menlo Park, Palo Alto); LA and Chicago are their own markets. */
export type Region = "SF" | "LA" | "NY" | "CHI" | "Other";

export const REGIONS: { id: Region; short: string; label: string; city: string }[] = [
  { id: "SF", short: "SF", label: "San Francisco / Bay Area", city: "San Francisco" },
  { id: "LA", short: "LA", label: "Los Angeles", city: "Los Angeles" },
  { id: "NY", short: "NY", label: "New York", city: "New York" },
  { id: "CHI", short: "Chicago", label: "Chicago", city: "Chicago" },
  { id: "Other", short: "Other", label: "Other / unassigned", city: "" },
];
export const regionInfo = (r: Region) => REGIONS.find((x) => x.id === r) ?? REGIONS[REGIONS.length - 1];

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
  | "team"
  | "linkedin"
  | "status"
  | "comment"
  | "company"
  /** When they were emailed (lib/contacted.ts). */
  | "contacted";

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
  /** Office, e.g. "SF", "NY", "Menlo Park" (see locationTeam.ts). */
  location: string;
  /** Coverage group, e.g. "Tech", "Healthcare", "RX", as on the sheet. Blank = not set (see locationTeam.ts#teamOf for inference). */
  team?: string;
  /** How `team` was set when not read from the sheet ("position" etc. = an accepted guess). */
  teamSource?: "sheet" | "position" | "comment" | "headline" | "office" | "manual";
  /** A guessed team the user rejected (✗), so it isn't suggested or counted again. */
  teamRejected?: string;
  position: string;
  email: string;
  emailSource?: "sheet" | "apollo" | "hunter" | "manual" | "gmail";
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
  /** The next follow-up, waiting as a Gmail draft (made from Follow-ups). Stale once `followUps` reaches `step`. */
  followUpDraft?: { gmailDraftId: string; messageId: string; step: number; createdAt: string };
  /**
   * A Gmail draft the server will send at `sendAt` (api/server). step 0 = the first email, n = follow-up #n.
   * Cleared when the server reports it sent (then status / dates move on) or when it's cancelled.
   */
  serverSend?: { draftId: string; sendAt: string; step: number; queuedAt: string };
  sentAt?: string;
  lastTouchAt?: string;
  /** A send queued in Gmail ("Schedule send") that hasn't gone out yet. Follow-ups are timed from the real send. */
  scheduledAt?: string;
  followUps: number;
  repliedAt?: string;
  threadId?: string;
  lastMessageId?: string;
  snoozeUntil?: string;
  /** Last time Gmail was searched for this person (throttles name lookups). */
  gmailCheckedAt?: string;
  /**
   * Their LinkedIn profile as the user saw it: captured by the bookmarklet from the page the user had open, or pasted.
   * Never fetched by the app itself.
   */
  profile?: { text: string; source: "linkedin" | "paste"; capturedAt: string };
  /** Coffee chat prep generated for this person (see app/prep). */
  prep?: CoffeePrep;
  /** What produced the current draft, for A/B results: the template, the base, the hook, and when. */
  draftMeta?: { templateId: string; baseId: string; hookId?: string; createdAt: string };
  /** Hook chosen by hand for this person; otherwise it follows their team (lib/hooks.ts). */
  hookId?: string;
  /** Set when the Gmail draft is made: the font it went out in and the arm of each running experiment. Kept on updates. */
  trial?: { at: string; font?: EmailFont; fontSource?: "draft" | "gmail" | "manual"; arms: Record<string, string> };
  history: HistoryEvent[];
}

export interface CoffeePrep {
  generatedAt: string;
  /** 3–4 sentence who-they-are, from the facts given. */
  brief: string;
  /** Roles in order, most recent first (only from the profile text). */
  path: { role: string; org: string; when: string }[];
  commonGround: string[];
  /** The user's 30-second intro, angled at this person. */
  intro: string;
  tailored: { question: string; why: string }[];
  /** Public web results the AI saw (title + link), for checking its claims. */
  sources: { title: string; link: string }[];
  /** Indexes of questions ticked off during the call: "g0", "t2"… */
  asked?: string[];
  notes?: string;
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
  /** Made in the Email lab (AI-generated or a test variant); shown with a badge until you're happy with it. */
  experimental?: boolean;
  /** Templates sharing a group are A/B variants: drafts alternate between them and replies are compared. */
  variantGroup?: string;
  /** Target share within its variant group (e.g. 80 vs 20). Without weights, variants split evenly. */
  weight?: number;
  /**
   * Facts the email can't be written without (e.g. "their_school" for the non-target template). Drafting stops and asks
   * for them instead of letting the AI paper over a blank.
   */
  requires?: RequiredFact[];
  /** Always use the Original base wording, even while a base A/B test runs (for templates that must read word for word). */
  lockBase?: boolean;
}

export type RequiredFact = "their_school" | "position";

/**
 * A self-run experiment. Font experiments set the Gmail draft's font; custom ones just tag each draft with the arm
 * (e.g. "sent before 9am" vs "after lunch") so replies can be compared.
 */
export interface Experiment {
  id: string;
  name: string;
  kind: "font" | "custom" | "time";
  /** Time arms are hour windows in the recipient's local time; emails are tagged from when they actually went out. */
  /** `weight` = target share (80/20, 70/30); arms without one split evenly. */
  arms: { id: string; label: string; font?: EmailFont; from?: number; to?: number; weight?: number }[];
  /** alternate: each new draft gets the least-used arm (fairest). wave: every draft uses `currentArm` until you switch. */
  mode: "alternate" | "wave";
  currentArm?: string;
  status: "running" | "ended";
  startedAt: string;
  endedAt?: string;
}

/** A {{my_pitch}} sentence for a kind of banker (see lib/hooks.ts). */
export interface EmailHook {
  id: string;
  name: string;
  /** Empty = no hook sentence at all. */
  text: string;
  /** Team words that pick this hook automatically ("tech", "tmt"…). */
  teams: string[];
  /** Used when no other hook matches the contact's team. */
  fallback?: boolean;
}

/**
 * The shared skeleton of every first email: pleasantry, who I am, the ask, and the sign-off. Templates use
 * {{base_opener}} {{base_intro}} {{base_ask}} {{base_close}}, so improving the base improves every template, and
 * several bases can be A/B tested against each other.
 */
export interface EmailBase {
  id: string;
  name: string;
  opener: string;
  intro: string;
  ask: string;
  close: string;
  /** Active bases are used for new drafts; with two or more active, drafts alternate between them (A/B test). */
  active: boolean;
  /** Why this base is written the way it is (shown in the Email lab). */
  notes?: string;
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
  ai: {
    provider: AiProvider;
    model: string;
    /** Backup models tried in order when the primary hits a rate/quota limit. undefined = pick automatically. */
    fallbacks?: { provider: AiProvider; model: string }[];
  };
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
  /** How drafts look in Gmail. */
  emailStyle: { font: EmailFont };
  /** Coffee chat prep: the general questions that work for anyone. */
  prep: { generalQuestions: string[] };
  /** Shared email skeletons (see EmailBase). */
  emailBases: EmailBase[];
  /** {{my_pitch}} sentences by kind of banker (see lib/hooks.ts). */
  hooks: EmailHook[];
  /** Self-run experiments (Email lab), e.g. which font gets more replies. */
  experiments: Experiment[];
  /** Who you have in common with people (your school, city, hometown, heritage, volunteering) and the senior exceptions. */
  outreach: import("./outreach").OutreachRules;
  /** Automatic reminders. `whatsappDaily` undefined = on once WhatsApp is connected. */
  alerts?: { whatsappDaily?: boolean };
  /**
   * This browser's account on the dashboard's server (api/server): random id + secret token, made in the browser.
   * The server keeps Gmail access (to send queued drafts) and the 9am WhatsApp text for it. Never exported.
   */
  server?: { id: string; token: string; email?: string; connectedAt?: string };
  /**
   * How drafts made on Follow-ups go out: "coverage" = the server sends them at each person's slot (needs `server`);
   * "gmail" = you open each draft and use Gmail's Schedule send (the Gmail API can't schedule for you).
   * undefined = coverage when automatic sending is on, else gmail.
   */
  sendMode?: "coverage" | "gmail";
  /** When sends go out (lib/sendWindow.ts). undefined = 9–11 AM the recipient's time, weekdays. */
  sendWindow?: import("./sendWindow").SendWindow;
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
  source: "google" | "apollo" | "linkedin";
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
  /** How the tab looks in Excel, so the grid can match it. Missing on snapshots from before formatting was read. */
  format?: SheetFormat;
}

/** Cell look, CSS-ready. Colors are "#rrggbb". */
export interface CellStyle {
  bg?: string;
  fg?: string;
  b?: 1;
  i?: 1;
  u?: 1;
  /** Font size in points. */
  sz?: number;
  al?: "left" | "center" | "right";
  va?: "top" | "middle" | "bottom";
  wrap?: 1;
  /** Borders present: any of "t", "r", "b", "l", with a color. */
  bd?: { sides: string; color: string };
}

export interface SheetFormat {
  /** Bump when the reader changes, so older snapshots get re-read. */
  version: number;
  /** Distinct styles; `cellStyle` points into this list. */
  styles: CellStyle[];
  cellStyle: Record<string, number>;
  /** Column widths and row heights in CSS px (only where set). */
  colWidths: Record<number, number>;
  rowHeights: Record<number, number>;
  /** Merged ranges as [top, left, bottom, right] (1-based, inclusive). */
  merges: [number, number, number, number][];
  hiddenCols: number[];
  hiddenRows: number[];
}

export type VaultService = "apollo" | "hunter" | "serper" | "brave" | "ai";

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

/** Font choices matching Gmail's own font menu (same CSS stacks Gmail writes). */
export const EMAIL_FONTS = {
  garamond: { label: "Garamond", css: "garamond,\"times new roman\",serif" },
  sans: { label: "Sans Serif (Gmail default)", css: "arial,sans-serif" },
  serif: { label: "Serif (Times)", css: "\"times new roman\",serif" },
  georgia: { label: "Georgia", css: "georgia,serif" },
  verdana: { label: "Verdana", css: "verdana,sans-serif" },
  trebuchet: { label: "Trebuchet", css: "\"trebuchet ms\",sans-serif" },
  tahoma: { label: "Tahoma", css: "tahoma,sans-serif" },
} as const;
export type EmailFont = keyof typeof EMAIL_FONTS;

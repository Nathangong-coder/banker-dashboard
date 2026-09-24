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
  };
  keys: {
    apollo: string;
    hunter: string;
    serper: string;
    ai: string;
    aiModel: string;
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
}

/** Snapshot of workbook cells for display (values as strings). */
export interface SheetSnapshot {
  name: string;
  rows: number;
  cols: number;
  cells: Record<string, { v: string; link?: string }>; // key "r:c" (1-based)
}

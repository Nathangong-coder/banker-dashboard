import type { Contact } from "./types";

/**
 * Cold outreach → Scheduled, one row per EMAIL (owner, 2026-11-23: "it has 13 contacts for scheduled emails when there
 * are actually 18"). It used to list contacts whose next step was "scheduled", so a person with a first email and a
 * follow-up both queued was one row, people not in the tracker were missing, and warm people (a check-in queued to
 * someone who replied) never showed. Now: every email in Gmail's Scheduled folder, plus Coverage's own queued sends
 * that aren't the same email.
 */
export type GmailScheduledItem = { at: string; to: string[]; subject: string; labels: string[]; threadId: string };

export interface ScheduledRow {
  key: string;
  at: string;
  /** The recipient shown (the matched person's address, else the first recipient). */
  to: string;
  subject?: string;
  /** Undefined = nobody in the tracker has that address. */
  contact?: Contact;
  via: "gmail" | "coverage";
  /** Coverage sends: 0 = first email, n = follow-up #n. */
  step?: number;
  /** A "DO NOT SEND" / "HOLD" / "Moved on" label is on it. */
  stop?: boolean;
}

/** Same email when Gmail's time and Coverage's planned time are this close. */
const SAME_SEND_MS = 2 * 60_000;
const STOP = /do not send|moved on|hold/i;

export function scheduledRows(gmailItems: GmailScheduledItem[] | undefined, contacts: Contact[], now = Date.now()): ScheduledRow[] {
  // Gmail's Scheduled folder not read yet (no server read access, or before the first sync): what each contact's own
  // Gmail sync found (`scheduledAt`) stands in for it.
  const items =
    gmailItems ??
    contacts.filter((c) => c.scheduledAt && c.email).map((c) => ({ at: c.scheduledAt!, to: [c.email], subject: "", labels: [], threadId: c.threadId ?? c.id }));
  const byAddr = new Map<string, Contact>();
  for (const c of contacts) for (const e of [c.email, ...(c.aliases ?? [])]) if (e?.trim()) byAddr.set(e.trim().toLowerCase(), c);
  const rows: ScheduledRow[] = [];
  for (const it of items) {
    if (!(Date.parse(it.at) > now)) continue;
    const to = it.to.map((e) => e.trim().toLowerCase());
    const hit = to.find((e) => byAddr.has(e));
    rows.push({
      key: `g:${it.threadId}:${it.at}`,
      at: it.at,
      to: hit ?? to[0] ?? "",
      subject: it.subject,
      contact: hit ? byAddr.get(hit) : undefined,
      via: "gmail",
      stop: it.labels.some((l) => STOP.test(l)) || undefined,
    });
  }
  for (const c of contacts) {
    const s = c.serverSend;
    if (!s || !(Date.parse(s.sendAt) > now)) continue;
    const t = Date.parse(s.sendAt);
    if (rows.some((r) => r.via === "gmail" && r.contact?.id === c.id && Math.abs(Date.parse(r.at) - t) <= SAME_SEND_MS)) continue;
    rows.push({ key: `c:${s.draftId}`, at: s.sendAt, to: c.email, contact: c, via: "coverage", step: s.step });
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

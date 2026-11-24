import { z } from "zod";

/** Body of POST /api/server/sync (its own module so checks can parse it without the server). */
const Item = z.object({ contactId: z.string().max(200), name: z.string().max(200), email: z.string().max(320).optional(), label: z.string().max(60) });
export const SyncBody = z.object({
  tz: z.string().max(64),
  /** null = turn the 9 PM text off; undefined = leave as is. */
  whatsapp: z.object({ phone: z.string().min(8).max(32), apiKey: z.string().min(3).max(64) }).nullable().optional(),
  digests: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.object({ items: z.array(Item).max(400), queued: z.number().int().min(0) })).optional(),
  /** People today's calendar events are matched against (thank-you reminders). */
  people: z
    .array(
      z.object({
        contactId: z.string().max(200),
        name: z.string().max(200),
        email: z.string().max(320).optional(),
        thankedAt: z.string().max(40).optional(),
        bank: z.string().max(200).optional(),
        linkedin: z.string().max(300).optional(),
        loggedAt: z.string().max(40).optional(),
        /** Replied / met / has a call: a first name alone may match them (calendarMatch.ts). */
        engaged: z.boolean().optional(),
      }),
    )
    .max(600)
    .optional(),
  /** The 9 PM text's "Big banks" message (lib/nightProgress.ts). null = none. */
  progress: z
    .object({
      at: z.string().max(40),
      banks: z
        .array(
          z.object({
            bank: z.string().max(200),
            score: z.number().min(0).max(100).nullable(),
            column: z.string().max(60).optional(),
            chats: z.number().int().min(0).max(9999),
            emailed: z.number().int().min(0).max(9999),
            live: z.number().int().min(0).max(9999),
            app: z.enum(["applied", "open", "closed"]).optional(),
            next: z.string().max(200).optional(),
          }),
        )
        .max(15),
      tips: z.array(z.string().max(300)).max(5),
      week: z.object({ emails: z.number().int().min(0), replies: z.number().int().min(0), chats: z.number().int().min(0) }),
    })
    .nullable()
    .optional(),
  /** People whose replies / thank-yous / intros the server watches in Gmail (needs read access). */
  track: z
    .array(
      z.object({
        contactId: z.string().max(200),
        name: z.string().max(200),
        emails: z.array(z.string().email().max(320)).min(1).max(4),
        since: z.string().max(40).optional(),
        hot: z.boolean().optional(),
        knownLast: z.string().max(40).optional(),
      }),
    )
    .max(400)
    .optional(),
  /** The "press Search" reminder: null = off. */
  jobRun: z.object({ lastAt: z.string().max(40).optional(), everyDays: z.number().int().min(1).max(14) }).nullable().optional(),
  /** Reply texts the dashboard has read (dropped from the server). */
  trackAck: z.array(z.object({ contactId: z.string().max(200), ids: z.array(z.string().max(100)).max(50) })).max(400).default([]),
  /** Every send the dashboard wants queued. Queued sends missing from this list are cancelled. */
  sends: z
    .array(z.object({ draftId: z.string().min(5).max(200), contactId: z.string().max(200), name: z.string().max(200), step: z.number().int().min(0).max(10), sendAt: z.string().datetime() }))
    .max(400)
    .optional(),
  /**
   * The "to schedule in Gmail" list (lib/handoff.ts): Gmail drafts the extension or Claude in Chrome puts in Gmail's
   * Schedule send. Served to Claude by the connector's emails_to_schedule. undefined = leave as is.
   */
  handoff: z
    .array(
      z.object({
        id: z.string().max(200),
        name: z.string().max(200),
        to: z.string().max(320),
        subject: z.string().max(400),
        draftId: z.string().max(200),
        messageId: z.string().max(200),
        step: z.number().int().min(-1).max(10),
        at: z.string().datetime(),
      }),
    )
    .max(200)
    .optional(),
  /** Read pixel hits only when tracking is on (saves a Redis call per sync). */
  opens: z.boolean().optional(),
  /**
   * Only ack / read pixel hits: no account save, no send queue, no digests, no Gmail tracking. `sends` is ignored (and
   * may be left out), so a page of opens can never cancel queued sends. Without it, `sends` is required.
   */
  opensOnly: z.boolean().optional(),
  /** Pixel hits (`id|at`) the dashboard has stored; dropped from the server. An id can be ~90 chars + "|" + time. */
  opensAck: z.array(z.string().max(200)).max(2000).default([]),
  /** Finished sends the dashboard has applied (removed from the server). */
  ack: z.array(z.string().max(200)).max(400).default([]),
}).refine((b) => b.opensOnly === true || b.sends !== undefined, { message: "sends is required unless opensOnly." });
export type SyncBodyIn = z.input<typeof SyncBody>;

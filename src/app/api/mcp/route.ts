import { appUrl, getSends, localNow, putSend, type Account } from "@/lib/server/accounts";
import { accountFromBearer } from "@/lib/server/oauth";
import { trackStates } from "@/lib/server/gmailTrack";
import { planItems } from "@/lib/server/tonight";
import { isTextDay, nextTextDay } from "@/lib/digestFormat";
import { findPerson, startFrom, whenLabel } from "@/lib/inviteCommand";
import { createInvite, inviteTitle } from "@/lib/server/invite";
import { readScheduled } from "@/lib/server/scheduled";
import { inGmail } from "@/lib/handoff";
import { gmailDraftUrl, gmailSearchUrl } from "@/lib/gmailLinks";

export const maxDuration = 60;

/**
 * The Coverage connector for Claude (owner, 2026-10-22): a remote MCP server (Streamable HTTP, JSON responses,
 * stateless) over what Coverage's server already keeps for automatic sending: tonight's to-dos, replies / thank-yous /
 * intros from the hourly Gmail tracking, and scheduled sends. Contacts, the spreadsheet and chats stay in the browser
 * (the Recruitify plugin's local tools cover those). Auth: OAuth via lib/server/oauth.ts; 401 points to the metadata.
 */

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DAY = 86_400_000;

type Json = Record<string, unknown>;
type Tool = { name: string; title: string; description: string; readOnly: boolean; destructive?: boolean; schema: Json; run: (a: Account, args: Json) => Promise<unknown> };

const obj = (properties: Json = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const when = (a: Account, iso?: string) =>
  iso ? new Intl.DateTimeFormat("en-US", { timeZone: a.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : undefined;
const nameOf = (a: Account, contactId: string) => a.track?.find((p) => p.contactId === contactId)?.name ?? a.people?.find((p) => p.contactId === contactId)?.name ?? contactId;

const TOOLS: Tool[] = [
  {
    name: "account_status",
    title: "Coverage account status",
    description: "Which Gmail Coverage sends from, whether the 9 PM WhatsApp text and hourly Gmail reply tracking are on, how many people are tracked, and when tracking last ran.",
    readOnly: true,
    schema: obj(),
    run: async (a) => {
      const states = await trackStates(a.id);
      const last = Object.values(states).map((s) => s.checkedAt).sort().pop();
      return {
        gmail: a.google?.email ?? null,
        whatsappText: !!a.whatsapp,
        calendar: !!a.google?.calendar,
        replyTracking: !!a.google?.read,
        trackedPeople: a.track?.length ?? 0,
        lastChecked: when(a, last),
        timeZone: a.tz,
        note: a.google?.read ? undefined : "Reply tracking is off: reconnect Google on Coverage → Follow-ups → Reminders and allow read-only Gmail.",
      };
    },
  },
  {
    name: "due_tonight",
    title: "What's due tonight",
    description:
      "The to-do list for a text night (every night; default: tonight, or the next text night): thank-yous owed, people who wrote back, check-ins and follow-ups due, from the plan the dashboard last pushed, minus anything settled by emails Coverage has seen since. Grouped by action.",
    readOnly: true,
    schema: obj({ day: { type: "string", description: "YYYY-MM-DD (the user's time zone). Omit for tonight / the next text night." } }),
    run: async (a, args) => {
      const today = localNow(a.tz).day;
      const day = typeof args.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.day) ? args.day : isTextDay(today) ? today : nextTextDay(today);
      const [states, sends] = await Promise.all([trackStates(a.id), getSends(a.id)]);
      const { items, queuedAhead } = planItems(a, day, states, Object.values(sends), new Set(), isTextDay(day));
      const groups: Record<string, { name: string; email?: string }[]> = {};
      for (const it of items) (groups[it.label] ??= []).push({ name: it.name, email: it.email });
      return {
        day,
        planPushed: Object.keys(a.digests ?? {}).length ? "yes" : "no plan yet: open the Coverage dashboard once",
        total: items.length,
        groups,
        alreadyScheduledBeforeNextText: queuedAhead,
      };
    },
  },
  {
    name: "recent_replies",
    title: "Recent replies",
    description: "People who wrote back recently (from the hourly Gmail tracking): when, whether you've answered, and the start of their newest reply when the dashboard hasn't read it yet.",
    readOnly: true,
    schema: obj({ days: { type: "number", description: "How far back (default 14, max 60)." } }),
    run: async (a, args) => {
      const days = Math.min(60, Math.max(1, Number(args.days) || 14));
      const states = await trackStates(a.id);
      const rows = Object.entries(states)
        .filter(([, s]) => s.result.lastHeardAt && Date.now() - Date.parse(s.result.lastHeardAt) < days * DAY)
        .sort((x, y) => (y[1].result.lastHeardAt ?? "").localeCompare(x[1].result.lastHeardAt ?? ""))
        .map(([id, s]) => {
          const text = Object.values(s.texts ?? {}).sort((x, y) => y.at.localeCompare(x.at))[0]?.text;
          return {
            name: nameOf(a, id),
            heard: when(a, s.result.lastHeardAt),
            youAnswered: !!s.result.lastEmailedAt && s.result.lastEmailedAt > s.result.lastHeardAt!,
            firstReply: when(a, s.result.repliedAt),
            excerpt: text ? text.slice(0, 400) : undefined,
          };
        });
      return { days, count: rows.length, replies: rows };
    },
  },
  {
    name: "thank_yous",
    title: "Thank-yous after calls",
    description: "For each call or coffee chat in the last 14 days: whether you've emailed them since (any email counts, as the thank-you), and when.",
    readOnly: true,
    schema: obj(),
    run: async (a) => {
      const states = await trackStates(a.id);
      const rows = (a.people ?? [])
        .filter((p) => p.loggedAt && Date.now() - Date.parse(p.loggedAt) < 14 * DAY)
        .map((p) => {
          const last = [p.thankedAt, states[p.contactId]?.result.lastEmailedAt].filter((x): x is string => !!x).sort().pop();
          return { name: p.name, bank: p.bank, chat: when(a, p.loggedAt), thanked: !!last && last > p.loggedAt!, lastEmailed: when(a, last) };
        })
        .sort((x, y) => Number(x.thanked) - Number(y.thanked));
      return { owed: rows.filter((r) => !r.thanked).length, chats: rows };
    },
  },
  {
    name: "intros_found",
    title: "Intros found in replies",
    description:
      "Bankers who added someone new to a reply (an intro / referral), from the hourly Gmail tracking, last 45 days: who, when, the person introduced, and whether you've emailed them. Confirm them on Coverage → Follow-ups → Referrals.",
    readOnly: true,
    schema: obj(),
    run: async (a) => {
      const states = await trackStates(a.id);
      const rows = Object.entries(states).flatMap(([id, s]) =>
        s.result.intros
          .filter((i) => Date.now() - Date.parse(i.at) < 45 * DAY)
          .map((i) => ({ from: nameOf(a, id), at: when(a, i.at), introduced: i.people.map((p) => `${p.name || p.email} <${p.email}>`), youWroteThem: when(a, i.youWroteAt) ?? "not yet" })),
      );
      return { count: rows.length, intros: rows };
    },
  },
  {
    name: "scheduled_sends",
    title: "Scheduled sends",
    description: "Emails Coverage will send automatically (first emails and follow-ups): who, which email, and when (the user's time zone). Includes recent failures.",
    readOnly: true,
    schema: obj(),
    run: async (a) => {
      const sends = Object.values(await getSends(a.id)).sort((x, y) => x.sendAt.localeCompare(y.sendAt));
      return {
        queued: sends.filter((s) => s.status === "queued").map((s) => ({ draftId: s.draftId, name: s.name, email: s.step ? `Follow-up #${s.step}` : "First email", sendAt: when(a, s.sendAt) })),
        problems: sends.filter((s) => s.status === "failed" || s.status === "missing").map((s) => ({ name: s.name, error: s.error })),
      };
    },
  },
  {
    name: "find_person",
    title: "Find a banker",
    description: "Look up someone the user emailed or talked to by name (or part of it, or with their bank), to get their email before sending a calendar invite.",
    readOnly: true,
    schema: obj({ name: { type: "string", description: "Full or partial name, optionally with the bank (\"Rohan BMO\")." } }, ["name"]),
    run: async (a, args) => {
      const q = String(args.name ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const hits = (a.people ?? []).filter((p) => q.every((w) => p.name.toLowerCase().split(/\s+/).some((x) => x.startsWith(w)) || (p.bank ?? "").toLowerCase().includes(w)));
      return { matches: hits.slice(0, 8).map((p) => ({ name: p.name, bank: p.bank, email: p.email ?? null, talkedBefore: !!p.engaged })) };
    },
  },
  {
    name: "send_calendar_invite",
    title: "Send a calendar invite",
    description:
      "Put a coffee chat on the user's Google Calendar with a banker as the guest; by default Google emails them the invite. The person must be someone Coverage knows (use find_person). Times without an offset are in the user's time zone. Only call this after the user confirmed who, the day and the time.",
    readOnly: false,
    destructive: false,
    schema: obj(
      {
        person: { type: "string", description: "Their email (best) or name." },
        start: { type: "string", description: "Start time, e.g. 2026-11-25T15:00 (user's zone) or a full ISO time with an offset." },
        minutes: { type: "number", description: "Length in minutes (default 30)." },
        title: { type: "string", description: "Event title (default \"<First name> Coffee Chat\")." },
        description: { type: "string", description: "Event description, e.g. who calls whom and the phone numbers." },
        notify: { type: "boolean", description: "Email them the invite now (default true). False = only on the user's calendar." },
      },
      ["person", "start"],
    ),
    run: async (a, args) => {
      const found = findPerson(a.people ?? [], String(args.person ?? ""));
      if ("error" in found) throw new Error(found.error);
      const start = startFrom(String(args.start ?? ""), a.tz);
      if (!start) throw new Error("start must look like 2026-11-25T15:00.");
      if (start.getTime() < Date.now()) throw new Error("That time has already passed.");
      const minutes = Math.min(180, Math.max(10, Number(args.minutes) || 30));
      const notify = args.notify !== false;
      const ev = await createInvite(a, {
        email: found.person.email!,
        title: typeof args.title === "string" && args.title.trim() ? args.title : inviteTitle(found.person.name),
        description: typeof args.description === "string" ? args.description : undefined,
        start,
        minutes,
        notify,
      });
      return { sent: notify, name: found.person.name, email: found.person.email, when: whenLabel(start, a.tz), minutes, link: ev.htmlLink };
    },
  },
  {
    name: "emails_to_schedule",
    title: "Emails to schedule in Gmail",
    description:
      "The user's Gmail drafts waiting to be put in Gmail's own Schedule send (Coverage → Cold outreach → Scheduled → To schedule in Gmail). For each: who, the address, the draft's link, and the exact date and time to schedule it for, in the user's time zone as Gmail's \"Pick date & time\" box wants it. Use with Claude in Chrome: open each draftUrl in Gmail, check the To address, then More send options (the arrow next to Send) → Schedule send → Pick date & time → type gmailDate and gmailTime → Schedule send. NEVER press Send. Afterwards call confirm_scheduled.",
    readOnly: true,
    schema: obj(),
    run: async (a) => {
      const items = (a.handoff ?? []).filter((i) => Date.parse(i.at) > Date.now()).sort((x, y) => x.at.localeCompare(y.at));
      const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: a.tz, ...o }).format(new Date(iso));
      return {
        count: items.length,
        timeZone: a.tz,
        listUpdated: when(a, a.handoffAt),
        note: items.length ? "Gmail's date/time box uses the browser's time zone; these are in the user's time zone (the same unless they're travelling)." : "Nothing waiting. The list fills when the user drafts follow-ups in Coverage with Gmail scheduling.",
        items: items.map((i) => ({
          name: i.name,
          to: i.to,
          email: i.step === 0 ? "First email" : i.step === -1 ? "Check-in" : `Follow-up #${i.step}`,
          subject: i.subject || undefined,
          sendAt: when(a, i.at),
          gmailDate: fmt(i.at, { month: "short", day: "numeric", year: "numeric" }),
          gmailTime: fmt(i.at, { hour: "numeric", minute: "2-digit" }),
          draftUrl: gmailDraftUrl(i.messageId),
        })),
        allScheduledUrl: gmailSearchUrl("in:scheduled"),
      };
    },
  },
  {
    name: "confirm_scheduled",
    title: "Check what's in Gmail's Scheduled folder",
    description: "After scheduling emails in Gmail, check each one on the emails_to_schedule list is really in Gmail's Scheduled folder at its time (within 2 minutes). Read-only; Coverage marks them on its next sync.",
    readOnly: true,
    schema: obj(),
    run: async (a) => {
      const r = await readScheduled(a);
      if (!r.read) return { checked: false, why: "Coverage can't read Gmail for this account (reconnect Google in Coverage → Settings → Account with read access)." };
      const items = (a.handoff ?? []).filter((i) => Date.parse(i.at) > Date.now());
      const found = items.filter((i) => inGmail({ email: i.to, aliases: [] }, i.at, r.items));
      const missing = items.filter((i) => !found.includes(i));
      return {
        checked: true,
        found: found.map((i) => ({ name: i.name, sendAt: when(a, i.at) })),
        missing: missing.map((i) => ({ name: i.name, sendAt: when(a, i.at), draftUrl: gmailDraftUrl(i.messageId) })),
        totalInGmailScheduled: r.items.length,
      };
    },
  },
  {
    name: "cancel_send",
    title: "Cancel a scheduled send",
    description: "Stop one queued automatic send (by draftId from scheduled_sends). The Gmail draft stays; the dashboard shows it as cancelled. Only do this when the user asks.",
    readOnly: false,
    destructive: true,
    schema: obj({ draftId: { type: "string" } }, ["draftId"]),
    run: async (a, args) => {
      const sends = await getSends(a.id);
      const s = sends[String(args.draftId)];
      if (!s || s.status !== "queued") throw new Error("No queued send with that draftId (it may have gone out already).");
      // "failed" so the dashboard clears it on its next sync and doesn't queue it again (api/server/sync skips non-queued).
      await putSend(a.id, { ...s, status: "failed", doneAt: new Date().toISOString(), error: "Cancelled from Claude" });
      return { cancelled: true, name: s.name, was: when(a, s.sendAt) };
    },
  },
];

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(a: Account, m: { id?: unknown; method?: string; params?: Json }) {
  const p = m.params ?? {};
  switch (m.method) {
    case "initialize": {
      const asked = String(p.protocolVersion ?? "");
      return {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "coverage", title: "Coverage", version: "0.1.0" },
        instructions:
          "Coverage tracks a student's investment-banking networking. These tools read what Coverage's server keeps: tonight's to-dos, replies, thank-yous, intros, scheduled sends, and the people the user emailed or talked to (names + emails). send_calendar_invite puts a chat on their Google Calendar: confirm who and when with the user first. Only cancel a send when the user asks.",
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.schema,
          annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: !!t.destructive, idempotentHint: t.readOnly, openWorldHint: false },
        })),
      };
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === p.name);
      if (!tool) throw Object.assign(new Error(`Unknown tool ${String(p.name)}`), { code: -32602 });
      try {
        const out = await tool.run(a, (p.arguments as Json) ?? {});
        return { content: [{ type: "text", text: JSON.stringify(out, null, 1) }] };
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error(`Method not found: ${m.method}`), { code: -32601 });
  }
}

export async function POST(req: Request) {
  const a = await accountFromBearer(req).catch(() => null);
  if (!a)
    return Response.json(rpcError(null, -32001, "Sign in to Coverage first."), {
      status: 401,
      headers: { "WWW-Authenticate": `Bearer resource_metadata="${appUrl(req)}/.well-known/oauth-protected-resource"` },
    });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  const list = (Array.isArray(body) ? body : [body]) as { id?: unknown; method?: string; params?: Json }[];
  const out = [];
  for (const m of list) {
    if (m.id === undefined) continue; // notifications
    try {
      out.push({ jsonrpc: "2.0", id: m.id, result: await handle(a, m) });
    } catch (e) {
      out.push(rpcError(m.id, (e as { code?: number }).code ?? -32603, (e as Error).message));
    }
  }
  if (!out.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? out : out[0]);
}

export function GET() {
  return new Response("This MCP endpoint takes POST (Streamable HTTP, no server-sent stream).", { status: 405, headers: { Allow: "POST" } });
}

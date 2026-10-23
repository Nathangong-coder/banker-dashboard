import { appUrl, getSends, localNow, putSend, type Account } from "@/lib/server/accounts";
import { accountFromBearer } from "@/lib/server/oauth";
import { trackStates } from "@/lib/server/gmailTrack";
import { planItems } from "@/lib/server/tonight";
import { isTextDay, nextTextDay } from "@/lib/digestFormat";

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
      "The to-do list for a text night (Mon–Thu; default: tonight, or the next text night): thank-yous owed, people who wrote back, check-ins and follow-ups due, from the plan the dashboard last pushed, minus anything settled by emails Coverage has seen since. Grouped by action.",
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
          "Coverage tracks a student's investment-banking networking. These tools read what Coverage's server keeps: tonight's to-dos, replies, thank-yous, intros, scheduled sends. Contacts and the spreadsheet aren't here. Only cancel a send when the user asks.",
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
          annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: !!t.destructive, idempotentHint: true, openWorldHint: false },
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

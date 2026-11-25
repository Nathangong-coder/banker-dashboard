import { cleanLayout } from "@/lib/textLayout";
import { errorResponse } from "@/lib/server/http";
import { DIGEST_DAY, DIGEST_ERR, accountIds, appUrl, captureUrl, db, getSends, loadAccount, localNow, type Account } from "@/lib/server/accounts";
import { accessToken, infoSessionsBetween, listEvents } from "@/lib/server/google";
import { verifyQstash } from "@/lib/server/jobs";
import { trackAccount, trackStates, type TrackState } from "@/lib/server/gmailTrack";
import { ensureWatch } from "@/lib/server/gmailPush";
import { PgStore } from "@/lib/server/store";
import { planItems } from "@/lib/server/tonight";
import { sendWhatsApp } from "@/lib/server/whatsapp";
import { LABELS, TEXT_HOUR, afterCallLines, jobRunLine, nextTextDay, nightMessages, type CallPerson, type DigestItem } from "@/lib/digestFormat";
import { looksLikeChat, matchEvent } from "@/lib/calendarMatch";
import { followUpTiming, reminderDue } from "@/lib/infoSessions";

export const maxDuration = 300;

/**
 * Calls from Google Calendar (owner, 2026-11-21: the text "isn't syncing with gcal"; it only read today's events):
 * - the last 7 days: a matched person with no email to them since the call started → thank-you (today's) / thank-you
 *   still owed (earlier days); an unmatched event that looks like a chat (≤ 3 guests) only for today, by its title;
 * - tomorrow: each call → "Calls tomorrow: prep".
 * Fails soft: the text still goes out without them, with a note.
 */
async function calendarItems(a: Account, day: string, tracked: Record<string, TrackState> = {}): Promise<{ items: DigestItem[]; met: CallPerson[]; note?: string }> {
  if (!a.google?.calendar) return { items: [], met: [] };
  try {
    const now = Date.now();
    const events = (await listEvents(await accessToken(a), new Date(now - 7 * 86_400_000).toISOString(), new Date(now + 40 * 3600_000).toISOString())).filter((e) => !e.allDay);
    const tomorrow = localNow(a.tz, new Date(now + 24 * 3600_000)).day;
    const people = a.people ?? [];
    const items: DigestItem[] = [];
    const met: CallPerson[] = [];
    const listed = new Set<string>();
    for (const e of events) {
      const at = new Date(e.start);
      const eDay = localNow(a.tz, at).day;
      const p = matchEvent({ id: e.id, summary: e.summary, description: e.description, attendees: e.attendees }, people);
      if (eDay === tomorrow && at.getTime() > now) {
        if (p || looksLikeChat(e.summary)) {
          const id = p?.contactId ?? `cal:${e.id}`;
          if (listed.has(`prep:${id}`)) continue;
          listed.add(`prep:${id}`);
          const who = p ? `${p.name}${p.bank ? ` (${p.bank})` : ""}` : e.summary || "Call";
          items.push({ contactId: id, name: `${who} at ${timeIn(a.tz, at)}`.slice(0, 200), label: LABELS.prepTomorrow });
        }
        continue;
      }
      if (at.getTime() > now) continue;
      if (p) {
        if (eDay === day && !met.some((m) => m.contactId === p.contactId)) met.push({ contactId: p.contactId, name: p.name, bank: p.bank, linkedin: p.linkedin });
        // Thanked = any email to them after the call started (Gmail, read by the server when it can), or done by hand.
        const thanked = [p.thankedAt, tracked[p.contactId]?.result.lastEmailedAt].filter(Boolean).sort().pop();
        if ((thanked && thanked >= e.start) || listed.has(p.contactId)) continue;
        listed.add(p.contactId);
        items.push({ contactId: p.contactId, name: p.name, email: p.email, label: eDay === day ? LABELS.thankToday : LABELS.thankOwed });
      } else if (eDay === day && looksLikeChat(e.summary) && e.attendees.length <= 3) {
        items.push({ contactId: `cal:${e.id}`, name: e.summary || "Untitled call", email: e.attendees[0], label: LABELS.thankToday });
      }
    }
    return { items, met };
  } catch (e) {
    return { items: [], met: [], note: `(Couldn't read Google Calendar: ${(e as Error).message.slice(0, 80)})` };
  }
}

const shortDay = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "numeric", day: "numeric" }).format(new Date(iso));

/**
 * The 9 PM text, every night (owner, 2026-11-21), as up to three messages (digestFormat.ts#nightMessages):
 * 📊 big banks (the dashboard's `progress`), ✅ to-do (calendar thank-yous for the last week, tomorrow's calls, and the
 * dashboard's plan: replies, check-ins, referrals), 📬 outreach (follow-ups, offices to fill). People the server has
 * emailed or followed up with since the dashboard last synced are left out. Returns whether a text went out.
 */
async function nightText(a: Account, app: string) {
  const id = a.id;
  const { day, hour } = localNow(a.tz);
  if (hour < TEXT_HOUR) return false;
  // Claim tonight first, so an overlapping run can't send it twice.
  const prev = await db().getset<string>(DIGEST_DAY(id), day);
  if (prev === day) return false;
  const tracked = a.google?.read ? await trackStates(id) : {};
  const plan = a.digests[day];
  const sends = Object.values(await getSends(id));
  const cal = await calendarItems(a, day, tracked);
  const calIds = new Set(cal.items.map((i) => i.contactId));
  const fromPlan = planItems(a, day, tracked, sends, calIds, true);
  const items = [...cal.items, ...fromPlan.items];
  const until = nextTextDay(day);
  const queued = sends.filter((s) => {
    if (s.status !== "queued") return false;
    const d = localNow(a.tz, new Date(s.sendAt)).day;
    return d > day && d <= until;
  }).length;

  // Everyone you talked to today: on the calendar, or a call / chat the dashboard knows about (thank-you items).
  const people = a.people ?? [];
  const met = [...cal.met];
  for (const it of items)
    if (it.label === LABELS.thankToday && !met.some((m) => m.contactId === it.contactId)) {
      const p = people.find((x) => x.contactId === it.contactId);
      if (p) met.push({ contactId: p.contactId, name: p.name, bank: p.bank, linkedin: p.linkedin });
    }
  // Already logged today's conversation on the dashboard: no need to ask.
  const toLog = met.filter((m) => {
    const at = people.find((p) => p.contactId === m.contactId)?.loggedAt;
    return !at || localNow(a.tz, new Date(at)).day < day;
  });
  const todoExtra: string[] = [];
  if (toLog.length || (!met.length && items.some((i) => i.label === LABELS.thankToday))) todoExtra.push(...afterCallLines(toLog, app, day));
  if (cal.note) todoExtra.push(cal.note);
  // The plan comes from the dashboard: say so when it's old (it's only refreshed while Coverage is open somewhere).
  const planAge = a.planAt ? Date.now() - Date.parse(a.planAt) : Infinity;
  if (!plan || planAge > 3 * 86_400_000)
    todoExtra.push(`⚠️ Coverage last synced ${a.planAt ? shortDay(a.planAt, a.tz) : "a while ago"}: open it (${app}) so replies, check-ins and follow-ups here are current.`);

  const outreachExtra: string[] = [];
  const ahead = Math.max(queued, plan?.queued ?? 0);
  if (ahead) outreachExtra.push(`Already scheduled before tomorrow night: ${ahead}`);
  const jobLine = jobRunLine(a.jobRun, day, app);
  if (jobLine) outreachExtra.push(jobLine);

  const progressAge = a.progress ? Date.now() - Date.parse(a.progress.at) : Infinity;
  const messages = nightMessages({
    items,
    progress: a.progress,
    progressNote: a.progress && progressAge > 36 * 3600_000 ? `(as of ${shortDay(a.progress.at, a.tz)})` : undefined,
    todoExtra,
    outreachExtra,
    app,
    maxLen: 1400,
    layout: cleanLayout(a.textLayout),
  });
  if (!messages.length) return false;
  try {
    for (let i = 0; i < messages.length; i++) {
      if (i) await new Promise((r) => setTimeout(r, 4000));
      await sendWhatsApp(a, messages[i]);
    }
    await db().del(DIGEST_ERR(id));
    return true;
  } catch (e) {
    // Give the next hour a try, and tell the dashboard why.
    await db().set(DIGEST_DAY(id), prev ?? "");
    await db().set(DIGEST_ERR(id), `${day}: ${(e as Error).message}`);
    return false;
  }
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekdayIn = (tz: string, at: Date) => WEEKDAYS.indexOf(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(at));
const timeIn = (tz: string, at: Date) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at);

/**
 * Info-session reminders (any day, every hourly tick): a text 1–2 h before each timed info session on your calendar,
 * and one in the hour after it ends asking who you met (capture link) and when the thank-yous go out (Mon–Thu
 * tonight; Fri–Sun tonight or next week). Each is sent once (`isr:<id>:<event>:<kind>`); a failed send frees the
 * claim so the next hour retries. Returns how many texts went out.
 */
async function infoSessionReminders(a: Account, req: Request) {
  if (!a.google?.calendar || !a.whatsapp) return 0;
  const now = Date.now();
  const sessions = (await infoSessionsBetween(a, new Date(now - 3 * 3600_000).toISOString(), new Date(now + 3 * 3600_000).toISOString())).filter((s) => !s.allDay);
  let sent = 0;
  let capture: string | undefined;
  const app = appUrl(req);
  for (const s of sessions) {
    const start = new Date(s.start);
    const end = new Date(s.end);
    const kind = reminderDue(now, start.getTime(), end.getTime());
    if (!kind) continue;
    const key = `isr:${a.id}:${s.eventId}:${kind}`;
    if ((await db().set(key, 1, { nx: true, ex: 259200 })) !== "OK") continue;
    try {
      capture ??= await captureUrl(a, req);
      const title = s.title.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() || "Info session";
      const review = `${app}/info-sessions?id=${encodeURIComponent(s.eventId)}`;
      let text: string;
      if (kind === "before") {
        const where = s.link ?? s.location;
        text = `📅 *${title}* at ${timeIn(a.tz, start)}${where ? ` (${where})` : ""}. Afterwards, send who you met: ${capture}`;
      } else {
        const wd = weekdayIn(a.tz, end);
        const when =
          followUpTiming(wd) === "tonight"
            ? `2) Thank-you emails go out tonight. Confirm names + draft: ${review}`
            : `2) It's ${WEEKDAYS[wd]}: send thank-yous tonight or next week? Pick here: ${review}`;
        text = `✅ *${title}* just ended. 1) Send who you met: ${capture} ${when}`;
      }
      await sendWhatsApp(a, text);
      sent++;
    } catch {
      await db().del(key);
    }
  }
  return sent;
}

/**
 * Hourly (QStash schedule), for every account with WhatsApp: info-session reminders (any day, needs Calendar access)
 * and, every night from 9 PM local, the night's messages via CallMeBot.
 */
export async function POST(req: Request) {
  try {
    await verifyQstash(req);
    let sent = 0;
    let sessionTexts = 0;
    let tracked = 0;
    for (const id of await accountIds()) {
      const a = await loadAccount(id);
      if (!a) continue;
      // Replies / thank-yous / intros first, so tonight's text is current.
      if (a.google?.read) tracked += await trackAccount(a, 60_000).catch(() => 0);
      // Gmail push (when set up): start or renew the 7-day watch.
      if (a.google?.read) await ensureWatch(a).catch((e: Error) => console.warn(`[gmail-push] watch ${a.id}: ${e.message.slice(0, 200)}`));
      if (!a.whatsapp) continue;
      try {
        sessionTexts += await infoSessionReminders(a, req);
      } catch {
        // Calendar unreadable this hour (revoked, API off): the 9 PM text still goes out and mentions it.
      }
      if (await nightText(a, appUrl(req))) sent++;
    }
    // Postgres keeps expired rows until they are deleted (Redis drops them by itself).
    const store = db();
    if (store instanceof PgStore) await store.sweepExpired().catch((e: Error) => console.warn(`[store] sweep: ${e.message}`));
    return Response.json({ sent, sessionTexts, tracked });
  } catch (e) {
    return errorResponse(e);
  }
}

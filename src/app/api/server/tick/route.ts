import { errorResponse } from "@/lib/server/http";
import { DIGEST_DAY, DIGEST_ERR, accountIds, appUrl, captureUrl, db, getSends, loadAccount, localNow, type Account } from "@/lib/server/accounts";
import { accessToken, eventsOn, infoSessionsBetween } from "@/lib/server/google";
import { verifyQstash } from "@/lib/server/jobs";
import { trackAccount, trackStates, type TrackState } from "@/lib/server/gmailTrack";
import { planItems } from "@/lib/server/tonight";
import { sendWhatsApp } from "@/lib/server/whatsapp";
import { LABELS, TEXT_HOUR, afterCallLines, digestMessages, digestTitle, isTextDay, nextTextDay, type CallPerson, type DigestItem } from "@/lib/digestFormat";
import { looksLikeChat, matchEvent } from "@/lib/calendarMatch";
import { followUpTiming, reminderDue } from "@/lib/infoSessions";

export const maxDuration = 300;

/**
 * Today's calls from Google Calendar that haven't been thanked yet (no email to them since the call started).
 * Unmatched events that look like a chat are listed by their title. Fails soft: the text still goes out without them.
 */
async function calendarThankYous(a: Account, day: string, tracked: Record<string, TrackState> = {}): Promise<{ items: DigestItem[]; met: CallPerson[]; note?: string }> {
  if (!a.google?.calendar) return { items: [], met: [] };
  try {
    const events = await eventsOn(await accessToken(a), day, (at) => localNow(a.tz, at).day);
    const people = a.people ?? [];
    const items: DigestItem[] = [];
    const met: CallPerson[] = [];
    for (const e of events) {
      if (new Date(e.start) > new Date()) continue;
      const p = matchEvent(e, people);
      if (p && !met.some((m) => m.contactId === p.contactId)) met.push({ contactId: p.contactId, name: p.name, bank: p.bank, linkedin: p.linkedin });
      if (p) {
        // Thanked = any email to them after the call started (Gmail, read by the server when it can).
        const thanked = [p.thankedAt, tracked[p.contactId]?.result.lastEmailedAt].filter(Boolean).sort().pop();
        if (!thanked || thanked < e.start) items.push({ contactId: p.contactId, name: p.name, email: p.email, label: LABELS.thankToday });
      } else if (looksLikeChat(e.summary) && e.attendees.length <= 3) {
        items.push({ contactId: `cal:${e.id}`, name: e.summary || "Untitled call", email: e.attendees[0], label: LABELS.thankToday });
      }
    }
    return { items, met };
  } catch (e) {
    return { items: [], met: [], note: `(Couldn't read Google Calendar: ${(e as Error).message.slice(0, 80)})` };
  }
}

/**
 * The 9 PM list (Mon–Thu, from 9 PM local, once a night): today's calls to thank (Google Calendar + the dashboard's
 * plan), replies and check-ins owed, and follow-ups due before the next text, then for each person you talked to today
 * a "log how it went" + LinkedIn link. Fri–Sun there's a text only when you had calls that day (thank-yous + those
 * links, no follow-ups). People the server has followed up with since the dashboard last synced are left out.
 * Returns whether a text went out.
 */
async function nightText(a: Account, app: string) {
  const id = a.id;
  const { day, hour } = localNow(a.tz);
  if (hour < TEXT_HOUR) return false;
  const textDay = isTextDay(day);
  // Off nights: only worth a text when there were calls today (read before claiming the night).
  const tracked = a.google?.read ? await trackStates(id) : {};
  const offCal = textDay ? undefined : await calendarThankYous(a, day, tracked);
  if (offCal && !offCal.met.length && !offCal.items.length) return false;
  // (An off night where everyone's already logged and thanked sends nothing: see `messages` below.)
  // Claim tonight first, so an overlapping run can't send it twice.
  const prev = await db().getset<string>(DIGEST_DAY(id), day);
  if (prev === day) return false;
  const plan = textDay ? a.digests[day] : undefined;
  const sends = Object.values(await getSends(id));
  const cal = offCal ?? (await calendarThankYous(a, day, tracked));
  const calIds = new Set(cal.items.map((i) => i.contactId));
  const fromPlan = planItems(a, day, tracked, sends, calIds, textDay);
  const items = [...cal.items, ...fromPlan.items];
  const until = textDay ? nextTextDay(day) : day;
  const queued = sends.filter((s) => {
    if (s.status !== "queued") return false;
    const d = localNow(a.tz, new Date(s.sendAt)).day;
    return d > day && d <= until;
  }).length;
  const extra: string[] = [];
  const ahead = Math.max(queued, plan?.queued ?? 0);
  if (ahead) extra.push(`Already scheduled before your next text: ${ahead}`);
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
  if (toLog.length || (!met.length && items.some((i) => i.label === LABELS.thankToday))) extra.push(...afterCallLines(toLog, app, day));
  if (cal.note) extra.push(cal.note);
  const messages = items.length || toLog.length ? digestMessages(items, extra) : [];
  if (!messages.length) return false;
  try {
    for (let i = 0; i < messages.length; i++) {
      if (i) await new Promise((r) => setTimeout(r, 4000));
      await sendWhatsApp(a, `*${digestTitle(i, messages.length)}*\n${messages[i]}`);
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
 * and, on text nights (Mon–Thu) from 9 PM local, the night's list via CallMeBot.
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
      if (!a.whatsapp) continue;
      try {
        sessionTexts += await infoSessionReminders(a, req);
      } catch {
        // Calendar unreadable this hour (revoked, API off): the 9 PM text still goes out and mentions it.
      }
      if (await nightText(a, appUrl(req))) sent++;
    }
    return Response.json({ sent, sessionTexts, tracked });
  } catch (e) {
    return errorResponse(e);
  }
}

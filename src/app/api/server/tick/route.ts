import { errorResponse } from "@/lib/server/http";
import { DIGEST_DAY, DIGEST_ERR, accountIds, appUrl, captureUrl, db, getSends, loadAccount, localNow, type Account } from "@/lib/server/accounts";
import { accessToken, eventsOn, infoSessionsBetween } from "@/lib/server/google";
import { verifyQstash } from "@/lib/server/jobs";
import { sendWhatsApp } from "@/lib/server/whatsapp";
import { LABELS, TEXT_HOUR, TRACKER_NOTE, digestMessages, digestTitle, isTextDay, nextTextDay, type DigestItem } from "@/lib/digestFormat";
import { looksLikeChat, matchEvent } from "@/lib/calendarMatch";
import { followUpTiming, reminderDue } from "@/lib/infoSessions";

export const maxDuration = 300;

/**
 * Today's calls from Google Calendar that haven't been thanked yet (no email to them since the call started).
 * Unmatched events that look like a chat are listed by their title. Fails soft: the text still goes out without them.
 */
async function calendarThankYous(a: Account, day: string): Promise<{ items: DigestItem[]; note?: string }> {
  if (!a.google?.calendar) return { items: [] };
  try {
    const events = await eventsOn(await accessToken(a), day, (at) => localNow(a.tz, at).day);
    const people = a.people ?? [];
    const items: DigestItem[] = [];
    for (const e of events) {
      if (new Date(e.start) > new Date()) continue;
      const p = matchEvent(e, people);
      if (p) {
        if (!p.thankedAt || p.thankedAt < e.start) items.push({ contactId: p.contactId, name: p.name, email: p.email, label: LABELS.thankToday });
      } else if (looksLikeChat(e.summary) && e.attendees.length <= 3) {
        items.push({ contactId: `cal:${e.id}`, name: e.summary || "Untitled call", email: e.attendees[0], label: LABELS.thankToday });
      }
    }
    return { items };
  } catch (e) {
    return { items: [], note: `(Couldn't read Google Calendar: ${(e as Error).message.slice(0, 80)})` };
  }
}

/**
 * The 9 PM list (Mon–Thu, from 9 PM local, once a night): today's calls to thank (Google Calendar + the dashboard's
 * plan), replies and check-ins owed, and follow-ups due before the next text. People the server has followed up with
 * since the dashboard last synced are left out. Returns whether a text went out.
 */
async function nightText(a: Account) {
  const id = a.id;
  const { day, hour } = localNow(a.tz);
  if (!isTextDay(day) || hour < TEXT_HOUR) return false;
  // Claim tonight first, so an overlapping run can't send it twice.
  const prev = await db().getset<string>(DIGEST_DAY(id), day);
  if (prev === day) return false;
  const plan = a.digests[day];
  const sends = Object.values(await getSends(id));
  const doneSince = new Set(sends.filter((s) => s.status === "sent").map((s) => s.contactId));
  const cal = await calendarThankYous(a, day);
  const calIds = new Set(cal.items.map((i) => i.contactId));
  const items = [...cal.items, ...(plan?.items ?? []).filter((it) => !calIds.has(it.contactId) && !(doneSince.has(it.contactId) && /follow-up|move on/i.test(it.label)))];
  const until = nextTextDay(day);
  const queued = sends.filter((s) => {
    if (s.status !== "queued") return false;
    const d = localNow(a.tz, new Date(s.sendAt)).day;
    return d > day && d <= until;
  }).length;
  const extra: string[] = [];
  const ahead = Math.max(queued, plan?.queued ?? 0);
  if (ahead) extra.push(`Already scheduled before your next text: ${ahead}`);
  if (items.some((i) => i.label === LABELS.thankToday)) extra.push(TRACKER_NOTE);
  if (cal.note) extra.push(cal.note);
  const messages = items.length ? digestMessages(items, extra) : [];
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
    for (const id of await accountIds()) {
      const a = await loadAccount(id);
      if (!a?.whatsapp) continue;
      try {
        sessionTexts += await infoSessionReminders(a, req);
      } catch {
        // Calendar unreadable this hour (revoked, API off): the 9 PM text still goes out and mentions it.
      }
      if (await nightText(a)) sent++;
    }
    return Response.json({ sent, sessionTexts });
  } catch (e) {
    return errorResponse(e);
  }
}

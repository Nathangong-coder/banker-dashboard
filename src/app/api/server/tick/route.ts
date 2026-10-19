import { errorResponse } from "@/lib/server/http";
import { DIGEST_DAY, DIGEST_ERR, accountIds, db, getSends, loadAccount, localNow, unseal, type Account } from "@/lib/server/accounts";
import { accessToken, eventsOn } from "@/lib/server/google";
import { verifyQstash } from "@/lib/server/jobs";
import { LABELS, TEXT_HOUR, TRACKER_NOTE, digestMessages, digestTitle, isTextDay, nextTextDay, type DigestItem } from "@/lib/digestFormat";
import { looksLikeChat, matchEvent } from "@/lib/calendarMatch";

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
 * Hourly (QStash schedule): on text nights (Mon–Thu) from 9 PM local, each account that hasn't had tonight's text gets
 * its WhatsApp list via CallMeBot: today's calls to thank (Google Calendar + the dashboard's plan), replies and
 * check-ins owed, and follow-ups due before the next text. People the server has followed up with since the dashboard
 * last synced are left out.
 */
export async function POST(req: Request) {
  try {
    await verifyQstash(req);
    let sent = 0;
    for (const id of await accountIds()) {
      const a = await loadAccount(id);
      if (!a?.whatsapp) continue;
      const { day, hour } = localNow(a.tz);
      if (!isTextDay(day) || hour < TEXT_HOUR) continue;
      // Claim tonight first, so an overlapping run can't send it twice.
      const prev = await db().getset<string>(DIGEST_DAY(id), day);
      if (prev === day) continue;
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
      if (!messages.length) continue;
      try {
        const phone = unseal(a.whatsapp.phone).replace(/[^\d+]/g, "");
        const apikey = unseal(a.whatsapp.apiKey);
        for (let i = 0; i < messages.length; i++) {
          if (i) await new Promise((r) => setTimeout(r, 4000));
          const q = new URLSearchParams({ phone, apikey, text: `*${digestTitle(i, messages.length)}*\n${messages[i]}`.slice(0, 1500) });
          const res = await fetch(`https://api.callmebot.com/whatsapp.php?${q}`);
          const text = await res.text();
          if (!res.ok || /invalid|error|not (?:allowed|activated)/i.test(text)) throw new Error(`CallMeBot: ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)}`);
        }
        await db().del(DIGEST_ERR(id));
        sent++;
      } catch (e) {
        // Give the next hour a try, and tell the dashboard why.
        await db().set(DIGEST_DAY(id), prev ?? "");
        await db().set(DIGEST_ERR(id), `${day}: ${(e as Error).message}`);
      }
    }
    return Response.json({ sent });
  } catch (e) {
    return errorResponse(e);
  }
}

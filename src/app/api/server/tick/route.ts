import { errorResponse } from "@/lib/server/http";
import { DIGEST_DAY, DIGEST_ERR, accountIds, db, getSends, loadAccount, localNow, unseal } from "@/lib/server/accounts";
import { verifyQstash } from "@/lib/server/jobs";
import { digestMessages, digestTitle } from "@/lib/digestFormat";

export const maxDuration = 300;

/**
 * Hourly (QStash schedule): each account whose local time is 9:00–8:59 PM and that hasn't had today's text gets its
 * WhatsApp digest via CallMeBot. People the server has followed up with since the dashboard last synced are left
 * out, and today's queued sends are counted.
 */
export async function POST(req: Request) {
  try {
    await verifyQstash(req);
    let sent = 0;
    for (const id of await accountIds()) {
      const a = await loadAccount(id);
      if (!a?.whatsapp) continue;
      const { day, hour } = localNow(a.tz);
      if (hour < 9 || hour >= 21) continue;
      // Claim today first, so an overlapping run can't send it twice.
      const prev = await db().getset<string>(DIGEST_DAY(id), day);
      if (prev === day) continue;
      const plan = a.digests[day];
      const sends = Object.values(await getSends(id));
      const doneSince = new Set(sends.filter((s) => s.status === "sent").map((s) => s.contactId));
      const items = (plan?.items ?? []).filter((it) => !doneSince.has(it.contactId));
      const queuedToday = sends.filter((s) => s.status === "queued" && localNow(a.tz, new Date(s.sendAt)).day === day).length;
      const messages = digestMessages(items, Math.max(queuedToday, plan?.queued ?? 0));
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

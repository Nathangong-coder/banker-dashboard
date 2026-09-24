import { z } from "zod";
import { HttpError, assertPublicHttps, errorResponse } from "@/lib/server/http";

const Body = z.object({
  channel: z.enum(["ntfy", "twilio", "whatsapp"]),
  title: z.string().max(200).default("Follow-up reminder"),
  message: z.string().min(1).max(1500),
  /** ISO time to deliver; omitted = now. */
  at: z.string().optional(),
  ntfy: z.object({ server: z.string().url(), topic: z.string().min(3) }).optional(),
  twilio: z
    .object({
      sid: z.string().min(10),
      token: z.string().min(10),
      from: z.string().optional(),
      messagingServiceSid: z.string().optional(),
      to: z.string().min(5),
    })
    .optional(),
  whatsapp: z.object({ phone: z.string().min(8), apiKey: z.string().min(3) }).optional(),
});

export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    const at = b.at ? new Date(b.at) : undefined;

    if (b.channel === "whatsapp") {
      // CallMeBot: free WhatsApp messages to your own number. Send-now only (no scheduling).
      if (!b.whatsapp) throw new HttpError(400, "Set your WhatsApp number and CallMeBot API key in Settings.");
      const q = new URLSearchParams({
        phone: b.whatsapp.phone.replace(/[^\d+]/g, ""),
        text: `*${b.title}*\n${b.message}`.slice(0, 1500),
        apikey: b.whatsapp.apiKey,
      });
      const res = await fetch(`https://api.callmebot.com/whatsapp.php?${q}`);
      const text = await res.text();
      if (!res.ok || /invalid|error|not (?:allowed|activated)/i.test(text))
        throw new HttpError(502, `CallMeBot: ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}`);
      return Response.json({ ok: true });
    }

    if (b.channel === "ntfy") {
      if (!b.ntfy) throw new HttpError(400, "Set an ntfy topic in Settings.");
      assertPublicHttps(b.ntfy.server, "ntfy server");
      const headers: Record<string, string> = { Title: b.title, Tags: "bell" };
      // ntfy.sh supports delayed delivery up to 3 days out.
      if (at && at.getTime() > Date.now() + 60_000) headers.At = String(Math.floor(at.getTime() / 1000));
      const res = await fetch(`${b.ntfy.server.replace(/\/$/, "")}/${encodeURIComponent(b.ntfy.topic)}`, {
        method: "POST",
        headers,
        body: b.message,
      });
      if (!res.ok) throw new HttpError(502, `ntfy: ${(await res.text()).slice(0, 200)}`);
      return Response.json({ ok: true });
    }

    if (!b.twilio) throw new HttpError(400, "Set Twilio credentials in Settings.");
    const t = b.twilio;
    const form = new URLSearchParams({ To: t.to, Body: `${b.title}\n${b.message}`.slice(0, 1500) });
    if (t.messagingServiceSid) form.set("MessagingServiceSid", t.messagingServiceSid);
    else if (t.from) form.set("From", t.from);
    else throw new HttpError(400, "Twilio needs a From number or a Messaging Service SID.");
    if (at && at.getTime() > Date.now() + 15 * 60_000) {
      // Twilio scheduling requires a Messaging Service and 15 min – 35 days lead time.
      if (!t.messagingServiceSid) throw new HttpError(400, "Scheduled SMS requires a Twilio Messaging Service SID.");
      form.set("ScheduleType", "fixed");
      form.set("SendAt", at.toISOString());
    }
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${t.sid}:${t.token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const j = (await res.json()) as { message?: string; sid?: string };
    if (!res.ok) throw new HttpError(502, `Twilio: ${j.message ?? res.statusText}`);
    return Response.json({ ok: true, sid: j.sid });
  } catch (e) {
    return errorResponse(e);
  }
}

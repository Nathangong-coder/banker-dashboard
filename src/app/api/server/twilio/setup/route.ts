import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/http";
import { TWNUM, appUrl, authAccount, db, saveAccount, seal } from "@/lib/server/accounts";

const E164 = /^\+[1-9]\d{6,14}$/;
const Creds = z.object({
    sid: z.string().trim().regex(/^AC[0-9a-fA-F]{32}$/, "The Account SID starts with AC followed by 32 letters/digits (Twilio Console → Account info)."),
    token: z.string().trim().regex(/^[0-9a-fA-F]{32}$/, "The Auth Token is 32 letters/digits (Twilio Console → Account info → Auth Token, click Show)."),
    number: z.string().trim().regex(E164, "Write the Twilio number in +1XXXXXXXXXX form."),
    myPhone: z.string().trim().regex(E164, "Write your phone number in +1XXXXXXXXXX form."),
});

const INBOUND_PATH = "/api/server/twilio/inbound";

async function twilio<T>(sid: string, token: string, path: string, form?: Record<string, string>) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
    method: form ? "POST" : "GET",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const j = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (res.status === 401) throw new HttpError(400, "Twilio rejected the Account SID / Auth Token. Copy both again from the Twilio Console (Account info).");
  if (!res.ok) throw new HttpError(502, `Twilio: ${j.message ?? res.statusText}`);
  return j;
}

/**
 * Connect your own Twilio number for texting photos / names in: checks the credentials and that the number is on the
 * account, points the number's incoming-SMS webhook at Coverage, and stores the credentials sealed. Only texts from
 * `myPhone` are accepted. `{remove: true}` disconnects; `{check: true}` returns the current state.
 */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req);
    const raw = (await req.json().catch(() => ({}))) as { check?: boolean; remove?: boolean };
    if (raw.check) return Response.json({ ok: true, number: a.twilio?.number ?? null, myPhone: a.twilio?.myPhone ?? null });
    if (raw.remove) {
      if (a.twilio) {
        if ((await db().get<string>(TWNUM(a.twilio.number))) === a.id) await db().del(TWNUM(a.twilio.number));
        delete a.twilio;
        await saveAccount(a);
      }
      return Response.json({ ok: true, number: null });
    }
    const parsed = Creds.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Fill in all four Twilio fields.");
    const b = parsed.data;
    if (b.number === b.myPhone) throw new HttpError(400, "Your phone and the Twilio number must be different: you text the Twilio number from your phone.");
    const found = await twilio<{ incoming_phone_numbers?: { sid: string; phone_number: string; sms_url?: string }[] }>(
      b.sid,
      b.token,
      `/IncomingPhoneNumbers.json?${new URLSearchParams({ PhoneNumber: b.number })}`,
    );
    const pn = found.incoming_phone_numbers?.[0];
    if (!pn) throw new HttpError(400, `${b.number} isn't a number on this Twilio account. Check Twilio Console → Phone Numbers → Active numbers.`);
    const hook = `${appUrl(req)}${INBOUND_PATH}`;
    await twilio(b.sid, b.token, `/IncomingPhoneNumbers/${pn.sid}.json`, { SmsUrl: hook, SmsMethod: "POST" });

    const owner = await db().get<string>(TWNUM(b.number));
    if (a.twilio && a.twilio.number !== b.number && (await db().get<string>(TWNUM(a.twilio.number))) === a.id) await db().del(TWNUM(a.twilio.number));
    a.twilio = { sid: seal(b.sid), token: seal(b.token), number: b.number, myPhone: b.myPhone };
    await saveAccount(a);
    await db().set(TWNUM(b.number), a.id);
    return Response.json({ ok: true, number: b.number, myPhone: b.myPhone, movedFromOtherDashboard: !!owner && owner !== a.id });
  } catch (e) {
    return errorResponse(e);
  }
}

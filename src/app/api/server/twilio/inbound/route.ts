import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "@/lib/server/http";
import { TWNUM, addInboxItem, appUrl, db, loadAccount, newItemId, unseal } from "@/lib/server/accounts";
import { currentSession, infoSessionsBetween } from "@/lib/server/google";
import type { CaptureItem } from "@/lib/infoSessions";

export const maxDuration = 30;

// Twilio allows 5 MB, but the dashboard pulls items through a Vercel response (4.5 MB cap, base64 adds a third).
const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const twiml = (message?: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${esc(message)}</Message>` : ""}</Response>`, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });

/** Twilio's X-Twilio-Signature: base64 HMAC-SHA1 (auth token) of the full URL + every POST param, sorted by name, as name+value. */
function validSignature(token: string, url: string, params: URLSearchParams, signature: string) {
  const keys = [...new Set(params.keys())].sort();
  const data = url + keys.map((k) => params.getAll(k).map((v) => k + v).join("")).join("");
  const want = Buffer.from(createHmac("sha1", token).update(data, "utf8").digest("base64"));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * Twilio's incoming-SMS/MMS webhook for numbers connected in AutoSend (twilio/setup). A text from your own phone to
 * your Twilio number (photos of name tags / a sign-in sheet, or names typed) goes into the capture inbox, tagged with
 * the info session going on now or ended in the last 6 hours. Replies with a short confirmation.
 */
export async function POST(req: Request) {
  const params = new URLSearchParams(await req.text());
  const to = params.get("To") ?? "";
  const id = to ? await db().get<string>(TWNUM(to)) : null;
  const a = id ? await loadAccount(id) : null;
  if (!a?.twilio || a.twilio.number !== to) return new Response("Unknown number", { status: 404 });
  const sid = unseal(a.twilio.sid);
  const token = unseal(a.twilio.token);
  if (params.get("AccountSid") !== sid || !validSignature(token, `${appUrl(req)}/api/server/twilio/inbound`, params, req.headers.get("x-twilio-signature") ?? ""))
    return new Response("Bad signature", { status: 403 });
  if ((params.get("From") ?? "") !== a.twilio.myPhone) return twiml();

  try {
    const at = new Date().toISOString();
    let sessionId: string | undefined;
    let sessionTitle: string | undefined;
    if (a.google?.calendar) {
      try {
        const now = Date.now();
        const s = currentSession(await infoSessionsBetween(a, new Date(now - 12 * 3600_000).toISOString(), new Date(now + 3600_000).toISOString()), now, 6);
        sessionId = s?.eventId;
        sessionTitle = s?.title.replace(/\([^)]*\)/g, "").trim();
      } catch {
        /* no session: the dashboard asks which one */
      }
    }
    const items: CaptureItem[] = [];
    let skipped = 0;
    const n = Math.min(Number(params.get("NumMedia") ?? 0) || 0, 10);
    for (let i = 0; i < n; i++) {
      const url = params.get(`MediaUrl${i}`);
      const type = (params.get(`MediaContentType${i}`) ?? "").toLowerCase();
      if (!url || !/^image\/(jpeg|jpg|png|webp|gif)$/.test(type) || !url.startsWith("https://api.twilio.com/")) {
        skipped++;
        continue;
      }
      const res = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` } }).catch(() => null);
      const buf = res?.ok ? Buffer.from(await res.arrayBuffer()) : null;
      if (!buf || buf.length > MAX_MEDIA_BYTES) {
        skipped++;
        continue;
      }
      const mime = (res!.headers.get("content-type") ?? type).split(";")[0].replace("image/jpg", "image/jpeg");
      items.push({ id: newItemId(), at, via: "twilio", image: `data:${mime};base64,${buf.toString("base64")}`, ...(sessionId ? { sessionId } : {}) });
    }
    const body = (params.get("Body") ?? "").trim().slice(0, 5000);
    if (body) items.push({ id: newItemId(), at, via: "twilio", text: body, ...(sessionId ? { sessionId } : {}) });
    if (!items.length) return twiml(skipped ? "Coverage only takes photos (JPEG/PNG) under 3 MB and typed names. Nothing was saved." : "Send a photo of name tags or type the names, and Coverage will save them.");
    for (const it of items) await addInboxItem(a.id, it);
    const photos = items.filter((i) => i.image).length;
    const what = [photos ? `${photos} photo${photos > 1 ? "s" : ""}` : "", body ? "names" : ""].filter(Boolean).join(" + ");
    return twiml(
      `Got it: ${what}${sessionTitle ? ` for ${sessionTitle}` : ""}.${skipped ? ` (${skipped} attachment${skipped > 1 ? "s" : ""} skipped: photos only, under 3 MB.)` : ""} Open Coverage → Info sessions to confirm.`,
    );
  } catch (e) {
    return twiml(e instanceof HttpError ? e.message : "Coverage couldn't save that. Try again in a minute.");
  }
}

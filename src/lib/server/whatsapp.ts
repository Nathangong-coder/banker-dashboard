import "server-only";
import { HttpError } from "./http";
import { unseal, type Account } from "./accounts";

/** One WhatsApp message to the account's own number via CallMeBot (free, self-only, send-now). Throws on failure. */
export async function sendWhatsApp(a: Account, text: string) {
  if (!a.whatsapp) throw new HttpError(400, "WhatsApp isn't connected.");
  const q = new URLSearchParams({ phone: unseal(a.whatsapp.phone).replace(/[^\d+]/g, ""), apikey: unseal(a.whatsapp.apiKey), text: text.slice(0, 1500) });
  const res = await fetch(`https://api.callmebot.com/whatsapp.php?${q}`);
  const body = await res.text();
  if (!res.ok || /invalid|error|not (?:allowed|activated)/i.test(body)) throw new Error(`CallMeBot: ${body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)}`);
}

import { HttpError } from "@/lib/server/http";
import { addInboxItem, captureAccount, newItemId } from "@/lib/server/accounts";
import { currentSession, infoSessionsBetween } from "@/lib/server/google";
import type { CaptureItem } from "@/lib/infoSessions";

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A small page for the phone when the share can't be stored (the share sheet opens this as a normal page). */
function page(status: number, title: string, message: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Coverage</title>
<style>body{margin:0;background:#f5f4ef;color:#1a2230;font:15px/1.5 system-ui,-apple-system,sans-serif}main{max-width:480px;margin:0 auto;padding:32px 16px}h1{font-size:22px;color:#13233f;margin:0 0 8px}a{display:inline-block;margin-top:16px;background:#13233f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none}@media (prefers-color-scheme:dark){body{background:#10151f;color:#e6e8ec}h1{color:#e6e8ec}}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(message)}</p><a href="/capture">Open the capture page</a></main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function cookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

/**
 * The PWA share target (manifest `share_target`): photos / screenshots / text shared from the phone's share sheet go
 * into the inbox, authenticated by the cookie the capture page set. Images must already be ≤ 2.5 MB (the capture page
 * downscales; the share sheet sends originals), else a friendly page asks to use the capture page instead.
 */
export async function POST(req: Request) {
  let a;
  try {
    a = await captureAccount(cookie(req, "coverage_capture"));
  } catch {
    return page(401, "Open your capture link first", "This phone doesn't have your capture key yet (or it was replaced). Open the capture link from your dashboard or your WhatsApp reminder once, then share again.");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return page(400, "Nothing to save", "The share didn't include anything Coverage could read.");
  }
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
  const tooBig = files.filter((f) => f.size > MAX_IMAGE_BYTES).length;
  if (tooBig) return page(413, "Image too large", `${tooBig > 1 ? `${tooBig} images are` : "That image is"} over 2.5 MB. Open the capture page and add ${tooBig > 1 ? "them" : "it"} with “Choose screenshots”: it shrinks photos before sending.`);
  const notImage = files.filter((f) => !TYPES.has(f.type)).length;
  const text = ["title", "text", "url"]
    .map((k) => form.get(k))
    .filter((v): v is string => typeof v === "string" && !!v.trim())
    .map((v) => v.trim())
    .join("\n")
    .slice(0, 5000);
  const images = files.filter((f) => TYPES.has(f.type));
  if (!images.length && !text) return page(400, "Nothing to save", notImage ? "Only JPEG, PNG or WebP images can be shared." : "The share didn't include a photo or any text.");

  let sessionId: string | undefined;
  if (a.google?.calendar) {
    try {
      const now = Date.now();
      sessionId = currentSession(await infoSessionsBetween(a, new Date(now - 12 * 3600_000).toISOString(), new Date(now + 3600_000).toISOString()), now, 6)?.eventId;
    } catch {
      /* no session: the dashboard asks which one */
    }
  }
  const at = new Date().toISOString();
  const items: CaptureItem[] = [];
  for (const f of images) {
    const image = `data:${f.type};base64,${Buffer.from(await f.arrayBuffer()).toString("base64")}`;
    items.push({ id: newItemId(), at, via: "phone", image, ...(sessionId ? { sessionId } : {}) });
  }
  if (text) items.push({ id: newItemId(), at, via: "phone", text, ...(sessionId ? { sessionId } : {}) });
  let saved = 0;
  try {
    for (const it of items) {
      await addInboxItem(a.id, it);
      saved++;
    }
  } catch (e) {
    if (!saved) return page(e instanceof HttpError ? e.status : 500, "Couldn't save the share", e instanceof HttpError ? e.message : "The server couldn't store it. Try again in a minute.");
  }
  return new Response(null, { status: 303, headers: { Location: new URL(`/capture?shared=${saved}${saved < items.length ? `&skipped=${items.length - saved}` : ""}`, req.url).toString() } });
}

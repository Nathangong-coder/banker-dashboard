"use client";

import type { AppEmail } from "./appEmails";
import { pickVerificationLink } from "./appEmails";
import { EMAIL_FONTS, type EmailFont } from "./types";

/**
 * Gmail runs entirely in the browser: Google Identity Services gives us a short-lived
 * access token, and we call the Gmail REST API directly (it supports CORS).
 */

import { bodyToHtml, bodyToPlain, logoLineIndex, normalizeBody, normalizeSubject } from "./emailFormat";
import { dropServerGoogleToken, serverGoogleToken } from "./googleToken";
import { requireAccount } from "./session";

const SCOPES = "https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

type TokenClient = { requestAccessToken: (o?: { prompt?: string }) => void };
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (r: { access_token?: string; expires_in?: number; scope?: string; error?: string }) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

let token: { value: string; exp: number; clientId: string } | null = null;
const listeners = new Set<() => void>();

/** Fires whenever a fresh Gmail token is obtained (used to kick off background sync). */
export function onGmailConnected(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Google sign-in"));
    document.head.appendChild(s);
  });
}

export function gmailConnected(clientId?: string) {
  return !!token && token.exp > Date.now() && (!clientId || token.clientId === clientId);
}

export async function connectGmail(clientId: string, opts: { force?: boolean } = {}): Promise<string> {
  requireAccount("connect Google");
  if (!opts.force && gmailConnected(clientId)) return token!.value;
  // Signed in with Google connected: the server's connection gives the token, no popup.
  const fromServer = await serverGoogleToken(SCOPES.split(" "));
  if (fromServer) {
    const fresh = !token;
    token = { value: fromServer, exp: Date.now() + 45 * 60_000, clientId };
    if (fresh) setTimeout(() => listeners.forEach((l) => l()), 0);
    return fromServer;
  }
  if (!clientId) throw new Error("Connect Gmail in Settings first (it needs a Google OAuth Client ID).");
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error ?? "Google sign-in failed"));
        // Google lets people untick individual permissions; both are required.
        const granted = (r.scope ?? "").split(" ");
        const missing = SCOPES.split(" ").filter((sc) => !granted.includes(sc));
        if (missing.length)
          return reject(new Error(`access_denied: please tick both Gmail permissions (missing ${missing.map((m) => m.split("/").pop()).join(", ")}).`));
        token = { value: r.access_token, exp: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000, clientId };
        resolve(token.value);
        setTimeout(() => listeners.forEach((l) => l()), 0);
      },
      error_callback: (e) => reject(new Error(e.type === "popup_closed" ? "popup_closed" : (e.message ?? e.type))),
    });
    client.requestAccessToken();
  });
}

/** The signed-in Gmail address (also proves the Gmail API is enabled for the project). */
export async function gmailProfile(clientId: string) {
  const p = await gapi<{ emailAddress: string }>(clientId, "/profile");
  return p.emailAddress;
}

async function gapi<T>(clientId: string, path: string, init?: RequestInit): Promise<T> {
  const t = await connectGmail(clientId);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 401) {
    token = null;
    dropServerGoogleToken();
    throw new Error("Gmail session expired — click Connect Gmail again.");
  }
  if (!res.ok) throw new Error(`Gmail: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

function b64Bytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64Text = (s: string) => b64Bytes(new TextEncoder().encode(s));
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");
const toUrlSafe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export interface DraftInput {
  to: string;
  subject: string;
  body: string;
  attachment?: { name: string; type: string; data: ArrayBuffer };
  threadId?: string;
  inReplyTo?: string;
  /** CSS font-family stack for the HTML part. */
  font?: string;
  /**
   * Logo under the signature, sent as an inline image (multipart/related, cid:) so it shows without loading anything
   * from the web. Undefined = use the one saved in Settings → Email → Writing; null = none.
   */
  logo?: SignatureLogo | null;
}

export interface SignatureLogo {
  type: string;
  data: ArrayBuffer;
  width: number;
  alt?: string;
  link?: string;
  /** The signature's last line; the logo goes under it, and only when the body has it. */
  after: string;
}

const LOGO_CID = "signature-logo@coverage";

/**
 * RFC 2822 message for a Gmail draft: multipart/alternative (plain text + Gmail-style HTML so lines use
 * the full width), wrapped in multipart/mixed when there's an attachment. Every draft goes through here,
 * so the body is normalized here too.
 */
export function buildMime(d: DraftInput): string {
  const id = Math.random().toString(36).slice(2);
  const alt = `alt_${id}`;
  const mixed = `mix_${id}`;
  const body = d.body;
  const headers = [
    `To: ${d.to}`,
    `Subject: =?UTF-8?B?${b64Text(normalizeSubject(d.subject))}?=`,
    "MIME-Version: 1.0",
    ...(d.inReplyTo ? [`In-Reply-To: ${d.inReplyTo}`, `References: ${d.inReplyTo}`] : []),
  ];
  const part = (type: string, content: string) =>
    [`Content-Type: ${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", wrap76(b64Text(content))].join("\r\n");
  // The logo only goes in when the body has the signature (a reply without one gets no logo either).
  const logo = d.logo && logoLineIndex(normalizeBody(body).split("\n"), d.logo.after) >= 0 ? d.logo : undefined;
  const html = part("text/html", bodyToHtml(body, d.font, logo && { src: `cid:${LOGO_CID}`, width: logo.width, alt: logo.alt, link: logo.link, after: logo.after }));
  const rel = `rel_${id}`;
  const htmlPart = logo
    ? [
        `Content-Type: multipart/related; boundary="${rel}"`,
        "",
        `--${rel}`,
        html,
        `--${rel}`,
        `Content-Type: ${logo.type}; name="logo"`,
        `Content-ID: <${LOGO_CID}>`,
        `Content-Disposition: inline; filename="logo"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrap76(b64Bytes(new Uint8Array(logo.data))),
        `--${rel}--`,
      ].join("\r\n")
    : html;
  const alternative = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    part("text/plain", bodyToPlain(body).replace(/\n/g, "\r\n")),
    `--${alt}`,
    htmlPart,
    `--${alt}--`,
  ].join("\r\n");
  if (!d.attachment) return [...headers, alternative].join("\r\n");
  const a = d.attachment;
  const safeName = a.name.replace(/["\r\n]/g, "");
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    alternative,
    `--${mixed}`,
    `Content-Type: ${a.type || "application/octet-stream"}; name="${safeName}"`,
    `Content-Disposition: attachment; filename="${safeName}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64Bytes(new Uint8Array(a.data))),
    `--${mixed}--`,
  ].join("\r\n");
}

export async function createDraft(clientId: string, d: DraftInput) {
  const raw = toUrlSafe(b64Text(buildMime(d)));
  return gapi<{ id: string; message: { id: string; threadId: string } }>(clientId, "/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw, ...(d.threadId ? { threadId: d.threadId } : {}) } }),
  });
}

/** Does this Gmail draft still exist? (It disappears when it's sent or deleted.) */
export async function draftExists(clientId: string, id: string): Promise<boolean> {
  const t = await connectGmail(clientId);
  const res = await fetch(`${API}/drafts/${encodeURIComponent(id)}?format=minimal`, { headers: { Authorization: `Bearer ${t}` } });
  if (res.status === 404) return false;
  if (res.status === 401) {
    token = null;
    dropServerGoogleToken();
    throw new Error("Gmail session expired — click Connect Gmail again.");
  }
  if (!res.ok) throw new Error(`Gmail: ${(await res.text()).slice(0, 200)}`);
  return true;
}

/** Delete a draft from Gmail (only ever called from an explicit button). Already gone counts as done. */
export async function deleteDraft(clientId: string, id: string) {
  const t = await connectGmail(clientId);
  const res = await fetch(`${API}/drafts/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok && res.status !== 404) throw new Error(`Gmail: ${(await res.text()).slice(0, 200)}`);
}

/** Replace the Gmail draft's content if it still exists, otherwise create a new one (so re-sending never duplicates). */
export async function upsertDraft(clientId: string, existingId: string | undefined, input: DraftInput) {
  const d = input.logo === undefined ? { ...input, logo: await savedSignatureLogo() } : input;
  if (existingId && (await draftExists(clientId, existingId))) {
    const raw = toUrlSafe(b64Text(buildMime(d)));
    return gapi<{ id: string; message: { id: string; threadId: string } }>(clientId, `/drafts/${encodeURIComponent(existingId)}`, {
      method: "PUT",
      body: JSON.stringify({ id: existingId, message: { raw, ...(d.threadId ? { threadId: d.threadId } : {}) } }),
    });
  }
  return createDraft(clientId, d);
}

type MsgMeta = {
  id: string;
  threadId: string;
  internalDate: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
};

async function listMessages(clientId: string, q: string, max = 10) {
  const r = await gapi<{ messages?: { id: string; threadId: string }[] }>(
    clientId,
    `/messages?q=${encodeURIComponent(q)}&maxResults=${max}`,
  );
  return r.messages ?? [];
}

async function getMeta(clientId: string, id: string) {
  return gapi<MsgMeta>(
    clientId,
    `/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-ID`,
  );
}

export interface SyncResult {
  sentCount: number;
  /** Emails sent before their first reply (1 = first email only, 2 = one follow-up, …). */
  outreachCount: number;
  firstSentAt?: string;
  lastSentAt?: string;
  threadId?: string;
  lastMessageId?: string;
  subject?: string;
  repliedAt?: string;
  /** The latest email you sent them, replies after their reply included (thank-yous, check-ins). */
  lastEmailedAt?: string;
  /** Their latest real (not auto-reply) email to you. */
  lastHeardAt?: string;
  /** The next email queued with Gmail's Schedule send (not sent yet). */
  scheduledAt?: string;
  /** A delivery-failure notice for our email came back. */
  bouncedAt?: string;
  /** An auto-reply says they've left (follow-ups stop; it isn't a reply). */
  leftNote?: string;
  /** Their first reply reads like a clear no (you confirm it on Follow-ups before anything changes). */
  declineNote?: string;
}

const AUTO_REPLY = /^(automatic reply|auto[- ]?reply|autoreply|out of (?:the )?office|ooo\b)/i;
const LEFT = /\b(no longer (?:with|at|employed|working)|has left|have left|left the (?:firm|company|bank)|last day (?:at|with))\b/i;

const header = (m: MsgMeta, n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value;
const when = (m: MsgMeta) => Number(m.internalDate);

/**
 * When we emailed someone and whether they wrote back. Follow-ups are counted only up to their first
 * reply, so back-and-forth scheduling emails don't inflate "follow-ups sent".
 */
export async function syncContact(clientId: string, email: string, aliases: string[] = []): Promise<SyncResult> {
  // Every address they've used (aliases come from the server's tracking), and To, Cc or Bcc: a thank-you you sent with
  // them in Bcc, or to the new address they reply from, still counts.
  const all = [email, ...aliases.filter((a) => a.toLowerCase() !== email.toLowerCase())].slice(0, 4);
  const [sent, replies, bounces, scheduled] = await Promise.all([
    listMessages(clientId, `in:sent {${all.flatMap((e) => [`to:${e}`, `cc:${e}`, `bcc:${e}`]).join(" ")}}`, 20),
    listMessages(clientId, `{${all.map((e) => `from:${e}`).join(" ")}}`, 10),
    listMessages(clientId, `from:(mailer-daemon OR postmaster) "${email}"`, 2),
    listMessages(clientId, `in:scheduled to:${email}`, 3),
  ]);
  const now = Date.now();
  // A scheduled send carries its future send time and no SENT label; it isn't "emailed" until it goes out.
  const sentMeta = (await Promise.all(sent.map((m) => getMeta(clientId, m.id))))
    .filter((m) => (!m.labelIds || m.labelIds.includes("SENT")) && !m.labelIds?.includes("SCHEDULED") && when(m) <= now)
    .sort((a, b) => when(a) - when(b));
  const out: SyncResult = { sentCount: sentMeta.length, outreachCount: 0 };
  const queued = (await Promise.all(scheduled.map((m) => getMeta(clientId, m.id)))).filter((m) => when(m) > now).sort((a, b) => when(a) - when(b));
  if (queued.length) out.scheduledAt = new Date(when(queued[0])).toISOString();
  if (!sentMeta.length) {
    if (replies.length) out.repliedAt = new Date(when(await getMeta(clientId, replies[0].id))).toISOString();
    return out;
  }
  const first = sentMeta[0];
  const allReplies = (await Promise.all(replies.map((m) => getMeta(clientId, m.id)))).filter((m) => when(m) > when(first)).sort((a, b) => when(a) - when(b));
  // Out-of-office auto-replies aren't replies; one that says they've left stops the follow-ups.
  const auto = (m: MsgMeta) => AUTO_REPLY.test(header(m, "Subject") ?? "");
  const replyMeta = allReplies.filter((m) => !auto(m));
  const left = allReplies.find((m) => auto(m) && LEFT.test(m.snippet ?? ""));
  if (left) out.leftNote = (left.snippet ?? "").slice(0, 160);
  const bounce = (await Promise.all(bounces.map((m) => getMeta(clientId, m.id)))).find((m) => when(m) > when(first));
  if (bounce) out.bouncedAt = new Date(when(bounce)).toISOString();
  const firstReply = replyMeta[0];
  const outreach = firstReply ? sentMeta.filter((m) => when(m) < when(firstReply)) : sentMeta;
  const last = outreach[outreach.length - 1] ?? first;
  out.outreachCount = outreach.length;
  out.firstSentAt = new Date(when(first)).toISOString();
  out.lastSentAt = new Date(when(last)).toISOString();
  out.threadId = last.threadId;
  out.lastMessageId = header(last, "Message-ID");
  out.subject = header(first, "Subject");
  if (firstReply) out.repliedAt = new Date(when(firstReply)).toISOString();
  out.lastEmailedAt = new Date(when(sentMeta[sentMeta.length - 1])).toISOString();
  const lastReply = replyMeta[replyMeta.length - 1];
  if (lastReply) out.lastHeardAt = new Date(when(lastReply)).toISOString();
  if (firstReply && looksLikeDecline(firstReply.snippet ?? "")) out.declineNote = (firstReply.snippet ?? "").slice(0, 200);
  return out;
}

// A clear no. Deliberately narrow: "unfortunately I'm busy this week, but next week works" is a yes, so anything with a
// positive signal isn't counted, and the owner confirms each one.
const DECLINE = /\b(not able to help|unable to help|can'?t help|cannot help|won'?t be able to (help|chat|connect|take)|not in a position to|no longer (recruiting|involved|with)|not (involved|part of) (in )?recruiting|reach out to (our |the )?(recruiting|campus|hr)|not the right person|don'?t have the (time|bandwidth|capacity)|not taking (calls|coffee chats|meetings)|have to (pass|decline)|going to (pass|decline)|respectfully decline|i'?ll pass|not able to (chat|connect|take (a )?calls?))\b/i;
const POSITIVE = /\b(happy to|glad to|would love to|let'?s (find|chat|set|connect)|free (on|at|this|next)|works for me|available (on|at|this|next)|send (me )?(some )?times|feel free to (grab|book|schedule))\b/i;
export const looksLikeDecline = (text: string) => DECLINE.test(text) && !POSITIVE.test(text);

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };

function htmlOf(p: Part | undefined): string {
  if (!p) return "";
  if (p.mimeType === "text/html" && p.body?.data) {
    const b64 = p.body.data.replace(/-/g, "+").replace(/_/g, "/");
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  }
  return (p.parts ?? []).map(htmlOf).find(Boolean) ?? "";
}

/**
 * The font the first email to this person actually went out in (read from its HTML), for tagging emails sent before
 * font tracking existed. Gmail's default (no font-family in the HTML) counts as "sans". Undefined if nothing was sent
 * or the email was plain text.
 */
export async function detectSentFont(clientId: string, email: string): Promise<{ font?: EmailFont; sentAt?: string }> {
  const sent = await listMessages(clientId, `in:sent to:${email}`, 10);
  if (!sent.length) return {};
  const metas = (await Promise.all(sent.map((m) => getMeta(clientId, m.id)))).sort((a, b) => when(a) - when(b));
  const first = metas[0];
  const full = await gapi<{ payload?: Part }>(clientId, `/messages/${first.id}?format=full`);
  const html = htmlOf(full.payload);
  const sentAt = new Date(when(first)).toISOString();
  if (!html) return { sentAt };
  // Gmail stores quotes inside style attributes as &quot;, so decode before reading the font list.
  const family = html.replace(/&quot;/g, '"').match(/font-family:\s*((?:"[^"]*"|'[^']*'|[^;"'>])+)/i)?.[1] ?? "";
  const firstFamily = family.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
  if (!firstFamily) return { font: "sans", sentAt };
  const hit = (Object.entries(EMAIL_FONTS) as [EmailFont, { css: string }][]).find(
    ([, v]) => v.css.split(",")[0].replace(/["']/g, "").trim().toLowerCase() === firstFamily,
  );
  return { font: hit?.[0] ?? (/(arial|helvetica|sans)/.test(firstFamily) ? "sans" : /(times|serif)/.test(firstFamily) ? "serif" : undefined), sentAt };
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Parse a To/Cc header into [{ name, email }]. */
export function parseAddresses(h: string): { name: string; email: string }[] {
  const out: { name: string; email: string }[] = [];
  const re = /(?:"([^"]*)"\s*|([^"<,]*?)\s*)<([^<>\s]+@[^<>\s]+)>|([^\s,<>"]+@[^\s,<>"]+)/g;
  for (const m of h.matchAll(re)) out.push({ name: (m[1] ?? m[2] ?? "").trim(), email: (m[3] ?? m[4]).toLowerCase() });
  return out;
}

/** Does this address plausibly belong to First Last? Display-name match, or first/last in the mailbox name. */
export function addressMatches(a: { name: string; email: string }, first: string, last: string) {
  const f = normName(first);
  const l = normName(last);
  if (!f || !l) return false;
  const dn = ` ${normName(a.name)} `;
  if (dn.includes(` ${f} `) && dn.includes(` ${l} `)) return true;
  const local = a.email.split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  const fl = f.replace(/ /g, "");
  const ll = l.replace(/ /g, "");
  return local.includes(ll) && (local.includes(fl) || local.startsWith(fl[0]) || local.endsWith(fl[0]));
}

/**
 * To-recipients of everything you sent since `sinceDay` (YYYY/MM/DD), for lib/offSheet.ts. Messages in `skip` (read
 * by an earlier scan) aren't fetched again. Capped at `max` messages, newest first.
 */
export async function sentRecipients(clientId: string, sinceDay: string, skip: Set<string>, max = 800) {
  const ids: string[] = [];
  let page = "";
  do {
    const r = await gapi<{ messages?: { id: string }[]; nextPageToken?: string }>(
      clientId,
      `/messages?q=${encodeURIComponent(`in:sent after:${sinceDay}`)}&maxResults=500${page ? `&pageToken=${page}` : ""}`,
    );
    ids.push(...(r.messages ?? []).map((m) => m.id));
    page = r.nextPageToken ?? "";
  } while (page && ids.length < max);
  const fresh = ids.slice(0, max).filter((id) => !skip.has(id));
  const out: { email: string; name: string; at: number; subject: string; threadId: string }[] = [];
  const read: string[] = [];
  let i = 0;
  const worker = async () => {
    while (i < fresh.length) {
      const id = fresh[i++];
      const m = await gapi<MsgMeta>(clientId, `/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject`);
      read.push(id);
      // A message Schedule-send hasn't sent yet isn't an email to follow up on.
      if (m.labelIds?.includes("SCHEDULED") || when(m) > Date.now()) continue;
      for (const a of parseAddresses(header(m, "To") ?? "")) out.push({ ...a, at: when(m), subject: header(m, "Subject") ?? "", threadId: m.threadId });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { recipients: out, read, total: ids.length };
}

/**
 * Find the address we emailed a person at, by searching Sent mail for their name. Only returns an
 * address whose display name or mailbox matches the person, so a wrong "missing" fill is unlikely.
 */
export async function findEmailByName(clientId: string, first: string, last: string): Promise<string | null> {
  if (!first || !last) return null;
  for (const q of [`in:sent to:"${first} ${last}"`, `in:sent "${first} ${last}"`, `in:sent to:${last}`]) {
    const msgs = await listMessages(clientId, q, 5);
    for (const m of msgs) {
      const meta = await gapi<MsgMeta>(clientId, `/messages/${m.id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`);
      const addrs = [header(meta, "To"), header(meta, "Cc")].filter(Boolean).flatMap((h) => parseAddresses(h!));
      const hit = addrs.find((a) => addressMatches(a, first, last));
      if (hit) return hit.email;
    }
  }
  return null;
}

/* ---------------- reading their latest reply (scheduling) ---------------- */

function partText(p: Part | undefined, mime: string): string {
  if (!p) return "";
  if (p.mimeType === mime && p.body?.data) {
    const b64 = p.body.data.replace(/-/g, "+").replace(/_/g, "/");
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  }
  return (p.parts ?? []).map((x) => partText(x, mime)).find(Boolean) ?? "";
}

const htmlToText = (html: string) =>
  html
    .replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/** Their new text only: cut at "On … wrote:", "From: … Sent:", or the first quoted line. */
export function stripQuoted(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*>/.test(l)) break;
    if (/^On .{5,200}wrote:\s*$/i.test(l) || (/^On .{5,200}$/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] ?? ""))) break;
    if (/^\s*(From|De|Von):\s.+/i.test(l) && lines.slice(i, i + 4).some((x) => /^\s*(Sent|Date|To|Subject):/i.test(x))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l)) break;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface TheirMessage {
  id: string;
  threadId: string;
  /** RFC Message-ID, for In-Reply-To. */
  messageId?: string;
  subject: string;
  date: string;
  /** Their new text (quoted history removed), plus the full text for finding a phone number in the signature. */
  text: string;
  full: string;
}

/** The most recent email from this address (needs the Gmail read permission the app already has). */
export async function latestFrom(clientId: string, email: string): Promise<TheirMessage | null> {
  const list = await listMessages(clientId, `from:${email}`, 1);
  if (!list.length) return null;
  const m = await gapi<MsgMeta & { payload?: Part & { headers?: { name: string; value: string }[] } }>(clientId, `/messages/${list[0].id}?format=full`);
  const plain = partText(m.payload, "text/plain");
  const full = (plain || htmlToText(partText(m.payload, "text/html"))).trim();
  return {
    id: m.id,
    threadId: m.threadId,
    messageId: header(m, "Message-ID"),
    subject: header(m, "Subject") ?? "",
    date: new Date(when(m)).toISOString(),
    text: stripQuoted(full).slice(0, 6000),
    full: full.slice(0, 20000),
  };
}

/* ---------------- what's waiting to go out (drafts + scheduled) ---------------- */

export interface Outgoing {
  kind: "draft" | "scheduled";
  /** Message id (labels go on messages); `draftId` for drafts. */
  messageId: string;
  draftId?: string;
  to: string[];
  subject: string;
  /** Send time for scheduled messages. */
  at?: string;
}

const addrs = (h?: string) => (h ? parseAddresses(h).map((a) => a.email) : []);

/** Every Gmail draft and scheduled message (up to `max` of each), with recipients and subject. */
export async function outgoingQueue(clientId: string, max = 100): Promise<Outgoing[]> {
  const drafts = await gapi<{ drafts?: { id: string; message: { id: string } }[] }>(clientId, `/drafts?maxResults=${max}`);
  const scheduled = await listMessages(clientId, "in:scheduled", max);
  const meta = (id: string) => gapi<MsgMeta>(clientId, `/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`);
  const out: Outgoing[] = [];
  const run = async <T,>(items: T[], fn: (x: T) => Promise<void>) => {
    for (let i = 0; i < items.length; i += 8) await Promise.all(items.slice(i, i + 8).map(fn));
  };
  await run(drafts.drafts ?? [], async (d) => {
    const m = await meta(d.message.id).catch(() => null);
    if (m) out.push({ kind: "draft", messageId: m.id, draftId: d.id, to: [...addrs(header(m, "To")), ...addrs(header(m, "Cc"))], subject: header(m, "Subject") ?? "" });
  });
  await run(scheduled, async (s) => {
    const m = await meta(s.id).catch(() => null);
    if (m) out.push({ kind: "scheduled", messageId: m.id, to: [...addrs(header(m, "To")), ...addrs(header(m, "Cc"))], subject: header(m, "Subject") ?? "", at: new Date(when(m)).toISOString() });
  });
  return out;
}

/* Labelling in Gmail needs the "modify" permission, asked for separately (only when you click "Label them in Gmail"). */
const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
let modifyToken: { value: string; exp: number } | null = null;

async function connectModify(clientId: string): Promise<string> {
  if (modifyToken && modifyToken.exp > Date.now()) return modifyToken.value;
  await loadGis();
  return new Promise((resolve, reject) => {
    window.google!.accounts.oauth2
      .initTokenClient({
        client_id: clientId,
        scope: MODIFY,
        callback: (r) => {
          if (r.error || !r.access_token || !(r.scope ?? "").includes(MODIFY)) return reject(new Error(r.error ?? "Gmail label permission wasn't granted."));
          modifyToken = { value: r.access_token, exp: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000 };
          resolve(modifyToken.value);
        },
        error_callback: (e) => reject(new Error(e.type === "popup_closed" ? "The Google window was closed." : (e.message ?? e.type))),
      })
      .requestAccessToken();
  });
}

/** Put a red "⚠ VP+ check" label on these messages (drafts or scheduled) so the warning shows inside Gmail too. */
export async function labelInGmail(clientId: string, messageIds: string[], name = "⚠ VP+ check") {
  const t = await connectModify(clientId);
  const call = async <T,>(path: string, init?: RequestInit) => {
    const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`Gmail: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  };
  const labels = await call<{ labels: { id: string; name: string }[] }>("/labels");
  const id =
    labels.labels.find((l) => l.name === name)?.id ??
    (await call<{ id: string }>("/labels", {
      method: "POST",
      body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show", color: { backgroundColor: "#cc3a21", textColor: "#ffffff" } }),
    })).id;
  for (const m of messageIds) await call(`/messages/${m}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: [id] }) });
  return messageIds.length;
}

// The saved logo comes from the store (blob + settings); it's plugged in by Shell so this file stays store-free
// (scripts import it outside the browser).
let logoSource: () => Promise<SignatureLogo | undefined> = async () => undefined;
export function setSignatureLogoSource(fn: () => Promise<SignatureLogo | undefined>) {
  logoSource = fn;
}
async function savedSignatureLogo() {
  try {
    return (await logoSource()) ?? null;
  } catch {
    return null;
  }
}

/* ---------------- application emails (Applications → Check Gmail) ---------------- */

/** Application emails (lib/appEmails.ts#applicationQuery) you haven't read yet: sender, subject, date, text. */
export async function applicationEmails(clientId: string, q: string, skip: Set<string>, max = 120): Promise<AppEmail[]> {
  const list = await listMessages(clientId, q, Math.min(max * 2, 500));
  const fresh = list.filter((m) => !skip.has(m.id)).slice(0, max);
  const out: AppEmail[] = [];
  for (let i = 0; i < fresh.length; i += 8)
    await Promise.all(
      fresh.slice(i, i + 8).map(async (s) => {
        const m = await gapi<MsgMeta & { payload?: Part & { headers?: { name: string; value: string }[] } }>(clientId, `/messages/${s.id}?format=full`).catch(() => null);
        if (!m) return;
        const plain = partText(m.payload, "text/plain");
        const text = (plain || htmlToText(partText(m.payload, "text/html"))).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        out.push({ id: m.id, threadId: m.threadId, from: header(m, "From") ?? "", subject: header(m, "Subject") ?? "", date: new Date(when(m)).toISOString(), text: stripQuoted(text).slice(0, 3000) });
      }),
    );
  return out;
}

/**
 * Put labels on messages: { "Applications/Summer 2027": [ids…] }. Labels (and the "Applications" parent, so Gmail nests
 * them) are created when missing. Needs the modify permission (asked on click).
 */
export async function labelMessages(clientId: string, byLabel: Record<string, string[]>) {
  const t = await connectModify(clientId);
  const call = async <T,>(path: string, init?: RequestInit) => {
    const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`Gmail: ${(await res.text()).slice(0, 200)}`);
    // batchModify answers 204 with no body.
    const body = await res.text();
    return (body ? JSON.parse(body) : {}) as T;
  };
  const labels = (await call<{ labels: { id: string; name: string }[] }>("/labels")).labels;
  const idOf = async (name: string) =>
    labels.find((l) => l.name === name)?.id ??
    (await call<{ id: string; name: string }>("/labels", { method: "POST", body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }) }).then((l) => {
      labels.push(l);
      return l.id;
    }));
  let n = 0;
  for (const [name, ids] of Object.entries(byLabel)) {
    if (!ids.length) continue;
    if (name.includes("/")) await idOf(name.split("/")[0]);
    const id = await idOf(name);
    for (let i = 0; i < ids.length; i += 1000) {
      await call("/messages/batchModify", { method: "POST", body: JSON.stringify({ ids: ids.slice(i, i + 1000), addLabelIds: [id] }) });
      n += ids.slice(i, i + 1000).length;
    }
  }
  return n;
}

/* ---------------- account verification emails (Applications → created accounts) ---------------- */

/**
 * The verification / activation link in the newest email from an application site since `sinceMs`: only an https
 * link on the same site (its registrable domain, e.g. myworkdayjobs.com / myworkday.com for Workday) and worded like
 * a verification. Null if there's none yet. Never follows anything itself.
 */
export async function verificationLink(clientId: string, siteHost: string, sinceMs: number): Promise<string | null> {
  const after = Math.floor((sinceMs - 120_000) / 1000);
  const q = `after:${after} (verify OR verification OR activate OR activation OR confirm OR "create your account" OR "complete your registration")`;
  const list = await listMessages(clientId, q, 10);
  for (const m of list) {
    const full = await gapi<MsgMeta & { payload?: Part & { headers?: { name: string; value: string }[] } }>(clientId, `/messages/${m.id}?format=full`).catch(() => null);
    if (!full || Number(full.internalDate) < sinceMs - 120_000) continue;
    const link = pickVerificationLink(partText(full.payload, "text/html"), partText(full.payload, "text/plain"), siteHost);
    if (link) return link;
  }
  return null;
}

/** Can Gmail be read without opening Google's window (a token in this tab, or your connected Google account)? */
export async function gmailReadableQuietly(clientId: string): Promise<boolean> {
  if (gmailConnected(clientId)) return true;
  return !!(await serverGoogleToken(SCOPES.split(" ")).catch(() => null));
}

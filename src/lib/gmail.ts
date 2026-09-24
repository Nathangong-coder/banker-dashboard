"use client";

/**
 * Gmail runs entirely in the browser: Google Identity Services gives us a short-lived
 * access token, and we call the Gmail REST API directly (it supports CORS).
 */

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
  if (!opts.force && gmailConnected(clientId)) return token!.value;
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
}

export function buildMime(d: DraftInput): string {
  const boundary = `bd_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `To: ${d.to}`,
    `Subject: =?UTF-8?B?${b64Text(d.subject)}?=`,
    "MIME-Version: 1.0",
    ...(d.inReplyTo ? [`In-Reply-To: ${d.inReplyTo}`, `References: ${d.inReplyTo}`] : []),
  ];
  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64Text(d.body)),
  ].join("\r\n");
  if (!d.attachment) return [...headers, textPart].join("\r\n");
  const a = d.attachment;
  const safeName = a.name.replace(/["\r\n]/g, "");
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    textPart,
    `--${boundary}`,
    `Content-Type: ${a.type || "application/octet-stream"}; name="${safeName}"`,
    `Content-Disposition: attachment; filename="${safeName}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64Bytes(new Uint8Array(a.data))),
    `--${boundary}--`,
  ].join("\r\n");
}

export async function createDraft(clientId: string, d: DraftInput) {
  const raw = toUrlSafe(b64Text(buildMime(d)));
  return gapi<{ id: string; message: { id: string; threadId: string } }>(clientId, "/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw, ...(d.threadId ? { threadId: d.threadId } : {}) } }),
  });
}

type MsgMeta = {
  id: string;
  threadId: string;
  internalDate: string;
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
}

const header = (m: MsgMeta, n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value;
const when = (m: MsgMeta) => Number(m.internalDate);

/**
 * When we emailed someone and whether they wrote back. Follow-ups are counted only up to their first
 * reply, so back-and-forth scheduling emails don't inflate "follow-ups sent".
 */
export async function syncContact(clientId: string, email: string): Promise<SyncResult> {
  const [sent, replies] = await Promise.all([
    listMessages(clientId, `in:sent to:${email}`, 15),
    listMessages(clientId, `from:${email}`, 5),
  ]);
  const out: SyncResult = { sentCount: sent.length, outreachCount: 0 };
  const sentMeta = (await Promise.all(sent.map((m) => getMeta(clientId, m.id)))).sort((a, b) => when(a) - when(b));
  if (!sentMeta.length) {
    if (replies.length) out.repliedAt = new Date(when(await getMeta(clientId, replies[0].id))).toISOString();
    return out;
  }
  const first = sentMeta[0];
  const replyMeta = (await Promise.all(replies.map((m) => getMeta(clientId, m.id)))).filter((m) => when(m) > when(first)).sort((a, b) => when(a) - when(b));
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
  return out;
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

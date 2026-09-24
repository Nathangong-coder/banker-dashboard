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
            callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

let token: { value: string; exp: number } | null = null;

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

export function gmailConnected() {
  return !!token && token.exp > Date.now();
}

export async function connectGmail(clientId: string): Promise<string> {
  if (gmailConnected()) return token!.value;
  if (!clientId) throw new Error("Add a Google OAuth Client ID in Settings to connect Gmail.");
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error ?? "Google sign-in failed"));
        token = { value: r.access_token, exp: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000 };
        resolve(token.value);
      },
      error_callback: (e) => reject(new Error(e.message ?? e.type)),
    });
    client.requestAccessToken();
  });
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
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    textPart,
    `--${boundary}`,
    `Content-Type: ${a.type || "application/octet-stream"}; name="${a.name}"`,
    `Content-Disposition: attachment; filename="${a.name}"`,
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
  firstSentAt?: string;
  lastSentAt?: string;
  threadId?: string;
  lastMessageId?: string;
  subject?: string;
  repliedAt?: string;
}

/** Look at Sent mail and inbox to learn when we emailed someone and whether they wrote back. */
export async function syncContact(clientId: string, email: string): Promise<SyncResult> {
  const [sent, replies] = await Promise.all([
    listMessages(clientId, `in:sent to:${email}`, 10),
    listMessages(clientId, `from:${email}`, 1),
  ]);
  const out: SyncResult = { sentCount: sent.length };
  if (sent.length) {
    const metas = await Promise.all(sent.map((m) => getMeta(clientId, m.id)));
    metas.sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    const first = metas[0];
    const last = metas[metas.length - 1];
    const h = (m: MsgMeta, n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value;
    out.firstSentAt = new Date(Number(first.internalDate)).toISOString();
    out.lastSentAt = new Date(Number(last.internalDate)).toISOString();
    out.threadId = last.threadId;
    out.lastMessageId = h(last, "Message-ID");
    out.subject = h(first, "Subject");
  }
  if (replies.length) {
    const m = await getMeta(clientId, replies[0].id);
    out.repliedAt = new Date(Number(m.internalDate)).toISOString();
  }
  return out;
}

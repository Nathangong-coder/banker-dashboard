"use client";

import { docJsonText, driveQueries, type DocsJson, type DriveDoc } from "./docMatch";

/**
 * Google Docs in the browser, for people without automatic sending (whose server connection reads docs with no popup,
 * api/server/docs). Like lib/gcal.ts: its own Google Identity Services token with read-only Docs + Drive file names,
 * asked for on a click ("Link Google Docs" on the Activity log), held for this page session only.
 * The Google Cloud project needs the Google Docs API and the Google Drive API enabled.
 */

const SCOPES = ["https://www.googleapis.com/auth/documents.readonly", "https://www.googleapis.com/auth/drive.metadata.readonly"];

let token: { value: string; exp: number; clientId: string } | null = null;

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

export const docsConnected = (clientId?: string) => !!token && token.exp > Date.now() && (!clientId || token.clientId === clientId);

export async function connectDocs(clientId: string): Promise<string> {
  if (docsConnected(clientId)) return token!.value;
  if (!clientId) throw new Error("Connect Gmail in Settings first (Google Docs uses the same Google sign-in).");
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES.join(" "),
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error ?? "Google sign-in failed"));
        const granted = (r.scope ?? "").split(" ");
        if (!SCOPES.every((s) => granted.includes(s))) return reject(new Error("Please tick both permissions (see your Google Docs, and see your Drive file names)."));
        token = { value: r.access_token, exp: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000, clientId };
        resolve(token.value);
      },
      error_callback: (e) => reject(new Error(e.type === "popup_closed" ? "The Google window was closed." : (e.message ?? e.type))),
    });
    client.requestAccessToken();
  });
}

async function get<T>(clientId: string, url: string, what: string): Promise<T> {
  const t = await connectDocs(clientId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
  if (res.status === 401) {
    token = null;
    throw new Error("Google session expired. Try again.");
  }
  if (!res.ok) {
    const text = await res.text();
    if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(text))
      throw new Error(`The ${what} API isn't enabled for this app's Google project yet. Enable it in Google Cloud (APIs & Services → Library → ${what} API), then try again.`);
    if (res.status === 404) throw new Error("That doc doesn't exist or isn't shared with your Google account.");
    throw new Error(`${what}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

type DriveFile = { id: string; name: string; modifiedTime?: string; createdTime?: string; webViewLink?: string };

export async function searchDocsBrowser(clientId: string, name: string): Promise<DriveDoc[]> {
  const q = driveQueries(name);
  const list = async (query: string, via: "name" | "text") => {
    const p = new URLSearchParams({ q: query, pageSize: "15", fields: "files(id,name,modifiedTime,createdTime,webViewLink)", spaces: "drive", corpora: "user" });
    const r = await get<{ files?: DriveFile[] }>(clientId, `https://www.googleapis.com/drive/v3/files?${p}`, "Google Drive");
    return (r.files ?? []).map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, createdTime: f.createdTime, url: f.webViewLink ?? `https://docs.google.com/document/d/${f.id}/edit`, via }));
  };
  const [byName, byText] = await Promise.all([list(q.name, "name"), list(q.text, "text").catch(() => [])]);
  return [...byName, ...byText.filter((t) => !byName.some((n) => n.id === t.id))];
}

export async function readDocBrowser(clientId: string, id: string) {
  const d = await get<DocsJson>(clientId, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}?includeTabsContent=true`, "Google Docs");
  return docJsonText(d);
}

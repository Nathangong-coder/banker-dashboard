"use client";

import { useStore } from "./store";
import { googleClientId } from "./keys";
import { serverCall } from "./serverSync";
import { updateConversation } from "./conversationActions";
import { docIdOf, pickDoc, wantsDoc, type DriveDoc } from "./docMatch";
import { docsConnected, readDocBrowser, searchDocsBrowser } from "./gdocs";
import type { ChatLog, Contact } from "./types";

/**
 * Chats ↔ Google Docs (owner, 2026-10-23). Every coffee chat / call without a notes doc is looked up in your Drive
 * (lib/docMatch.ts picks), at most once a day per chat while nothing is found. Reads go through the server's
 * read-only Docs access when automatic sending is connected with it (no popup, private docs fine), else this
 * session's browser token (gdocs.ts, one click), else only link-shared docs via the public export.
 */

const DAY = 86_400_000;
const PER_RUN = 25;

type Backend = {
  find: (people: { key: string; name: string }[]) => Promise<{ found: Record<string, DriveDoc[]>; error?: string }>;
  read: (id: string) => Promise<string>;
};

let serverDocs: boolean | undefined;

function serverBackend(): Backend {
  return {
    find: async (find) => {
      const r = await serverCall<{ docs: boolean; found?: Record<string, DriveDoc[]>; error?: string }>("/api/server/docs", { find });
      serverDocs = r.docs;
      if (!r.docs) throw new Error("no-server-docs");
      return { found: r.found ?? {}, error: r.error };
    },
    read: async (id) => {
      const r = await serverCall<{ docs: boolean; texts?: Record<string, { text?: string; error?: string }> }>("/api/server/docs", { read: [id] });
      serverDocs = r.docs;
      if (!r.docs) throw new Error("no-server-docs");
      const t = r.texts?.[id];
      if (t?.error) throw new Error(t.error);
      return t?.text ?? "";
    },
  };
}

function browserBackend(clientId: string): Backend {
  return {
    find: async (people) => {
      const found: Record<string, DriveDoc[]> = {};
      let error: string | undefined;
      for (const p of people) {
        try {
          found[p.key] = await searchDocsBrowser(clientId, p.name);
        } catch (e) {
          error ??= (e as Error).message;
          if (/isn't enabled|expired|closed/.test(error)) break;
        }
      }
      return { found, error };
    },
    read: (id) => readDocBrowser(clientId, id),
  };
}

/** Where docs can be read from right now. `interactive` = may open Google's window (only from a click). */
function backends(interactive: boolean): Backend[] {
  const s = useStore.getState();
  const out: Backend[] = [];
  if (s.settings.server?.email && serverDocs !== false) out.push(serverBackend());
  const clientId = googleClientId(s.settings);
  if (clientId && (interactive || docsConnected(clientId))) out.push(browserBackend(clientId));
  return out;
}

export const docsReadable = () => backends(false).length > 0;

/** Chats that still need a doc, newest first. */
function missing(contacts: Contact[], force: boolean, only?: string) {
  const now = Date.now();
  const out: { c: Contact; chat: ChatLog }[] = [];
  for (const c of contacts) {
    if (only && c.id !== only) continue;
    for (const chat of c.chats ?? []) {
      if (!wantsDoc(chat.kind) || chat.docUrl) continue;
      if (!force && chat.docCheckedAt && now - Date.parse(chat.docCheckedAt) < DAY) continue;
      out.push({ c, chat });
    }
  }
  return out.sort((a, b) => b.chat.at.localeCompare(a.chat.at));
}

export interface LinkResult {
  searched: number;
  linked: { name: string; doc: string; why: string }[];
  choices: number;
  error?: string;
  /** Nothing could search Drive (no server Docs access, no browser token). */
  unavailable?: boolean;
}

let inflight: Promise<LinkResult> | null = null;

/** Look for the notes doc of every chat that has none (or just `contactId`'s). Single-flight. */
export function linkChatDocs(opts: { interactive?: boolean; force?: boolean; contactId?: string } = {}): Promise<LinkResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    const todo = missing(useStore.getState().contacts, !!opts.force, opts.contactId);
    const people = [...new Map(todo.map((t) => [t.c.id, t.c])).values()].slice(0, PER_RUN);
    const result: LinkResult = { searched: people.length, linked: [], choices: 0 };
    if (!people.length) return result;
    let found: Record<string, DriveDoc[]> | undefined;
    for (const b of backends(!!opts.interactive)) {
      try {
        const r = await b.find(people.map((c) => ({ key: c.id, name: c.name })));
        found = r.found;
        result.error = r.error;
        break;
      } catch (e) {
        if ((e as Error).message !== "no-server-docs") result.error = (e as Error).message;
      }
    }
    if (!found) return { ...result, searched: 0, unavailable: !result.error };
    const at = new Date().toISOString();
    for (const { c, chat } of todo) {
      const docs = found[c.id];
      if (!docs) continue;
      const pick = pickDoc(docs, c.name, { bank: c.bank, chatAt: chat.at });
      if (pick && "doc" in pick) {
        updateConversation(c.id, chat.id, { docUrl: pick.doc.url, docSource: "drive", docCheckedAt: at, docChoices: undefined });
        result.linked.push({ name: c.name, doc: pick.doc.name, why: pick.why });
      } else if (pick) {
        updateConversation(c.id, chat.id, { docCheckedAt: at, docChoices: pick.candidates.map((d) => ({ id: d.id, name: d.name, url: d.url })) });
        result.choices++;
      } else updateConversation(c.id, chat.id, { docCheckedAt: at, docChoices: undefined });
    }
    return result;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Link a doc by hand (pasted link or one of the choices). */
export function setChatDoc(contactId: string, chatId: string, url: string | undefined) {
  if (url && !docIdOf(url)) throw new Error("Paste a Google Docs link (https://docs.google.com/document/d/…).");
  updateConversation(contactId, chatId, { docUrl: url || undefined, docSource: url ? "manual" : undefined, docChoices: undefined, docCheckedAt: url ? undefined : new Date().toISOString() });
}

const cache = new Map<string, Promise<string>>();

/** A doc's current text: the server or this session's token (private docs), else the public export (link-shared only). */
export function readChatDoc(url: string): Promise<string> {
  const id = docIdOf(url);
  if (!id) return Promise.resolve("");
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      for (const b of backends(false)) {
        try {
          const text = await b.read(id);
          if (text) return text;
        } catch {
          // next way
        }
      }
      const r = await fetch("/api/templates/gdoc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, format: "txt" }) }).catch(() => null);
      return r?.ok ? r.text() : "";
    })();
    cache.set(id, p);
    // Don't remember a failure (the doc may be shared, or Docs connected, a minute from now).
    void p.then((t) => t || cache.delete(id));
  }
  return p;
}

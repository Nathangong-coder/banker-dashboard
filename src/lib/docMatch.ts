/**
 * Linking chats to their Google Docs (owner, 2026-10-23). Pure: the browser (lib/chatDocs.ts) and the server
 * (api/server/docs) both use it. A chat's notes doc is found by searching your Drive for the person: a doc titled with
 * their name ("Benjamin Hon coffee chat", "Hon, Benjamin - Mizuho") wins; otherwise a single doc that mentions their
 * full name in the text (a running "Coffee chat notes" doc) is used, and `docSection` later reads only their part.
 * Ambiguous results are never linked on their own: the log page shows the choices. `npm run check:mentions` covers it.
 */

export interface DriveDoc {
  id: string;
  name: string;
  url: string;
  modifiedTime?: string;
  createdTime?: string;
  /** How the search found it: the title has their name, or only the text does. */
  via: "name" | "text";
}

export type DocPick = { doc: DriveDoc; why: string } | { candidates: DriveDoc[] } | undefined;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const words = (s: string) => ` ${norm(s)} `;

export const docIdOf = (url: string) => url.match(/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/)?.[1];
export const docUrlOf = (id: string) => `https://docs.google.com/document/d/${id}/edit`;
/** A Google Docs link anywhere in some text (a sheet cell, notes). */
export const findDocUrl = (text: string) => text.match(/https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/[\w-]{20,}[^\s)"'<>]*/)?.[0];

/** Drive search terms: the full name in the title, then the full name in the text. */
export function driveQueries(name: string) {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1] ?? "";
  const base = "mimeType='application/vnd.google-apps.document' and trashed=false";
  return {
    // Last name only in the title query: "Hon, Benjamin" and "Ben Hon" both come back, and scoring sorts them out.
    name: `${base} and name contains '${esc(last)}'`,
    text: `${base} and fullText contains '"${esc(name.trim())}"'`,
  };
}

const DAY = 86_400_000;

/** How well a doc's title names this person: 3 = full name (any order), 2 = last name + first initial or nickname, 0 = no. */
function titleScore(title: string, name: string) {
  const t = words(title);
  const parts = norm(name).split(" ").filter(Boolean);
  if (parts.length < 2) return t.includes(` ${parts[0]} `) ? 2 : 0;
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!t.includes(` ${last} `)) return 0;
  if (t.includes(` ${first} `)) return 3;
  // "Ben Hon" for Benjamin Hon, "B. Hon"
  const tokens = t.trim().split(" ");
  return tokens.some((w) => w !== last && w.length >= 1 && first.startsWith(w) && (w.length === 1 || w.length >= 3)) ? 2 : 0;
}

/** Created or edited near the chat (2 days before to 3 weeks after). Undated chats ("No date" sheet rows) count everything. */
function nearChat(d: DriveDoc, chatAt?: string) {
  const at = chatAt ? Date.parse(chatAt) : NaN;
  if (!Number.isFinite(at) || at < DAY * 365) return true;
  return [d.createdTime, d.modifiedTime].some((x) => {
    const t = x ? Date.parse(x) : NaN;
    return Number.isFinite(t) && t >= at - 2 * DAY && t <= at + 21 * DAY;
  });
}

/**
 * Pick the doc for a chat with `name` (at `bank`, on `chatAt`) from Drive results. One clear title match → it; several
 * → the one near the chat date (or one also naming the bank); a single text-only match → it. Anything else = choices.
 */
export function pickDoc(docs: DriveDoc[], name: string, opts: { bank?: string; chatAt?: string } = {}): DocPick {
  const uniq = [...new Map(docs.map((d) => [d.id, d])).values()];
  if (!uniq.length) return undefined;
  const titled = uniq.map((d) => ({ d, s: titleScore(d.name, name) })).filter((x) => x.s >= 2);
  if (titled.length) {
    const top = Math.max(...titled.map((x) => x.s));
    let best = titled.filter((x) => x.s === top).map((x) => x.d);
    if (best.length > 1) {
      const near = best.filter((d) => nearChat(d, opts.chatAt));
      if (near.length) best = near;
    }
    if (best.length > 1 && opts.bank) {
      const b = norm(opts.bank).split(" ")[0];
      const withBank = best.filter((d) => b && words(d.name).includes(` ${b} `));
      if (withBank.length) best = withBank;
    }
    if (best.length === 1) return { doc: best[0], why: `Its title names ${name}` };
    return { candidates: best.slice(0, 5) };
  }
  const text = uniq.filter((d) => d.via === "text");
  if (text.length === 1) return { doc: text[0], why: `It's the only doc that mentions ${name}` };
  const near = text.filter((d) => nearChat(d, opts.chatAt));
  if (near.length === 1) return { doc: near[0], why: `It mentions ${name} and was edited around the chat` };
  return text.length ? { candidates: text.slice(0, 5) } : undefined;
}

/* ---------------- Docs API JSON → plain text ---------------- */

type El = {
  paragraph?: { elements?: { textRun?: { content?: string } }[] };
  table?: { tableRows?: { tableCells?: { content?: El[] }[] }[] };
  tableOfContents?: { content?: El[] };
};
type Tab = { documentTab?: { body?: { content?: El[] } }; childTabs?: Tab[]; tabProperties?: { title?: string } };
export type DocsJson = { title?: string; body?: { content?: El[] }; tabs?: Tab[] };

function elsText(els: El[] | undefined): string {
  let out = "";
  for (const e of els ?? []) {
    if (e.paragraph) out += (e.paragraph.elements ?? []).map((x) => x.textRun?.content ?? "").join("");
    else if (e.table) for (const r of e.table.tableRows ?? []) out += (r.tableCells ?? []).map((c) => elsText(c.content).trim()).join(" | ") + "\n";
    else if (e.tableOfContents) continue;
  }
  return out;
}

/** The text of a Google Doc as returned by `documents.get` (with or without `includeTabsContent`), tabs titled. */
export function docJsonText(doc: DocsJson, limit = 60_000) {
  const tabs: string[] = [];
  const walk = (list: Tab[] | undefined) => {
    for (const t of list ?? []) {
      const text = elsText(t.documentTab?.body?.content).trim();
      if (text) tabs.push(list!.length > 1 || t.childTabs?.length ? `${t.tabProperties?.title ?? ""}\n${text}` : text);
      walk(t.childTabs);
    }
  };
  if (doc.tabs?.length) walk(doc.tabs);
  else tabs.push(elsText(doc.body?.content).trim());
  return tabs.join("\n\n").replace(/\u000b/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, limit);
}

/** Chats that should have a notes doc: real conversations, not emails or info sessions. */
export const wantsDoc = (kind?: string) => !kind || ["coffee_chat", "call", "in_person", "other"].includes(kind);

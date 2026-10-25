"use client";

import { useEffect, useState } from "react";
import { blobs, readNamespace, switchNamespace, useStore, type StoreNamespace } from "@/lib/store";
import { SIGNIN_REQUIRED, fetchUser, useSession, type SessionUser } from "@/lib/session";
import { startSync } from "@/lib/sync";
import { markServerConnected } from "@/lib/serverSync";
import { setServerGoogleToken } from "@/lib/googleToken";
import { demoState } from "@/lib/demo";
import { FORMAT_VERSION, readFormats, withInternalLinks } from "@/lib/workbook";
import { readInternalLinks } from "@/lib/sheetLinks";
import { toast } from "./ui";

/**
 * What a tab shows (owner, 2026-10-25): signed in → that user's account (cached here, kept in step by lib/sync.ts);
 * signed out with this browser's pre-account data → that data (until sign-in is required), or a "sign in to keep
 * it" screen; otherwise the demo. A signed-in browser that still has pre-account data gets the move screen first.
 */

/** This browser's pre-account data was moved into (or set aside for) this user: don't ask again. */
const MOVED = "coverage:moved";
export const movedFor = (uid: string) => {
  try {
    return (JSON.parse(localStorage.getItem(MOVED) ?? "{}") as Record<string, string>)[uid] ?? null;
  } catch {
    return null;
  }
};
/** This browser's old data went into some account already: signed out, it shows the demo, not that old copy. */
const movedAny = () => {
  try {
    return Object.keys(JSON.parse(localStorage.getItem(MOVED) ?? "{}")).length > 0;
  } catch {
    return false;
  }
};
export function markMoved(uid: string) {
  try {
    const m = JSON.parse(localStorage.getItem(MOVED) ?? "{}") as Record<string, string>;
    localStorage.setItem(MOVED, JSON.stringify({ ...m, [uid]: new Date().toISOString() }));
  } catch {}
}
/** Set by a full-backup restore: the next start replaces the account with this browser's copy. */
export const REPLACE_ACCOUNT = "coverage:replace-account";

export interface LegacyInfo {
  contacts: number;
  jobs: number;
  workbook: string | null;
  server: { id: string; token: string; email?: string } | null;
}
export async function legacyInfo(): Promise<LegacyInfo | null> {
  const raw = await readNamespace("legacy");
  const s = raw?.state as { contacts?: unknown[]; apply?: { jobs?: unknown[] }; workbook?: { name?: string }; settings?: { server?: LegacyInfo["server"] } } | undefined;
  if (!s) return null;
  const info = { contacts: s.contacts?.length ?? 0, jobs: s.apply?.jobs?.length ?? 0, workbook: s.workbook?.name ?? null, server: s.settings?.server?.id ? s.settings.server : null };
  return info.contacts || info.jobs || info.workbook ? info : null;
}

/** Point the store at a namespace and load what it needs before pages render (parsed sheets, old formats). */
async function load(ns: StoreNamespace) {
  await switchNamespace(ns, ns === "demo" ? demoState() : undefined);
  const snaps = await blobs.snapshots();
  if (snaps) useStore.getState().setSnapshots(snaps);
  return snaps;
}

async function afterLoad(snaps: Awaited<ReturnType<typeof blobs.snapshots>>) {
  if (snaps?.length) {
    const { describeTabChanges, refreshBankTabs } = await import("@/lib/actions");
    const text = describeTabChanges(refreshBankTabs() ?? { added: [], renamed: [], repaired: [], listed: [], coverageRows: [], skipped: [] });
    if (text) toast.info(`Spreadsheet tabs: ${text}`);
  }
  if (snaps?.length && snaps.some((s) => s.format?.version !== FORMAT_VERSION)) {
    const buf = await blobs.workbook();
    if (!buf) return;
    const [formats, links] = await Promise.all([readFormats(buf), readInternalLinks(buf)]);
    const next = useStore.getState().snapshots.map((s) => (formats[s.name] ? { ...s, format: formats[s.name], cells: withInternalLinks(s.cells, links[s.name]) } : s));
    useStore.getState().setSnapshots(next);
    blobs.setSnapshots(next);
  }
}

/** Open a signed-in user's account in this tab (after any move). */
export async function openAccount(user: SessionUser, opts: { localWins?: boolean } = {}) {
  await load(`u:${user.id}`);
  setServerGoogleToken(async () => {
    const srv = useStore.getState().settings.server;
    if (!srv?.id || !srv.email) return null;
    const res = await fetch("/api/server/google/token", { method: "POST", headers: { Authorization: `Bearer ${srv.id}.${srv.token}` } });
    return res.ok ? res.json() : null;
  });
  let replace = opts.localWins ?? false;
  try {
    if (localStorage.getItem(REPLACE_ACCOUNT) === user.id) replace = true;
    localStorage.removeItem(REPLACE_ACCOUNT);
  } catch {}
  await startSync(user.id, { localWins: replace });
  // The store may have changed under the pull: re-read the parsed sheets that came down.
  const snaps = await blobs.snapshots();
  if (snaps) useStore.getState().setSnapshots(snaps);
  useSession.setState({ user, mode: "account", checked: true });
  void afterLoad(snaps);
  // Back from "Connect Google" (Settings → Account; Follow-ups handles its own return).
  const q = new URLSearchParams(window.location.search);
  if (q.get("server") && !window.location.pathname.startsWith("/followups")) {
    if (q.get("server") === "connected" && q.get("email")) {
      markServerConnected(q.get("email")!);
      toast.ok(`Google connected (${q.get("email")}): Gmail, Calendar and Docs work without popups now.`);
    } else toast.err(`Google wasn't connected: ${q.get("reason") ?? "unknown error"}`);
    q.delete("server");
    q.delete("email");
    q.delete("reason");
    window.history.replaceState(null, "", window.location.pathname + (q.size ? `?${q}` : ""));
  }
}

export function useBoot() {
  const [ready, setReady] = useState(false);
  const [move, setMove] = useState<{ user: SessionUser; legacy: LegacyInfo } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const q = new URLSearchParams(window.location.search);
      if (q.get("signin") === "error") toast.err(`Sign-in didn't finish: ${q.get("reason") ?? "try again"}`);
      let user: SessionUser | null = null;
      try {
        user = await fetchUser();
      } catch (e) {
        toast.err((e as Error).message);
      }
      const legacy = await legacyInfo();
      if (cancelled) return;
      if (user) {
        if (legacy && !movedFor(user.id)) {
          useSession.setState({ user, mode: "loading", checked: true });
          setMove({ user, legacy });
          return;
        }
        await openAccount(user);
      } else if (legacy && !movedAny()) {
        if (SIGNIN_REQUIRED) {
          useSession.setState({ user: null, mode: "blocked", checked: true });
        } else {
          const snaps = await load("legacy");
          useSession.setState({ user: null, mode: "legacy", checked: true });
          void afterLoad(snaps);
        }
      } else {
        await load("demo");
        useSession.setState({ user: null, mode: "demo", checked: true });
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // A session that ended elsewhere (signed out on another tab, account deleted): back to the start.
  useEffect(() => {
    const on = () => {
      toast.err("You were signed out. Sign in again to keep saving.");
      useSession.setState({ mode: "blocked" });
    };
    window.addEventListener("coverage:signed-out", on);
    return () => window.removeEventListener("coverage:signed-out", on);
  }, []);
  const finishMove = async (opts: { localWins: boolean } | null) => {
    if (!move) return;
    const { user } = move;
    setMove(null);
    await openAccount(user, opts ?? {});
    setReady(true);
  };
  return { ready, move, finishMove };
}

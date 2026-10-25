"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cloud, CloudOff, Download, Loader2, LogOut, Settings2, UserRound } from "lucide-react";
import { copyNamespace, currentNamespace, dropNamespace, useStore } from "@/lib/store";
import { signInHref, useSession } from "@/lib/session";
import { dropSyncMeta, flushSync, stopSync, useSyncStatus } from "@/lib/sync";
import { downloadFullBackup, restoreFullBackup } from "@/lib/backup";
import { connectServer } from "@/lib/serverSync";
import { Button, Card, CardHeader, Input, Modal, toast } from "./ui";
import { REPLACE_ACCOUNT, legacyInfo, markMoved, type LegacyInfo } from "./useBoot";
import { cn } from "@/lib/util";

/** Google's "G", drawn inline (no external image). */
function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.7 10.7l7.8-6z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function SignInButton({ label = "Sign in with Google", className }: { label?: string; className?: string }) {
  return (
    <a
      href={signInHref()}
      className={cn("inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line-2 bg-panel px-3.5 text-[13.5px] font-medium text-ink hover:bg-subtle", className)}
    >
      <GoogleG className="size-4" />
      {label}
    </a>
  );
}

/** Signed out, sign-in required, but this browser has data from before accounts: keep it by signing in. */
export function SignInScreen() {
  return (
    <div className="mx-auto mt-[12vh] max-w-md rounded-2xl border border-line bg-panel p-6 text-center">
      <h1 className="text-[18px] font-semibold">Sign in to keep your data</h1>
      <p className="mt-2 text-[13.5px] text-muted">
        This browser has your Coverage data from before accounts. Sign in with Google and it moves into your account, so it&apos;s on every browser and
        computer. Nothing is deleted.
      </p>
      <SignInButton className="mt-5" />
    </div>
  );
}

export function DemoBar() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-brass-soft px-4 py-2 text-[13px] text-brass-ink">
      <span>
        <b className="font-semibold">Demo</b> · made-up bankers, jobs and chats. Nothing you do here is saved.
      </span>
      <a href={signInHref()} className="font-semibold underline underline-offset-2">
        Sign in with Google to use your own
      </a>
    </div>
  );
}

export function LegacyBar() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-subtle px-4 py-2 text-[13px] text-ink-2">
      <span>This browser&apos;s data isn&apos;t in an account yet, so it&apos;s only here.</span>
      <a href={signInHref()} className="font-semibold text-brass-ink underline underline-offset-2">
        Sign in to sync it to every browser
      </a>
    </div>
  );
}

/** "Sign in to do this" when a demo visitor tries something real. */
export function SignInNeededModal() {
  const [what, setWhat] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setWhat(((e as CustomEvent<string | undefined>).detail ?? "do this").toString());
    window.addEventListener("coverage:signin-needed", on);
    return () => window.removeEventListener("coverage:signin-needed", on);
  }, []);
  return (
    <Modal open={!!what} onClose={() => setWhat(null)} title={`Sign in to ${what}`}>
      <p className="text-[13.5px] text-ink-2">This is the demo with made-up data. Sign in with Google to use Coverage with your own contacts, emails and applications.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setWhat(null)}>
          Keep exploring
        </Button>
        <SignInButton />
      </div>
    </Modal>
  );
}

export function SyncBadge() {
  const { state, error } = useSyncStatus();
  if (state === "off") return null;
  const busy = state === "saving" || state === "starting";
  const bad = state === "offline" || state === "error";
  return (
    <span title={error ?? (busy ? "Saving to your account…" : "Everything is saved to your account")} className={cn("hidden items-center gap-1.5 px-2 text-[12px] lg:flex", bad ? "text-top-ink" : "text-top-muted")}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : bad ? <CloudOff className="size-3.5" /> : <Cloud className="size-3.5" />}
      {busy ? "Saving…" : state === "offline" ? "Offline" : state === "error" ? "Not saved" : "Saved"}
    </span>
  );
}

/** Ties this browser's automatic-sending account to the user (and merges an old one into it). */
export async function linkServerAccount(drop?: { id: string; token: string } | null) {
  const srv = useStore.getState().settings.server;
  if (!srv?.id) return;
  const res = await fetch("/api/auth/link", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${srv.id}.${srv.token}` },
    body: JSON.stringify(drop && drop.id !== srv.id ? { drop: `${drop.id}.${drop.token}` } : {}),
  });
  if (res.ok) useSession.setState((s) => (s.user ? { user: { ...s.user, accountId: srv.id } } : s));
}

export async function signOut(force = false) {
  const { user } = useSession.getState();
  if (!user) return;
  if (!force && !(await flushSync())) {
    toast.err("Your latest changes aren't saved to your account yet (offline?). Try again, or use Sign out anyway in Settings → Account.");
    return false;
  }
  await fetch("/api/auth/signout", { method: "POST" });
  stopSync();
  await dropNamespace(`u:${user.id}`);
  await dropSyncMeta(user.id);
  // A full page load (not router.push): the store and sync restart signed out, on the demo.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/");
  return true;
}

export function AccountMenu() {
  const user = useSession((s) => s.user);
  const mode = useSession((s) => s.mode);
  const [open, setOpen] = useState(false);
  if (mode === "demo" || mode === "legacy" || mode === "blocked") return <SignInButton label="Sign in" className="hidden h-8 border-top-line bg-transparent px-2.5 text-[12.5px] text-top-ink hover:bg-top-ink/10 sm:inline-flex" />;
  if (!user) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Account" title={user.email} className="grid size-9 place-items-center overflow-hidden rounded-full hover:bg-top-ink/10">
        {user.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.picture} alt="" referrerPolicy="no-referrer" className="size-7 rounded-full" />
        ) : (
          <UserRound className="size-[18px] text-top-muted" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-line bg-panel p-1.5 text-ink shadow-lg" onMouseLeave={() => setOpen(false)}>
          <div className="px-2.5 py-2 text-[12.5px]">
            <div className="font-medium">{user.name ?? user.email}</div>
            <div className="truncate text-muted">{user.email}</div>
          </div>
          <Link href="/settings?tab=account" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-hover">
            <Settings2 className="size-4" /> Account settings
          </Link>
          <button onClick={() => void signOut()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-hover">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * First sign-in on a browser that has data from before accounts: back it up, then move it in (or keep the account's).
 * The old copy stays in this browser until "Remove this browser's old copy" (Settings → Account).
 */
export function MoveData({ legacy, onDone }: { legacy: LegacyInfo; onDone: (opts: { localWins: boolean } | null) => Promise<void> }) {
  const user = useSession((s) => s.user)!;
  const [account, setAccount] = useState<{ contacts: number; docs: number } | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/sync/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then(setAccount)
      .catch(() => setAccount({ contacts: 0, docs: -1 }));
  }, []);
  const empty = account && account.docs === 0;
  const what = [legacy.contacts && `${legacy.contacts} contacts`, legacy.jobs && `${legacy.jobs} jobs`, legacy.workbook && `the spreadsheet "${legacy.workbook}"`].filter(Boolean).join(", ");

  const backup = async () => {
    setBusy("backup");
    try {
      await downloadFullBackup("legacy");
      setBackedUp(true);
    } catch (e) {
      toast.err(`Backup failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  const useThisBrowser = async () => {
    setBusy("move");
    try {
      await copyNamespace("legacy", `u:${user.id}`);
      await onDone({ localWins: true });
      markMoved(user.id);
      await linkServerAccount(null);
      toast.ok("Moved this browser's data into your account. It's on every browser you sign in to now.");
    } catch (e) {
      toast.err(`Moving didn't finish: ${(e as Error).message}. Nothing was deleted; reload to try again.`);
      setBusy(null);
    }
  };
  const useAccount = async () => {
    setBusy("account");
    try {
      await onDone(null);
      markMoved(user.id);
      const st = useStore.getState();
      // The account's data has no automatic sending yet: keep this browser's (queue, texts, captures).
      if (!st.settings.server?.id && legacy.server) st.setSettings((s) => ({ ...s, server: legacy.server! }));
      await linkServerAccount(legacy.server);
      toast.ok("Using your account's data. This browser's old copy is untouched (Settings → Account to remove it).");
    } catch (e) {
      toast.err((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto mt-[8vh] max-w-lg rounded-2xl border border-line bg-panel p-6">
      <h1 className="text-[18px] font-semibold">Move this browser&apos;s data into your account</h1>
      <p className="mt-2 text-[13.5px] text-ink-2">
        Signed in as <b>{user.email}</b>. This browser has Coverage data from before accounts{what ? `: ${what}` : ""}.
        {account === null ? " Checking your account…" : empty ? " Your account is empty." : ` Your account already has ${account.contacts} contacts.`}
      </p>
      <ol className="mt-4 space-y-4 text-[13.5px]">
        <li>
          <div className="font-medium">1. Download a full backup first</div>
          <p className="mt-0.5 text-muted">This browser may hold the only copy. The file has everything, spreadsheet and resumes included.</p>
          <Button className="mt-2" icon={<Download className="size-4" />} loading={busy === "backup"} onClick={backup}>
            {backedUp ? "Downloaded. Download again" : "Download full backup"}
          </Button>
        </li>
        <li>
          <div className="font-medium">2. {empty || account === null ? "Move it in" : "Pick which data to keep"}</div>
          {empty || account === null ? (
            <Button variant="primary" className="mt-2" disabled={!backedUp || account === null} loading={busy === "move"} onClick={useThisBrowser}>
              Move it into my account
            </Button>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="primary" disabled={!backedUp || !!busy} loading={busy === "move"} onClick={useThisBrowser}>
                Use this browser&apos;s data
              </Button>
              <Button disabled={!!busy} loading={busy === "account"} onClick={useAccount}>
                Use my account&apos;s data
              </Button>
            </div>
          )}
          {!empty && account && <p className="mt-1.5 text-[12.5px] text-muted">&quot;This browser&apos;s data&quot; replaces what&apos;s in your account. Your account&apos;s data leaves this browser&apos;s old copy untouched.</p>}
          {!backedUp && <p className="mt-1.5 text-[12.5px] text-muted">Download the backup first.</p>}
        </li>
      </ol>
    </div>
  );
}

/**
 * Restore a complete backup into whatever this tab shows (an account: it replaces the account's data on the next
 * start; this browser's old data; never the demo). Returns contacts restored, or null if refused.
 */
export async function restoreBackupHere(data: Parameters<typeof restoreFullBackup>[1]) {
  const { mode, user } = useSession.getState();
  if (mode === "demo") {
    window.dispatchEvent(new CustomEvent("coverage:signin-needed", { detail: "restore a backup" }));
    return null;
  }
  const ns = currentNamespace();
  if (mode === "account" && user) {
    if (!window.confirm("Replace everything in your account with this backup? Your other browsers get it too.")) return null;
    stopSync();
    try {
      localStorage.setItem(REPLACE_ACCOUNT, user.id);
    } catch {}
  }
  return restoreFullBackup(ns, data);
}

/** "Connect Google": one Google screen for Gmail, Calendar and Docs, kept on the server (no popups after this). */
function GoogleCard() {
  const server = useStore((s) => s.settings.server);
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader
        title="Google"
        sub={
          server?.email
            ? `Connected as ${server.email}: drafts, sending, reply tracking, your calendar and notes docs work on every browser without Google popups.`
            : "Connect your Google account once (Gmail, Calendar, Docs): Coverage then drafts and sends email, reads replies and your calendar, on every browser, with no popups."
        }
      />
      <div className="p-4">
        <Button
          variant={server?.email ? "secondary" : "primary"}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await connectServer("/settings?tab=account");
            } catch (e) {
              setBusy(false);
              toast.err((e as Error).message);
            }
          }}
        >
          {server?.email ? "Reconnect Google" : "Connect Google"}
        </Button>
      </div>
    </Card>
  );
}

export function AccountSettings() {
  const user = useSession((s) => s.user);
  const mode = useSession((s) => s.mode);
  const { state, at, error } = useSyncStatus();
  const [hasOld, setHasOld] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void legacyInfo().then((x) => setHasOld(!!x));
  }, []);
  if (mode !== "account" || !user)
    return (
      <Card>
        <CardHeader title="Account" sub={mode === "demo" ? "You're looking at the demo." : "This browser's data isn't in an account yet."} />
        <div className="p-4">
          <SignInButton />
        </div>
      </Card>
    );
  return (
    <>
      <Card>
        <CardHeader
          title="Your account"
          sub="Everything you save is stored in your Coverage account, so it's on every browser and computer you sign in to."
        />
        <div className="flex flex-wrap items-center gap-3 p-4 text-[13.5px]">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{user.name ?? user.email}</div>
            <div className="text-muted">{user.email}</div>
            <div className="mt-1 text-[12.5px] text-muted">
              {state === "saved" ? `All changes saved${at ? ` · ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}` : state === "saving" ? "Saving…" : error ? `Not saved yet: ${error}` : ""}
            </div>
          </div>
          <Button icon={<Download className="size-4" />} loading={busy === "dl"} onClick={async () => {
            setBusy("dl");
            try {
              await flushSync();
              const n = await downloadFullBackup(currentNamespace());
              toast.ok(`Downloaded everything (${n} contacts).`);
            } catch (e) {
              toast.err((e as Error).message);
            } finally {
              setBusy(null);
            }
          }}>
            Download everything
          </Button>
          <Button icon={<LogOut className="size-4" />} onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
        <div className="border-t border-line px-4 py-3 text-[12.5px] text-muted">
          Can&apos;t save (offline) and need to leave?{" "}
          <button className="text-navy underline" onClick={() => window.confirm("Sign out without saving your latest changes? Anything not saved yet is lost.") && void signOut(true)}>
            Sign out anyway
          </button>
        </div>
      </Card>
      <GoogleCard />
      {hasOld && (
        <Card>
          <CardHeader title="This browser's old copy" sub="Data from before accounts is still stored in this browser (it was moved into your account, or you chose your account's data). Remove it once you're happy." />
          <div className="flex flex-wrap gap-2 p-4">
            <Button onClick={() => void downloadFullBackup("legacy")} icon={<Download className="size-4" />}>
              Download it
            </Button>
            <Button variant="danger" loading={busy === "old"} onClick={async () => {
              if (!window.confirm("Remove this browser's old copy? Your account isn't touched.")) return;
              setBusy("old");
              await dropNamespace("legacy");
              setHasOld(false);
              setBusy(null);
              toast.ok("Removed this browser's old copy.");
            }}>
              Remove this browser&apos;s old copy
            </Button>
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="Delete my account" sub="Deletes everything Coverage stores for you: your data and files, automatic sending (Google access is revoked), texts, phone captures, the Claude connector. Can't be undone. Download everything first." />
        <div className="flex flex-wrap items-center gap-2 p-4">
          <Input className="max-w-xs" placeholder={`Type ${user.email} to confirm`} value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} />
          <Button variant="danger" disabled={confirmDelete.trim().toLowerCase() !== user.email.toLowerCase()} loading={busy === "del"} onClick={async () => {
            setBusy("del");
            const res = await fetch("/api/auth/delete", { method: "POST" });
            if (!res.ok) {
              setBusy(null);
              toast.err(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't delete the account.");
              return;
            }
            stopSync();
            await dropNamespace(`u:${user.id}`);
            await dropSyncMeta(user.id);
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign("/");
          }}>
            Delete my account
          </Button>
        </div>
      </Card>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { useStore } from "@/lib/store";
import { googleClientId } from "@/lib/keys";
import { connectGmail, gmailConnected, onGmailConnected } from "@/lib/gmail";
import { describeSync, syncAllWithGmail } from "@/lib/gmailSync";
import { cn } from "@/lib/util";
import { toast } from "./ui";

const EVERY_MS = 20 * 60_000;

function ago(iso?: string) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/**
 * Sidebar control + background loop. Google needs one click per browser session to hand over a token;
 * after that (or after any other Gmail action this session) we re-sync quietly every 20 minutes.
 */
export function GmailSyncWidget() {
  const settings = useStore((s) => s.settings);
  const last = useStore((s) => s.lastGmailSync);
  const clientId = googleClientId(settings);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(() => gmailConnected(clientId));
  const [, tick] = useState(0);

  useEffect(() => {
    if (!clientId) return;
    const quiet = async () => {
      if (!gmailConnected(clientId)) return setConnected(false);
      setConnected(true);
      const stale = !useStore.getState().lastGmailSync || Date.now() - new Date(useStore.getState().lastGmailSync!).getTime() > EVERY_MS - 60_000;
      if (!stale) return;
      setBusy(true);
      try {
        const r = await syncAllWithGmail({ interactive: false });
        if (r.newlySent || r.emailsFound || r.replies) toast.ok(describeSync(r));
      } catch {
        setConnected(false);
      } finally {
        setBusy(false);
      }
    };
    const off = onGmailConnected(() => void quiet());
    quiet();
    const id = setInterval(() => {
      quiet();
      tick((n) => n + 1); // refresh "synced Xm ago"
    }, 60_000);
    return () => {
      off();
      clearInterval(id);
    };
  }, [clientId]);

  if (!clientId) return null;

  const run = async () => {
    setBusy(true);
    try {
      await connectGmail(clientId);
      setConnected(true);
      const r = await syncAllWithGmail({ interactive: true });
      toast.ok(describeSync(r));
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={run}
      disabled={busy}
      className="mx-2.5 mb-2 flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-left text-[12px] hover:bg-white/5 disabled:opacity-70"
      title={connected ? "Gmail auto-syncs every 20 minutes while this tab is open. Click to sync now." : "Connect once per session to auto-sync sent dates, follow-ups and replies"}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin text-brass" /> : connected ? <RefreshCw className="size-3.5 text-brass" /> : <Mail className="size-3.5 text-brass" />}
      <span className="flex-1">
        {busy ? "Syncing Gmail…" : connected ? "Gmail auto-sync on" : "Connect Gmail sync"}
        <span className={cn("block text-[11px]", "text-[#8793a8]")}>synced {ago(last)}</span>
      </span>
    </button>
  );
}

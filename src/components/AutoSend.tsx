"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";
import { connectServer, disconnectServer, syncServer, useServerStatus } from "@/lib/serverSync";
import { Badge, Button, Card, CardHeader, toast } from "./ui";

/** Automatic sending: the server sends queued Gmail drafts at each person's slot and the 9am WhatsApp text. */
export function AutoSendCard() {
  const server = useStore((s) => s.settings.server);
  const queued = useStore((s) => s.contacts.filter((c) => c.serverSend).length);
  const status = useServerStatus((s) => s.status);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.err((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <Card>
      <CardHeader
        title="Automatic sending"
        sub="Coverage sends the emails you schedule inside your send window (Settings → Email → Sending) and texts your 9am WhatsApp list, even when this dashboard is closed."
        right={<Clock className="size-4 text-muted" />}
      />
      <div className="space-y-2 p-4 text-[13px]">
        {server?.email ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green">On</Badge>
              <span>
                Sends from <b>{server.email}</b> · {queued} queued
              </span>
            </div>
            {status?.whatsapp && <div className="text-[12px] text-muted">WhatsApp 9am text: on{status.lastDigestDay ? ` · last sent ${status.lastDigestDay}` : ""}</div>}
            {status?.lastDigestError && <div className="text-[12px] text-red">WhatsApp: {status.lastDigestError}</div>}
            {status?.error && <div className="text-[12px] text-red">{status.error}</div>}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" loading={busy} onClick={() => run(async () => toast.ok((await syncServer()) ? "Synced with the server." : "Nothing to sync."))}>
                Sync now
              </Button>
              <Button size="sm" variant="ghost" onClick={() => run(() => connectServer())}>
                Reconnect Gmail
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  window.confirm("Turn off automatic sending? Queued sends are cancelled (the drafts stay in Gmail) and the server forgets your Gmail access.") &&
                  run(async () => {
                    await disconnectServer();
                    toast.ok("Automatic sending is off.");
                  })
                }
              >
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-ink-2">
              One Google sign-in gives Coverage permission to <b>send drafts you&apos;ve made</b> (Gmail &ldquo;compose&rdquo; access, nothing else).
              It sends only what you schedule here, and you can turn it off any time.
            </p>
            <Button size="sm" variant="primary" loading={busy} onClick={() => run(() => connectServer())}>
              Turn on automatic sending
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Who sends the drafts made here: Coverage (the server, at each person's slot) or you, with Gmail's Schedule send.
 * Gmail's API has no Schedule send, so the Gmail option means: drafts land in Gmail and you schedule each one there.
 */
export function SendModeSwitch({ onAuto }: { onAuto: () => void }) {
  const connected = useStore((s) => !!s.settings.server?.email);
  const mode = useStore((s) => s.settings.sendMode);
  const setSettings = useStore((s) => s.setSettings);
  const current = connected && mode !== "gmail" ? "coverage" : "gmail";
  const pick = (m: "coverage" | "gmail") => {
    if (m === "coverage" && !connected) return onAuto();
    setSettings((x) => ({ ...x, sendMode: m }));
  };
  const opt = (m: "coverage" | "gmail", label: string) => (
    <button onClick={() => pick(m)} className={cn("rounded px-3 py-1 text-[12.5px]", current === m ? "bg-navy text-white" : "text-ink-2 hover:bg-[#f0eee7]")}>
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
      <span className="text-muted">Drafts go out by</span>
      <div className="inline-flex rounded-md border border-line-2 bg-panel p-0.5">
        {opt("coverage", "Coverage sends them")}
        {opt("gmail", "Gmail Schedule send (I click)")}
      </div>
      <span className="text-muted">
        {current === "coverage"
          ? "Sent from your Gmail at each person's slot, even with the dashboard closed. They wait in Gmail Drafts until then."
          : connected
            ? "Drafts land in Gmail; open each one and pick the time shown here with Schedule send. They then sit in Gmail's Scheduled folder."
            : "Drafts land in Gmail; you schedule each one there. Coverage sends them needs a one-time Google sign-in."}
      </span>
      <details className="w-full text-[12px] text-muted">
        <summary className="cursor-pointer select-none font-medium text-navy">Why can&apos;t Coverage just use Gmail&apos;s Schedule send?</summary>
        <p className="mt-1 max-w-3xl">
          Google doesn&apos;t let apps create Schedule-send emails: that button only exists inside Gmail itself. So there are two ways to send at
          the right time. <b>Coverage sends them</b> keeps each email as a normal Gmail draft and sends it from your account at its slot (it can
          only send drafts you scheduled here, and can&apos;t read your inbox). <b>Gmail Schedule send</b> puts the drafts in Gmail, and you
          open each one and pick the time shown here. Either way the email comes from your Gmail and looks the same to the banker.
        </p>
      </details>
    </div>
  );
}

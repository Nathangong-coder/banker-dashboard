"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useStore } from "@/lib/store";
import { markServerConnected, syncServer, useServerStatus } from "@/lib/serverSync";
import { Button, Card, CardHeader, PageHeader, toast } from "@/components/ui";
import { Reminders } from "@/components/RemindersPanel";

const ago = (iso?: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

/**
 * Reminders (owner, 2026-11-23: "that sub-section should be its own sub-tab"; it was Cold outreach → Reminders &
 * alerts). Opens with how the 9 PM text is made and how fresh tonight's list is, because the text is only as current
 * as the last time a Coverage tab sent the server its plan.
 */
export default function RemindersPage() {
  const status = useServerStatus((s) => s.status);
  const connected = useStore((s) => !!s.settings.server?.email);
  const whatsapp = useStore((s) => !!(s.settings.keys.whatsappPhone && s.settings.keys.whatsappApiKey));
  const [busy, setBusy] = useState(false);

  // Opening Reminders sends tonight's list (owner, 2026-11-23: "the 9 PM text is not being auto-updated"). It also fills
  // in "Last sent" / "Last text", which only exist after a sync in this tab (they showed "never" on every fresh page).
  useEffect(() => {
    if (useServerStatus.getState().status || new URLSearchParams(window.location.search).get("server")) return;
    if (!useStore.getState().settings.server?.email) return;
    void syncServer().catch(() => undefined);
  }, []);

  // Google sends you back here after connecting automatic sending (?server=connected&email=…).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("server") === "connected" && q.get("email")) {
      markServerConnected(q.get("email")!);
      toast.ok(`Automatic sending is on for ${q.get("email")}.`);
      syncServer().catch((e: Error) => toast.err(e.message));
    } else if (q.get("server") === "error") toast.err(`Automatic sending wasn't connected: ${q.get("reason") ?? "unknown error"}`);
    if (q.get("server")) window.history.replaceState(null, "", "/reminders");
  }, []);

  const refresh = async () => {
    setBusy(true);
    try {
      await syncServer();
      toast.ok("Tonight's list is up to date on the server.");
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Reminders" sub="Your 9 PM text and where reminders go." />
      <Card className="mb-3">
        <CardHeader
          title="How the 9 PM text works"
          right={
            connected && (
              <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={busy} onClick={() => void refresh()}>
                Update tonight&apos;s list
              </Button>
            )
          }
        />
        <ol className="grid gap-2 px-4 pb-4 text-[13px] text-ink-2 md:grid-cols-3">
          <li className="rounded border border-line p-3">
            <div className="mb-1 text-[12px] font-semibold text-ink">1 · Your browser builds the list</div>
            Only a Coverage tab knows your people, so it works out who&apos;s due (thank-yous, replies, check-ins, follow-ups, reminders) and sends that
            plan to the server: when you open Coverage, on every sync (Sync button / your schedule), when a tab is open between 7 and 9 PM, and when your
            send queue changes.
            <div className="mt-2 text-[12px] text-muted">
              Last sent to the server: <b className="text-ink-2">{ago(status?.syncedAt)}</b>
            </div>
          </li>
          <li className="rounded border border-line p-3">
            <div className="mb-1 text-[12px] font-semibold text-ink">2 · At 9 PM the server sends it</div>
            The server takes tonight&apos;s part of that plan, adds Google Calendar (today&apos;s calls → thank-yous, tomorrow&apos;s calls), drops anyone who
            emailed you or got an email from you since the plan was made, and texts it on WhatsApp as up to 3 messages.
            <div className="mt-2 text-[12px] text-muted">
              Last text: <b className="text-ink-2">{status?.lastDigestDay ?? "none yet"}</b>
              {status?.lastDigestError && <span className="text-red"> · failed: {status.lastDigestError}</span>}
            </div>
          </li>
          <li className="rounded border border-line p-3">
            <div className="mb-1 text-[12px] font-semibold text-ink">3 · Why it can look the same every night</div>
            If no Coverage tab has synced since yesterday, tonight&apos;s text is built from the old plan (it then says &quot;as of …&quot;). Follow-ups you
            never send stay due: those more than a week late now move to &quot;Went cold&quot; on Cold outreach and leave the text.
            {!connected && <div className="mt-2 text-[12px] text-amber">Automatic sending is off, so nothing is sent at 9 PM. Turn it on below.</div>}
            {connected && !whatsapp && <div className="mt-2 text-[12px] text-amber">WhatsApp isn&apos;t set up yet (below).</div>}
          </li>
        </ol>
      </Card>
      <Reminders />
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Plug } from "lucide-react";
import { useStore } from "@/lib/store";
import { serverCall } from "@/lib/serverSync";
import { Button, Card, PageHeader } from "@/components/ui";

/**
 * OAuth approval screen for the Claude connector (api/mcp; lib/server/oauth.ts). Claude sends the browser here with
 * client_id / redirect_uri / PKCE; this browser holds the Coverage account (settings.server), so approving here is
 * what links Claude to it. The server checks everything again before issuing the one-time code.
 */
const PARAMS = ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "response_type", "state", "scope"] as const;

export default function ConnectPage() {
  const server = useStore((s) => s.settings.server);
  // Read once from the URL (the page renders only in the browser, after the store hydrates).
  const [q] = useState<Record<string, string> | null>(() => {
    if (typeof window === "undefined") return null;
    const u = new URLSearchParams(window.location.search);
    const params = Object.fromEntries(PARAMS.map((k) => [k, u.get(k) ?? ""]).filter(([, v]) => v));
    return params.client_id && params.redirect_uri && params.code_challenge ? params : null;
  });
  const [client, setClient] = useState("");
  const [error, setError] = useState(q ? "" : "This link is missing parts. Start connecting again from the app (Claude → Connectors).");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q) return;
    serverCall<{ client: string }>("/api/oauth/authorize", { ...q, check: true })
      .then((r) => setClient(r.client))
      .catch((e: Error) => setError(e.message));
  }, [q]);

  const answer = async (approve: boolean) => {
    if (!q) return;
    setBusy(true);
    try {
      const r = await serverCall<{ redirect: string }>("/api/oauth/authorize", { ...q, approve });
      window.location.href = r.redirect;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const connected = !!server?.email;
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="Connect an app" sub="Give an AI assistant access to your Coverage account." />
      <Card className="space-y-4 p-5 text-[13.5px]">
        <div className="flex items-center gap-2 text-ink">
          <Plug className="size-5 text-brass-strong" />
          <span>
            <b>{client || "An app"}</b> wants to connect to your Coverage account{server?.email ? ` (${server.email})` : ""}.
          </span>
        </div>
        {!connected ? (
          <p className="text-ink-2">
            Turn on automatic sending first (it&apos;s what keeps your data on Coverage&apos;s server):{" "}
            <Link className="underline" href="/followups?tab=reminders">
              Follow-ups → Reminders
            </Link>
            , then start connecting again from the app.
          </p>
        ) : (
          <>
            <div>
              <p className="mb-1.5 font-medium text-ink">It will be able to:</p>
              <ul className="space-y-1 text-ink-2">
                {[
                  "See what's due tonight (thank-yous, replies, check-ins, follow-ups)",
                  "See who replied, who you've thanked, and intros found in their emails",
                  "See your scheduled sends, and cancel one when you ask it to",
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green" />
                    {t}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted">
                It can&apos;t send email, read the rest of your mailbox, or see your spreadsheet. Turning automatic sending off disconnects it.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" loading={busy} disabled={!q || !client} onClick={() => answer(true)}>
                Allow
              </Button>
              <Button variant="ghost" disabled={busy || !q} onClick={() => answer(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}
        {error && <p className="text-[12.5px] text-red">{error}</p>}
      </Card>
    </div>
  );
}

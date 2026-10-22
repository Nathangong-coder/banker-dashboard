"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";
import { connectServer, disconnectServer, syncServer, useServerStatus } from "@/lib/serverSync";
import { callApi } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Field, Input, toast } from "./ui";

/** Automatic sending: the server sends queued Gmail drafts at each person's slot and the 9 PM WhatsApp text. */
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
        sub="Coverage sends the emails you schedule inside your send window (Settings → Email → Sending) and texts your 9 PM WhatsApp list (Mon–Thu: today's thank-yous, check-ins, follow-ups due before the next text), even when this dashboard is closed."
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
            {status?.whatsapp && <div className="text-[12px] text-muted">WhatsApp 9 PM text (Mon–Thu): on{status.lastDigestDay ? ` · last sent ${status.lastDigestDay}` : ""}</div>}
            {status && !status.calendar && (
              <div className="text-[12px] text-ink-2">
                Google Calendar isn&apos;t connected, so tonight&apos;s thank-you list only knows calls booked from this dashboard.{" "}
                <button className="underline" onClick={() => run(() => connectServer())}>
                  Reconnect Google
                </button>{" "}
                and tick Calendar (read-only) to add calls from your calendar.
              </div>
            )}
            {status && (status.gmailRead ? (
              <div className="text-[12px] text-muted">Reply tracking: on (Coverage checks Gmail every hour for replies, thank-yous and referrals)</div>
            ) : (
              <div className="text-[12px] text-ink-2">
                Reply tracking is off: thank-yous and replies are only seen while this dashboard is open.{" "}
                <button className="underline" onClick={() => run(() => connectServer())}>
                  Reconnect Google
                </button>{" "}
                and tick &ldquo;View your email messages&rdquo; (read-only) so Coverage checks every hour.
              </div>
            ))}
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
            <InfoSessionsSection />
          </>
        ) : (
          <>
            <p className="text-ink-2">
              One Google sign-in gives Coverage permission to <b>send drafts you&apos;ve made</b> (Gmail &ldquo;compose&rdquo; access) and, if you tick them, <b>read your calendar</b> (today&apos;s calls) and <b>read your email</b> (replies, thank-yous and referrals from the people you track, checked every hour) so the 9 PM text is always current.
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
    <button onClick={() => pick(m)} className={cn("rounded px-3 py-1 text-[12.5px]", current === m ? "bg-navy text-white" : "text-ink-2 hover:bg-hover")}>
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

/** Server calls with this browser's server account (same credentials as automatic sending). */
async function serverCall<T>(path: string, body: unknown): Promise<T> {
  const srv = useStore.getState().settings.server;
  if (!srv?.id) throw new Error("Turn on automatic sending first.");
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${srv.id}.${srv.token}` }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Server error ${res.status}`);
  return j;
}

/**
 * Info sessions (server side): the phone capture link (photos / names after an event go to the server inbox, which
 * /info-sessions pulls) and an optional Twilio number to text them to instead.
 */
function InfoSessionsSection() {
  const serverId = useStore((s) => s.settings.server?.id);
  const keys = useStore((s) => s.settings.keys);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tw, setTw] = useState<{ number: string | null; myPhone: string | null } | null>(null);
  const [form, setForm] = useState<{ sid: string; token: string; number: string; myPhone: string } | null>(null);

  useEffect(() => {
    if (!serverId) return;
    let live = true;
    serverCall<{ number: string | null; myPhone: string | null }>("/api/server/twilio/setup", { check: true })
      .then((r) => live && setTw(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [serverId]);

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast.err((e as Error).message);
    }
    setBusy(null);
  };
  const getLink = (rotate = false) =>
    run(rotate ? "rotate" : "link", async () => {
      const { url } = await serverCall<{ url: string }>("/api/server/capture/link", { rotate });
      setLink(url);
      if (rotate) toast.ok("New link made. The old one no longer works.");
    });
  const textIt = () =>
    run("text", async () => {
      const st = useStore.getState();
      const k = st.settings.keys;
      if (!k.whatsappPhone || !k.whatsappApiKey) throw new Error("Connect WhatsApp (CallMeBot) on this page first.");
      await callApi("/api/notify", { channel: "whatsapp", title: "Coverage capture link", message: `Open on your phone, then Add to Home Screen:\n${link}`, whatsapp: { phone: k.whatsappPhone, apiKey: k.whatsappApiKey } }, st.settings);
      toast.ok("Sent to your WhatsApp.");
    });
  const saveTwilio = () =>
    run("twilio", async () => {
      const r = await serverCall<{ number: string; myPhone: string }>("/api/server/twilio/setup", form);
      setTw({ number: r.number, myPhone: r.myPhone });
      setForm(null);
      toast.ok(`Texts to ${r.number} now go to your capture inbox.`);
    });

  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      <div className="text-[12.5px] font-medium text-ink">Info sessions</div>
      <p className="text-[12px] text-muted">
        With Calendar connected, WhatsApp texts you 1–2 h before each info session and right after it, with a link to send who you met from your phone.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-ink-2">Phone capture link</span>
        {!link ? (
          <Button size="sm" loading={busy === "link"} onClick={() => getLink()}>
            Show link
          </Button>
        ) : (
          <>
            <code className="max-w-full truncate rounded bg-hover px-1.5 py-0.5 text-[11.5px]">{link.replace(/#k=.*/, "#k=…")}</code>
            <Button size="sm" onClick={() => navigator.clipboard.writeText(link).then(() => toast.ok("Copied."), () => toast.err("Couldn't copy."))}>
              Copy
            </Button>
            <Button size="sm" loading={busy === "text"} onClick={textIt}>
              Text it to my WhatsApp
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={busy === "rotate"}
              onClick={() => window.confirm("Make a new link? The old one (and any home-screen icon made from it) stops working.") && getLink(true)}
            >
              Rotate
            </Button>
          </>
        )}
      </div>
      <div className="space-y-2">
        {tw?.number ? (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <Badge tone="green">Twilio</Badge>
            <span>
              Text photos or names to <b>{tw.number}</b> from {tw.myPhone}
            </span>
            <Button
              size="sm"
              variant="ghost"
              loading={busy === "remove"}
              onClick={() =>
                run("remove", async () => {
                  await serverCall("/api/server/twilio/setup", { remove: true });
                  setTw({ number: null, myPhone: null });
                })
              }
            >
              Remove
            </Button>
          </div>
        ) : !form ? (
          <button
            className="text-[12px] text-navy underline"
            onClick={() => setForm({ sid: keys.twilioSid ?? "", token: keys.twilioToken ?? "", number: keys.twilioFrom ?? "", myPhone: keys.twilioTo ?? "" })}
          >
            Or text them to your own Twilio number…
          </button>
        ) : (
          <div className="grid max-w-xl gap-2 sm:grid-cols-2">
            <Field label="Account SID">
              <Input value={form.sid} onChange={(e) => setForm({ ...form, sid: e.target.value })} placeholder="AC…" autoComplete="off" />
            </Field>
            <Field label="Auth Token">
              <Input type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Twilio number">
              <Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="+13105550123" />
            </Field>
            <Field label="Your phone" hint="Only texts from this number are accepted.">
              <Input value={form.myPhone} onChange={(e) => setForm({ ...form, myPhone: e.target.value })} placeholder="+14255550123" />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" variant="primary" loading={busy === "twilio"} onClick={saveTwilio}>
                Connect number
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setForm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

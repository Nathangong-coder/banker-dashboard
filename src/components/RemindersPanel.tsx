"use client";

import { useMemo, useState } from "react";
import Link from "@/components/Link";
import { Bell, CalendarPlus, MessageSquare, Smartphone } from "lucide-react";
import { bankKey, useStore } from "@/lib/store";
import { nextAction } from "@/lib/followups";
import { callApi } from "@/lib/api";
import { buildIcs } from "@/lib/ics";
import { digestText, nightPlan, sendWhatsAppDigest, textTime, upcomingDigests, whatsappDigest } from "@/lib/reminders";
import { officeGapItems, officeGaps } from "@/lib/officeGaps";
import { download, fmtDate } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, toast } from "@/components/ui";
import { progressFor } from "@/lib/serverSync";
import { AutoSendCard } from "@/components/AutoSend";


export function Reminders() {
  const { contacts, banks, settings, scheduled, markScheduled, setSettings } = useStore();
  const k = settings.keys;
  const [busy, setBusy] = useState<string | null>(null);
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const digests = useMemo(() => upcomingDigests(contacts, banks, settings.followUp, 35), [contacts, banks, settings.followUp]);
  const todayDigest = digests[0]?.date === new Date().toLocaleDateString("en-CA") ? digests[0] : undefined;

  const send = async (channel: "ntfy" | "twilio" | "whatsapp", message: string, at?: Date, title = "Follow-ups due") =>
    callApi(
      "/api/notify",
      {
        channel,
        title,
        message,
        at: at?.toISOString(),
        ntfy: k.ntfyTopic ? { server: k.ntfyServer || "https://ntfy.sh", topic: k.ntfyTopic } : undefined,
        twilio: k.twilioSid
          ? { sid: k.twilioSid, token: k.twilioToken, from: k.twilioFrom || undefined, messagingServiceSid: k.twilioMessagingServiceSid || undefined, to: k.twilioTo }
          : undefined,
        whatsapp: k.whatsappPhone && k.whatsappApiKey ? { phone: k.whatsappPhone, apiKey: k.whatsappApiKey } : undefined,
      },
      settings,
    );

  const schedule = async (channel: "ntfy" | "twilio") => {
    const maxDays = channel === "ntfy" ? 3 : 35;
    const horizon = Date.now() + maxDays * 86_400_000;
    const list = digests.filter((d) => d.when.getTime() <= horizon && !scheduled[`${channel}:${d.date}`]);
    if (!list.length) return toast.info("Nothing new to schedule in that window.");
    setBusy(channel);
    let n = 0;
    for (const d of list) {
      try {
        const at = d.when.getTime() < Date.now() + 20 * 60_000 ? undefined : d.when;
        await send(channel, digestText(d), at, `${d.items.length} follow-up${d.items.length > 1 ? "s" : ""} due`);
        markScheduled(`${channel}:${d.date}`, new Date().toISOString());
        n++;
      } catch (e) {
        toast.err((e as Error).message);
        break;
      }
    }
    setBusy(null);
    if (n) toast.ok(`Scheduled ${n} daily reminder${n > 1 ? "s" : ""} via ${channel === "ntfy" ? "push" : "SMS"}.`);
  };

  const test = async (channel: "ntfy" | "twilio" | "whatsapp") => {
    setBusy(`test-${channel}`);
    try {
      const wa = channel === "whatsapp" ? whatsappDigest(contacts, banks, settings.followUp) : null;
      if (wa) {
        const n = await sendWhatsAppDigest(wa, (title, message) => send("whatsapp", message, undefined, title));
        toast.ok(`Sent${n > 1 ? ` as ${n} messages` : ""}. Check your phone.`);
      } else {
        await send(channel, todayDigest ? digestText(todayDigest) : "Test from your networking dashboard ✔ (nothing due today)", undefined, "Coverage test");
        toast.ok("Sent. Check your phone.");
      }
    } catch (e) {
      toast.err((e as Error).message);
    }
    setBusy(null);
  };

  const ics = () => {
    const events = contacts.flatMap((c) => {
      const a = nextAction(c, settings.followUp, banks[bankKey(c.bank, c.region)]);
      if ((a.kind !== "follow_up" && a.kind !== "move_on") || !a.due) return [];
      const start = a.due < new Date() ? new Date() : a.due;
      return [
        {
          uid: `${c.id}-${c.followUps}`,
          start,
          title: `${a.kind === "follow_up" ? "Follow up" : "Move on?"}: ${c.name} (${c.bank})`,
          description: `${c.position} · ${c.bank} ${c.region}\nEmail: ${c.email}\nFirst emailed: ${fmtDate(c.sentAt)} · follow-ups: ${c.followUps}`,
          url: c.linkedin || undefined,
        },
      ];
    });
    if (!events.length) return toast.info("No follow-up dates to export yet.");
    download(buildIcs(events), "follow-ups.ics", "text/calendar");
    toast.ok(`Exported ${events.length} reminders. Open the file to add them to Google or Apple Calendar.`);
  };

  const ntfyReady = !!k.ntfyTopic;
  const twilioReady = !!(k.twilioSid && k.twilioToken && k.twilioTo && (k.twilioFrom || k.twilioMessagingServiceSid));
  const whatsappReady = !!(k.whatsappPhone && k.whatsappApiKey);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
      <NightTextPreview />
      <Card className="overflow-hidden">
        <CardHeader title="Upcoming reminder digests" sub="Push / SMS / calendar: one message per day at 9am, listing everyone to follow up with" />
        {digests.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-muted">No follow-ups scheduled in the next 5 weeks.</div>
        ) : (
          <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
            {digests.map((d) => (
              <li key={d.date} className="px-5 py-2.5 hover:bg-subtle">
                <div className="flex items-center gap-2 text-[12.5px] font-medium">
                  {d.when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  <span className="num rounded-full bg-track px-1.5 text-[11px] text-muted">{d.items.length}</span>
                  {scheduled[`ntfy:${d.date}`] && <Badge tone="green">push</Badge>}
                  {scheduled[`twilio:${d.date}`] && <Badge tone="green">SMS</Badge>}
                </div>
                <div className="mt-0.5 truncate text-[12px] text-muted">{d.items.map((i) => i.c.name).join(", ")}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="space-y-6">
        <AutoSendCard />
        <Card>
          <CardHeader title="Alert channels" sub="Where your daily follow-up list goes. Keys and numbers live in Settings → Reminders." />
          <ul className="divide-y divide-line">
            <Channel
              icon={<Bell />}
              title="Browser notifications"
              sub="A daily alert whenever this dashboard is open"
              status={
                perm === "granted" ? <Badge tone="green">On</Badge> : <Badge tone="neutral">{perm === "denied" ? "Blocked in browser settings" : perm === "unsupported" ? "Not supported here" : "Off"}</Badge>
              }
            >
              {perm === "default" && (
                <Button size="sm" onClick={async () => setPerm(await Notification.requestPermission())}>
                  Enable
                </Button>
              )}
            </Channel>

            <Channel
              icon={<Smartphone />}
              title="Phone push (ntfy)"
              sub={ntfyReady ? "Free push notifications through the ntfy app. Can schedule up to 3 days ahead." : <SetupHint text="Install the ntfy app, subscribe to a hard-to-guess topic, and paste that topic in" />}
            >
              {ntfyReady && (
                <>
                  <Button size="sm" variant="ghost" loading={busy === "test-ntfy"} onClick={() => test("ntfy")}>
                    Send test
                  </Button>
                  <Button size="sm" variant="brass" loading={busy === "ntfy"} onClick={() => schedule("ntfy")}>
                    Schedule next 3 days
                  </Button>
                </>
              )}
            </Channel>

            <Channel
              icon={<MessageSquare />}
              title="Text messages (Twilio)"
              sub={
                twilioReady ? (
                  "SMS digests. Scheduling up to 35 days out needs a Messaging Service SID."
                ) : (
                  <SetupHint text="Add your Twilio Account SID, auth token, a From number or Messaging Service, and your phone number in" />
                )
              }
            >
              {twilioReady && (
                <>
                  <Button size="sm" variant="ghost" loading={busy === "test-twilio"} onClick={() => test("twilio")}>
                    Text me today’s list
                  </Button>
                  <Button size="sm" variant="brass" loading={busy === "twilio"} disabled={!k.twilioMessagingServiceSid} onClick={() => schedule("twilio")}>
                    Schedule upcoming
                  </Button>
                </>
              )}
            </Channel>

            <Channel
              icon={<MessageSquare />}
              title="WhatsApp (CallMeBot)"
              sub={
                whatsappReady ? (
                  <span title="With automatic sending on, the server sends it even when the dashboard is closed; otherwise it goes out the first time the dashboard is open after 9 PM.">
                    Free. Your list at 9 PM every night: today&apos;s thank-yous, replies and check-ins owed, and follow-ups due before the next text. The server sends it when automatic sending is on.
                  </span>
                ) : (
                  <SetupHint text="Message +34 694 23 41 84 on WhatsApp: “I allow callmebot to send me messages”, then paste the API key it replies with into" />
                )
              }
              status={whatsappReady && scheduled[`whatsapp:${new Date().toLocaleDateString("en-CA")}`] ? <Badge tone="green">sent today</Badge> : undefined}
            >
              {whatsappReady && (
                <>
                  <label className="flex items-center gap-1.5 text-[12.5px] whitespace-nowrap">
                    <Checkbox checked={settings.alerts?.whatsappDaily !== false} onChange={(on) => setSettings((x) => ({ ...x, alerts: { ...x.alerts, whatsappDaily: on } }))} />
                    Send automatically
                  </label>
                  <Button size="sm" variant="ghost" loading={busy === "test-whatsapp"} onClick={() => test("whatsapp")}>
                    WhatsApp me today’s list
                  </Button>
                </>
              )}
            </Channel>

            <Channel icon={<CalendarPlus />} title="Calendar" sub="Each follow-up becomes an all-day event with a 9am alert on your phone">
              <Button size="sm" onClick={ics} icon={<CalendarPlus className="size-3.5" />}>
                Download .ics
              </Button>
            </Channel>
          </ul>
        </Card>
      </div>
    </div>
  );
}

/** One alert channel: icon, name, one muted line, its status and buttons on the right. */
function Channel({ icon, title, sub, status, children }: { icon: React.ReactNode; title: string; sub: React.ReactNode; status?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 py-3.5">
      <span className="mt-0.5 text-muted [&>svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1 basis-[200px]">
        <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
          {title}
          {status}
        </div>
        <div className="mt-0.5 text-[12px] text-muted">{sub}</div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-1.5">{children}</div>}
    </li>
  );
}

function SetupHint({ text }: { text: string }) {
  return (
    <>
      {text}{" "}
      <Link href="/settings?tab=reminders" className="font-medium text-brass-ink underline">
        Settings
      </Link>
      .
    </>
  );
}

/** What tonight's 9 PM WhatsApp text will say (every night), from the same plan + big-banks summary the server gets. */
function NightTextPreview() {
  const contacts = useStore((s) => s.contacts);
  const banks = useStore((s) => s.banks);
  const followUp = useStore((s) => s.settings.followUp);
  const coverage = useStore((s) => s.coverage);
  const next = useMemo(() => {
    const st = useStore.getState();
    const plan = nightPlan(contacts, banks, followUp, 2);
    const day = Object.keys(plan).sort()[0] ?? null;
    let office: ReturnType<typeof officeGapItems> = [];
    try {
      office = officeGapItems(officeGaps({ contacts, tables: st.tables, targets: st.targets, coverage, banks, followUp }), Math.max(1, followUp.livePerBank));
    } catch {
      /* coverage couldn't be built */
    }
    const d = whatsappDigest(contacts, banks, followUp, { progress: progressFor(st), extraItems: office, maxLen: 4000 });
    return d ? { day: day ?? d.day, messages: d.messages } : null;
  }, [contacts, banks, followUp, coverage]);
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title={next ? `Next 9 PM text · ${textTime(next.day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}` : "Next 9 PM text"}
        sub="Every night, as up to 3 messages. The server adds Google Calendar calls (the past week's thank-yous, tomorrow's calls) when it sends; check-ins stop once you mark someone referred or Done."
      />
      {next ? (
        <div className="p-4">
          <pre className="max-h-[360px] overflow-y-auto rounded-lg border border-line bg-subtle p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">{next.messages.join("\n\n")}</pre>
        </div>
      ) : (
        <div className="p-6 text-center text-[13px] text-muted">Nothing to send in the next week.</div>
      )}
    </Card>
  );
}


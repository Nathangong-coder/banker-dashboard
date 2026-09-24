"use client";

import { useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useStore } from "@/lib/store";
import type { Settings } from "@/lib/types";
import { download } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";

function Secret({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        className="num pr-9 text-[12.5px]"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.trim())}
      />
      <button type="button" onClick={() => setShow(!show)} className="absolute top-2.5 right-2.5 text-muted hover:text-ink" aria-label={show ? "Hide" : "Show"}>
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

function KeyRow({ title, used, how, children, ok }: { title: string; used: string; how: ReactNode; children: ReactNode; ok: boolean }) {
  return (
    <div className="grid gap-3 border-b border-line px-4 py-4 last:border-0 md:grid-cols-[1fr_1.1fr]">
      <div>
        <div className="flex items-center gap-2 font-medium">
          {title} {ok ? <Badge tone="green">connected</Badge> : <Badge>not set</Badge>}
        </div>
        <p className="mt-0.5 text-[12px] text-ink-2">{used}</p>
        <p className="mt-1 text-[11.5px] text-muted">{how}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-navy underline">
    {children}
  </a>
);

export default function SettingsPage() {
  const { settings, setSettings, clearAll, replaceAll } = useStore();
  const importRef = useRef<HTMLInputElement>(null);
  const p = settings.profile;
  const k = settings.keys;
  const fu = settings.followUp;
  const setP = (patch: Partial<Settings["profile"]>) => setSettings((s) => ({ ...s, profile: { ...s.profile, ...patch } }));
  const setK = (patch: Partial<Settings["keys"]>) => setSettings((s) => ({ ...s, keys: { ...s.keys, ...patch } }));
  const setFu = (patch: Partial<Settings["followUp"]>) => setSettings((s) => ({ ...s, followUp: { ...s.followUp, ...patch } }));
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const exportBackup = (withKeys: boolean) => {
    const st = useStore.getState();
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: withKeys ? st.settings : { ...st.settings, keys: { ...st.settings.keys, apollo: "", hunter: "", serper: "", ai: "", twilioToken: "", whatsappApiKey: "" } },
      contacts: st.contacts,
      templates: st.templates,
      banks: st.banks,
      prospects: st.prospects,
    };
    download(JSON.stringify(data, null, 1), `coverage-backup-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
  };

  return (
    <>
      <PageHeader
        title="Settings & keys"
        sub="Keys live only in this browser's local storage. Each request sends them to the service that needs them and nothing else. Nothing is saved on the server."
        right={<Badge tone="green"><ShieldCheck className="size-3" /> Bring your own keys</Badge>}
      />

      <div className="space-y-6">
        <Card>
          <CardHeader title="Your profile" sub="Fills the {{my_*}} placeholders in templates" />
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <Field label="Full name"><Input value={p.name} onChange={(e) => setP({ name: e.target.value })} /></Field>
            <Field label="School"><Input value={p.school} placeholder="UCLA" onChange={(e) => setP({ school: e.target.value })} /></Field>
            <Field label="Class year"><Input value={p.year} placeholder="sophomore" onChange={(e) => setP({ year: e.target.value })} /></Field>
            <Field label="Major"><Input value={p.major} onChange={(e) => setP({ major: e.target.value })} /></Field>
            <Field label="Hometown"><Input value={p.hometown} placeholder="Seattle, WA" onChange={(e) => setP({ hometown: e.target.value })} /></Field>
            <Field label="Phone"><Input value={p.phone} onChange={(e) => setP({ phone: e.target.value })} /></Field>
            <Field label="LinkedIn"><Input value={p.linkedin} onChange={(e) => setP({ linkedin: e.target.value })} /></Field>
            <div className="md:col-span-2">
              <Field label="Signature (appended if not already in the template)">
                <Textarea rows={2} value={p.signature} onChange={(e) => setP({ signature: e.target.value })} />
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Data & AI services" />
          <KeyRow
            title="Apollo"
            ok={!!k.apollo}
            used="Enrich contact info (finds emails from LinkedIn + name). Optional second source for Find people."
            how={<>Apollo → Settings → Integrations → API → create a <b>master</b> key. <A href="https://app.apollo.io/#/settings/integrations/api">Open Apollo</A></>}
          >
            <Secret value={k.apollo} onChange={(v) => setK({ apollo: v })} placeholder="Apollo API key" />
            <label className="flex items-center gap-2 text-[12px] text-ink-2">
              <Checkbox
                checked={settings.enrich.revealPersonalEmails}
                onChange={(v) => setSettings((s) => ({ ...s, enrich: { revealPersonalEmails: v } }))}
              />
              Fall back to personal emails when there’s no work email (uses more credits)
            </label>
          </KeyRow>
          <KeyRow
            title="Hunter.io (optional)"
            ok={!!k.hunter}
            used="Backup email finder for anyone Apollo can’t match."
            how={<><A href="https://hunter.io/api-keys">hunter.io/api-keys</A> · 25 free searches/month</>}
          >
            <Secret value={k.hunter} onChange={(v) => setK({ hunter: v })} placeholder="Hunter API key" />
          </KeyRow>
          <KeyRow
            title="Serper (Google search)"
            ok={!!k.serper}
            used="Find people: searches Google for public LinkedIn profiles (name, headline, school, location). This app never logs in to or scrapes LinkedIn itself."
            how={<><A href="https://serper.dev">serper.dev</A> · 2,500 free searches</>}
          >
            <Secret value={k.serper} onChange={(v) => setK({ serper: v })} placeholder="Serper API key" />
          </KeyRow>
          <KeyRow
            title="AI (Claude)"
            ok={!!k.ai}
            used="Screens prospects against your criteria, auto-assigns templates, writes the personalized lines."
            how={<>An Anthropic key (<code>sk-ant-…</code>) from <A href="https://console.anthropic.com/settings/keys">console.anthropic.com</A>, or a Vercel AI Gateway key.</>}
          >
            <Secret value={k.ai} onChange={(v) => setK({ ai: v })} placeholder="sk-ant-… or AI Gateway key" />
            <Select className="w-full" value={k.aiModel} onChange={(e) => setK({ aiModel: e.target.value })} aria-label="Model">
              <option value="claude-sonnet-5">Claude Sonnet 5 (recommended)</option>
              <option value="claude-haiku-4-5">Claude Haiku 4.5 (cheapest)</option>
              <option value="claude-opus-5-5">Claude Opus 5.5 (best writing)</option>
            </Select>
          </KeyRow>
          <KeyRow
            title="Gmail"
            ok={!!k.googleClientId}
            used="Creates drafts with your resume attached, and syncs Sent mail and replies to fill in follow-up dates."
            how={
              <>
                Google Cloud Console → APIs & Services: enable the <b>Gmail API</b>, set up the OAuth consent screen (add yourself as a test user),
                then create an OAuth client ID of type <b>Web application</b> with authorized JavaScript origin <code className="rounded bg-[#efede5] px-1">{origin}</code>.{" "}
                <A href="https://console.cloud.google.com/apis/credentials">Open console</A>
              </>
            }
          >
            <Input className="num text-[12.5px]" value={k.googleClientId} onChange={(e) => setK({ googleClientId: e.target.value.trim() })} placeholder="xxxx.apps.googleusercontent.com" />
          </KeyRow>
        </Card>

        <Card id="alerts">
          <CardHeader title="Reminders & alerts" />
          <KeyRow
            title="ntfy push"
            ok={!!k.ntfyTopic}
            used="Push notifications to your phone. Free, no account needed."
            how={<>Install ntfy (<A href="https://ntfy.sh">ntfy.sh</A>) on your phone and subscribe to a long random topic name. Anyone who knows the topic can read it.</>}
          >
            <Input value={k.ntfyTopic} placeholder="e.g. coverage-7f3k29xq" onChange={(e) => setK({ ntfyTopic: e.target.value.trim() })} />
            <Input value={k.ntfyServer} placeholder="https://ntfy.sh" onChange={(e) => setK({ ntfyServer: e.target.value.trim() })} />
          </KeyRow>
          <KeyRow
            title="Twilio SMS"
            ok={!!(k.twilioSid && k.twilioToken && k.twilioTo)}
            used="Text message digests of who to follow up with."
            how={<><A href="https://console.twilio.com">console.twilio.com</A> · a Messaging Service SID lets you schedule texts ahead of time.</>}
          >
            <div className="grid grid-cols-2 gap-2">
              <Secret value={k.twilioSid} onChange={(v) => setK({ twilioSid: v })} placeholder="Account SID" />
              <Secret value={k.twilioToken} onChange={(v) => setK({ twilioToken: v })} placeholder="Auth token" />
              <Input value={k.twilioFrom} placeholder="From +1…" onChange={(e) => setK({ twilioFrom: e.target.value.trim() })} />
              <Input value={k.twilioMessagingServiceSid} placeholder="Messaging Service SID (MG…)" onChange={(e) => setK({ twilioMessagingServiceSid: e.target.value.trim() })} />
              <Input className="col-span-2" value={k.twilioTo} placeholder="Your phone +1…" onChange={(e) => setK({ twilioTo: e.target.value.trim() })} />
            </div>
          </KeyRow>
          <KeyRow
            title="WhatsApp (CallMeBot)"
            ok={!!(k.whatsappPhone && k.whatsappApiKey)}
            used="Free WhatsApp messages to yourself with today's follow-up list. Send-now only, no scheduling."
            how={
              <>
                On your phone, save <b>+34 694 23 41 84</b> as a contact and WhatsApp it:{" "}
                <i>I allow callmebot to send me messages</i>. It replies with your API key within about 2 minutes. If nothing arrives, try again after 24h.{" "}
                <A href="https://www.callmebot.com/blog/free-api-whatsapp-messages/">Instructions</A>
              </>
            }
          >
            <Input value={k.whatsappPhone} placeholder="Your WhatsApp number, e.g. +14255550123" onChange={(e) => setK({ whatsappPhone: e.target.value.trim() })} />
            <Secret value={k.whatsappApiKey} onChange={(v) => setK({ whatsappApiKey: v })} placeholder="CallMeBot API key" />
          </KeyRow>
        </Card>

        <Card>
          <CardHeader title="Follow-up rules" />
          <div className="grid gap-3 p-4 md:grid-cols-5">
            <Field label="First follow-up after (days)"><Input type="number" min={1} value={fu.firstAfterDays} onChange={(e) => setFu({ firstAfterDays: Number(e.target.value) || 1 })} /></Field>
            <Field label="Next follow-ups every (days)"><Input type="number" min={1} value={fu.nextAfterDays} onChange={(e) => setFu({ nextAfterDays: Number(e.target.value) || 1 })} /></Field>
            <Field label="Max follow-ups"><Input type="number" min={0} max={5} value={fu.maxFollowUps} onChange={(e) => setFu({ maxFollowUps: Number(e.target.value) || 0 })} /></Field>
            <Field label="Suggest moving on after (days)"><Input type="number" min={1} value={fu.moveOnAfterDays} onChange={(e) => setFu({ moveOnAfterDays: Number(e.target.value) || 1 })} /></Field>
            <Field label="Live people per bank" hint="Emailed, no reply yet"><Input type="number" min={1} max={20} value={fu.livePerBank} onChange={(e) => setFu({ livePerBank: Number(e.target.value) || 1 })} /></Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Backup & data" sub="Everything is stored in this browser. Export a backup to move to another computer." />
          <div className="flex flex-wrap gap-2 p-4">
            <Button onClick={() => exportBackup(false)}>Export backup (without keys)</Button>
            <Button onClick={() => exportBackup(true)}>Export with keys</Button>
            <Button onClick={() => importRef.current?.click()}>Import backup</Button>
            <input
              ref={importRef}
              type="file"
              accept=".json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  const d = JSON.parse(await f.text());
                  if (!Array.isArray(d.contacts)) throw new Error("Not a Coverage backup file");
                  replaceAll({
                    contacts: d.contacts,
                    templates: d.templates ?? useStore.getState().templates,
                    banks: d.banks ?? {},
                    prospects: d.prospects ?? [],
                    settings: { ...useStore.getState().settings, ...d.settings, keys: { ...useStore.getState().settings.keys, ...Object.fromEntries(Object.entries(d.settings?.keys ?? {}).filter(([, v]) => v)) } },
                  });
                  toast.ok(`Restored ${d.contacts.length} contacts.`);
                } catch (err) {
                  toast.err((err as Error).message);
                }
              }}
            />
            <div className="flex-1" />
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm("Delete all contacts, prospects and the stored spreadsheet from this browser? Keys and templates are kept.")) {
                  clearAll();
                  toast.ok("Cleared.");
                }
              }}
            >
              Clear all data
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

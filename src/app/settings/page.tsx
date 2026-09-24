"use client";

import { useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useStore } from "@/lib/store";
import type { Settings } from "@/lib/types";
import { download } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, PageHeader, Textarea, toast } from "@/components/ui";
import { AiVault, KeyVault, testKey } from "@/components/KeyVault";
import { aiReady, googleClientId, hasKey } from "@/lib/keys";
import { GmailSetup } from "@/components/GmailSetup";

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


type TestResult = { ok: boolean; note: string };

async function sendTest(body: Record<string, unknown>): Promise<TestResult> {
  const res = await fetch("/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Coverage connected ✅", message: "Test from your networking dashboard. Reminders will arrive here.", ...body }),
  });
  const j = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, note: "Test message sent. Check your phone." } : { ok: false, note: j.error ?? `HTTP ${res.status}` };
}

/** Draft fields that are only committed to settings after `test` passes. */
function TestedFields<K extends string>({
  saved,
  summary,
  initial,
  fields,
  test,
  onSave,
  onClear,
  actionLabel = "Test & save",
}: {
  saved: boolean;
  summary?: ReactNode;
  initial: Record<K, string>;
  fields: { key: K; placeholder: string; secret?: boolean }[];
  test: (d: Record<K, string>) => Promise<TestResult>;
  onSave: (d: Record<K, string>) => void;
  onClear: () => void;
  actionLabel?: string;
}) {
  const [editing, setEditing] = useState(!saved);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<TestResult | null>(null);

  if (saved && !editing)
    return (
      <div className="flex items-center gap-2 text-[12.5px]">
        <Badge tone="green">verified</Badge>
        <span className="flex-1 truncate text-ink-2">{summary}</span>
        <Button size="sm" variant="ghost" onClick={() => { setDraft(initial); setEditing(true); setMsg(null); }}>Change</Button>
        <Button size="sm" variant="ghost" onClick={onClear}>Remove</Button>
      </div>
    );

  const run = async () => {
    const d = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, String(v ?? "").trim()])) as Record<K, string>;
    setBusy(true);
    const r = await test(d);
    setBusy(false);
    setMsg(r);
    if (r.ok) {
      onSave(d);
      setEditing(false);
      toast.ok(r.note);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className={fields.length > 2 ? "grid grid-cols-2 gap-1.5" : "space-y-1.5"}>
        {fields.map((f) =>
          f.secret ? (
            <Secret key={f.key} value={draft[f.key] ?? ""} placeholder={f.placeholder} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />
          ) : (
            <Input key={f.key} className="text-[12.5px]" value={draft[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
          ),
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" loading={busy} onClick={run}>{actionLabel}</Button>
        {saved && <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
        {msg && !msg.ok && <span className="text-[12px] text-red">{msg.note}</span>}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, setSettings, clearAll, replaceAll } = useStore();
  const importRef = useRef<HTMLInputElement>(null);
  const p = settings.profile;
  const k = settings.keys;
  const fu = settings.followUp;
  const setP = (patch: Partial<Settings["profile"]>) => setSettings((s) => ({ ...s, profile: { ...s.profile, ...patch } }));
  const setK = (patch: Partial<Settings["keys"]>) => setSettings((s) => ({ ...s, keys: { ...s.keys, ...patch } }));
  const setFu = (patch: Partial<Settings["followUp"]>) => setSettings((s) => ({ ...s, followUp: { ...s.followUp, ...patch } }));

  const exportBackup = (withKeys: boolean) => {
    const st = useStore.getState();
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: withKeys
        ? st.settings
        : { ...st.settings, vault: { apollo: [], hunter: [], serper: [], brave: [], ai: [] }, keys: { ...st.settings.keys, twilioToken: "", whatsappApiKey: "" } },
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
            <Field label="Major" hint="As it reads in “I’m a ___ student”"><Input value={p.major} placeholder="economics & applied mathematics" onChange={(e) => setP({ major: e.target.value })} /></Field>
            <Field label="Hometown"><Input value={p.hometown} placeholder="Seattle, WA" onChange={(e) => setP({ hometown: e.target.value })} /></Field>
            <Field label="Phone"><Input value={p.phone} onChange={(e) => setP({ phone: e.target.value })} /></Field>
            <Field label="LinkedIn"><Input value={p.linkedin} onChange={(e) => setP({ linkedin: e.target.value })} /></Field>
            <Field label="School nickname" hint="“Fellow Bruin…”"><Input value={p.schoolNickname} placeholder="Bruin" onChange={(e) => setP({ schoolNickname: e.target.value })} /></Field>
            <Field label="School city" hint="“…went to college in LA”"><Input value={p.schoolCity} placeholder="LA" onChange={(e) => setP({ schoolCity: e.target.value })} /></Field>
            <Field label="Club"><Input value={p.club} placeholder="e.g. Bruin Finance Society" onChange={(e) => setP({ club: e.target.value })} /></Field>
            <div className="md:col-span-3">
              <Field label="Background line ({{my_pitch}})" hint="1–2 sentences used right after your intro in most templates.">
                <Textarea rows={2} value={p.pitch} placeholder="Through my software development internship and starting my own tech startup, I've developed a strong interest in the tech sector." onChange={(e) => setP({ pitch: e.target.value })} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Signature (appended if not already in the template)">
                <Textarea rows={2} value={p.signature} onChange={(e) => setP({ signature: e.target.value })} />
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Data & AI services"
            sub="Every key is tested live before it's saved. Add several per service and they'll be used in order, falling through when one is rejected or out of credits."
          />
          <KeyRow
            title="Apollo"
            ok={hasKey(settings, "apollo")}
            used="Enrich contact info (finds emails from LinkedIn + name). Optional second source for Find people."
            how={<>Apollo → Settings → Integrations → API → create a <b>master</b> key (search needs master; email lookups work with any). <A href="https://app.apollo.io/#/settings/integrations/api">Open Apollo</A></>}
          >
            <KeyVault service="apollo" placeholder="Apollo API key" />
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
            ok={hasKey(settings, "hunter")}
            used="Backup email finder for anyone Apollo can’t match."
            how={<><A href="https://hunter.io/api-keys">hunter.io/api-keys</A> · 25 free searches/month. Testing is free.</>}
          >
            <KeyVault service="hunter" placeholder="Hunter API key" />
          </KeyRow>
          <KeyRow
            title="Serper (Google search)"
            ok={hasKey(settings, "serper")}
            used="Find people: searches Google for public LinkedIn profiles (name, headline, school, location). This app never logs in to or scrapes LinkedIn itself."
            how={<><A href="https://serper.dev">serper.dev</A> · 2,500 free searches. Testing a key uses 1 search.</>}
          >
            <KeyVault service="serper" placeholder="Serper API key" />
          </KeyRow>
          <KeyRow
            title="Brave Search (backup)"
            ok={hasKey(settings, "brave")}
            used="Same LinkedIn-profile search as Serper, used when Serper has no key or fails."
            how={<><A href="https://api-dashboard.search.brave.com/app/keys">api-dashboard.search.brave.com</A>: pick the free plan, then create an API key. Testing uses 1 query.</>}
          >
            <KeyVault service="brave" placeholder="Brave Search API key" />
          </KeyRow>
          <KeyRow
            title="AI model"
            ok={aiReady(settings)}
            used="Screens prospects against your criteria, auto-assigns templates, writes the personalized lines."
            how={<>Claude, GPT, Gemini, DeepSeek, GLM, anything OpenAI-compatible, or a Vercel AI Gateway key (one key, every model). Model lists are pulled from your key.</>}
          >
            <AiVault />
          </KeyRow>
          <KeyRow
            title="Gmail"
            ok={!!googleClientId(settings)}
            used="Creates drafts with your resume attached, and syncs Sent mail and replies to fill in follow-up dates."
            how={<>Needs a Google <b>OAuth Client ID</b> (not the secret). It takes about 10 minutes once; the steps are on the right.</>}
          >
            <GmailSetup />
          </KeyRow>
        </Card>

        <Card id="alerts">
          <CardHeader title="Reminders & alerts" sub="Each one sends a real test message before it's saved." />
          <KeyRow
            title="WhatsApp (CallMeBot)"
            ok={!!(k.whatsappPhone && k.whatsappApiKey)}
            used="Free “what’s due today” pings to your own WhatsApp."
            how={
              <>
                On your phone, save <b>+34 694 23 41 84</b> as a contact and WhatsApp it:{" "}
                <i>I allow callmebot to send me messages</i>. It replies with your API key within about 2 minutes. If nothing arrives, try again after 24h.{" "}
                <A href="https://www.callmebot.com/blog/free-api-whatsapp-messages/">Instructions</A>
              </>
            }
          >
            <TestedFields
              saved={!!(k.whatsappPhone && k.whatsappApiKey)}
              summary={k.whatsappPhone}
              initial={{ whatsappPhone: k.whatsappPhone, whatsappApiKey: k.whatsappApiKey }}
              fields={[
                { key: "whatsappPhone", placeholder: "Your WhatsApp number, e.g. +14255550123" },
                { key: "whatsappApiKey", placeholder: "CallMeBot API key", secret: true },
              ]}
              test={(d) => sendTest({ channel: "whatsapp", whatsapp: { phone: d.whatsappPhone, apiKey: d.whatsappApiKey } })}
              onSave={(d) => setK(d)}
              onClear={() => setK({ whatsappPhone: "", whatsappApiKey: "" })}
            />
          </KeyRow>
          <KeyRow
            title="ntfy push"
            ok={!!k.ntfyTopic}
            used="Free push notifications to your phone. No account needed."
            how={<>Install ntfy (<A href="https://ntfy.sh">ntfy.sh</A>) on your phone and subscribe to a long random topic name. Anyone who knows the topic can read it.</>}
          >
            <TestedFields
              saved={!!k.ntfyTopic}
              summary={k.ntfyTopic}
              initial={{ ntfyTopic: k.ntfyTopic, ntfyServer: k.ntfyServer || "https://ntfy.sh" }}
              fields={[
                { key: "ntfyTopic", placeholder: "e.g. coverage-7f3k29xq" },
                { key: "ntfyServer", placeholder: "https://ntfy.sh" },
              ]}
              test={(d) => sendTest({ channel: "ntfy", ntfy: { server: d.ntfyServer || "https://ntfy.sh", topic: d.ntfyTopic } })}
              onSave={(d) => setK(d)}
              onClear={() => setK({ ntfyTopic: "" })}
            />
          </KeyRow>
          <KeyRow
            title="Twilio SMS"
            ok={!!(k.twilioSid && k.twilioToken && k.twilioTo)}
            used="Text messages (paid). See the README for setup."
            how={<><A href="https://console.twilio.com">console.twilio.com</A>. Credentials are checked against your Twilio account (free), then a test text is sent.</>}
          >
            <TestedFields
              saved={!!(k.twilioSid && k.twilioToken && k.twilioTo)}
              summary={k.twilioTo && `texts ${k.twilioTo}`}
              initial={{ twilioSid: k.twilioSid, twilioToken: k.twilioToken, twilioFrom: k.twilioFrom, twilioMessagingServiceSid: k.twilioMessagingServiceSid, twilioTo: k.twilioTo }}
              fields={[
                { key: "twilioSid", placeholder: "Account SID (AC…)", secret: true },
                { key: "twilioToken", placeholder: "Auth token", secret: true },
                { key: "twilioFrom", placeholder: "From number +1…" },
                { key: "twilioMessagingServiceSid", placeholder: "Messaging Service SID (MG…, optional)" },
                { key: "twilioTo", placeholder: "Your phone +1…" },
              ]}
              test={async (d) => {
                const acct = await testKey({ service: "twilio", sid: d.twilioSid, token: d.twilioToken });
                if (!acct.ok) return acct;
                if (!d.twilioTo || (!d.twilioFrom && !d.twilioMessagingServiceSid)) return { ok: false, note: "Add your phone number and a From number (or Messaging Service SID)." };
                const sms = await sendTest({
                  channel: "twilio",
                  twilio: { sid: d.twilioSid, token: d.twilioToken, from: d.twilioFrom || undefined, messagingServiceSid: d.twilioMessagingServiceSid || undefined, to: d.twilioTo },
                });
                return sms.ok ? { ok: true, note: `${acct.note}. Test text sent.` } : sms;
              }}
              onSave={(d) => setK(d)}
              onClear={() => setK({ twilioSid: "", twilioToken: "", twilioFrom: "", twilioMessagingServiceSid: "", twilioTo: "" })}
            />
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
                    settings: mergeImportedSettings(useStore.getState().settings, d.settings),
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

/** Restore a backup without wiping keys the backup doesn't contain (backups are usually exported without keys). */
function mergeImportedSettings(cur: Settings, incoming?: Partial<Settings>): Settings {
  if (!incoming) return cur;
  const vault = { ...cur.vault };
  for (const svc of Object.keys(vault) as (keyof Settings["vault"])[]) {
    const extra = (incoming.vault?.[svc] ?? []).filter((e) => !vault[svc].some((x) => x.value === e.value));
    vault[svc] = [...vault[svc], ...extra];
  }
  const keys = { ...cur.keys, ...Object.fromEntries(Object.entries(incoming.keys ?? {}).filter(([, v]) => v)) };
  return { ...cur, ...incoming, keys, vault, ai: incoming.ai && vault.ai.some((k) => k.provider === incoming.ai!.provider) ? incoming.ai : cur.ai };
}

"use client";

import { AccountSettings, restoreBackupHere } from "@/components/Account";
import { isFullBackup } from "@/lib/backup";
import { useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { OutreachRulesEditor } from "@/components/OutreachRules";
import { HooksEditor } from "@/components/Hooks";
import { useStore } from "@/lib/store";
import { EMAIL_FONTS, type EmailFont, type Settings } from "@/lib/types";
import { cn, download } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { AiVault, KeyVault, testKey } from "@/components/KeyVault";
import { aiReady, googleClientId, hasKey } from "@/lib/keys";
import { GmailSetup } from "@/components/GmailSetup";
import { LabSetup } from "@/components/LabSetup";
import { SchedulingSettingsEditor } from "@/components/SchedulingSettings";
import { AutoSendCard, SendModeSwitch } from "@/components/AutoSend";
import { SendWindowEditor } from "@/components/SendWindowEditor";
import { AnalyticsSetting } from "@/components/Consent";
import { checkEmail, checkLinkedIn, checkName, checkPhone } from "@/lib/validate";
import { bodyToHtml, unwrapRedirects, withSignature } from "@/lib/emailFormat";
import { ResumeCard } from "@/components/ResumeCard";
import { InterestsEditor } from "@/components/PrepInterests";
import { SignatureLogoEditor, useSignatureLogoPreview } from "@/components/SignatureLogo";
import { ThemePicker } from "@/components/ThemePicker";
import Link from "next/link";

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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 border-b border-line px-4 py-4 last:border-0 md:grid-cols-[1fr_1.1fr]">
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

type Tab = "account" | "profile" | "email" | "outreach" | "data" | "reminders" | "appearance" | "backup";
type Sub = "writing" | "sending" | "scheduling" | "experiments";
const TABS: [Tab, string][] = [
  ["account", "Account"],
  ["profile", "Profile"],
  ["email", "Email"],
  ["outreach", "Outreach rules"],
  ["data", "Data & AI"],
  ["reminders", "Reminders"],
  ["appearance", "Appearance"],
  ["backup", "Backup"],
];
const SUBS: [Sub, string, string][] = [
  ["writing", "Writing", "Hooks, font, signature"],
  ["sending", "Sending", "Send window, who sends, follow-up rules"],
  ["scheduling", "Scheduling", "Your call availability, and the reply / calendar invite templates"],
  ["experiments", "Experiments", "A/B tests, shared wording, new angles (results: Email lab)"],
];

function readTab(): { tab: Tab; sub: Sub } {
  if (typeof window === "undefined") return { tab: "profile", sub: "writing" };
  const q = new URLSearchParams(window.location.search);
  const t = (q.get("tab") ?? (window.location.hash === "#alerts" ? "reminders" : "")) as Tab;
  const sub = q.get("sub") as Sub;
  return { tab: TABS.some(([k]) => k === t) ? t : "profile", sub: SUBS.some(([k]) => k === sub) ? sub : "writing" };
}

function SettingsTabs({ tab, sub, onTab }: { tab: Tab; sub: Sub; onTab: (t: Tab, s?: Sub) => void }) {
  return (
    <div className="mb-5 space-y-2">
      <div className="inline-flex max-w-full flex-wrap rounded-lg bg-hover p-[3px]">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            onClick={() => onTab(t)}
            className={cn("rounded-md px-3.5 py-1.5 text-[13px] font-medium", tab === t ? "bg-panel text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-2 hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "email" && (
        <div className="flex flex-wrap gap-1.5">
          {SUBS.map(([k, label, hint]) => (
            <button
              key={k}
              onClick={() => onTab("email", k)}
              title={hint}
              className={cn("rounded-full border px-3 py-1 text-[12.5px]", sub === k ? "border-navy bg-navy/5 font-medium text-navy" : "border-line-2 text-ink-2 hover:border-navy/40")}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { settings, setSettings, clearAll, replaceAll } = useStore();
  const [{ tab, sub }, setTabState] = useState(readTab);
  const go = (t: Tab, s?: Sub) => {
    const next = { tab: t, sub: s ?? (t === "email" ? sub : "writing") };
    setTabState(next);
    window.history.replaceState(null, "", `/settings?tab=${next.tab}${next.tab === "email" ? `&sub=${next.sub}` : ""}`);
  };
  const importRef = useRef<HTMLInputElement>(null);
  const p = settings.profile;
  const logoPreview = useSignatureLogoPreview();
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
        : { ...st.settings, vault: { apollo: [], hunter: [], serper: [], brave: [], jev: [], ai: [] }, keys: { ...st.settings.keys, twilioToken: "", whatsappApiKey: "" }, server: undefined },
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
        title="Settings"
        sub="Your data and API keys are saved to your Coverage account (encrypted), so they're on every browser you sign in to. Each request sends a key only to the service that needs it."
        right={<Badge tone="green"><ShieldCheck className="size-3" /> Bring your own keys</Badge>}
      />

      <SettingsTabs tab={tab} sub={sub} onTab={go} />
      <div className="space-y-6">
        {tab === "profile" && (
          <>
        <Card>
          <CardHeader title="Your profile" sub="Fills the {{my_*}} placeholders in templates" />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4 md:grid-cols-3">
            <Field label="Full name" error={p.name ? checkName(p.name) : undefined}><Input autoComplete="name" value={p.name} onChange={(e) => setP({ name: e.target.value })} /></Field>
            <Field label="School"><Input value={p.school} placeholder="UCLA" onChange={(e) => setP({ school: e.target.value })} /></Field>
            <Field label="Class year"><Input value={p.year} placeholder="sophomore" onChange={(e) => setP({ year: e.target.value })} /></Field>
            <Field label="Major" hint="As it reads in “I’m a ___ student”"><Input value={p.major} placeholder="economics & applied mathematics" onChange={(e) => setP({ major: e.target.value })} /></Field>
            <Field label="Hometown"><Input value={p.hometown} placeholder="Seattle, WA" onChange={(e) => setP({ hometown: e.target.value })} /></Field>
            <Field label="Email (for signature)" error={checkEmail(p.email)}><Input type="email" autoComplete="email" aria-invalid={!!checkEmail(p.email)} value={p.email} placeholder="you@g.ucla.edu" onChange={(e) => setP({ email: e.target.value.trim() })} /></Field>
            <Field label="Phone" error={checkPhone(p.phone)}><Input type="tel" autoComplete="tel" aria-invalid={!!checkPhone(p.phone)} value={p.phone} onChange={(e) => setP({ phone: e.target.value })} /></Field>
            <Field label="LinkedIn URL" hint="Linked as “LinkedIn” in your signature" error={checkLinkedIn(unwrapRedirects(p.linkedin))}><Input inputMode="url" aria-invalid={!!checkLinkedIn(unwrapRedirects(p.linkedin))} value={p.linkedin} placeholder="https://www.linkedin.com/in/you" onChange={(e) => setP({ linkedin: e.target.value.trim() })} /></Field>
            <Field label="School nickname" hint="“Fellow Bruin…”"><Input value={p.schoolNickname} placeholder="Bruin" onChange={(e) => setP({ schoolNickname: e.target.value })} /></Field>
            <Field label="School city" hint="“…went to college in LA”"><Input value={p.schoolCity} placeholder="LA" onChange={(e) => setP({ schoolCity: e.target.value })} /></Field>
            <Field label="Club"><Input value={p.club} placeholder="e.g. Bruin Finance Society" onChange={(e) => setP({ club: e.target.value })} /></Field>
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Sector interests"
            sub="The sectors and sub-verticals you're recruiting for. Coffee chat prep uses them for each bank's recent deals and your “Why this bank” answer."
          />
          <div className="p-4">
            <InterestsEditor />
          </div>
        </Card>
        <ResumeCard />
          </>
        )}
        {tab === "email" && sub === "writing" && (
          <>
        <Card>
          <CardHeader title="Writing" sub="Your hooks ({{my_pitch}}), the font drafts are made in, and your signature" />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4 md:grid-cols-3">
            <div className="md:col-span-3">
              <div className="mb-1 text-[12.5px] font-medium text-ink-2">Hooks ({"{{my_pitch}}"})</div>
              <HooksEditor />
            </div>
            <Field
              label="Email font"
              hint={(settings.experiments ?? []).some((x) => x.status === "running" && x.kind === "font") ? "A font experiment is running (Email lab); it picks the font until it ends" : "Used for drafts created in Gmail"}
            >
              <Select
                className="w-full"
                value={settings.emailStyle.font}
                onChange={(e) => setSettings((st) => ({ ...st, emailStyle: { ...st.emailStyle, font: e.target.value as EmailFont } }))}
                style={{ fontFamily: EMAIL_FONTS[settings.emailStyle.font].css }}
              >
                {(Object.keys(EMAIL_FONTS) as EmailFont[]).map((f) => (
                  <option key={f} value={f} style={{ fontFamily: EMAIL_FONTS[f].css }}>
                    {EMAIL_FONTS[f].label}
                  </option>
                ))}
              </Select>
            </Field>
            <SmartMentionsField />
            <div className="md:col-span-2">
              <Field
                label="Custom signature (optional)"
                hint={
                  <>
                    Replaces the lines under your full name. Wrap a line in *asterisks* for italics. The word “LinkedIn” links straight to
                    your LinkedIn URL, and phone numbers stay plain text. Leave empty to build it from your profile. Every email ends like this:
                  </>
                }
              >
                <Textarea rows={3} value={p.signature} onChange={(e) => setP({ signature: e.target.value })} />
              </Field>
              <div
                className="mt-2 rounded-md border border-line bg-white px-3 py-2 text-[13px] text-[#222]"
                // Built from your own profile fields; bodyToHtml escapes them.
                dangerouslySetInnerHTML={{ __html: bodyToHtml(withSignature(`Sincerely,\n${p.name.trim().split(/\s+/)[0] || "First"}`, p), EMAIL_FONTS[settings.emailStyle.font]?.css, logoPreview) }}
              />
              <div className="mt-3">
                <SignatureLogoEditor />
              </div>
            </div>
          </div>
        </Card>
          </>
        )}
        {tab === "email" && sub === "sending" && (
          <>
            <SendWindowEditor />
            <Card>
              <CardHeader title="Who sends" sub="Coverage sends scheduled drafts itself, or you schedule each one in Gmail" />
              <div className="p-4">
                <SendModeSwitch onAuto={() => go("reminders")} />
              </div>
            </Card>
        <Card>
          <CardHeader title="Follow-up rules" />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4 md:grid-cols-5">
            <Field label="First follow-up after (days)"><Input type="number" min={1} value={fu.firstAfterDays} onChange={(e) => setFu({ firstAfterDays: Number(e.target.value) || 1 })} /></Field>
            <Field label="Next follow-ups every (days)"><Input type="number" min={1} value={fu.nextAfterDays} onChange={(e) => setFu({ nextAfterDays: Number(e.target.value) || 1 })} /></Field>
            <Field label="Max follow-ups"><Input type="number" min={0} max={5} value={fu.maxFollowUps} onChange={(e) => setFu({ maxFollowUps: Number(e.target.value) || 0 })} /></Field>
            <Field label="Suggest moving on after (days)"><Input type="number" min={1} value={fu.moveOnAfterDays} onChange={(e) => setFu({ moveOnAfterDays: Number(e.target.value) || 1 })} /></Field>
            <Field label="Live people per team" hint="Emailed, no reply yet. Counted per bank + office + team (SF Tech and NY Tech are separate)"><Input type="number" min={1} max={20} value={fu.livePerBank} onChange={(e) => setFu({ livePerBank: Number(e.target.value) || 1 })} /></Field>
          </div>
        </Card>

          </>
        )}
        {tab === "email" && sub === "scheduling" && <SchedulingSettingsEditor />}
        {tab === "email" && sub === "experiments" && <LabSetup />}
        {tab === "outreach" && <OutreachRulesEditor />}
        {tab === "data" && (
          <>
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
            title="Jev (TypeSafe)"
            ok={hasKey(settings, "jev")}
            used="A cheap judgment model: sorts the jobs Find jobs turns up and picks dropdown answers on applications (your AI model writes the text answers). Optional."
            how={<><A href="https://typesafe.ai">typesafe.ai</A>: create an API key. About $0.04 per million input tokens; testing is free.</>}
          >
            <KeyVault service="jev" placeholder="TypeSafe API key" />
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

          </>
        )}
        {tab === "reminders" && (
          <>
            <AutoSendCard />
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

          </>
        )}
        {tab === "account" && <AccountSettings />}
        {tab === "appearance" && (
          <Card>
            <CardHeader title="Color theme" sub="Applies right away, in this browser." />
            <ThemePicker />
          </Card>
        )}
        {tab === "backup" && (
          <>
            <Card>
              <CardHeader title="Privacy" sub="Your data is saved to your Coverage account, encrypted. See the Privacy Policy for the details." />
              <div className="flex flex-wrap items-center gap-4 p-4">
                <AnalyticsSetting />
                <Link href="/privacy" className="text-[12.5px] text-navy underline">
                  Privacy Policy
                </Link>
                <Link href="/terms" className="text-[12.5px] text-navy underline">
                  Terms of Use
                </Link>
              </div>
            </Card>
            <AdminSetting />
        <Card>
          <CardHeader title="Backup & data" sub="Settings → Account → Download everything makes a complete backup. These older exports have contacts, templates and settings only; Import backup reads both kinds." />
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
                  if (isFullBackup(d)) {
                    const n = await restoreBackupHere(d);
                    if (n === null) return;
                    toast.ok(`Restored ${n} contacts. Reloading…`);
                    setTimeout(() => window.location.reload(), 800);
                    return;
                  }
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
          </>
        )}
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

/** Admin mode: shows admin-only settings (the grading rubric on Activity log → ⋯). A view switch, not a lock: there are no logins. */
function AdminSetting() {
  const admin = useStore((s) => !!s.settings.admin);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <Card>
      <CardHeader title="Admin" sub="Admin-only settings, hidden from the normal views." />
      <label className="flex flex-wrap items-center gap-2 p-4 text-[13px]">
        <Checkbox checked={admin} onChange={(v) => setSettings((s) => ({ ...s, admin: v || undefined }))} label="Admin mode" />
        Admin mode
        <span className="text-[12px] text-muted">Adds the grading rubric editor (Activity log → ⋯ → Grading rubric).</span>
      </label>
    </Card>
  );
}

/** Smart mentions (lib/smartMention.ts): on/off and the lowest chat rating that gets mentioned. */
function SmartMentionsField() {
  const cfg = useStore((s) => s.settings.emailStyle.smartMentions);
  const setSettings = useStore((s) => s.setSettings);
  const on = cfg?.on ?? true;
  const min = cfg?.minRating ?? 6;
  const set = (patch: Partial<{ on: boolean; minRating: number }>) =>
    setSettings((st) => ({ ...st, emailStyle: { ...st.emailStyle, smartMentions: { on, minRating: min, ...patch } } }));
  return (
    <Field
      label="Smart mentions"
      hint="After a good chat at a bank, first emails and follow-ups to others there name that person and one or two things they told you, taken only from your chat notes (and the chat's Google Doc, if it's shared by link)."
    >
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <label className="inline-flex items-center gap-1.5">
          <Checkbox checked={on} onChange={(v) => set({ on: v })} label="Smart mentions on" />
          On, for chats rated
        </label>
        <Select className="w-20" value={String(min)} disabled={!on} onChange={(e) => set({ minRating: Number(e.target.value) })} aria-label="Lowest rating to mention">
          {[5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>
              {n}/10
            </option>
          ))}
        </Select>
        <span className="text-muted">or better</span>
      </div>
    </Field>
  );
}

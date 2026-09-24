"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { useStore } from "@/lib/store";
import { googleClientId } from "@/lib/keys";
import { connectGmail, gmailProfile } from "@/lib/gmail";
import { Badge, Button, Input, toast } from "./ui";

const L = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-navy underline">
    {children}
    <ExternalLink className="size-3" />
  </a>
);

const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-[#efede5] px-1 py-px text-[11.5px]">{children}</code>;

/** Step-by-step Google Cloud setup + a live connection test. Only a Client ID is needed (never the secret). */
export function GmailSetup() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const own = settings.keys.googleClientId;
  const effective = googleClientId(settings);
  const usingDefault = !own && !!effective;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [draft, setDraft] = useState(own);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; note: string } | null>(null);
  const [open, setOpen] = useState(!effective);

  const test = async (clientId: string, save: boolean) => {
    const id = clientId.trim();
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) {
      setResult({ ok: false, note: "That doesn't look like a Client ID. It should end in .apps.googleusercontent.com (don't paste the Client secret)." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await connectGmail(id, { force: true });
      const email = await gmailProfile(id);
      if (save) setSettings((s) => ({ ...s, keys: { ...s.keys, googleClientId: id } }));
      setResult({ ok: true, note: `Connected as ${email}. Drafts and sync will use this account.` });
      toast.ok(`Gmail connected: ${email}`);
    } catch (e) {
      setResult({ ok: false, note: explain((e as Error).message, origin) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {effective ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <Badge tone="green">{usingDefault ? "using this site's Client ID" : "your Client ID"}</Badge>
          <span className="num truncate text-ink-2">{effective.slice(0, 22)}…</span>
          <Button size="sm" variant="primary" loading={busy} onClick={() => test(effective, false)}>
            Test Gmail connection
          </Button>
          {own && (
            <Button size="sm" variant="ghost" onClick={() => setSettings((s) => ({ ...s, keys: { ...s.keys, googleClientId: "" } }))}>
              Remove
            </Button>
          )}
        </div>
      ) : null}

      {!usingDefault && (
        <div className="flex gap-1.5">
          <Input className="num text-[12.5px]" placeholder="1234567890-abc123.apps.googleusercontent.com" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button loading={busy} onClick={() => test(draft, true)} disabled={!draft.trim()}>
            Sign in to test & save
          </Button>
        </div>
      )}
      {result && (
        <p className={`flex items-start gap-1.5 text-[12px] ${result.ok ? "text-green" : "text-red"}`}>
          {result.ok && <CheckCircle2 className="mt-px size-3.5 shrink-0" />}
          {result.note}
        </p>
      )}

      <button className="text-[12px] font-medium text-navy hover:underline" onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} step-by-step Google setup (~10 min, one time)
      </button>
      {open && (
        <ol className="list-decimal space-y-2.5 rounded-md border border-line bg-[#fbfaf6] py-3 pr-3 pl-7 text-[12.5px] leading-relaxed text-ink-2">
          <li>
            <b>Create a project.</b> <L href="https://console.cloud.google.com/projectcreate">New project</L>. Any name works, e.g. “Coverage”.
          </li>
          <li>
            <b>Turn on the Gmail API</b> for that project: <L href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Gmail API</L> → <b>Enable</b>.
          </li>
          <li>
            <b>Set up the consent screen</b>: <L href="https://console.cloud.google.com/auth/overview">Google Auth Platform</L> → Get started. App name + your email, audience{" "}
            <b>External</b>. Then under <b>Audience → Test users</b>, add every Gmail address that will use the app (including yours). Leave it in <b>Testing</b>, with no
            verification needed for up to 100 test users.
          </li>
          <li>
            <b>Create the Client ID</b>: <L href="https://console.cloud.google.com/auth/clients">Clients</L> → Create client → type <b>Web application</b>.
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                Under <b>Authorized JavaScript origins</b> add <Code>{origin || "https://your-app.vercel.app"}</Code>
                {origin.startsWith("http://localhost") ? " and your Vercel URL" : " and http://localhost:3000 for local testing"}.
              </li>
              <li>
                Leave <b>Authorized redirect URIs</b> empty. This app uses Google’s popup sign-in, which checks origins, not redirect URIs.
              </li>
            </ul>
          </li>
          <li>
            Copy the <b>Client ID</b> (ends in <Code>.apps.googleusercontent.com</Code>) and paste it above. <b>You don’t need the Client secret.</b> Sign-in
            happens in the browser, and a secret must never be put in a web page. Keep it private or delete it.
          </li>
          <li>
            Click <b>Sign in to test</b>. Google will say the app “hasn’t been verified”. That’s expected for your own test app, so click <b>Continue</b> and allow
            both Gmail permissions.
          </li>
          <li className="list-none text-[12px] text-muted">
            Deploying for friends? Set <Code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</Code> in Vercel → Project → Settings → Environment Variables. Everyone then uses your
            Client ID; you just add their emails as test users. Official docs:{" "}
            <L href="https://developers.google.com/identity/oauth2/web/guides/use-token-model">token model</L> ·{" "}
            <L href="https://developers.google.com/workspace/gmail/api/quickstart/js">Gmail JS quickstart</L>.
          </li>
        </ol>
      )}
    </div>
  );
}

/** Turn Google's terse errors into what to fix. */
function explain(msg: string, origin: string) {
  if (/popup_closed/i.test(msg))
    return `The Google window closed before finishing. If it showed “Error 400: origin_mismatch”, add ${origin} under Authorized JavaScript origins (changes can take ~5 min).`;
  if (/popup_failed|popup.*block/i.test(msg)) return "Your browser blocked the Google popup. Allow popups for this site and try again.";
  if (/access_denied/i.test(msg)) return "Access denied. Make sure your Gmail is listed under Audience → Test users, and tick both Gmail permissions.";
  if (/invalid_client|not found/i.test(msg)) return "Google doesn't recognize that Client ID. Copy it again from Google Auth Platform → Clients.";
  if (/403|has not been used|disabled/i.test(msg)) return "Signed in, but the Gmail API isn't enabled for this project. Enable it (step 2) and wait a minute.";
  return msg;
}

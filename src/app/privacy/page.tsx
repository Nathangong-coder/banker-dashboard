import type { Metadata } from "next";
import { H2, LegalPage } from "@/components/LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${SITE.name} handles your data: what stays in your browser, the little that's stored on our server, and how Gmail access is used.`,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        {SITE.name} is a personal tool for networking in investment-banking recruiting. It&apos;s built so that almost everything stays on your own device.
        This page explains exactly what is stored where, who it&apos;s shared with, and the choices you have. Questions or deletion requests:{" "}
        <a className="text-navy underline" href={`mailto:${SITE.contact}`}>
          {SITE.contact}
        </a>
        .
      </p>

      <H2>1. What stays in your browser</H2>
      <p>
        Your contacts, spreadsheet, drafts, templates, settings and the API keys you add are stored in your browser (IndexedDB and local storage) on the
        device you use. We can&apos;t see them. Clearing your browser data, or <b>Settings → Backup → Clear all data</b>, deletes them. Backups you export are
        files you control.
      </p>

      <H2>2. What our server stores, and only if you turn it on</H2>
      <p>
        If you turn on <b>automatic sending</b> (Follow-ups → Reminders), our server keeps the minimum it needs to work while your dashboard is closed:
      </p>
      <ul className="list-disc space-y-1 pl-6">
        <li>A random account ID, and a one-way hash of a random secret your browser created (no name or password).</li>
        <li>Your Google refresh token for sending, encrypted (AES-256-GCM), and the Gmail address it belongs to.</li>
        <li>The queue of emails you scheduled: Gmail draft IDs, the contact&apos;s name, and the send time. Not the email text.</li>
        <li>
          If you use WhatsApp reminders: your WhatsApp number and CallMeBot key (encrypted), and the next two weeks of reminder lists (names, email addresses
          and labels such as &ldquo;Follow-up #1&rdquo;).
        </li>
        <li>Your time zone, so reminders arrive at 9am your time.</li>
      </ul>
      <p>
        Turning automatic sending off deletes all of this and revokes our Google access. To limit abuse, the server also keeps your IP address for up to an
        hour in a rate-limit counter. It is not linked to your account.
      </p>

      <H2>3. Gmail and Google data</H2>
      <p>
        With your permission, {SITE.name} uses Google&apos;s Gmail API. In your browser it can read your sent mail and replies to people in your tracker (to
        fill in when you emailed them and whether they replied) and create drafts. On our server, with automatic sending on, it can only send drafts you
        scheduled (the <code>gmail.compose</code> permission).
      </p>
      <p>
        If you use <b>Schedule calls</b>, your browser also reads the latest email from that banker (to see which days and time zone they asked
        for, and their phone number), and, with a separate permission, your Google Calendar: your free/busy times, so offered times skip your
        events, and creating the call event with the banker as a guest. Calendar data is used only in your browser and isn&apos;t stored on our
        server. If an AI model is set up, the text of that one reply is sent to it to read the request.
      </p>
      <p>
        To protect you from emailing senior bankers by mistake, your browser lists your Gmail drafts and scheduled emails (recipients and subject
        only) and compares them with your contacts&apos; titles. If you click <b>Label them in Gmail</b>, it asks for permission to manage labels
        and adds a &ldquo;⚠ VP+ check&rdquo; label to those messages. Nothing else in your mailbox is changed.
      </p>
      <p>
        {SITE.name}&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a className="text-navy underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We don&apos;t sell Google data, use it for ads, use it to train AI models, or let anyone read it. The only
        exception is something you ask for, such as sending an email&apos;s text to the AI model you chose to draft or improve it.
      </p>

      <H2>4. Services you connect</H2>
      <p>
        You bring your own accounts for enrichment, search, AI and alerts. When you use a feature, your browser sends the request through our server, which
        passes it to that service with your key and returns the answer. The server doesn&apos;t keep the request, the answer or the key. Depending on what you
        connect, that means:
      </p>
      <ul className="list-disc space-y-1 pl-6">
        <li>Apollo, Hunter: a contact&apos;s name, firm and LinkedIn URL, to find a work email.</li>
        <li>Serper, Brave: search queries, to find bankers and public background for coffee-chat prep.</li>
        <li>
          Your AI provider (Anthropic, OpenAI, Google Gemini, DeepSeek, Z.ai, Vercel AI Gateway, or one you configure): contact details and draft text, to
          screen candidates and write emails.
        </li>
        <li>CallMeBot (WhatsApp), ntfy, Twilio: the reminder text, to send it to you.</li>
      </ul>
      <p>Each of these services handles data under its own privacy policy.</p>

      <H2>5. Hosting, storage and analytics</H2>
      <p>
        The app runs on Vercel. Server data (section 2) is stored with Upstash (Redis), and timed jobs run on Upstash QStash. We use Vercel Web Analytics
        and Speed Insights to count page views and measure page speed. They use no cookies and don&apos;t identify you across sites. You can turn them off
        in the notice at the bottom of the page, or under <b>Settings → Backup</b>.
      </p>

      <H2>6. Cookies and local storage</H2>
      <p>
        {SITE.name} doesn&apos;t use advertising or tracking cookies. Google&apos;s sign-in window may set its own cookies on google.com. The app stores your
        data in your browser (section 1) because it can&apos;t work without it.
      </p>

      <H2>7. LinkedIn</H2>
      <p>
        {SITE.name} doesn&apos;t scrape LinkedIn. The optional bookmarklet reads only the LinkedIn page you have open, when you click it, and hands that text to
        your own dashboard.
      </p>

      <H2>8. Your choices and rights</H2>
      <ul className="list-disc space-y-1 pl-6">
        <li>Delete local data: Settings → Backup → Clear all data, or clear your browser storage.</li>
        <li>Delete server data and revoke Google access: Follow-ups → Reminders → Turn off. You can also remove access at myaccount.google.com/permissions.</li>
        <li>
          Ask what we hold, or ask us to delete it: email{" "}
          <a className="text-navy underline" href={`mailto:${SITE.contact}`}>
            {SITE.contact}
          </a>
          . Include your Gmail address if you used automatic sending.
        </li>
      </ul>

      <H2>9. Security</H2>
      <p>
        Traffic is HTTPS only. Secrets on our server are encrypted, server credentials are stored only as hashes, job calls are signed, and API routes are
        rate-limited. No system is perfectly secure. Use strong passwords on the accounts you connect.
      </p>

      <H2>10. Children</H2>
      <p>{SITE.name} is meant for university students and isn&apos;t directed at children under 13.</p>

      <H2>11. Changes</H2>
      <p>If this policy changes, the date at the top changes too. Material changes will be noted in the app.</p>
    </LegalPage>
  );
}

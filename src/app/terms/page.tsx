import type { Metadata } from "next";
import Link from "next/link";
import { H2, LegalPage } from "@/components/LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: `The terms for using ${SITE.name}: your accounts and keys, sending email responsibly, and the limits of what the tool promises.`,
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        By using {SITE.name} you agree to these terms. If you don&apos;t agree, please don&apos;t use it. How data is handled is in the{" "}
        <Link className="text-navy underline" href="/privacy">
          Privacy Policy
        </Link>
        .
      </p>

      <H2>1. What {SITE.name} is</H2>
      <p>
        A free, personal tool for organizing recruiting outreach: tracking contacts, finding emails, drafting messages and reminding you to follow up. It&apos;s
        provided as is, may change, and may be unavailable at times. It isn&apos;t affiliated with any bank, LinkedIn or Google.
      </p>

      <H2>2. Your accounts and keys</H2>
      <p>
        You connect your own accounts (Gmail, enrichment, search, AI, alerts) and you&apos;re responsible for them, including their terms, limits and any fees
        they charge. Keep your keys private. You can disconnect any service at any time.
      </p>

      <H2>3. Sending email responsibly</H2>
      <p>Emails go out from your own Gmail account, under your name. You agree to:</p>
      <ul className="list-disc space-y-1 pl-6">
        <li>Send only personal, one-to-one networking emails you&apos;d be comfortable putting your name on. No bulk marketing or spam.</li>
        <li>Follow applicable law (for example CAN-SPAM) and Google&apos;s policies.</li>
        <li>Stop emailing anyone who asks you to.</li>
        <li>Review drafts before they go out. Scheduled emails send exactly what the draft says at send time.</li>
      </ul>

      <H2>4. Data about other people</H2>
      <p>
        Your tracker holds information about real people. Use it only for your own recruiting, keep it accurate, and don&apos;t share or sell it. Don&apos;t use{" "}
        {SITE.name} to scrape websites, including LinkedIn, or to get around another service&apos;s terms.
      </p>

      <H2>5. Acceptable use</H2>
      <p>
        Don&apos;t attack, overload or reverse-engineer the service, get around its rate limits, or use it to harass anyone. We may block access that breaks
        these terms.
      </p>

      <H2>6. AI-written content</H2>
      <p>
        Drafts and coffee-chat prep can be written by the AI model you choose. They can be wrong: check facts, names and titles before you send anything. You
        are responsible for what you send.
      </p>

      <H2>7. No guarantees</H2>
      <p>
        {SITE.name} doesn&apos;t guarantee replies, interviews or offers, or that firm and recruiting information is complete or current. To the fullest extent
        the law allows, the service is provided without warranties, and its makers aren&apos;t liable for indirect or consequential losses, lost data or missed
        opportunities. Keep your own backups (Settings → Backup).
      </p>

      <H2>8. Ending use</H2>
      <p>
        You can stop using {SITE.name} at any time. Turn off automatic sending to delete server data, and clear your browser data to delete the rest. These
        terms may be updated, and continuing to use the app means you accept the updated version.
      </p>

      <H2>9. Contact</H2>
      <p>
        <a className="text-navy underline" href={`mailto:${SITE.contact}`}>
          {SITE.contact}
        </a>
      </p>
    </LegalPage>
  );
}

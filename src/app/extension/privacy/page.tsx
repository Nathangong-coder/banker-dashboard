import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { H2 } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Extension privacy policy",
  description: `What the ${SITE.name} browser extension reads, where it goes, and what it never does.`,
  alternates: { canonical: "/extension/privacy" },
};

/**
 * The extension's own privacy policy: the Chrome Web Store listing's privacy URL. Keep it in step with
 * extension/manifest.json (store build: activeTab, scripting, storage, plus the dashboard-only content script) and
 * privacy page §7. Bump SITE.legalUpdated
 * when it changes.
 */
export default function ExtensionPrivacyPage() {
  return (
    <article className="mx-auto max-w-[760px]">
      <h1 className="text-[34px] leading-tight font-medium tracking-tight text-ink">Extension privacy policy</h1>
      <p className="mt-1 text-[13px] text-muted">
        {SITE.name} for Chrome and Edge · Last updated {SITE.legalUpdated}
      </p>
      <div className="mt-8 space-y-4 text-[14.5px] leading-relaxed text-ink-2">
        <p>
          The {SITE.name} extension does two things, both only when you click its button: on a LinkedIn page it sends that page&apos;s text to your own{" "}
          {SITE.name} dashboard, and on a job application it fills the form from the application info you saved in your dashboard. This page explains
          exactly what that involves. The dashboard itself is covered by the{" "}
          <Link href="/privacy" className="text-navy underline">
            {SITE.name} Privacy Policy
          </Link>
          .
        </p>

        <H2>1. What it reads</H2>
        <p>Only when you click a button in its popup, and only in the tab you&apos;re looking at:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            On a LinkedIn profile: the text shown on that page (name, headline, location, experience, education and similar sections) and the profile&apos;s address.
          </li>
          <li>On a LinkedIn People search: the names, headlines and profile addresses of the people listed on the page.</li>
          <li>
            On a LinkedIn job page (&ldquo;Track this job&rdquo;): the job&apos;s title, company, location, description and, when LinkedIn shows it, the
            employer&apos;s own application link.
          </li>
          <li>
            On a job application (&ldquo;Autofill this page&rdquo;): the form&apos;s questions (labels, field types and answer options, never the contents of
            password fields) and the page&apos;s visible text, so the dashboard can tell what each field asks and what the job is. To read the choices of a
            custom dropdown it opens the dropdown and closes it again.
          </li>
        </ul>
        <p>
          That&apos;s website content you can already see. The extension doesn&apos;t read pages you haven&apos;t clicked it on, other tabs, your browsing history, passwords,
          messages, saved passwords or anything else. On LinkedIn it never clicks, scrolls, types or loads pages for you. On a job application it only
          types into the form fields it read, picks the matching choice in dropdowns and suggestion lists, and, on Workday when you click &ldquo;Fill the
          next pages too&rdquo; or Fill selected, presses the page&apos;s Next / Continue button. For Fill selected it also presses the buttons that open
          the form (Workday&apos;s Apply / Apply Manually, Lever&apos;s &ldquo;Apply for this job&rdquo; link) and, if you turned on saved logins, the
          sign-in form&apos;s Sign in button. It never presses Submit or any button that sends an application, signs a document or creates an account,
          never fills Social Security numbers, bank or card details, fills a password only from your own saved logins, and you review the application
          before you submit it yourself.
        </p>

        <p>
          <b>Fill selected</b> (1.3): when you press it on your dashboard&apos;s Applications page, the extension opens those jobs in a
          &ldquo;Coverage&rdquo; tab group and does the same reading and filling there, on application sites you allowed, without another click per
          job. On Workday it presses the job&apos;s own Apply / Apply Manually buttons to open the form. With <b>Watch it work</b> it fills one tab at a
          time in front of you and shows a banner with a Stop button.
        </p>

        <H2>2. Where it goes</H2>
        <p>
          The extension opens your dashboard ({SITE.url}, or another address you set) in a new tab, with the text in the address&apos;s fragment (the part after
          &ldquo;#&rdquo;). Browsers never send the fragment to a server, so the text goes straight from the LinkedIn tab to your dashboard in your browser, which keeps it
          in your browser&apos;s storage.
        </p>
        <p>
          For autofill, the extension passes the form&apos;s questions and the page text to your open {SITE.name} tab (through a small script that runs on{" "}
          {SITE.name}&apos;s own pages only, never on other sites). Your dashboard decides each answer from the application info you saved there and sends back
          only those values (and your resume file for upload fields), which the extension types into that form. If you have an AI key connected, open
          questions are drafted by your AI provider as described in the {SITE.name} Privacy Policy, section 4. The employer receives your application only
          when you submit it. The extension sends nothing to us, to analytics services or to anyone else.
        </p>

        <H2>3. What it stores</H2>
        <p>
          One setting: your dashboard&apos;s address, in your browser&apos;s extension storage (it follows your browser profile if you use browser sync). After an
          autofill it keeps a short summary for that tab (how many fields were filled and which questions were left for you) in session storage, which
          the browser clears when it closes. Your application info stays in your dashboard, not in the extension.
        </p>

        <p>
          <b>Saved logins</b> (optional, off by default): if you turn them on in the extension&apos;s settings, the sign-ins you add (site, email or
          username, password) are encrypted on your device with a key made from your PIN (AES-GCM, PBKDF2 with 600,000 rounds) and kept in the
          extension&apos;s storage. You unlock them with your PIN once per browser session. The extension types a login only into the sign-in form of the
          exact site you saved it for. Logins are never sent to your dashboard, to us, to any AI provider or to any other site, and you can delete them
          all from the extension&apos;s settings at any time. The extension never reads your browser&apos;s own saved passwords and never creates
          accounts.
        </p>

        <H2>4. What it never does</H2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Sell or transfer your data to anyone, or use it for advertising, credit or lending decisions.</li>
          <li>Run on any site before you click it there (the only exception is the bridge script on {SITE.name}&apos;s own pages).</li>
          <li>
            Submit an application for you. The only buttons it presses are a multi-page form&apos;s Next / Continue, the ones that open an application form,
            and a sign-in form&apos;s Sign in with your saved login, and only when you started a fill.
          </li>
          <li>Load code from the internet: everything it runs ships inside the extension.</li>
          <li>Track you, or include analytics.</li>
        </ul>
        <p>
          The use of information received from the extension adheres to the{" "}
          <a href="https://developer.chrome.com/docs/webstore/program-policies/policies" className="text-navy underline" target="_blank" rel="noreferrer">
            Chrome Web Store User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>

        <H2>5. Permissions</H2>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <b>activeTab</b>: access to the current tab only, granted by your click, and only until you leave that page.
          </li>
          <li>
            <b>scripting</b>: runs the read-only function that collects the visible text from that tab.
          </li>
          <li>
            <b>storage</b>: saves your dashboard&apos;s address, the last autofill summary for a tab until the browser closes, and, only if you turn
            them on, your encrypted saved logins.
          </li>
          <li>
            <b>tabGroups</b>: puts the jobs Fill selected opens into one &ldquo;Coverage&rdquo; tab group, so they&apos;re easy to find and close.
          </li>
          <li>
            <b>Access to {SITE.name}&apos;s own site</b> ({SITE.url}): runs the bridge script that connects the extension to your dashboard tab for autofill. It
            doesn&apos;t give access to any other site.
          </li>
          <li>
            <b>Optional: application sites</b> (Workday, Greenhouse, Lever, iCIMS, Taleo, SuccessFactors and similar application systems): asked one site at a
            time from the popup (or all at once from the extension&apos;s settings, for Fill selected), only when you choose page-by-page filling, batch filling or
            need to fill a form embedded from that site. Nothing is granted at install, and
            you can remove a site at any time from the extension&apos;s details page.
          </li>
        </ul>

        <H2>6. Removing it</H2>
        <p>
          Remove the extension from <code>chrome://extensions</code> (or <code>edge://extensions</code>) and its one setting is deleted with it. To delete profiles you
          sent to your dashboard, use the dashboard (Settings → Backup → Clear all data, or delete the contact).
        </p>

        <H2>7. Changes and contact</H2>
        <p>
          If what the extension does changes, this page changes first, with a new date at the top. Questions or requests:{" "}
          <a href={`mailto:${SITE.contact}`} className="text-navy underline">
            {SITE.contact}
          </a>
          .
        </p>
      </div>
    </article>
  );
}

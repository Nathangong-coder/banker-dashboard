import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Extension help & support",
  description: `Fixes for common problems with the ${SITE.name} browser extension, what changed in each version, and how to reach us.`,
  alternates: { canonical: "/extension/support" },
};

const PROBLEMS: [string, string[]][] = [
  [
    "The popup says “Nothing to do on this page”",
    ["It works on LinkedIn profiles, People searches and job pages, and on job application forms.", "If you're on one, reload the tab and click the icon again."],
  ],
  [
    "Autofill says it can't reach Coverage",
    [
      "Autofill asks your open Coverage tab what goes in each field (your info lives there). Open your dashboard in a tab, then click Autofill again.",
      "Check Options (right-click the icon → Options) points at the same address you use.",
    ],
  ],
  [
    "Autofill left some fields empty",
    [
      "Fields you haven't filled in on Applications → My info are left for you, and so are passwords, SSNs, consent boxes and salary, on purpose.",
      "Open questions need an AI key (Settings → Data). The box on the page lists everything left and why.",
    ],
  ],
  [
    "“The form on this page comes from another site”",
    ["The bank's careers page shows a form from Workday, Greenhouse or similar. Click “Allow Coverage on …” once, then click the icon and Autofill again, or open the form in its own tab."],
  ],
  [
    "Workday: it filled one page and stopped",
    [
      "Click “Allow Coverage on myworkdayjobs.com” once; then “Fill the next pages too” presses Next for you.",
      "It stops on purpose at a page with a required question it can't answer, at AI-drafted answers (read them, then Continue), and at the review page. It never submits.",
      "Workday asks you to sign in or create an account for each company: that part is yours (Chrome's password manager can create and save the password).",
    ],
  ],
  [
    "“No profiles on this page yet”",
    [
      "On a search, scroll down so the results load, then click Send again.",
      "LinkedIn sometimes shows “LinkedIn Member” for people outside your network; those can't be sent.",
    ],
  ],
  [
    "It opened the dashboard but nobody was added",
    [
      "A profile opens Coffee chat prep, with the person ready to add: check that page.",
      "If the dashboard is still loading your data, wait a second and send it again.",
    ],
  ],
  [
    "It opens the wrong dashboard",
    ["Right-click the Coverage icon → Options, and set your dashboard's address (https://…, or http://localhost:3000 for development)."],
  ],
  [
    "LinkedIn changed and it stopped reading pages",
    ["LinkedIn changes its pages often. Email us the page type (profile or search) and we'll update the extension."],
  ],
];

const CHANGES: [string, string, string][] = [
  [
    "1.2.0",
    "October 2026",
    "Workday: picks from its dropdowns and suggestion boxes and, once you allow the site, presses Next page by page (never Submit). Forms embedded from Workday, Greenhouse and other application sites. “Track this job” on LinkedIn job pages.",
  ],
  ["1.1.0", "October 2026", "Job application autofill from Applications → My info, with your resume and AI drafts of open questions. One-click “Add to tracker + find email” on LinkedIn."],
  ["1.0.0", "October 2026", "First Chrome Web Store version: LinkedIn profile → Coffee chat prep, People search → Find people."],
];

export default function ExtensionSupportPage() {
  return (
    <div className="mx-auto max-w-[760px]">
      <h1 className="text-[34px] leading-tight font-medium tracking-tight text-ink">Help & support</h1>
      <p className="mt-2 text-[15px] text-ink-2">Fixes for the usual problems, then a way to reach a person.</p>

      <div className="mt-8 divide-y divide-line rounded-2xl border border-line bg-panel">
        {PROBLEMS.map(([q, fixes]) => (
          <details key={q} className="group px-5 py-4">
            <summary className="cursor-pointer list-none text-[14.5px] font-medium text-ink marker:hidden">
              {q}
              <span className="float-right text-muted transition-transform group-open:rotate-45" aria-hidden="true">
                +
              </span>
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-ink-2">
              {fixes.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>

      <section className="mt-10 flex flex-wrap items-center gap-4 rounded-2xl bg-brass-soft p-6" aria-labelledby="contact">
        <span className="grid size-10 place-items-center rounded-full bg-panel text-brass-ink">
          <Mail className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="contact" className="text-[16px] font-medium text-ink">
            Still stuck?
          </h2>
          <p className="text-[13.5px] text-ink-2">Email us what you clicked, what you expected, and your browser (Chrome or Edge).</p>
        </div>
        <a href={`mailto:${SITE.contact}?subject=${encodeURIComponent("Coverage extension")}`} className="inline-flex h-10 items-center rounded-full bg-brass-strong px-5 text-[14px] font-medium text-white hover:bg-brass-hover">
          Email {SITE.contact}
        </a>
      </section>

      <section className="mt-12" aria-labelledby="changes">
        <h2 id="changes" className="text-[20px] font-medium tracking-tight text-ink">
          What&apos;s new
        </h2>
        <ul className="mt-3 space-y-3">
          {CHANGES.map(([v, when, what]) => (
            <li key={v} className="rounded-xl border border-line bg-panel px-4 py-3 text-[13.5px]">
              <div className="font-medium text-ink">
                {v} <span className="font-normal text-muted">· {when}</span>
              </div>
              <p className="mt-0.5 text-ink-2">{what}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[13px] text-muted">
          See also:{" "}
          <Link href="/extension/privacy" className="text-brass-ink underline">
            extension privacy policy
          </Link>{" "}
          ·{" "}
          <Link href="/extension" className="text-brass-ink underline">
            what it does
          </Link>
        </p>
      </section>
    </div>
  );
}

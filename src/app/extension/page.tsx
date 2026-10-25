import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Coffee, EyeOff, MousePointerClick, Search, ShieldCheck, Users } from "lucide-react";
import { SITE } from "@/lib/site";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = {
  title: "Browser extension",
  description: `The ${SITE.name} extension for Chrome and Edge: send the LinkedIn profile or People search you're viewing to your ${SITE.name} dashboard in one click.`,
  alternates: { canonical: "/extension" },
};

const REPO = "https://github.com/Nathangong-coder/banker-dashboard/tree/main/extension";

const PERMISSIONS = [
  ["Your current tab, after you click (activeTab)", "Lets the button read the LinkedIn page or application form you're on, only when you click it. It can't see other tabs, other sites or anything in the background."],
  ["Run a script on that tab (scripting)", "On LinkedIn: reads the profile text you can already see, never clicking or scrolling. On an application: reads the form's questions, then types your answers in. It never presses Submit."],
  ["Storage", "Saves your dashboard's address, the last autofill summary for a tab until the browser closes, and (only if you turn them on) your saved logins, encrypted with your PIN."],
  ["Tab groups", "Puts the jobs “Fill selected” opens into one “Coverage” tab group."],
  [
    "Application sites you allow (optional)",
    "Asked from the popup one site at a time, or all at once in the extension's settings (Workday, Greenhouse, Lever…), for page-by-page filling, Fill selected, or a form embedded from that site. Nothing is granted at install.",
  ],
  [`${SITE.name}'s own site`, "A small bridge script on your dashboard's pages only, so autofill can ask your open dashboard what goes in each field. Your application info stays there."],
];

const NOT = ["Access to all websites", "Your browsing history", "Chrome's saved passwords (it can't read them)", "Submitting anything for you", "Code loaded from the internet", "Analytics or tracking", "Any server of ours (the text goes straight to your dashboard)"];

const FAQ: [string, string][] = [
  ["Is it free?", `Yes, like ${SITE.name}.`],
  ["Does it work in Microsoft Edge?", "Yes. Edge installs extensions from the Chrome Web Store: open the listing in Edge, click “Allow extensions from other stores”, then “Get”."],
  [
    "Will LinkedIn flag my account?",
    "It does what you'd do by copying the page yourself: it reads what's on your screen once, when you click. It doesn't browse, scroll, click or visit profiles for you, which is the kind of automation LinkedIn restricts.",
  ],
  ["Where does the profile go?", `To your own ${SITE.name} dashboard in a new tab, which keeps it in your browser. Nothing passes through our server.`],
  ["Can I point it at my own copy of the dashboard?", "Yes: right-click the extension icon → Options, and enter its https address (or http://localhost for development)."],
];

/** A drawn copy of the extension's popup on a profile (fictional person), for the hero. */
function PopupMock() {
  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-xl border border-line bg-panel text-[13px] shadow-xl" aria-hidden="true">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <Logo size={20} />
        <span className="font-medium text-ink">Coverage</span>
        <span className="ml-auto text-[12px] text-brass-ink">Open dashboard</span>
      </div>
      <div className="p-3.5">
        <div className="rounded-lg border border-line p-3">
          <div className="font-medium text-ink">LinkedIn profile</div>
          <p className="mt-1 text-[12px] leading-snug text-muted">Opens Coffee chat prep with this profile, so you can add them or prep a call.</p>
          <div className="mt-3 rounded-lg bg-brass-strong py-2 text-center text-[13px] font-medium text-white">Send profile to Coverage</div>
        </div>
      </div>
      <div className="flex justify-between border-t border-line px-3.5 py-2 text-[11.5px] text-muted">
        <span className="text-brass-ink">Settings</span>
        <span>Reads this page only when you click.</span>
      </div>
    </div>
  );
}

function InstallButton({ big }: { big?: boolean }) {
  const cls = big ? "h-12 px-7 text-[16px]" : "h-10 px-5 text-[14px]";
  return SITE.extension.chromeUrl ? (
    <a href={SITE.extension.chromeUrl} className={`inline-flex items-center gap-2 rounded-full bg-brass-strong font-medium text-white transition-colors hover:bg-brass-hover ${cls}`}>
      Add to Chrome, it&apos;s free
    </a>
  ) : (
    <a href="#install" className={`inline-flex items-center gap-2 rounded-full bg-brass-strong font-medium text-white transition-colors hover:bg-brass-hover ${cls}`}>
      Install it now
    </a>
  );
}

export default function ExtensionPage() {
  return (
    <>
      <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="text-[34px] leading-[1.1] font-medium tracking-tight text-balance text-ink sm:text-[46px]">Send any LinkedIn profile to {SITE.name} in one click.</h1>
          <p className="mt-4 max-w-[520px] text-[16px] leading-relaxed text-ink-2">
            Looking at a banker&apos;s profile? Click the {SITE.name} button to prep a coffee chat or add them to your tracker. On a People search, send everyone listed to Find
            people. For Chrome and Edge.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <InstallButton big />
            {!SITE.extension.chromeUrl && <span className="text-[13px] text-muted">Coming soon to the Chrome Web Store</span>}
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-[13px] text-muted">
            <ShieldCheck className="size-4 text-green" aria-hidden="true" /> Reads the page only when you click. No access to other sites.
          </p>
        </div>
        <PopupMock />
      </section>

      <section className="mt-20 grid gap-4 sm:grid-cols-3" aria-label="What it does">
        {[
          [Coffee, "On a profile", "Opens Coffee chat prep with their career path, so you can add them to your tracker or prep the call."],
          [Users, "On a People search", "Sends everyone listed (scroll first so they load) to Find people, where you screen and add them."],
          [EyeOff, "Everywhere else", "Nothing. It doesn't run in the background, and it can't see any page until you click it there."],
        ].map(([Icon, t, b]) => {
          const I = Icon as typeof Coffee;
          return (
            <div key={t as string} className="rounded-2xl border border-line bg-panel p-5">
              <span className="grid size-9 place-items-center rounded-lg bg-brass-soft text-brass-ink">
                <I className="size-4.5" aria-hidden="true" />
              </span>
              <h2 className="mt-3 text-[15px] font-medium text-ink">{t as string}</h2>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{b as string}</p>
            </div>
          );
        })}
      </section>

      <section className="mt-20" aria-labelledby="how">
        <h2 id="how" className="text-[24px] font-medium tracking-tight text-ink">
          How to use it
        </h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            [MousePointerClick, "Pin it", "Click the puzzle-piece icon in your toolbar, then the pin next to Coverage."],
            [Search, "Open LinkedIn", "Go to a banker's profile, or a People search (scroll so the results load)."],
            [ArrowRight, "Click and send", "Click the Coverage icon → Send. Your dashboard opens with them in a new tab."],
          ].map(([Icon, t, b], i) => {
            const I = Icon as typeof Coffee;
            return (
              <li key={t as string} className="flex gap-3 rounded-2xl bg-subtle p-5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-panel text-[13px] font-medium text-brass-ink">{i + 1}</span>
                <div>
                  <h3 className="flex items-center gap-1.5 text-[14.5px] font-medium text-ink">
                    {t as string} <I className="size-3.5 text-muted" aria-hidden="true" />
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{b as string}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="mt-20 grid gap-8 lg:grid-cols-2" aria-labelledby="permissions">
        <div>
          <h2 id="permissions" className="text-[24px] font-medium tracking-tight text-ink">
            Permissions, in plain words
          </h2>
          <dl className="mt-5 space-y-4">
            {PERMISSIONS.map(([t, b]) => (
              <div key={t}>
                <dt className="text-[14px] font-medium text-ink">{t}</dt>
                <dd className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">{b}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h3 className="text-[15px] font-medium text-ink">What it doesn&apos;t ask for</h3>
          <ul className="mt-3 space-y-2 text-[13.5px] text-ink-2">
            {NOT.map((x) => (
              <li key={x} className="flex gap-2">
                <span className="text-muted" aria-hidden="true">
                  ✕
                </span>
                {x}
              </li>
            ))}
          </ul>
          <Link href="/extension/privacy" className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-brass-ink hover:underline">
            Read the extension&apos;s privacy policy <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </section>

      <section id="install" className="mt-20 scroll-mt-28 rounded-2xl bg-brass-soft p-6 sm:p-8" aria-labelledby="install-title">
        <h2 id="install-title" className="text-[22px] font-medium tracking-tight text-ink">
          {SITE.extension.chromeUrl ? "Install" : "Install it before it's in the store"}
        </h2>
        {SITE.extension.chromeUrl ? (
          <div className="mt-4">
            <InstallButton />
          </div>
        ) : (
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-[14px] leading-relaxed text-ink-2">
            <li>
              Download the{" "}
              <a href={REPO} className="font-medium text-brass-ink underline" target="_blank" rel="noreferrer">
                extension folder
              </a>{" "}
              (on GitHub: Code → Download ZIP, then unzip it).
            </li>
            <li>
              Open <code className="rounded bg-panel px-1 font-mono text-[12.5px]">chrome://extensions</code> (Edge:{" "}
              <code className="rounded bg-panel px-1 font-mono text-[12.5px]">edge://extensions</code>) and turn on Developer mode.
            </li>
            <li>
              Click <b>Load unpacked</b> and pick the <code className="rounded bg-panel px-1 font-mono text-[12.5px]">extension</code> folder, then pin it.
            </li>
          </ol>
        )}
      </section>

      <section className="mt-20" aria-labelledby="faq">
        <h2 id="faq" className="text-[24px] font-medium tracking-tight text-ink">
          Questions
        </h2>
        <div className="mt-4 divide-y divide-line rounded-2xl border border-line bg-panel">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none text-[14.5px] font-medium text-ink marker:hidden">
                {q}
                <span className="float-right text-muted transition-transform group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{a}</p>
            </details>
          ))}
        </div>
        <p className="mt-4 text-[13px] text-muted">
          Something not working?{" "}
          <Link href="/extension/support" className="text-brass-ink underline">
            Help & support
          </Link>
        </p>
      </section>
    </>
  );
}

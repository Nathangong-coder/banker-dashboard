import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, Check, Lock } from "lucide-react";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/util";
import { FEATURES } from "@/components/landing/features";
import { LandingNav } from "@/components/landing/LandingNav";
import { Mock } from "@/components/landing/mocks";
import { StartLink } from "@/components/landing/StartLink";

export const metadata: Metadata = {
  title: { absolute: `${SITE.name}: run your investment banking networking in one place` },
  description: SITE.description,
  alternates: { canonical: "/welcome" },
};

/**
 * The landing page (owner, 2026-10-23), shaped like the owner's quizlet-v2 landing (itself borrowed from Quizlet's):
 * a question as the headline, one line, ONE button, every tool as a horizontally scrolling gallery of colored slabs,
 * then zig-zag stories, then a closing slab. The nav is HubSpot-style (components/landing/LandingNav.tsx).
 * Shell renders /welcome without the app chrome (BARE_PATHS). "/" sends a first-time visitor here
 * (app/page.tsx); any "Open dashboard" / "Get started" click marks them as started.
 * Server component, no store: it renders for every visitor and crawler as-is.
 */

const STEPS = [
  ["Import your tracker", "Your .xlsx stays the source of truth. Coverage reads every bank tab and saves back only the cells it changes."],
  ["Find who's missing", "See every desk you're recruiting for, then find analysts and associates there with verified emails."],
  ["Send personal emails", "Your wording, the right hook for each banker, scheduled for the morning in their time zone."],
  ["Follow up and prep", "Follow-ups stop when they reply. Before each call, a brief; after it, a graded log and a thank-you nudge."],
];

const SLAB_TEXT = "text-ink";

function Story({
  id,
  label,
  title,
  body,
  mock,
  flip,
  children,
}: {
  id: string;
  label: string;
  title: string;
  body: string;
  mock: Parameters<typeof Mock>[0]["id"];
  flip?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-24 grid scroll-mt-28 items-center gap-10 lg:grid-cols-2 lg:gap-16" aria-labelledby={`${id}-title`}>
      <div className={cn(flip && "lg:order-2")}>
        <div className="text-[12px] font-medium tracking-[0.1em] text-brass-ink uppercase">{label}</div>
        <h2 id={`${id}-title`} className="mt-2 text-[30px] leading-tight font-medium tracking-tight text-balance text-ink sm:text-[36px]">
          {title}
        </h2>
        <p className="mt-4 text-[15.5px] leading-relaxed text-ink-2">{body}</p>
        {children}
      </div>
      <div className={cn("rounded-2xl bg-brass-soft p-4 sm:p-8", flip && "lg:order-1")}>
        <div className="mx-auto max-w-md">
          <Mock id={mock} />
        </div>
      </div>
    </section>
  );
}

const linkCls = "mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-brass-ink underline-offset-4 hover:underline";

export default function WelcomePage() {
  const year = new Date().getFullYear();
  return (
    <div className="min-h-screen bg-panel text-ink">
      <LandingNav />

      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:py-20">
        {/* Hero */}
        <section className="mx-auto max-w-3xl text-center" aria-labelledby="hero-title">
          <h1 id="hero-title" className="mx-auto max-w-[20ch] text-[clamp(2.25rem,1.4rem+3.2vw,3.6rem)] leading-[1.08] font-medium tracking-tight text-ink">
            Who are you reaching out to this recruiting season?
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-ink-2">
            Coverage turns your networking spreadsheet into a desk that works for you: find bankers, write emails that sound like you, follow up on time, and
            walk into every coffee chat prepared.
          </p>
          <div className="mt-8">
            <StartLink href="/sheet" className="inline-flex h-12 items-center rounded-full bg-brass-strong px-8 text-[16px] font-medium text-white transition-colors hover:bg-brass-hover">
              Get started free
            </StartLink>
          </div>
          <p className="mt-4 text-[14px]">
            <StartLink href="/" className="text-brass-ink underline-offset-4 hover:underline">
              Already set up? Open your dashboard
            </StartLink>
          </p>
        </section>

        {/* Every tool, as a gallery */}
        <section className="mt-16" aria-label="Everything in Coverage">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[12px] font-medium tracking-[0.1em] text-muted uppercase">Everything in one place</h2>
            <span className="text-[12px] text-muted" aria-hidden="true">
              scroll →
            </span>
          </div>
          {/* -mx-4 + px-4: the strip bleeds to the page edge so the last card peeks in, which says "this scrolls". */}
          <ul className="-mx-4 mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3 [scrollbar-width:thin]">
            {FEATURES.map((f) => (
              <li key={f.slug} className="w-[min(78vw,290px)] shrink-0 snap-start">
                <StartLink href={f.href} className={cn("group flex h-full flex-col overflow-hidden rounded-2xl transition-transform hover:-translate-y-0.5", f.slab)}>
                  <div className="flex items-center gap-2 px-5 pt-5">
                    <f.icon className={cn("size-5 shrink-0", SLAB_TEXT)} aria-hidden="true" />
                    <h3 className={cn("truncate text-[19px] font-medium tracking-tight", SLAB_TEXT)}>{f.label}</h3>
                  </div>
                  <p className="line-clamp-2 px-5 pt-1 text-[13.5px] text-ink-2">{f.line}</p>
                  {/* A fixed window onto the mock, clipped, so every card is the same height. */}
                  <div className="mt-4 h-52 overflow-hidden px-4">
                    <div className="origin-top scale-[0.92] transition-transform group-hover:scale-[0.96]">
                      <Mock id={f.mock} />
                    </div>
                  </div>
                </StartLink>
              </li>
            ))}
          </ul>
        </section>

        <Story
          id="reach"
          label="Reach out"
          title="Emails that sound like you, to people who'll answer."
          body="Pick a bank and a desk, and Coverage finds analysts and associates there, checks every email before you use it, and drafts from your own templates with the hook that fits: the same school, the same hometown, a path that stood out. Sends go out mid-morning in their time zone."
          mock="draft"
        >
          <StartLink href="/drafts" className={linkCls}>
            See your drafts <ArrowRight className="size-4" />
          </StartLink>
        </Story>

        <Story
          id="smart"
          label="Smart outreach"
          title="Every good chat makes the next email better."
          body="When a coffee chat went well, the next email to that bank says so. Coverage reads your chat notes and the rating you gave it, and writes one line in your voice: who you talked to and what stuck with you. Only facts from your notes, never invented."
          mock="smart"
          flip
        >
          <StartLink href="/log" className={linkCls}>
            Open your activity log <ArrowRight className="size-4" />
          </StartLink>
        </Story>

        <Story
          id="track"
          label="Stay on track"
          title="Nothing falls through. Not a follow-up, not a thank-you."
          body="Follow-ups schedule themselves 6 to 8 days later and stop the moment someone replies. Thank-yous, intros and referrals are picked up from Gmail, even for bankers you met at an info session and never added to the sheet. At 9 PM, a text lists what to send tonight."
          mock="text"
        >
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
            <StartLink href="/followups" className="inline-flex items-center gap-1.5 font-medium text-brass-ink underline-offset-4 hover:underline">
              Follow-ups
            </StartLink>
            <StartLink href="/calendar" className="inline-flex items-center gap-1.5 font-medium text-brass-ink underline-offset-4 hover:underline">
              Calendar
            </StartLink>
            <StartLink href="/prep" className="inline-flex items-center gap-1.5 font-medium text-brass-ink underline-offset-4 hover:underline">
              Coffee chat prep
            </StartLink>
          </div>
        </Story>

        {/* How it works */}
        <section id="how" className="mt-24 scroll-mt-28" aria-labelledby="how-title">
          <div className="text-[12px] font-medium tracking-[0.1em] text-brass-ink uppercase">How it works</div>
          <h2 id="how-title" className="mt-2 text-[30px] font-medium tracking-tight text-ink sm:text-[36px]">
            Your season, in four steps.
          </h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([t, b], i) => (
              <li key={t} className="rounded-2xl border border-line bg-subtle p-5">
                <span className="grid size-8 place-items-center rounded-full bg-brass-strong text-[14px] font-medium text-white">{i + 1}</span>
                <h3 className="mt-4 text-[16px] font-medium text-ink">{t}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{b}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Claude */}
        <section id="claude" className="mt-24 grid scroll-mt-28 gap-6 rounded-2xl border border-line p-6 sm:p-10 lg:grid-cols-[1fr_1.1fr]" aria-labelledby="claude-title">
          <div>
            <div className="inline-flex items-center gap-2 text-[12px] font-medium tracking-[0.1em] text-brass-ink uppercase">
              <Bot className="size-4" /> Coverage for Claude
            </div>
            <h2 id="claude-title" className="mt-2 text-[26px] font-medium tracking-tight text-ink sm:text-[30px]">
              Ask Claude what&apos;s due tonight.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              Add the Coverage connector in Claude, or install the Recruitify plugin in Claude Code and Cowork. Claude can read your to-dos, replies and intros,
              update your tracker, log a chat and sort your Gmail into follow-up tiers, always asking before it changes anything.
            </p>
          </div>
          <div className="space-y-3 text-[13px]">
            <div className="rounded-xl bg-subtle p-4">
              <div className="mb-1 font-medium text-ink">Connector URL</div>
              <code className="block font-mono text-[12px] break-all text-ink-2">{SITE.url}/api/mcp</code>
            </div>
            <div className="rounded-xl bg-subtle p-4">
              <div className="mb-1 font-medium text-ink">Claude Code plugin</div>
              <code className="block font-mono text-[12px] break-all text-ink-2">/plugin marketplace add Nathangong-coder/banker-dashboard</code>
              <code className="mt-1 block font-mono text-[12px] break-all text-ink-2">/plugin install recruitify@recruitify</code>
            </div>
          </div>
        </section>

        {/* Privacy promise */}
        <section className="mt-16 grid gap-4 sm:grid-cols-3" aria-label="Your data">
          {[
            ["Your data stays with you", "Contacts, drafts and your spreadsheet live in your browser. There's no account to make."],
            ["Your own keys", "Bring your own AI and email-finder keys. Each is tested before it's saved."],
            ["Only what's needed on the server", "Automatic sending is opt-in, and you can turn it off (and delete it) anytime."],
          ].map(([t, b]) => (
            <div key={t} className="flex gap-3">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-green-soft text-green">
                {t.startsWith("Your data") ? <Lock className="size-3.5" /> : <Check className="size-3.5" />}
              </span>
              <div>
                <h3 className="text-[14.5px] font-medium text-ink">{t}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{b}</p>
              </div>
            </div>
          ))}
        </section>

        {/* Closing */}
        <section className="mt-24 rounded-2xl bg-brass-soft px-6 py-12 text-center sm:px-10" aria-labelledby="closing">
          <h2 id="closing" className="text-[26px] font-medium tracking-tight text-balance text-ink sm:text-[32px]">
            Built by a student recruiting for banking. Ready for your tracker.
          </h2>
          <div className="mt-6">
            <StartLink href="/sheet" className="inline-flex h-12 items-center rounded-full bg-brass-strong px-8 text-[16px] font-medium text-white transition-colors hover:bg-brass-hover">
              Get started free
            </StartLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-subtle">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
          {(["Track", "Reach out", "Prep & follow up"] as const).map((g) => (
            <nav key={g} aria-label={g}>
              <h2 className="text-[13px] font-medium text-ink">{g}</h2>
              <ul className="mt-3 space-y-2">
                {FEATURES.filter((f) => f.group === g).map((f) => (
                  <li key={f.slug}>
                    <StartLink href={f.href} className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">
                      {f.label}
                    </StartLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
          <nav aria-label="Company">
            <h2 className="text-[13px] font-medium text-ink">Coverage</h2>
            <ul className="mt-3 space-y-2 text-[13px]">
              <li>
                <Link href="/privacy" className="text-muted underline-offset-4 hover:text-ink hover:underline">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-muted underline-offset-4 hover:text-ink hover:underline">
                  Terms
                </Link>
              </li>
              <li>
                <a href={`mailto:${SITE.contact}`} className="text-muted underline-offset-4 hover:text-ink hover:underline">
                  Contact
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <div className="mx-auto flex max-w-6xl items-center gap-2 border-t border-line px-4 py-5 text-[12px] text-muted">
          <span className="grid size-5 place-items-center rounded bg-brass-strong text-[10px] font-semibold text-white">C</span>© {year} {SITE.name}
        </div>
      </footer>
    </div>
  );
}

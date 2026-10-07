import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

const PLACES = [
  { href: "/followups", label: "Follow-ups", hint: "Who's due today" },
  { href: "/coverage", label: "Bank coverage", hint: "Which banks and desks you've reached" },
  { href: "/drafts", label: "Email drafts", hint: "Write and send outreach" },
  { href: "/sheet", label: "Spreadsheet", hint: "Your tracker" },
];

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[640px] py-10">
      <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-brass-strong">404</div>
      <h1 className="mt-2 font-serif text-[40px] leading-tight text-ink">This page doesn&apos;t exist.</h1>
      <p className="mt-2 text-[14.5px] text-ink-2">The link may be old, or the address has a typo. Your data is fine: it lives in this browser, not at a URL.</p>
      <Link href="/" className="mt-6 inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2.5 text-[14px] font-medium text-white hover:bg-[#1d3156]">
        Go to the overview <ArrowRight className="size-4" />
      </Link>
      <ul className="mt-8 divide-y divide-line rounded-lg border border-line bg-panel">
        {PLACES.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="flex items-center justify-between px-4 py-3 text-[14px] hover:bg-[#fbfaf6]">
              <span>
                <span className="font-medium text-ink">{p.label}</span> <span className="text-muted">· {p.hint}</span>
              </span>
              <ArrowRight className="size-4 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

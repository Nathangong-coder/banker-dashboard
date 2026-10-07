import Link from "next/link";
import type { ReactNode } from "react";
import { SITE } from "@/lib/site";

/** Shared layout for /privacy and /terms: readable width, serif title, last-updated line, links between them. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-[760px] pb-16">
      <h1 className="font-serif text-[40px] leading-tight text-ink">{title}</h1>
      <p className="mt-1 text-[13px] text-muted">
        {SITE.name} · Last updated {SITE.legalUpdated}
      </p>
      <div className="legal mt-8 space-y-4 text-[14.5px] leading-relaxed text-ink-2">{children}</div>
      <nav className="mt-12 flex gap-4 border-t border-line pt-4 text-[13px]">
        <Link href="/privacy" className="text-navy underline">
          Privacy Policy
        </Link>
        <Link href="/terms" className="text-navy underline">
          Terms of Use
        </Link>
        <Link href="/" className="text-navy underline">
          Back to the app
        </Link>
      </nav>
    </article>
  );
}

export const H2 = ({ children }: { children: ReactNode }) => <h2 className="pt-4 text-[18px] font-semibold text-ink">{children}</h2>;

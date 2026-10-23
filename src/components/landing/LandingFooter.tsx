import Link from "next/link";
import { SITE } from "@/lib/site";
import { FEATURES } from "./features";
import { StartLink } from "./StartLink";
import { Logo } from "../Logo";

const linkCls = "text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline";

/** The footer of the public pages (/welcome, /extension/*): every tool by stage, then the site's own links. */
export function LandingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line bg-subtle">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        {(["Track", "Reach out", "Prep & follow up"] as const).map((g) => (
          <nav key={g} aria-label={g}>
            <h2 className="text-[13px] font-medium text-ink">{g}</h2>
            <ul className="mt-3 space-y-2">
              {FEATURES.filter((f) => f.group === g).map((f) => (
                <li key={f.slug}>
                  <StartLink href={f.href} className={linkCls}>
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
            {[
              ["/extension", "Browser extension"],
              ["/extension/support", "Extension help"],
              ["/privacy", "Privacy"],
              ["/terms", "Terms"],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href} className={linkCls}>
                  {label}
                </Link>
              </li>
            ))}
            <li>
              <a href={`mailto:${SITE.contact}`} className={linkCls}>
                Contact
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div className="mx-auto flex max-w-6xl items-center gap-2 border-t border-line px-4 py-5 text-[12px] text-muted">
        <Logo size={20} />© {year} {SITE.name}
      </div>
    </footer>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { cn } from "@/lib/util";
import { FEATURES, INTEGRATIONS, type Feature } from "./features";
import { StartLink } from "./StartLink";
import { Logo } from "../Logo";

/**
 * The landing page's top bar, HubSpot-style (owner, 2026-10-23): a thin utility strip above the main bar, then logo,
 * mega-menu dropdowns (Products grouped by stage with an icon + one line each, Integrations, Resources), and two
 * buttons on the right: an outline "Open dashboard" and the filled "Get started free". Menus are disclosure buttons
 * (aria-expanded), closed on outside click / Escape; below lg everything folds into one drawer.
 */
type MenuId = "products" | "integrations" | "resources";

const RESOURCES = [
  { label: "How it works", line: "The season, step by step", href: "/welcome#how" },
  { label: "Browser extension", line: "LinkedIn → Coverage in one click", href: "/extension" },
  { label: "Coverage for Claude", line: "Connector + Recruitify plugin", href: "/welcome#claude" },
  { label: "Privacy", line: "What stays in your browser", href: "/privacy" },
  { label: "Terms", line: "The short version", href: "/terms" },
];

const GROUPS: Feature["group"][] = ["Track", "Reach out", "Prep & follow up"];

function Item({ href, icon: Icon, label, line, onClick }: { href: string; icon?: Feature["icon"]; label: string; line: string; onClick: () => void }) {
  return (
    <Link href={href} onClick={onClick} className="group flex items-start gap-3 rounded-lg px-2.5 py-2 hover:bg-hover">
      {Icon && (
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brass-soft text-brass-ink">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-ink group-hover:text-brass-ink">{label}</span>
        <span className="block text-[12px] leading-snug text-muted">{line}</span>
      </span>
    </Link>
  );
}

export function LandingNav() {
  const [open, setOpen] = useState<MenuId | null>(null);
  const [drawer, setDrawer] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(null);
    setDrawer(false);
  };

  const trigger = (id: MenuId, label: string) => (
    <button
      type="button"
      aria-expanded={open === id}
      aria-controls={`menu-${id}`}
      onClick={() => setOpen(open === id ? null : id)}
      className={cn(
        "relative inline-flex h-full items-center gap-1 px-3.5 text-[14px] font-medium text-ink transition-colors hover:text-brass-ink",
        open === id && "text-brass-ink",
      )}
    >
      {label}
      <ChevronDown className={cn("size-4 transition-transform", open === id && "rotate-180")} aria-hidden="true" />
      {open === id && <span className="absolute inset-x-3.5 bottom-0 h-[3px] rounded-t bg-brass" />}
    </button>
  );

  return (
    <header ref={ref} className="sticky top-0 z-40">
      {/* Utility strip */}
      <div className="hidden bg-top text-top-muted sm:block">
        <div className="mx-auto flex h-8 max-w-6xl items-center justify-between px-4 text-[12px]">
          <span>Free for students · your contacts stay in your browser</span>
          <nav aria-label="Utility" className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-top-ink">
              Privacy
            </Link>
            <Link href="/extension" className="hover:text-top-ink">
              Get the extension
            </Link>
            <Link href="/welcome#claude" className="hover:text-top-ink">
              Add to Claude
            </Link>
            <StartLink href="/settings" className="hover:text-top-ink">
              Settings
            </StartLink>
          </nav>
        </div>
      </div>

      {/* Main bar */}
      <div className="border-b border-line bg-panel/95 backdrop-blur">
        <div className="relative mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
          <Link href="/welcome" onClick={close} className="mr-3 flex shrink-0 items-center gap-2.5" aria-label="Coverage home">
            <Logo size={32} />
            <span className="text-[18px] font-medium tracking-tight text-ink">Coverage</span>
          </Link>

          <nav aria-label="Primary" className="hidden h-full items-stretch lg:flex">
            {trigger("products", "Products")}
            {trigger("integrations", "Integrations")}
            {trigger("resources", "Resources")}
            <Link href="/welcome#how" onClick={close} className="inline-flex h-full items-center px-3.5 text-[14px] font-medium text-ink hover:text-brass-ink">
              How it works
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <StartLink
              href="/"
              className="hidden h-10 items-center rounded-lg border border-brass-strong px-4 text-[14px] font-medium text-brass-ink transition-colors hover:bg-brass-soft sm:inline-flex"
            >
              Open dashboard
            </StartLink>
            <StartLink href="/sheet" className="inline-flex h-10 items-center rounded-lg bg-brass-strong px-4 text-[14px] font-medium text-white transition-colors hover:bg-brass-hover">
              Get started free
            </StartLink>
            <button
              type="button"
              className="grid size-10 place-items-center rounded-lg text-ink hover:bg-hover lg:hidden"
              aria-expanded={drawer}
              aria-controls="landing-drawer"
              aria-label={drawer ? "Close menu" : "Open menu"}
              onClick={() => setDrawer((d) => !d)}
            >
              {drawer ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>

          {/* Mega menus */}
          {open === "products" && (
            <div id="menu-products" className="absolute inset-x-4 top-full z-50 mt-px rounded-b-xl border border-t-0 border-line bg-panel p-5 shadow-lg">
              <div className="grid gap-6 lg:grid-cols-3">
                {GROUPS.map((g) => (
                  <div key={g}>
                    <div className="mb-1.5 px-2.5 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">{g}</div>
                    {FEATURES.filter((f) => f.group === g).map((f) => (
                      <Item key={f.slug} href={f.href} icon={f.icon} label={f.label} line={f.line} onClick={close} />
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-lg bg-subtle px-4 py-3 text-[13px]">
                <span className="text-ink-2">New to Coverage? Start with your tracker spreadsheet.</span>
                <StartLink href="/sheet" className="inline-flex items-center gap-1 font-medium text-brass-ink hover:underline">
                  Import it <ArrowRight className="size-3.5" />
                </StartLink>
              </div>
            </div>
          )}
          {open === "integrations" && (
            <div id="menu-integrations" className="absolute top-full left-4 z-50 mt-px w-[min(92vw,420px)] rounded-b-xl border border-t-0 border-line bg-panel p-3 shadow-lg lg:left-[250px]">
              {INTEGRATIONS.map((i) => (
                <Item key={i.label} href={i.href} icon={i.icon} label={i.label} line={i.line} onClick={close} />
              ))}
            </div>
          )}
          {open === "resources" && (
            <div id="menu-resources" className="absolute top-full left-4 z-50 mt-px w-[min(92vw,340px)] rounded-b-xl border border-t-0 border-line bg-panel p-3 shadow-lg lg:left-[390px]">
              {RESOURCES.map((r) => (
                <Item key={r.label} {...r} onClick={close} />
              ))}
            </div>
          )}
        </div>

        {drawer && (
          <nav id="landing-drawer" aria-label="Primary" className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-line bg-panel px-4 pt-3 pb-5 lg:hidden">
            {GROUPS.map((g) => (
              <div key={g} className="mb-3">
                <div className="mb-1 px-2.5 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">{g}</div>
                {FEATURES.filter((f) => f.group === g).map((f) => (
                  <Item key={f.slug} href={f.href} icon={f.icon} label={f.label} line={f.line} onClick={close} />
                ))}
              </div>
            ))}
            <div className="mb-1 px-2.5 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Integrations & resources</div>
            {[...INTEGRATIONS, ...RESOURCES].map((r) => (
              <Item key={r.label} href={r.href} label={r.label} line={r.line} onClick={close} />
            ))}
            <StartLink href="/" className="mt-3 flex h-10 items-center justify-center rounded-lg border border-brass-strong text-[14px] font-medium text-brass-ink sm:hidden">
              Open dashboard
            </StartLink>
          </nav>
        )}
      </div>
    </header>
  );
}

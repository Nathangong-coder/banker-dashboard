"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  BellRing,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Coffee,
  FileText,
  FlaskConical,
  Home,
  Lightbulb,
  Mail,
  MailCheck,
  Menu as MenuIcon,
  NotebookPen,
  Presentation,
  Search,
  Settings2,
  Sheet,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/util";

/**
 * App navigation (docs/DESIGN.md G-2): one white bar of object tabs under the global header, like Salesforce's
 * navigation bar. A tab is either one page or a group with a ▾ menu. Replaced the group switcher + sidebar
 * (owner, 2026-11-22: "copy more of a CRM style").
 */
export type NavPage = { href: string; label: string; icon: ComponentType<{ className?: string }> };
export type NavTab = { label: string; href?: string; icon: NavPage["icon"]; pages?: NavPage[] };

export const NAV: NavTab[] = [
  { label: "Home", href: "/", icon: Home },
  { label: "Things to think about", href: "/think", icon: Lightbulb },
  { label: "Follow-ups", href: "/followups", icon: BellRing },
  { label: "Bank coverage", href: "/coverage", icon: Building2 },
  { label: "Process", href: "/process", icon: Workflow },
  {
    label: "Outreach",
    icon: Mail,
    pages: [
      { href: "/find", label: "Find people", icon: Search },
      { href: "/drafts", label: "Email drafts", icon: Mail },
      { href: "/tracking", label: "Email tracking", icon: MailCheck },
      { href: "/templates", label: "Templates", icon: FileText },
      { href: "/lab", label: "Email lab", icon: FlaskConical },
    ],
  },
  {
    label: "Prep",
    icon: Coffee,
    pages: [
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/prep", label: "Coffee chat prep", icon: Coffee },
      { href: "/log", label: "Activity log", icon: NotebookPen },
      { href: "/info-sessions", label: "Info sessions", icon: Presentation },
    ],
  },
  { label: "Applications", href: "/applications", icon: BriefcaseBusiness },
  {
    label: "More",
    icon: MenuIcon,
    pages: [
      { href: "/sheet", label: "Spreadsheet", icon: Sheet },
      { href: "/corrections", label: "Corrections", icon: Wrench },
      { href: "/settings", label: "Settings", icon: Settings2 },
    ],
  },
];

/** Every page once, for search and the phone menu. */
export const ALL_PAGES: NavPage[] = NAV.flatMap((t) => t.pages ?? [{ href: t.href!, label: t.label, icon: t.icon }]);

export const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`) || path.startsWith(`${href}?`));
const tabActive = (t: NavTab, path: string) => (t.href ? isActive(t.href, path) : !!t.pages?.some((p) => isActive(p.href, path)));

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", esc);
    };
  }, [open, close]);
  return ref;
}

const Count = ({ n }: { n: number }) => (n > 0 ? <span className="num rounded bg-brass-strong px-1.5 text-[11px] leading-[18px] font-semibold text-white">{n}</span> : null);

function GroupTab({ tab, path, badge }: { tab: NavTab; path: string; badge: (href: string) => number }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const on = tabActive(tab, path);
  const current = tab.pages?.find((p) => isActive(p.href, path));
  const total = (tab.pages ?? []).reduce((n, p) => n + badge(p.href), 0);
  return (
    <div ref={ref} className="relative flex h-full">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn("relative flex h-full items-center gap-1 px-3 text-[13px] whitespace-nowrap", on ? "font-semibold text-ink" : "text-ink-2 hover:bg-hover")}
      >
        {current && tab.label !== "More" ? current.label : tab.label}
        <Count n={total} />
        <ChevronDown className="size-3.5 text-muted" />
        {on && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-brass-strong" />}
      </button>
      {open && (
        <div role="menu" className="absolute top-full left-0 z-40 mt-px w-[240px] rounded-lg border border-line bg-panel py-1 shadow-[0_0_7px_rgba(0,0,0,0.14),0_5px_5px_rgba(0,0,0,0.14)]">
          {tab.pages!.map((p) => {
            const a = isActive(p.href, path);
            return (
              <Link key={p.href} role="menuitem" href={p.href} onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-ink hover:bg-hover">
                <p.icon className="size-4 text-muted" />
                <span className="flex-1">{p.label}</span>
                <Count n={badge(p.href)} />
                {a && <Check className="size-3.5 text-brass-strong" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The navigation bar (≥ 768 px). */
export function AppNavBar({ path, badge }: { path: string; badge: (href: string) => number }) {
  return (
    <nav aria-label="App" className="sticky top-12 z-20 hidden h-10 shrink-0 items-stretch border-b border-line bg-side px-2 text-side-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] md:flex">
      {NAV.map((t) =>
        t.pages ? (
          <GroupTab key={t.label} tab={t} path={path} badge={badge} />
        ) : (
          <Link
            key={t.href}
            href={t.href!}
            aria-current={tabActive(t, path) ? "page" : undefined}
            className={cn("relative flex h-full items-center gap-1.5 px-3 text-[13px] whitespace-nowrap", tabActive(t, path) ? "font-semibold text-ink" : "text-ink-2 hover:bg-hover")}
          >
            {t.label}
            <Count n={badge(t.href!)} />
            {tabActive(t, path) && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-brass-strong" />}
          </Link>
        ),
      )}
    </nav>
  );
}

/** Phones: a menu button in the header opens every page as a list (DESIGN.md §8). */
export function MobileMenu({ path, badge, footer }: { path: string; badge: (href: string) => number; footer?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  return (
    <>
      <button type="button" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(true)} className="grid size-11 shrink-0 place-items-center text-top-ink md:hidden">
        <MenuIcon className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(320px,86vw)] flex-col overflow-y-auto bg-panel text-ink shadow-xl">
            <div className="flex h-12 items-center justify-between border-b border-line px-4">
              <span className="text-[14px] font-semibold">Coverage</span>
              <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="grid size-11 place-items-center text-muted">
                <X className="size-5" />
              </button>
            </div>
            {NAV.map((t) => (
              <div key={t.label} className="border-b border-line py-1">
                {t.pages && <div className="px-4 pt-2 pb-1 text-[12px] text-muted">{t.label}</div>}
                {(t.pages ?? [{ href: t.href!, label: t.label, icon: t.icon }]).map((p) => (
                  <Link
                    key={p.href}
                    href={p.href}
                    onClick={() => setOpen(false)}
                    className={cn("flex min-h-11 items-center gap-3 px-4 text-[14px]", isActive(p.href, path) ? "bg-brass-soft font-semibold text-brass-ink" : "hover:bg-hover")}
                  >
                    <p.icon className="size-4 text-muted" />
                    <span className="flex-1">{p.label}</span>
                    <Count n={badge(p.href)} />
                  </Link>
                ))}
              </div>
            ))}
            <div className="mt-auto p-3">{footer}</div>
          </div>
        </div>
      )}
    </>
  );
}

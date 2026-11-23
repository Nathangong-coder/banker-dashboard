import type { ComponentType } from "react";
import { BriefcaseBusiness, Building2, CalendarDays, Coffee, FileText, Flame, FlaskConical, Home, LayoutGrid, Mail, MailCheck, NotebookPen, Presentation, Search, Settings2, Sheet, Workflow, Wrench } from "lucide-react";

/** An ice cube (owner, 2026-11-22: "cold outreach" with an ice-cube logo); lucide has none. Same API as a lucide icon. */
export function IceCube({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3 4 7v10l8 4 8-4V7z" />
      <path d="m4 7 8 4 8-4" />
      <path d="M12 11v10" />
      <path d="M7.5 9.5 7 12.5M9.5 10.5l-.4 2" />
    </svg>
  );
}

/**
 * Navigation (owner, 2026-11-22): the header lists the categories only; a category's pages appear in the left
 * sidebar once you're in it (Salesforce's app navigation + a vertical sub-nav). Settings, Corrections and
 * Applications live in the profile menu.
 */
export type NavPage = { href: string; label: string; icon: ComponentType<{ className?: string }> };
export type NavCategory = { label: string; icon: NavPage["icon"]; pages: NavPage[]; /** Other paths that belong here (record pages). */ also?: string[] };

export const NAV: NavCategory[] = [
  { label: "Home", icon: Home, pages: [{ href: "/", label: "Dashboard", icon: LayoutGrid }] },
  {
    label: "Follow-ups",
    icon: IceCube,
    pages: [
      { href: "/followups", label: "Cold outreach", icon: IceCube },
      { href: "/think", label: "Warm follow-ups", icon: Flame },
    ],
  },
  {
    label: "Banks",
    icon: Building2,
    pages: [
      { href: "/coverage", label: "Bank coverage", icon: Building2 },
      { href: "/process", label: "Process", icon: Workflow },
      { href: "/sheet", label: "Spreadsheet", icon: Sheet },
    ],
    also: ["/bank", "/person"],
  },
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
];

/** In the profile menu, not the bar. */
export const PROFILE_PAGES: NavPage[] = [
  { href: "/settings", label: "Settings", icon: Settings2 },
  { href: "/corrections", label: "Corrections", icon: Wrench },
  { href: "/applications", label: "Applications", icon: BriefcaseBusiness },
];

/** Every page once, for search and the phone menu. */
export const ALL_PAGES: NavPage[] = [...NAV.flatMap((c) => c.pages), ...PROFILE_PAGES];

export const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
export const categoryOf = (path: string) => NAV.find((c) => c.pages.some((p) => isActive(p.href, path)) || c.also?.some((a) => isActive(a, path)));


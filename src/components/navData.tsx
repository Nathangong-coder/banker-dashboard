import type { ComponentType } from "react";
import { BellRing, ListTodo, MessagesSquare, Tags, BriefcaseBusiness, Building2, CalendarDays, Coffee, FileText, Flame, FlaskConical, Home, LayoutGrid, Mail, MailCheck, NotebookPen, Presentation, Search, Settings2, Sheet, Workflow, Wrench } from "lucide-react";

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
export type NavPage = { href: string; label: string; icon: ComponentType<{ className?: string }>; /** One line under it in the category menu. */ hint?: string };
export type NavCategory = { label: string; icon: NavPage["icon"]; pages: NavPage[]; /** Other paths that belong here (record pages). */ also?: string[] };

export const NAV: NavCategory[] = [
  { label: "Home", icon: Home, pages: [{ href: "/", label: "Dashboard", icon: LayoutGrid, hint: "Tonight's list, this week's numbers" }] },
  {
    label: "Follow-ups",
    icon: IceCube,
    pages: [
      { href: "/todo", label: "To-do", icon: ListTodo, hint: "Everything that needs you, cold and warm, by when it's due" },
      { href: "/followups", label: "Cold outreach", icon: IceCube, hint: "Follow up on emails with no reply yet" },
      { href: "/think", label: "Warm follow-ups", icon: Flame, hint: "Replies, thank-yous and check-ins with people you've talked to" },
      { href: "/ongoing", label: "Ongoing threads", icon: MessagesSquare, hint: "Every live conversation, and what's already scheduled to go out" },
      { href: "/reminders", label: "Reminders", icon: BellRing, hint: "Your 9 PM text: what's in it, when it updates, where it goes" },
    ],
  },
  {
    label: "Banks",
    icon: Building2,
    pages: [
      { href: "/coverage", label: "Bank coverage", icon: Building2, hint: "Every bank by office: who you know, what's next" },
      { href: "/process", label: "Process", icon: Workflow, hint: "Each bank's recruiting step, Watching to Offer" },
      { href: "/sheet", label: "Spreadsheet", icon: Sheet, hint: "Your workbook, grid or contact list" },
    ],
    also: ["/bank", "/person"],
  },
  {
    label: "Outreach",
    icon: Mail,
    pages: [
      { href: "/find", label: "Find people", icon: Search, hint: "Search LinkedIn results for bankers to email" },
      { href: "/drafts", label: "Email drafts", icon: Mail, hint: "Write and send first emails" },
      { href: "/tracking", label: "Email tracking", icon: MailCheck, hint: "Who opened your emails" },
      { href: "/labels", label: "Gmail labels", icon: Tags, hint: "Label banker threads in Gmail to match your tracker" },
      { href: "/templates", label: "Templates", icon: FileText, hint: "Your email templates, hooks and resume" },
      { href: "/lab", label: "Email lab", icon: FlaskConical, hint: "What wording gets replies" },
    ],
  },
  {
    label: "Prep",
    icon: Coffee,
    pages: [
      { href: "/calendar", label: "Calendar", icon: CalendarDays, hint: "Coffee chats and info sessions on your calendar" },
      { href: "/prep", label: "Coffee chat prep", icon: Coffee, hint: "Brief, questions and grading for a chat" },
      { href: "/log", label: "Activity log", icon: NotebookPen, hint: "Every conversation you've logged" },
      { href: "/info-sessions", label: "Info sessions", icon: Presentation, hint: "Sessions, who you met, thank-yous" },
    ],
  },
];

/** In the profile menu, not the bar. */
export const PROFILE_PAGES: NavPage[] = [
  { href: "/settings", label: "Settings", icon: Settings2, hint: "Profile, email, keys, reminders" },
  { href: "/corrections", label: "Corrections", icon: Wrench, hint: "Fix anything Coverage guessed" },
  { href: "/applications", label: "Applications", icon: BriefcaseBusiness, hint: "Jobs you're applying to" },
];

/** Every page once, for search and the phone menu. */
export const ALL_PAGES: NavPage[] = [...NAV.flatMap((c) => c.pages), ...PROFILE_PAGES];

export const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
export const categoryOf = (path: string) => NAV.find((c) => c.pages.some((p) => isActive(p.href, path)) || c.also?.some((a) => isActive(a, path)));


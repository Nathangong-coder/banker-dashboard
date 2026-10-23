import {
  BellRing,
  Bot,
  Building2,
  CalendarDays,
  Coffee,
  FlaskConical,
  Mail,
  MessageCircle,
  Presentation,
  Search,
  Sheet,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { MockId } from "./mocks";

/**
 * What the landing page (/welcome) shows: every tool once, in the order a recruiting season runs. The nav's
 * Products menu, the tool gallery and the footer all read this list, so a new tool is added in one place.
 * Copy names WHAT a tool does for the student, never how it's built.
 */
export interface Feature {
  slug: string;
  label: string;
  line: string;
  href: string;
  icon: LucideIcon;
  group: "Track" | "Reach out" | "Prep & follow up";
  mock: MockId;
  /** Slab background: a soft theme token, dark text on it in every theme. */
  slab: string;
}

export const FEATURES: Feature[] = [
  { slug: "sheet", label: "Your spreadsheet, live", line: "Import your tracker. Edits sync both ways, formatting kept.", href: "/sheet", icon: Sheet, group: "Track", mock: "sheet", slab: "bg-chart-soft" },
  { slug: "coverage", label: "Bank coverage", line: "Every desk you're recruiting for, and where you have no one yet.", href: "/coverage", icon: Building2, group: "Track", mock: "coverage", slab: "bg-blue-soft" },
  { slug: "firms", label: "Firm scores", line: "Which banks reply, take calls and refer you.", href: "/firms", icon: Trophy, group: "Track", mock: "firms", slab: "bg-amber-soft" },
  { slug: "find", label: "Find bankers", line: "Search by bank, office and team, with verified emails.", href: "/find", icon: Search, group: "Reach out", mock: "find", slab: "bg-green-soft" },
  { slug: "drafts", label: "Personal emails", line: "Your own wording, the right hook for each banker.", href: "/drafts", icon: Mail, group: "Reach out", mock: "draft", slab: "bg-brass-soft" },
  { slug: "smart", label: "Smart mentions", line: "\"I just talked to Ben…\" pulled from your chat notes.", href: "/drafts", icon: Sparkles, group: "Reach out", mock: "smart", slab: "bg-red-soft" },
  { slug: "lab", label: "Email lab", line: "A/B test subjects, asks and send times on real replies.", href: "/lab", icon: FlaskConical, group: "Reach out", mock: "lab", slab: "bg-chart-soft" },
  { slug: "followups", label: "Follow-ups that send", line: "Scheduled in their time zone, stopped the moment they reply.", href: "/followups", icon: BellRing, group: "Prep & follow up", mock: "followups", slab: "bg-blue-soft" },
  { slug: "text", label: "The 9 PM text", line: "Tonight's thank-yous and follow-ups, on WhatsApp.", href: "/followups?tab=reminders", icon: MessageCircle, group: "Prep & follow up", mock: "text", slab: "bg-green-soft" },
  { slug: "prep", label: "Coffee chat prep", line: "A brief, common ground and questions before every call.", href: "/prep", icon: Coffee, group: "Prep & follow up", mock: "prep", slab: "bg-amber-soft" },
  { slug: "calendar", label: "Calendar & chat log", line: "Calls from Google Calendar, graded notes after.", href: "/calendar", icon: CalendarDays, group: "Prep & follow up", mock: "log", slab: "bg-brass-soft" },
  { slug: "info", label: "Info sessions", line: "Snap the name tags. Thank-yous drafted that night.", href: "/info-sessions", icon: Presentation, group: "Prep & follow up", mock: "info", slab: "bg-red-soft" },
];

export const INTEGRATIONS: { label: string; line: string; href: string; icon: LucideIcon }[] = [
  { label: "Gmail", line: "Drafts, sends and reply tracking", href: "/followups?tab=reminders", icon: Mail },
  { label: "Google Calendar", line: "Coffee chats and info sessions", href: "/calendar", icon: CalendarDays },
  { label: "Excel", line: "Your .xlsx, saved in place", href: "/sheet", icon: Sheet },
  { label: "WhatsApp", line: "The 9 PM to-do text", href: "/followups?tab=reminders", icon: MessageCircle },
  { label: "Claude", line: "Connector + Recruitify plugin", href: "/welcome#claude", icon: Bot },
];

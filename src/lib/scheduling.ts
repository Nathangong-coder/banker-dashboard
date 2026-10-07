import { DEFAULT_AVAILABILITY, timeLabel, tzLabel, type Availability } from "./availability";
import type { Contact, Settings } from "./types";

/**
 * Scheduling calls with bankers who replied: the availability reply (in their time zone) and the calendar invite.
 * Templates use {{…}} fields filled by `fillScheduling`; everything is editable in Settings → Email → Scheduling.
 */
export interface SchedulingSettings {
  availability: Availability;
  /** The reply that offers times. {{availability}} = one line per day in their time zone. */
  replyTemplate: string;
  inviteTitle: string;
  inviteDescription: string;
  /** Email the invite to them (Google sends it) or only put it on your calendar. */
  inviteNotify: boolean;
}

export const DEFAULT_REPLY = `Hi {{first_name}},

Thank you so much for getting back to me! I'd love to find a time to chat. Here's when I'm free ({{their_tz}}):

{{availability}}

Please let me know what works best for you, along with the best number to reach you. Looking forward to it!

Best,
{{my_first_name}}`;

export const DEFAULT_INVITE_TITLE = "{{my_first_name}}<>{{first_name}} Coffee Chat";
export const DEFAULT_INVITE_DESCRIPTION = "{{my_first_name}} ({{my_phone}}) to call {{first_name}} ({{their_phone}}) at {{time}}";

export function schedulingOf(s: Pick<Settings, "scheduling">): SchedulingSettings {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
  const cur = s.scheduling;
  return {
    availability: { ...DEFAULT_AVAILABILITY(tz), ...(cur?.availability ?? {}) },
    replyTemplate: cur?.replyTemplate || DEFAULT_REPLY,
    inviteTitle: cur?.inviteTitle || DEFAULT_INVITE_TITLE,
    inviteDescription: cur?.inviteDescription || DEFAULT_INVITE_DESCRIPTION,
    inviteNotify: cur?.inviteNotify ?? true,
  };
}

export const SCHEDULING_FIELDS: [string, string][] = [
  ["first_name", "their first name"],
  ["their_name", "their full name"],
  ["bank", "their firm"],
  ["their_phone", "their phone"],
  ["their_tz", "their time zone (ET / PT…)"],
  ["availability", "your free times, in their time zone (reply only)"],
  ["time", "the call time in their zone, e.g. 10 AM PT (invite only)"],
  ["date", "the call date, e.g. Tuesday, Oct 13 (invite only)"],
  ["my_first_name", "your first name"],
  ["my_name", "your full name"],
  ["my_phone", "your phone"],
];

/** Fill {{fields}} for a reply or an invite. Unknown fields are left visible so they get noticed. */
export function fillScheduling(
  template: string,
  c: Pick<Contact, "firstName" | "name" | "bank" | "phone">,
  me: Settings["profile"],
  extra: { theirTz: string; availability?: string[]; at?: Date },
) {
  const myFirst = me.name.trim().split(/\s+/)[0] ?? "";
  const vals: Record<string, string> = {
    first_name: c.firstName || c.name.split(" ")[0],
    their_name: c.name,
    bank: c.bank,
    their_phone: c.phone || "their number",
    their_tz: tzLabel(extra.theirTz, extra.at),
    availability: (extra.availability ?? []).map((l) => `- ${l}`).join("\n"),
    time: extra.at ? timeLabel(extra.at, extra.theirTz) : "",
    date: extra.at ? extra.at.toLocaleDateString("en-US", { timeZone: extra.theirTz, weekday: "long", month: "short", day: "numeric" }) : "",
    my_first_name: myFirst,
    my_name: me.name,
    my_phone: me.phone,
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in vals ? vals[k] : m));
}

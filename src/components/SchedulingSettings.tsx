"use client";

import { useState } from "react";
import { CalendarDays, RotateCcw } from "lucide-react";
import { useStore } from "@/lib/store";
import { googleClientId } from "@/lib/keys";
import { busyTimes } from "@/lib/gcal";
import { COMMON_ZONES, formatWindows, freeWindows, parseRanges, rangesText, tzLabel, ymdIn, type Availability, type Range, type Window } from "@/lib/availability";
import { DEFAULT_INVITE_DESCRIPTION, DEFAULT_INVITE_TITLE, DEFAULT_REPLY, SCHEDULING_FIELDS, schedulingOf, type SchedulingSettings } from "@/lib/scheduling";
import { zonedDate } from "@/lib/sendWindow";
import { Button, Card, CardHeader, Checkbox, Field, Input, Select, Textarea, toast } from "./ui";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A text box for one day's hours ("7-10am, 2-4pm"): saves when it parses, shows the problem when it doesn't. */
function RangesInput({ value, onChange, placeholder, label }: { value: Range[] | undefined; onChange: (r: Range[] | undefined) => void; placeholder?: string; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const shown = draft ?? (value === undefined ? "" : rangesText(value));
  return (
    <div>
      <Input
        aria-label={label}
        aria-invalid={!!error}
        value={shown}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!e.target.value.trim() && placeholder) {
            setError(undefined);
            return onChange(undefined);
          }
          try {
            onChange(parseRanges(e.target.value));
            setError(undefined);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
        onBlur={() => !error && setDraft(null)}
      />
      {error && <span className="mt-0.5 block text-[11px] text-red">{error}</span>}
    </div>
  );
}

const weekStart = (offset: number, tz: string) => {
  const now = new Date();
  const ymd = ymdIn(now, tz).split("-").map(Number);
  const noon = zonedDate(ymd[0], ymd[1], ymd[2], 12, 0, tz);
  const wd = new Date(noon.toLocaleString("en-US", { timeZone: tz })).getDay();
  // Monday of this week (+ offset weeks).
  return zonedDate(ymd[0], ymd[1], ymd[2] - ((wd + 6) % 7) + offset * 7, 12, 0, tz);
};

export function SchedulingSettingsEditor() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const sch = schedulingOf(settings);
  const av = sch.availability;
  const [week, setWeek] = useState(0);
  const [busy, setBusy] = useState<Window[] | null>(null);
  const set = (patch: Partial<SchedulingSettings>) => setSettings((x) => ({ ...x, scheduling: { ...schedulingOf(x), ...patch } }));
  const setAv = (patch: Partial<Availability>) => set({ availability: { ...av, ...patch } });

  const days = Array.from({ length: 7 }, (_, i) => {
    const noon = new Date(weekStart(week, av.tz).getTime() + i * 86_400_000);
    const key = ymdIn(noon, av.tz);
    const wd = new Date(noon.toLocaleString("en-US", { timeZone: av.tz })).getDay();
    return { key, wd, label: noon.toLocaleDateString("en-US", { timeZone: av.tz, weekday: "short", month: "short", day: "numeric" }), noon };
  });
  const busyOn = (key: string) => (busy ?? []).filter((b) => ymdIn(b.start, av.tz) === key);
  const preview = (tz: string) => {
    const now = new Date();
    return formatWindows(freeWindows(av, busy ?? [], now, new Date(now.getTime() + av.horizonDays * 86_400_000), now), tz, { maxDays: 3 });
  };
  const other = av.tz === "America/New_York" ? "America/Los_Angeles" : "America/New_York";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Your availability for calls" sub={`In your time zone. Bankers see it converted to theirs (NY → ET, SF → PT) when you reply with times.`} right={<CalendarDays className="size-4 text-muted" />} />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4 md:grid-cols-4">
          <Field label="Your time zone">
            <Select className="w-full" value={av.tz} onChange={(e) => setAv({ tz: e.target.value })}>
              {(COMMON_ZONES.some(([z]) => z === av.tz) ? COMMON_ZONES : [[av.tz, av.tz] as [string, string], ...COMMON_ZONES]).map(([z, l]) => (
                <option key={z} value={z}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Call length">
            <Select className="w-full" value={av.meetingMinutes} onChange={(e) => setAv({ meetingMinutes: Number(e.target.value) })}>
              {[15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notice" hint="Don't offer times sooner than this">
            <Select className="w-full" value={av.minNoticeHours} onChange={(e) => setAv({ minNoticeHours: Number(e.target.value) })}>
              {[2, 6, 12, 24, 48].map((h) => (
                <option key={h} value={h}>
                  {h} hours
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Look ahead" hint="When they don't say which days">
            <Select className="w-full" value={av.horizonDays} onChange={(e) => setAv({ horizonDays: Number(e.target.value) })}>
              {[5, 7, 10, 14].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="border-t border-line p-4">
          <div className="mb-2 text-[12.5px] font-medium text-ink-2">Every week ({tzLabel(av.tz)}) · type hours like “7-10am, 2-4pm”, or “off”</div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-2 sm:grid-cols-2">
            {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
              <label key={wd} className="grid grid-cols-[90px_minmax(0,1fr)] items-start gap-2 text-[13px]">
                <span className="pt-2">{DAYS[wd]}</span>
                <RangesInput label={`${DAYS[wd]} hours`} value={av.weekly[wd] ?? []} onChange={(r) => setAv({ weekly: { ...av.weekly, [wd]: r ?? [] } })} />
              </label>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="A specific week"
          sub="Change one week without touching the usual hours. Leave a day blank to keep the usual hours."
          right={
            <div className="flex flex-wrap items-center gap-2">
              <Select className="h-8" value={week} onChange={(e) => setWeek(Number(e.target.value))} aria-label="Week">
                {[0, 1, 2, 3].map((w) => (
                  <option key={w} value={w}>
                    {w === 0 ? "This week" : w === 1 ? "Next week" : `In ${w} weeks`} ({weekStart(w, av.tz).toLocaleDateString("en-US", { timeZone: av.tz, month: "short", day: "numeric" })})
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    const from = weekStart(0, av.tz);
                    setBusy(await busyTimes(googleClientId(settings), new Date(from.getTime() - 86_400_000), new Date(from.getTime() + 29 * 86_400_000)));
                  } catch (e) {
                    toast.err((e as Error).message);
                  }
                }}
              >
                {busy ? "Calendar checked" : "Show my calendar"}
              </Button>
            </div>
          }
        />
        <div className="space-y-2 p-4">
          {days.map((d) => {
            const has = d.key in av.overrides;
            const events = busyOn(d.key);
            return (
              <div key={d.key} className="grid grid-cols-[minmax(0,1fr)] items-start gap-2 text-[13px] sm:grid-cols-[110px_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                <span className="pt-2 font-medium">{d.label}</span>
                <RangesInput
                  label={`${d.label} hours`}
                  value={has ? av.overrides[d.key] : undefined}
                  placeholder={`usual: ${rangesText(av.weekly[d.wd] ?? [])}`}
                  onChange={(r) => {
                    const next = { ...av.overrides };
                    if (r === undefined) delete next[d.key];
                    else next[d.key] = r;
                    setAv({ overrides: next });
                  }}
                />
                <span className="pt-2 text-[12px] text-muted">
                  {busy ? (events.length ? `Busy ${events.map((b) => `${b.start.toLocaleTimeString("en-US", { timeZone: av.tz, hour: "numeric", minute: "2-digit" })}–${b.end.toLocaleTimeString("en-US", { timeZone: av.tz, hour: "numeric", minute: "2-digit" })}`).join(", ")}` : "No events") : ""}
                </span>
                {has ? (
                  <button
                    className="pt-2 text-[12px] text-navy underline"
                    onClick={() => {
                      const next = { ...av.overrides };
                      delete next[d.key];
                      setAv({ overrides: next });
                    }}
                  >
                    usual
                  </button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
        <div className="border-t border-line p-4 text-[12.5px]">
          <div className="mb-1 font-medium text-ink-2">What a banker would see{busy ? "" : " (before your calendar events are taken out)"}</div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            {[av.tz, other].map((tz) => (
              <div key={tz}>
                <div className="text-muted">In {tzLabel(tz)}:</div>
                <ul className="num">{preview(tz).map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Reply and invite templates"
          sub={`Fields: ${SCHEDULING_FIELDS.map(([k]) => `{{${k}}}`).join(" ")}`}
          right={
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => set({ replyTemplate: DEFAULT_REPLY, inviteTitle: DEFAULT_INVITE_TITLE, inviteDescription: DEFAULT_INVITE_DESCRIPTION })}>
              Reset
            </Button>
          }
        />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
          <Field label="Reply with your times" hint="{{availability}} becomes one line per day, already in their time zone.">
            <Textarea rows={10} value={sch.replyTemplate} onChange={(e) => set({ replyTemplate: e.target.value })} />
          </Field>
          <Field label="Invite title">
            <Input value={sch.inviteTitle} onChange={(e) => set({ inviteTitle: e.target.value })} />
          </Field>
          <Field label="Invite description" hint="Their phone comes from their email signature when it's there.">
            <Textarea rows={2} value={sch.inviteDescription} onChange={(e) => set({ inviteDescription: e.target.value })} />
          </Field>
          <Checkbox checked={sch.inviteNotify} onChange={(v) => set({ inviteNotify: v })} label="Email the invite to them by default (otherwise it only goes on your calendar)" />
        </div>
      </Card>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { useStore } from "@/lib/store";
import { applySchedule, sendableDraft } from "@/lib/serverSync";
import { planBatch, windowOf, type BatchOptions } from "@/lib/sendWindow";
import { tzLabel } from "@/lib/availability";
import type { Contact } from "@/lib/types";
import { Button, Field, Input, Select, toast } from "./ui";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const mins = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + (m || 0);
};
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/**
 * Schedule (or re-time) many emails at once with your own overrides: put them all on one day, keep each day but set the
 * time, or spread them through a time range, N minutes apart, in their time zone or yours. A day you pick is never moved
 * (unlike the automatic plan, which rolls overflow to the next allowed day); anything odd is flagged in the preview.
 */
export function BatchSchedule({ contacts, onClose }: { contacts: Contact[]; onClose: () => void }) {
  const saved = useStore((s) => s.settings.sendWindow);
  const w = windowOf({ sendWindow: saved });
  const anyQueued = contacts.some((c) => c.serverSend);
  const [opts, setOpts] = useState<BatchOptions>({
    day: anyQueued ? { mode: "keep" } : { mode: "auto" },
    time: { mode: "spread", start: w.start * 60, end: w.end * 60, at: w.start * 60 },
    basis: w.basis,
    gap: 4,
  });
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  const usable = useMemo(() => contacts.filter((c) => c.serverSend || sendableDraft(c)), [contacts]);
  const unusable = contacts.length - usable.length;
  const plan = useMemo(() => {
    const current = new Map(usable.filter((c) => c.serverSend).map((c) => [c.id, new Date(c.serverSend!.sendAt)]));
    const effective: BatchOptions = { ...opts, day: opts.day.mode === "date" ? { mode: "date", date } : opts.day };
    return planBatch(usable, effective, windowOf({ sendWindow: saved }), current);
  }, [usable, opts, date, saved]);
  const warnings = [...plan.values()].filter((p) => p.warn).length;
  const set = (patch: Partial<BatchOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const fmt = (d: Date, tz: string) => `${d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ${tzLabel(tz, d)}`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <Field label="Day">
          <div className="flex flex-wrap gap-2">
            <Select className="min-w-0 flex-1" value={opts.day.mode} onChange={(e) => set({ day: { mode: e.target.value as BatchOptions["day"]["mode"] } })}>
              {anyQueued && <option value="keep">Keep each one&apos;s day</option>}
              <option value="date">All on one day…</option>
              <option value="auto">Next allowed day ({w.days.length === 3 && w.days.join() === "2,3,4" ? "Tue–Thu" : "your send days"})</option>
            </Select>
            {opts.day.mode === "date" && <Input type="date" className="w-auto" value={date} min={todayIso()} onChange={(e) => setDate(e.target.value)} />}
          </div>
        </Field>
        <Field label="Time">
          <div className="flex flex-wrap items-center gap-2">
            <Select className="min-w-0 flex-1" value={opts.time.mode} onChange={(e) => set({ time: { ...opts.time, mode: e.target.value as BatchOptions["time"]["mode"] } })}>
              {anyQueued && <option value="keep">Keep each one&apos;s time</option>}
              <option value="spread">Spread between…</option>
              <option value="exact">Starting at…</option>
            </Select>
            {opts.time.mode === "spread" && (
              <>
                <Input type="time" step={300} className="w-auto" value={hhmm(opts.time.start ?? 540)} onChange={(e) => set({ time: { ...opts.time, start: mins(e.target.value) } })} aria-label="From" />
                <span className="text-[12px] text-muted">to</span>
                <Input type="time" step={300} className="w-auto" value={hhmm(opts.time.end ?? 660)} onChange={(e) => set({ time: { ...opts.time, end: mins(e.target.value) } })} aria-label="To" />
              </>
            )}
            {opts.time.mode === "exact" && <Input type="time" step={300} className="w-auto" value={hhmm(opts.time.at ?? 540)} onChange={(e) => set({ time: { ...opts.time, at: mins(e.target.value) } })} aria-label="Time" />}
          </div>
        </Field>
        <Field label="In whose time zone">
          <Select className="w-full" value={opts.basis} onChange={(e) => set({ basis: e.target.value as BatchOptions["basis"] })}>
            <option value="recipient">The banker&apos;s (NY → ET, SF → PT…)</option>
            <option value="mine">Mine</option>
          </Select>
        </Field>
        <Field label="Minutes between sends" hint="Per time zone, same day. 0 = all at once.">
          <Input type="number" min={0} max={60} value={opts.gap} onChange={(e) => set({ gap: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} />
        </Field>
      </div>

      <div>
        <div className="mb-1 text-[12px] font-medium text-ink-2">
          {usable.length} email{usable.length === 1 ? "" : "s"}
          {warnings ? <span className="text-amber"> · {warnings} flagged</span> : null}
          {unusable ? <span className="text-muted"> · {unusable} without a Gmail draft left out (draft them first)</span> : null}
        </div>
        <ul className="max-h-[300px] divide-y divide-line overflow-y-auto rounded-md border border-line text-[12.5px]">
          {usable.map((c) => {
            const p = plan.get(c.id)!;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <span className="min-w-[140px] flex-1">
                  {c.name} <span className="text-muted">· {c.bank}</span>
                </span>
                {c.serverSend && <span className="text-[11.5px] text-muted line-through">{fmt(new Date(c.serverSend.sendAt), p.tz)}</span>}
                <span className="num font-medium">{fmt(p.at, p.tz)}</span>
                {p.warn && <span className="w-full text-[11.5px] text-amber">⚠ {p.warn}</span>}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={busy}
          icon={<CalendarClock className="size-4" />}
          disabled={!usable.length || [...plan.values()].some((p) => p.warn === "that time has already passed")}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await applySchedule(new Map([...plan].map(([id, p]) => [id, p.at])));
              toast.ok(`Scheduled ${r.n} email${r.n === 1 ? "" : "s"}.${r.skipped.length ? ` Left out: ${r.skipped.slice(0, 4).join(", ")}${r.skipped.length > 4 ? "…" : ""}.` : ""}`);
              onClose();
            } catch (e) {
              toast.err((e as Error).message);
            }
            setBusy(false);
          }}
        >
          Schedule {usable.length}
        </Button>
      </div>
    </div>
  );
}

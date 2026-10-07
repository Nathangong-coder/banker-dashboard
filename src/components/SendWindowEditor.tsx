"use client";

import { useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { useStore } from "@/lib/store";
import { DEFAULT_SEND_WINDOW, nextSendSlot, windowLabel, windowOf, type SendWindow } from "@/lib/sendWindow";
import { rescheduleQueued } from "@/lib/serverSync";
import { Button, Card, CardHeader, Checkbox, Field, Select, toast } from "./ui";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`;

/**
 * When scheduled emails go out (lib/sendWindow.ts): a window of hours in the recipient's time zone or yours, weekdays
 * only by default, with a preview of the next slot for a NY / SF / Houston person and a button that moves everything
 * already queued into the new window.
 */
export function SendWindowEditor() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const queued = useStore((s) => s.contacts.filter((c) => c.serverSend && new Date(c.serverSend.sendAt) > new Date()).length);
  const w = windowOf(settings);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<SendWindow>) =>
    setSettings((x) => {
      const next = { ...windowOf(x), ...patch };
      // Keep at least an hour open.
      if (next.end <= next.start) next.end = Math.min(24, next.start + 1);
      return { ...x, sendWindow: next };
    });
  const examples = useMemo(
    () =>
      [
        { id: "ny", region: "NY" as const, location: "NY", who: "Someone in New York" },
        { id: "sf", region: "SF" as const, location: "SF", who: "Someone in SF / LA" },
        { id: "tx", region: "Other" as const, location: "Houston", who: "Someone in Houston" },
      ].map((p) => ({ ...p, slot: nextSendSlot(p, w) })),
    [w],
  );

  return (
    <Card>
      <CardHeader title="Send window" sub={`Scheduled emails go out ${windowLabel(w)}, a few minutes apart.`} right={<Clock className="size-4 text-muted" />} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4 md:grid-cols-4">
        <Field label="From">
          <Select className="w-full" value={w.start} onChange={(e) => set({ start: Number(e.target.value) })}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Until">
          <Select className="w-full" value={w.end} onChange={(e) => set({ end: Number(e.target.value) })}>
            {HOURS.filter((h) => h > w.start).map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
            <option value={24}>midnight</option>
          </Select>
        </Field>
        <Field label="In whose time zone" hint="Their office: NY → Eastern, Chicago / Texas → Central, else Pacific">
          <Select className="w-full" value={w.basis} onChange={(e) => set({ basis: e.target.value as SendWindow["basis"] })}>
            <option value="recipient">The banker&apos;s</option>
            <option value="mine">Mine</option>
          </Select>
        </Field>
        <Field label="Days">
          <label className="flex h-9 items-center gap-2 text-[13px]">
            <Checkbox checked={w.weekdaysOnly} onChange={(v) => set({ weekdaysOnly: v })} /> Weekdays only
          </label>
        </Field>
        <div className="md:col-span-4">
          <div className="mb-1 text-[12px] font-medium text-ink-2">If you scheduled one now</div>
          <ul className="space-y-0.5 text-[12.5px] text-ink-2">
            {examples.map((e) => (
              <li key={e.id}>
                {e.who}: <span className="num">{e.slot.label}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:col-span-4">
          {queued > 0 && (
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const n = await rescheduleQueued();
                  toast.ok(`Moved ${n} queued email${n === 1 ? "" : "s"} into ${windowLabel(windowOf(useStore.getState().settings))}.`);
                } catch (e) {
                  toast.err((e as Error).message);
                }
                setBusy(false);
              }}
            >
              Move {queued} queued email{queued === 1 ? "" : "s"} into this window
            </Button>
          )}
          {settings.sendWindow && (
            <Button size="sm" variant="ghost" onClick={() => setSettings((x) => ({ ...x, sendWindow: { ...DEFAULT_SEND_WINDOW } }))}>
              Reset to 9–11 AM their time
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

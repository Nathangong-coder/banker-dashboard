"use client";

import { useMemo, useState } from "react";
import { Check, Clock, FlaskConical, Play, Plus, Square, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { arm, resultsByFont, verdict, type Arm } from "@/lib/experiments";
import { TIME_WINDOWS, experimentArmOf } from "@/lib/segments";
import { EMAIL_FONTS, type Contact, type EmailFont, type Experiment } from "@/lib/types";
import { cn, fmtDate, uid } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Field, Input, Select, toast } from "./ui";

export const FONT_LABELS = Object.fromEntries(Object.entries(EMAIL_FONTS).map(([k, v]) => [k, v.label]));

const KIND_LABEL: Record<Experiment["kind"], string> = { font: "Font", time: "Send time", custom: "Custom" };

function useExperiments() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const experiments = settings.experiments ?? [];
  const setExps = (fn: (e: Experiment[]) => Experiment[]) => setSettings((s) => ({ ...s, experiments: fn(s.experiments ?? []) }));
  return { experiments, setExps };
}

/** Reply rates per arm. Send-time arms come from when emails actually went out, so past emails count too. */
export function armsOf(e: Experiment, contacts: Contact[]): Arm[] {
  const groups = new Map<string, { label: string; list: Contact[] }>();
  for (const a of e.arms) groups.set(a.id, { label: a.label, list: [] });
  for (const c of contacts) {
    const v = experimentArmOf(c, e);
    if (!v) continue;
    const g = groups.get(v.key) ?? { label: v.label, list: [] };
    g.list.push(c);
    groups.set(v.key, g);
  }
  return [...groups.entries()].map(([id, g]) => arm(id, g.label, g.list)).filter((a) => a.drafted > 0 || e.arms.some((x) => x.id === a.id));
}

/* ================= setup ================= */

export function ExperimentsSetup() {
  const { experiments, setExps } = useExperiments();
  const [creating, setCreating] = useState(false);
  const running = experiments.filter((e) => e.status === "running");
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <FlaskConical className="size-4 text-brass" /> Experiments
          </span>
        }
        sub="Test one thing at a time: the font, when you send, or anything you label yourself. Every Gmail draft records what it used, and Gmail sync picks up the replies. See Results for how each is doing."
        right={
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(!creating)}>
            New experiment
          </Button>
        }
      />
      {creating && (
        <NewExperiment
          fontBusy={running.some((e) => e.kind === "font")}
          onCreate={(e) => {
            setExps((list) => [e, ...list]);
            setCreating(false);
            toast.ok(
              e.kind === "time"
                ? `“${e.name}” is running. Your sent emails are tagged by when they went out (in the recipient's time zone), including ones already sent.`
                : `“${e.name}” is running. New Gmail drafts ${e.mode === "wave" ? `use ${e.arms.find((a) => a.id === e.currentArm)?.label}` : "alternate between the options"}.`,
            );
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {experiments.length === 0 && !creating && (
        <div className="px-4 py-4 text-[12.5px] text-ink-2">
          No experiments yet.{" "}
          <button className="font-medium text-navy hover:underline" onClick={() => setCreating(true)}>
            Start a font or send-time test
          </button>
          .
        </div>
      )}
      <ul className="divide-y divide-line">
        {experiments.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[12.5px]">
            <span className="text-[13px] font-medium">{e.name}</span>
            <Badge>{KIND_LABEL[e.kind]}</Badge>
            <Badge tone={e.status === "running" ? "green" : "neutral"}>{e.status === "running" ? "running" : `ended ${fmtDate(e.endedAt)}`}</Badge>
            <span className="text-muted">{e.arms.map((a) => a.label).join(" · ")}</span>
            <div className="flex-1" />
            {e.status === "running" && e.mode === "wave" && e.kind !== "time" && (
              <label className="flex items-center gap-1.5">
                This wave:
                <Select className="h-7 text-[12px]" value={e.currentArm} onChange={(ev) => setExps((list) => list.map((x) => (x.id === e.id ? { ...x, currentArm: ev.target.value } : x)))} aria-label="Current wave">
                  {e.arms.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {e.status === "running" ? (
              <Button size="sm" variant="ghost" icon={<Square className="size-3" />} onClick={() => setExps((list) => list.map((x) => (x.id === e.id ? { ...x, status: "ended", endedAt: new Date().toISOString() } : x)))}>
                End
              </Button>
            ) : (
              <button className="rounded p-1 text-muted hover:text-red" aria-label={`Delete ${e.name}`} onClick={() => setExps((list) => list.filter((x) => x.id !== e.id))}>
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NewExperiment({ fontBusy, onCreate, onCancel }: { fontBusy: boolean; onCreate: (e: Experiment) => void; onCancel: () => void }) {
  const current = useStore((s) => s.settings.emailStyle.font);
  const [kind, setKind] = useState<Experiment["kind"]>(fontBusy ? "time" : "font");
  const [fonts, setFonts] = useState<EmailFont[]>(() => [current, current === "sans" ? "garamond" : "sans"]);
  const [windows, setWindows] = useState<string[]>(["7–9am", "12–2pm"]);
  const [labels, setLabels] = useState("");
  const [mode, setMode] = useState<Experiment["mode"]>("alternate");
  const [name, setName] = useState("");

  const create = () => {
    const arms =
      kind === "font"
        ? fonts.map((f) => ({ id: uid("arm"), label: EMAIL_FONTS[f].label.split(" (")[0], font: f }))
        : kind === "time"
          ? TIME_WINDOWS.filter((w) => windows.includes(w.label)).map((w) => ({ id: uid("arm"), label: w.label, from: w.from, to: w.to }))
          : labels
              .split(",")
              .map((l) => l.trim())
              .filter(Boolean)
              .map((label) => ({ id: uid("arm"), label }));
    if (arms.length < 2) return toast.err("Pick at least two options to compare.");
    onCreate({
      id: uid("exp"),
      name: name.trim() || `${KIND_LABEL[kind]}: ${arms.map((a) => a.label).join(" vs ")}`,
      kind,
      arms,
      mode: kind === "time" ? "alternate" : mode,
      currentArm: arms[0].id,
      status: "running",
      startedAt: new Date().toISOString(),
    });
  };

  const chip = (on: boolean, label: React.ReactNode, onClick: () => void, style?: React.CSSProperties) => (
    <button
      style={style}
      onClick={onClick}
      className={cn("flex items-center gap-1 rounded-full border px-3 py-1 text-[13px]", on ? "border-navy bg-navy text-white" : "border-line-2 bg-panel hover:border-navy/50")}
    >
      {on && <Check className="size-3" />} {label}
    </button>
  );

  return (
    <div className="space-y-3 border-b border-line bg-[#fbfaf6] px-4 py-3 text-[12.5px]">
      <div className="flex flex-wrap gap-4">
        {(["font", "time", "custom"] as const).map((k) => (
          <label key={k} className={cn("flex items-center gap-1.5", k === "font" && fontBusy && "opacity-50")} title={k === "font" && fontBusy ? "A font experiment is already running" : undefined}>
            <input type="radio" className="accent-navy" disabled={k === "font" && fontBusy} checked={kind === k} onChange={() => setKind(k)} />
            {k === "font" ? "Font" : k === "time" ? "Send time" : "Something else (you label the options)"}
          </label>
        ))}
      </div>
      {kind === "font" && (
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(EMAIL_FONTS) as EmailFont[]).map((f) =>
            chip(fonts.includes(f), EMAIL_FONTS[f].label, () => setFonts(fonts.includes(f) ? fonts.filter((x) => x !== f) : [...fonts, f]), { fontFamily: EMAIL_FONTS[f].css }),
          )}
        </div>
      )}
      {kind === "time" && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {TIME_WINDOWS.map((w) =>
              chip(windows.includes(w.label), w.label, () => setWindows(windows.includes(w.label) ? windows.filter((x) => x !== w.label) : [...windows, w.label])),
            )}
          </div>
          <p className="flex items-start gap-1.5 text-[11.5px] text-muted">
            <Clock className="mt-0.5 size-3 shrink-0" />
            Times are in the recipient&apos;s time zone (NY bankers get Eastern, SF/LA Pacific, Chicago Central). Emails are sorted into windows by when
            they actually went out, so everything you&apos;ve already sent counts too. Use Gmail&apos;s “Schedule send” to hit a window. Results can be split by
            bank type, team and location.
          </p>
        </>
      )}
      {kind === "custom" && (
        <Field label="Options, comma-separated" hint="Each Gmail draft gets tagged with one (or tag sent emails yourself in Results).">
          <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="Short subject, Long subject" />
        </Field>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        {kind !== "time" && (
          <Field label="How drafts get an option">
            <Select className="w-full" value={mode} onChange={(e) => setMode(e.target.value as Experiment["mode"])}>
              <option value="alternate">Alternate on every draft (fairest)</option>
              <option value="wave">In waves: one option until I switch</option>
            </Select>
          </Field>
        )}
        <Field label="Name (optional)">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      {mode === "wave" && kind !== "time" && (
        <p className="text-[11.5px] text-amber">Waves go out at different times, so timing is mixed into the result. Alternating avoids that.</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={create}>
          Start
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ================= results ================= */

export function ExperimentsResults() {
  const { experiments } = useExperiments();
  const contacts = useStore((s) => s.contacts);
  const setSettings = useStore((s) => s.setSettings);
  const byFont = useMemo(() => resultsByFont(contacts, FONT_LABELS), [contacts]);

  const adopt = (e: Experiment, armId: string) => {
    const a = e.arms.find((x) => x.id === armId);
    if (!a?.font) return;
    setSettings((s) => ({
      ...s,
      emailStyle: { ...s.emailStyle, font: a.font! },
      experiments: (s.experiments ?? []).map((x) => (x.id === e.id && x.status === "running" ? { ...x, status: "ended", endedAt: new Date().toISOString() } : x)),
    }));
    toast.ok(`Your emails now use ${a.label}.`);
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <FlaskConical className="size-4 text-brass" /> Experiments
          </span>
        }
        sub="Reply rate = replied ÷ sent. Overlapping ranges mean it's too early to pick a winner."
      />
      {experiments.length === 0 && <p className="px-4 py-3 text-[12.5px] text-muted">No experiments yet. Start one in Setup.</p>}
      <ul className="divide-y divide-line">
        {experiments.map((e) => {
          const arms = armsOf(e, contacts);
          const real = arms.filter((a) => a.id !== "_outside");
          const leader = [...real].sort((a, b) => b.rate - a.rate)[0];
          return (
            <li key={e.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{e.name}</span>
                <Badge>{KIND_LABEL[e.kind]}</Badge>
                <Badge tone={e.status === "running" ? "green" : "neutral"}>{e.status}</Badge>
              </div>
              <ArmTable arms={arms} fontOf={(id) => e.arms.find((a) => a.id === id)?.font} />
              <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-ink-2">
                {real.length >= 2 && <span>{verdict(real[0], real[1])}</span>}
                {e.kind === "font" && leader?.sent > 0 && (
                  <Button size="sm" onClick={() => adopt(e, leader.id)}>
                    Use {leader.label} from now on
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted">Replies by font (all tagged emails)</div>
      {byFont.length ? <ArmTable arms={byFont} /> : <p className="px-4 py-3 text-[12.5px] text-muted">No fonts tagged yet. Tag already-sent emails below, or they&apos;re recorded from your next Gmail draft.</p>}
    </Card>
  );
}

export function ArmTable({ arms, fontOf }: { arms: Arm[]; fontOf?: (id: string) => EmailFont | undefined }) {
  return (
    <div className="overflow-x-auto">
      <table className="my-2 w-full min-w-[480px] text-[12.5px]">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-1 font-medium">Option</th>
            <th className="px-2 py-1 text-right font-medium">Emails</th>
            <th className="px-2 py-1 text-right font-medium">Sent</th>
            <th className="px-2 py-1 text-right font-medium">Replied</th>
            <th className="px-2 py-1 text-right font-medium">Reply rate</th>
            <th className="px-4 py-1 font-medium">Likely range</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {arms.map((a) => {
            const font = fontOf?.(a.id) ?? (a.id in EMAIL_FONTS ? (a.id as EmailFont) : undefined);
            return (
              <tr key={a.id} className={cn(a.id === "_outside" && "text-muted")}>
                <td className="px-4 py-1.5 font-medium" style={font ? { fontFamily: EMAIL_FONTS[font].css } : undefined}>
                  {a.label}
                </td>
                <td className="num px-2 text-right">{a.drafted}</td>
                <td className="num px-2 text-right">{a.sent}</td>
                <td className="num px-2 text-right text-green">{a.replied}</td>
                <td className="num px-2 text-right font-medium">{a.sent ? `${Math.round(a.rate * 100)}%` : "—"}</td>
                <td className="px-4">
                  <div className="relative h-2 w-40 rounded-full bg-[#ecebe4]" title={`95% range ${Math.round(a.lo * 100)}–${Math.round(a.hi * 100)}%`}>
                    {a.sent > 0 && (
                      <>
                        <div className="absolute h-2 rounded-full bg-green/25" style={{ left: `${a.lo * 100}%`, width: `${Math.max((a.hi - a.lo) * 100, 1)}%` }} />
                        <div className="absolute top-[-2px] h-3 w-0.5 bg-green" style={{ left: `${a.rate * 100}%` }} />
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Check, FlaskConical, Play, Plus, Square, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { experimentArms, resultsByFont, verdict, type Arm } from "@/lib/experiments";
import { EMAIL_FONTS, type EmailFont, type Experiment } from "@/lib/types";
import { cn, fmtDate, uid } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Field, Input, Select, toast } from "./ui";

const FONT_LABELS = Object.fromEntries(Object.entries(EMAIL_FONTS).map(([k, v]) => [k, v.label]));

/**
 * Self-run experiments: "does Garamond or Arial get more replies?". A running font experiment picks the font of
 * each new Gmail draft; custom ones just tag drafts. Results = reply rate per arm, from Gmail sync.
 */
export function SelfExperiments() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const contacts = useStore((s) => s.contacts);
  const experiments = settings.experiments ?? [];
  const [creating, setCreating] = useState(false);
  const setExps = (fn: (e: Experiment[]) => Experiment[]) => setSettings((s) => ({ ...s, experiments: fn(s.experiments ?? []) }));
  const byFont = useMemo(() => resultsByFont(contacts, FONT_LABELS), [contacts]);
  const running = experiments.filter((e) => e.status === "running");

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <FlaskConical className="size-4 text-brass" /> Experiments
          </span>
        }
        sub="Test one thing at a time (like the font) and see which gets more replies. Every Gmail draft records what it used; Gmail sync picks up the replies."
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
            toast.ok(`“${e.name}” is running. New Gmail drafts ${e.mode === "wave" ? `use ${e.arms.find((a) => a.id === e.currentArm)?.label}` : "alternate between the options"}.`);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {experiments.length === 0 && !creating && (
        <div className="px-4 py-4 text-[12.5px] text-ink-2">
          No experiments yet.{" "}
          <button className="font-medium text-navy hover:underline" onClick={() => setCreating(true)}>
            Start a font test
          </button>{" "}
          (e.g. Garamond vs Gmail&apos;s default).
        </div>
      )}
      <ul className="divide-y divide-line">
        {experiments.map((e) => (
          <ExperimentRow key={e.id} e={e} onChange={(n) => setExps((list) => list.map((x) => (x.id === e.id ? n : x)))} onDelete={() => setExps((list) => list.filter((x) => x.id !== e.id))} />
        ))}
      </ul>
      <div className="border-t border-line px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted">Replies by font (every tracked Gmail draft)</div>
      {byFont.length ? (
        <ArmTable arms={byFont} />
      ) : (
        <p className="px-4 py-3 text-[12.5px] text-muted">Nothing tracked yet. Fonts are recorded from the next Gmail draft you create.</p>
      )}
    </Card>
  );
}

function NewExperiment({ fontBusy, onCreate, onCancel }: { fontBusy: boolean; onCreate: (e: Experiment) => void; onCancel: () => void }) {
  const current = useStore((s) => s.settings.emailStyle.font);
  const [kind, setKind] = useState<Experiment["kind"]>(fontBusy ? "custom" : "font");
  const [fonts, setFonts] = useState<EmailFont[]>(() => [current, current === "sans" ? "garamond" : "sans"]);
  const [labels, setLabels] = useState("Morning, Afternoon");
  const [mode, setMode] = useState<Experiment["mode"]>("alternate");
  const [name, setName] = useState("");

  const create = () => {
    const arms =
      kind === "font"
        ? fonts.map((f) => ({ id: uid("arm"), label: EMAIL_FONTS[f].label, font: f }))
        : labels
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((label) => ({ id: uid("arm"), label }));
    if (arms.length < 2) return toast.err("Pick at least two options to compare.");
    onCreate({
      id: uid("exp"),
      name: name.trim() || (kind === "font" ? `Font: ${arms.map((a) => a.label.split(" (")[0]).join(" vs ")}` : arms.map((a) => a.label).join(" vs ")),
      kind,
      arms,
      mode,
      currentArm: arms[0].id,
      status: "running",
      startedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="space-y-3 border-b border-line bg-[#fbfaf6] px-4 py-3 text-[12.5px]">
      <div className="flex flex-wrap gap-4">
        <label className={cn("flex items-center gap-1.5", fontBusy && "opacity-50")} title={fontBusy ? "A font experiment is already running" : undefined}>
          <input type="radio" className="accent-navy" disabled={fontBusy} checked={kind === "font"} onChange={() => setKind("font")} /> Font
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" className="accent-navy" checked={kind === "custom"} onChange={() => setKind("custom")} /> Something else (you label the options)
        </label>
      </div>
      {kind === "font" ? (
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(EMAIL_FONTS) as EmailFont[]).map((f) => {
            const on = fonts.includes(f);
            return (
              <button
                key={f}
                style={{ fontFamily: EMAIL_FONTS[f].css }}
                onClick={() => setFonts(on ? fonts.filter((x) => x !== f) : [...fonts, f])}
                className={cn("flex items-center gap-1 rounded-full border px-3 py-1 text-[13px]", on ? "border-navy bg-navy text-white" : "border-line-2 bg-panel hover:border-navy/50")}
              >
                {on && <Check className="size-3" />} {EMAIL_FONTS[f].label}
              </button>
            );
          })}
        </div>
      ) : (
        <Field label="Options, comma-separated" hint="Each Gmail draft gets tagged with one; you do the thing (e.g. send in the morning) yourself.">
          <Input value={labels} onChange={(e) => setLabels(e.target.value)} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How drafts get an option">
          <Select className="w-full" value={mode} onChange={(e) => setMode(e.target.value as Experiment["mode"])}>
            <option value="alternate">Alternate on every draft (fairest)</option>
            <option value="wave">In waves: one option until I switch</option>
          </Select>
        </Field>
        <Field label="Name (optional)">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "font" ? "Font test, fall wave" : ""} />
        </Field>
      </div>
      {mode === "wave" && (
        <p className="text-[11.5px] text-amber">
          Waves go out at different times, so timing (recruiting season, day of week) is mixed into the result. Alternating avoids that.
        </p>
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

function ExperimentRow({ e, onChange, onDelete }: { e: Experiment; onChange: (e: Experiment) => void; onDelete: () => void }) {
  const contacts = useStore((s) => s.contacts);
  const setSettings = useStore((s) => s.setSettings);
  const arms = useMemo(() => experimentArms(e, contacts), [e, contacts]);
  const leader = [...arms].sort((a, b) => b.rate - a.rate)[0];
  const running = e.status === "running";

  const end = () => onChange({ ...e, status: "ended", endedAt: new Date().toISOString() });
  const adopt = (armId: string) => {
    const a = e.arms.find((x) => x.id === armId);
    if (!a?.font) return;
    setSettings((s) => ({ ...s, emailStyle: { ...s.emailStyle, font: a.font! } }));
    if (running) end();
    toast.ok(`Your emails now use ${a.label}.`);
  };

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{e.name}</span>
        <Badge tone={running ? "green" : "neutral"}>{running ? "running" : `ended ${fmtDate(e.endedAt)}`}</Badge>
        <span className="text-[12px] text-muted">
          {e.mode === "wave" ? "in waves" : "alternating"} · since {fmtDate(e.startedAt)}
        </span>
        <div className="flex-1" />
        {running && e.mode === "wave" && (
          <label className="flex items-center gap-1.5 text-[12.5px]">
            This wave:
            <Select className="h-7 text-[12px]" value={e.currentArm} onChange={(ev) => onChange({ ...e, currentArm: ev.target.value })} aria-label="Current wave">
              {e.arms.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </label>
        )}
        {running ? (
          <Button size="sm" variant="ghost" icon={<Square className="size-3" />} onClick={end}>
            End
          </Button>
        ) : (
          <button className="rounded p-1 text-muted hover:text-red" aria-label={`Delete ${e.name}`} onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      <ArmTable arms={arms} fontOf={(id) => e.arms.find((a) => a.id === id)?.font} />
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-ink-2">
        {arms.length >= 2 && <span>{verdict(arms[0], arms[1])}</span>}
        {e.kind === "font" && leader?.sent > 0 && (
          <Button size="sm" variant="secondary" onClick={() => adopt(leader.id)}>
            Use {leader.label.split(" (")[0]} from now on
          </Button>
        )}
      </div>
    </li>
  );
}

function ArmTable({ arms, fontOf }: { arms: Arm[]; fontOf?: (id: string) => EmailFont | undefined }) {
  return (
    <table className="my-2 w-full text-[12.5px]">
      <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
        <tr>
          <th className="px-4 py-1 font-medium">Option</th>
          <th className="px-2 py-1 text-right font-medium">Drafts</th>
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
            <tr key={a.id}>
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
  );
}


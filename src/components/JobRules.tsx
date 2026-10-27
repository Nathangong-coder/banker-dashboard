"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { NOT_FINANCE, roleTypeId, rulesOf, type ReviewRules, type Verdict } from "@/lib/jobReview";
import { Button, Checkbox, Field, Input, Modal, Segmented } from "@/components/ui";

const VERDICTS: readonly (readonly [Verdict, string])[] = [
  ["apply", "Apply"],
  ["maybe", "Maybe"],
  ["skip", "Skip"],
];

/**
 * Applications → Find jobs → "What jobs I want": the AI review's settings (role types with Apply / Maybe / Skip in
 * priority order, class years, rules learned from Keep / Remove, the 9 PM reminder). Verdict changes re-sort stored
 * reviews instantly; wording changes bump the version so older reviews can be re-checked.
 */
export function JobRules({ stale, onRecheck }: { stale: number; onRecheck: () => void }) {
  const saved = useStore((s) => s.apply.finder.rules);
  const gradDate = useStore((s) => s.apply.profile.gradDate);
  const setApply = useStore((s) => s.setApply);
  const rules = rulesOf(saved, gradDate);
  const [label, setLabel] = useState("");
  const [covers, setCovers] = useState("");
  const [years, setYears] = useState(rules.classYears.join(", "));

  /** `reword` = what the AI is told changed (bumps the version). */
  const save = (next: Partial<ReviewRules>, reword = false) =>
    setApply((a) => {
      const cur = rulesOf(a.finder.rules, a.profile.gradDate);
      return {
        ...a,
        finder: {
          ...a.finder,
          rules: { ...cur, ...next, version: cur.version + (reword ? 1 : 0) },
        },
      };
    });
  const types = rules.roleTypes;
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= types.length) return;
    const next = [...types];
    [next[i], next[j]] = [next[j], next[i]];
    save({ roleTypes: next });
  };

  return (
    <div className="space-y-3 px-4 pb-4 text-[13px]">
      <p className="text-[12.5px] text-muted">
        The AI sorts each posting into one of these. <b className="font-medium text-ink-2">Apply</b> jobs go straight onto your tracker under “Added by AI”, <b className="font-medium text-ink-2">Maybe</b> jobs wait here
        for you, <b className="font-medium text-ink-2">Skip</b> jobs are hidden (kept under “Skipped”). Higher = higher priority.
      </p>
      <ul className="divide-y divide-line rounded-md border border-line">
        {types.map((t, i) => (
          <li key={t.id} className="grid grid-cols-[minmax(0,1fr)] items-center gap-2 px-3 py-2 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto_auto]">
            <span className="font-medium text-ink">{t.label}</span>
            <Input
              className="h-8 text-[12.5px]"
              defaultValue={t.covers}
              aria-label={`What ${t.label} covers`}
              onBlur={(e) =>
                e.target.value.trim() !== t.covers &&
                save(
                  {
                    roleTypes: types.map((x) => (x.id === t.id ? { ...x, covers: e.target.value.trim().slice(0, 300) } : x)),
                  },
                  true,
                )
              }
            />
            <Segmented
              value={t.verdict}
              onChange={(v: Verdict) =>
                save({
                  roleTypes: types.map((x) => (x.id === t.id ? { ...x, verdict: v } : x)),
                })
              }
              options={VERDICTS}
            />
            <div className="flex items-center gap-0.5">
              <button className="rounded p-1 text-muted hover:bg-hover hover:text-ink disabled:opacity-30" disabled={i === 0} aria-label={`Move ${t.label} up`} onClick={() => move(i, -1)}>
                <ArrowUp className="size-3.5" />
              </button>
              <button className="rounded p-1 text-muted hover:bg-hover hover:text-ink disabled:opacity-30" disabled={i === types.length - 1} aria-label={`Move ${t.label} down`} onClick={() => move(i, 1)}>
                <ArrowDown className="size-3.5" />
              </button>
              <button
                className="rounded p-1 text-muted hover:bg-hover hover:text-red disabled:opacity-30"
                disabled={t.id === NOT_FINANCE}
                title={t.id === NOT_FINANCE ? "The catch-all can't be deleted" : undefined}
                aria-label={`Delete ${t.label}`}
                onClick={() => save({ roleTypes: types.filter((x) => x.id !== t.id) }, true)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return;
          const t = {
            id: roleTypeId(
              label,
              types.map((x) => x.id),
            ),
            label: label.trim().slice(0, 80),
            covers: covers.trim().slice(0, 300),
            verdict: "apply" as Verdict,
          };
          // New types go above the catch-all.
          const at = types.findIndex((x) => x.id === NOT_FINANCE);
          save(
            {
              roleTypes: at < 0 ? [...types, t] : [...types.slice(0, at), t, ...types.slice(at)],
            },
            true,
          );
          setLabel("");
          setCovers("");
        }}
      >
        <Field label="Add a role type">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Real estate investing" />
        </Field>
        <Field label="Covers">
          <Input value={covers} onChange={(e) => setCovers(e.target.value)} placeholder="REPE, real estate acquisitions" />
        </Field>
        <Button type="submit" size="sm" variant="secondary" icon={<Plus className="size-3.5" />} disabled={!label.trim()}>
          Add
        </Button>
      </form>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
        <Field label="Class years you can apply as" hint="Postings clearly for other years are skipped; unclear ones keep their verdict.">
          <Input
            value={years}
            onChange={(e) => setYears(e.target.value)}
            onBlur={() => {
              const ys = [...new Set((years.match(/20\d{2}/g) ?? []).map(Number))].slice(0, 6);
              setYears(ys.join(", "));
              save({ classYears: ys }, true);
            }}
            placeholder="2028, 2029"
          />
        </Field>
        <Field label="Reminder">
          <div className="flex h-9 flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
            <label className="flex items-center gap-1.5">
              <Checkbox checked={rules.reminder.on} onChange={(on) => save({ reminder: { ...rules.reminder, on } })} label="Text me to search" /> In the 9 PM text, remind me to search if I haven&apos;t in
            </label>
            <Input
              type="number"
              min={1}
              max={14}
              className="h-8 w-16"
              value={rules.reminder.everyDays}
              aria-label="Days"
              onChange={(e) =>
                save({
                  reminder: {
                    ...rules.reminder,
                    everyDays: Math.min(14, Math.max(1, Number(e.target.value) || 1)),
                  },
                })
              }
            />
            day{rules.reminder.everyDays === 1 ? "" : "s"}
          </div>
        </Field>
      </div>

      {rules.rules.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Learned from your Keep / Remove answers</p>
          <ul className="space-y-1">
            {rules.rules.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px] text-ink-2">
                <span className="flex-1">• {r}</span>
                <button className="rounded p-0.5 text-muted hover:text-red" aria-label="Delete this rule" onClick={() => save({ rules: rules.rules.filter((_, k) => k !== i) }, true)}>
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {stale > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
          {stale} job{stale === 1 ? " was" : "s were"} reviewed before your latest changes.
          <Button size="sm" variant="brass" onClick={onRecheck}>
            Re-check {stale} with your new rules
          </Button>
          <span className="text-muted">(uses the stored text; nothing is re-read)</span>
        </p>
      )}
    </div>
  );
}

/**
 * "Why?" in one line, after Remove (an AI-added job) or an overrule ("this should be Apply"). The answer becomes a
 * review rule; leaving it empty just does the action.
 */
export function WhyModal({
  ask,
  onClose,
}: {
  ask: {
    title: string;
    placeholder: string;
    act: (why: string) => void;
  } | null;
  onClose: () => void;
}) {
  const [why, setWhy] = useState("");
  const done = (text: string) => {
    ask?.act(text.trim());
    setWhy("");
    onClose();
  };
  return (
    <Modal open={!!ask} onClose={onClose} title={ask?.title ?? ""}>
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          done(why);
        }}
      >
        <Field label="Why? (one line; it becomes a rule the AI follows)">
          <Input autoFocus value={why} onChange={(e) => setWhy(e.target.value)} placeholder={ask?.placeholder} maxLength={300} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => done("")}>
            Skip
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

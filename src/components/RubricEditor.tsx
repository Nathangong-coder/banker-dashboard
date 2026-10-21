"use client";

/**
 * Admin: the coffee-chat grading rubric (settings.prep.rubric). Areas, their weight in the overall score, and what a
 * 5 / 3 / 1 looks like. Edited as a draft and saved at once, so a half-typed area never reaches a grade.
 */
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { DEFAULT_RUBRIC, RUBRIC_LIMITS, cleanRubric, overallScore, type RubricArea } from "@/lib/gradeRubric";
import { Button, Input, Textarea, toast } from "./ui";

export function RubricEditor({ onDone }: { onDone?: () => void }) {
  const saved = useStore((s) => s.settings.prep?.rubric);
  const setSettings = useStore((s) => s.setSettings);
  const [draft, setDraft] = useState<RubricArea[]>(() => saved ?? DEFAULT_RUBRIC);
  const total = draft.reduce((n, a) => n + (a.weight || 0), 0);
  const set = (i: number, patch: Partial<RubricArea>) => setDraft((d) => d.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const next = [...d];
      const [a] = next.splice(i, 1);
      next.splice(i + by, 0, a);
      return next;
    });
  const named = draft.filter((a) => a.area.trim());
  const error =
    named.length < RUBRIC_LIMITS.minAreas ? `Keep at least ${RUBRIC_LIMITS.minAreas} areas.` : !named.some((a) => a.weight > 0) ? "Give at least one area some weight." : "";

  const save = (next: RubricArea[] | undefined) => {
    setSettings((s) => ({ ...s, prep: { ...s.prep, rubric: next } }));
    toast.ok(next ? "Rubric saved. New grades use it; regrade a call to apply it." : "Back to the default rubric.");
    onDone?.();
  };
  const isDefault = JSON.stringify(cleanRubric(draft)) === JSON.stringify(DEFAULT_RUBRIC);

  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-[12.5px] text-muted">
        Each area is scored 1–5. The overall grade is the weighted average (all 3s = {overallScore([{ area: "", weight: 1, anchors: "" }], [3])}, all 4s ={" "}
        {overallScore([{ area: "", weight: 1, anchors: "" }], [4])}). Weights are relative, so they don&apos;t have to add up to 100. Your grading rules still come first.
      </p>
      <ol className="space-y-2.5">
        {draft.map((a, i) => (
          <li key={i} className="rounded-lg border border-line p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num w-5 text-[12px] text-muted">{i + 1}.</span>
              <Input className="h-8 min-w-0 flex-1 basis-[180px]" value={a.area} maxLength={RUBRIC_LIMITS.area} onChange={(e) => set(i, { area: e.target.value })} placeholder="Area name" aria-label={`Area ${i + 1} name`} />
              <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
                Weight
                <Input
                  type="number"
                  min={0}
                  max={RUBRIC_LIMITS.maxWeight}
                  className="h-8 w-[72px]"
                  value={a.weight}
                  onChange={(e) => set(i, { weight: Math.max(0, Math.min(RUBRIC_LIMITS.maxWeight, Number(e.target.value) || 0)) })}
                />
                <span className="num w-10 text-muted">{total ? Math.round((a.weight / total) * 100) : 0}%</span>
              </label>
              <div className="flex">
                <button className="rounded p-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} aria-label="Move up" onClick={() => move(i, -1)}>
                  <ArrowUp className="size-3.5" />
                </button>
                <button className="rounded p-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === draft.length - 1} aria-label="Move down" onClick={() => move(i, 1)}>
                  <ArrowDown className="size-3.5" />
                </button>
                <button className="rounded p-1 text-muted hover:text-red" aria-label="Remove this area" onClick={() => setDraft((d) => d.filter((_, k) => k !== i))}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
            <Textarea
              className="mt-2 text-[12.5px]"
              rows={2}
              maxLength={RUBRIC_LIMITS.anchors}
              value={a.anchors}
              onChange={(e) => set(i, { anchors: e.target.value })}
              placeholder="What a 5, a 3 and a 1 look like (e.g. 5 = they laughed and told stories. 3 = polite. 1 = flat.)"
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus className="size-3.5" />}
          disabled={draft.length >= RUBRIC_LIMITS.maxAreas}
          onClick={() => setDraft((d) => [...d, { area: "", weight: 10, anchors: "" }])}
        >
          Add area
        </Button>
        {!isDefault && (
          <button className="text-[12px] text-navy hover:underline" onClick={() => setDraft(DEFAULT_RUBRIC)}>
            Reset to default
          </button>
        )}
        <div className="flex-1" />
        {error && <span className="text-[12px] text-red">{error}</span>}
        <Button variant="primary" size="sm" disabled={!!error} onClick={() => save(isDefault ? undefined : cleanRubric(draft))}>
          Save rubric
        </Button>
      </div>
    </div>
  );
}

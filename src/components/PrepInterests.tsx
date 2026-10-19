"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { DEFAULT_INTERESTS } from "@/lib/defaults";
import type { PrepInterest } from "@/lib/types";
import { Button, Input } from "@/components/ui";

/** The interests in settings, falling back to the defaults (applied outside the selector: zustand v5). */
export function useInterests(): PrepInterest[] {
  const stored = useStore((s) => s.settings.prep?.interests);
  return stored ?? DEFAULT_INTERESTS;
}

/** "Tech (Software, Internet)" one-liner. */
export function interestsLabel(list: PrepInterest[]) {
  const named = list.filter((i) => i.sector.trim());
  return named.length ? named.map((i) => (i.subVerticals.length ? `${i.sector} (${i.subVerticals.join(", ")})` : i.sector)).join(" · ") : "none yet";
}

/**
 * Sector interests and their sub-verticals (Settings → Profile, and inline on /prep). They steer the bank brief's deal search
 * and the "Why <Bank>" answer. Sub-verticals are a comma list; fields save when you click away.
 */
export function InterestsEditor() {
  const interests = useInterests();
  const setSettings = useStore((s) => s.setSettings);
  const save = (next: PrepInterest[]) => setSettings((s) => ({ ...s, prep: { ...s.prep, interests: next } }));
  // Inputs are uncontrolled (save on blur); remount them when rows are added, removed or reset.
  const [gen, setGen] = useState(0);
  const replace = (next: PrepInterest[]) => {
    save(next);
    setGen((g) => g + 1);
  };
  const patch = (i: number, p: Partial<PrepInterest>) => save(interests.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <div className="space-y-2">
      {interests.map((it, i) => (
        <div key={`${gen}:${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
          <Input
            aria-label="Sector"
            placeholder="Sector, e.g. Tech"
            defaultValue={it.sector}
            onBlur={(e) => e.target.value.trim() !== it.sector && patch(i, { sector: e.target.value.trim() })}
          />
          <Input
            aria-label="Sub-verticals"
            className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto"
            placeholder="Sub-verticals, comma separated: Software, Internet"
            defaultValue={it.subVerticals.join(", ")}
            onBlur={(e) => {
              const subs = e.target.value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
              if (subs.join("|") !== it.subVerticals.join("|")) patch(i, { subVerticals: subs });
            }}
          />
          <button
            className="col-start-2 row-start-1 self-center text-muted hover:text-red sm:col-start-auto sm:row-start-auto"
            aria-label={`Remove ${it.sector || "this sector"}`}
            onClick={() => replace(interests.filter((_, j) => j !== i))}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => replace([...interests, { sector: "", subVerticals: [] }])} disabled={interests.length >= 8}>
          Add a sector
        </Button>
        <button className="text-[12px] text-muted hover:underline" onClick={() => replace(DEFAULT_INTERESTS)}>
          Reset to Tech · Software, Internet, Vertical software
        </button>
      </div>
    </div>
  );
}

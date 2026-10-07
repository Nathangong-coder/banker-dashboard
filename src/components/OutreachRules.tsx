"use client";

import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { DEFAULT_OUTREACH_RULES, rulesOf, type OutreachRules } from "@/lib/outreach";
import { Button, Card, CardHeader, Checkbox, Field, Input, Textarea } from "./ui";

const EXCEPTIONS: { key: OutreachRules["seniorExceptions"][number]; label: (r: OutreachRules) => string }[] = [
  { key: "school", label: () => "Your school" },
  { key: "grad", label: (r) => r.grad.name || "Grad school" },
  { key: "hometown", label: (r) => `Hometown (${r.hometown.demonym || "—"})` },
  { key: "heritage", label: (r) => `Heritage (${r.heritage.word || "—"})` },
  { key: "city", label: (r) => `${r.city.label || "City"} schools` },
  { key: "system", label: (r) => `${r.system.label || "System"} schools` },
  { key: "state", label: (r) => `${r.state.label || "State"} schools` },
];

/**
 * Who you have in common with people: these pick each first email's subject and hook (lib/outreach.ts#affinityOf) and
 * which MD / Head / Partners are still OK to email. The defaults are the owner's (UCLA, LA, the UCs, California, Seattle).
 */
export function OutreachRulesEditor() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const r = rulesOf(settings);
  const set = (fn: (r: OutreachRules) => OutreachRules) => setSettings((s) => ({ ...s, outreach: fn(rulesOf(s)) }));
  const list = (value: string, onChange: (v: string) => void, placeholder?: string) => (
    <Textarea rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="text-[12.5px]" />
  );

  return (
    <Card>
      <CardHeader
        title="Outreach rules"
        sub="What you might have in common with someone. It picks each first email's subject and hook, and which senior bankers are still OK to email. Lists are comma-separated; “a+b” means both must appear."
        right={
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => set(() => DEFAULT_OUTREACH_RULES)}>
            Reset to defaults
          </Button>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 md:grid-cols-2">
        <Field label="Your school, as people write it" hint={`Subject: “Fellow ${settings.profile.schoolNickname || "…"} Seeking to Connect” (nickname is in Your profile)`}>
          {list(r.school.match, (v) => set((x) => ({ ...x, school: { match: v } })), "UCLA, Bruin, University of California Los Angeles")}
        </Field>
        <Field label="Grad / business school" hint="“…a fellow Bruin from Anderson”. Leave empty if none.">
          <div className="space-y-1.5">
            <Input value={r.grad.name} placeholder="Anderson" onChange={(e) => set((x) => ({ ...x, grad: { ...x.grad, name: e.target.value } }))} />
            {list(r.grad.match, (v) => set((x) => ({ ...x, grad: { ...x.grad, match: v } })), "UCLA Anderson, Anderson School")}
          </div>
        </Field>
        {(
          [
            ["city", "Schools in your city", "“Fellow LA Student”, “went to school in LA”", "LA"],
            ["system", "Your school system", "“Fellow UC Student”, “went to a UC”", "UC"],
            ["state", "Schools in your state", "“Fellow California Student”", "California"],
          ] as const
        ).map(([k, title, hint, ph]) => (
          <Field key={k} label={title} hint={hint}>
            <div className="space-y-1.5">
              <Input value={r[k].label} placeholder={ph} onChange={(e) => set((x) => ({ ...x, [k]: { ...x[k], label: e.target.value } }))} aria-label={`${title} label`} />
              {list(r[k].match, (v) => set((x) => ({ ...x, [k]: { ...x[k], match: v } })))}
            </div>
          </Field>
        ))}
        <Field label="Hometown" hint={`“Fellow Washingtonian”; the hook says “Being from ${settings.profile.hometown || "your hometown"} myself…” (hometown is in Your profile)`}>
          <div className="space-y-1.5">
            <Input value={r.hometown.demonym} placeholder="Washingtonian" onChange={(e) => set((x) => ({ ...x, hometown: { ...x.hometown, demonym: e.target.value } }))} aria-label="Hometown demonym" />
            {list(r.hometown.match, (v) => set((x) => ({ ...x, hometown: { ...x.hometown, match: v } })), "Schools and towns there: University of Washington, Seattle, Bellevue")}
          </div>
        </Field>
        <Field label="Shared heritage" hint="Only ever read from your own notes (the Comment column), never guessed from a name. Leave empty to turn off.">
          <Input value={r.heritage.word} placeholder="e.g. Chinese" onChange={(e) => set((x) => ({ ...x, heritage: { word: e.target.value } }))} />
        </Field>
        <div className="md:col-span-2">
          <div className="mb-1 text-[12px] font-medium text-ink-2">Volunteer experiences</div>
          <p className="mb-2 text-[11.5px] text-muted">
            When their profile mentions the same thing: “One of my most meaningful high school experiences was <i>yours</i>. I’d love to learn more about your <i>theirs</i>…”
          </p>
          <div className="space-y-2">
            {r.volunteer.map((v, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)] gap-1.5 md:grid-cols-[1fr_1.4fr_1fr_auto]">
                <Input value={v.match} placeholder="Their profile mentions… (soup kitchen)" onChange={(e) => set((x) => ({ ...x, volunteer: x.volunteer.map((y, j) => (j === i ? { ...y, match: e.target.value } : y)) }))} aria-label="Match" />
                <Input value={v.mine} placeholder="Yours (working at a soup kitchen)" onChange={(e) => set((x) => ({ ...x, volunteer: x.volunteer.map((y, j) => (j === i ? { ...y, mine: e.target.value } : y)) }))} aria-label="Your experience" />
                <Input value={v.theirs} placeholder="Theirs (volunteer experience)" onChange={(e) => set((x) => ({ ...x, volunteer: x.volunteer.map((y, j) => (j === i ? { ...y, theirs: e.target.value } : y)) }))} aria-label="Their experience" />
                <button className="rounded p-1.5 text-muted hover:bg-[#efede5] hover:text-red" aria-label="Remove" onClick={() => set((x) => ({ ...x, volunteer: x.volunteer.filter((_, j) => j !== i) }))}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => set((x) => ({ ...x, volunteer: [...x.volunteer, { match: "", mine: "", theirs: "" }] }))}>
              Add one
            </Button>
          </div>
        </div>
        <div className="md:col-span-2">
          <div className="mb-1 text-[12px] font-medium text-ink-2">Senior exceptions</div>
          <p className="mb-2 text-[11.5px] text-muted">The rule is VPs and below. An MD / Head / Partner is still OK when they share one of these with you:</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
            {EXCEPTIONS.map((e) => (
              <label key={e.key} className="flex items-center gap-1.5">
                <Checkbox
                  checked={r.seniorExceptions.includes(e.key)}
                  onChange={(on) => set((x) => ({ ...x, seniorExceptions: on ? [...new Set([...x.seniorExceptions, e.key])] : x.seniorExceptions.filter((k) => k !== e.key) }))}
                />
                {e.label(r)}
              </label>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

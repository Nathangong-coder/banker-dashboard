"use client";

/**
 * Your rules for the AI chat grader (settings.prep.gradingRules): what you believe makes a good coffee chat, sent with
 * every grade and ranked above the built-in rubric. "Disagree" on any part of a grade turns your correction into a rule,
 * so the grader learns your view instead of repeating generic advice.
 */
import { useState } from "react";
import { Plus, ThumbsDown, Trash2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { DEFAULT_GRADING_RULES } from "@/lib/defaults";
import { gradingRules } from "@/lib/conversationActions";
import { Button, Input, Textarea, toast } from "./ui";

function useRules() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const rules = gradingRules(settings);
  const save = (next: string[] | undefined) => setSettings((s) => ({ ...s, prep: { ...s.prep, gradingRules: next } }));
  return { rules, save };
}

/** The list of rules: add, remove, reset. */
export function GradingRulesEditor() {
  const { rules, save } = useRules();
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    save([...rules, t]);
    setDraft("");
  };
  const edited = JSON.stringify(rules) !== JSON.stringify(DEFAULT_GRADING_RULES);
  return (
    <div className="space-y-2 text-[13px]">
      <p className="text-[12.5px] text-muted">
        What you think makes a good chat. Every grade follows these first, ahead of the built-in rubric. Regrade a call to apply new ones.
      </p>
      <ul className="space-y-1.5">
        {rules.map((r, i) => (
          <li key={i} className="group flex items-start gap-2 rounded-md bg-subtle px-2.5 py-1.5">
            <span className="min-w-0 flex-1 text-ink-2">{r}</span>
            <button className="rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:text-red focus:opacity-100" aria-label="Remove this rule" onClick={() => save(rules.filter((_, k) => k !== i))}>
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
        {!rules.length && <li className="text-muted">No rules: the grader uses its rubric only.</li>}
      </ul>
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="e.g. Asking about their weekend is fine, don't flag it" />
        <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      {edited && (
        <button className="text-[12px] text-navy hover:underline" onClick={() => save(undefined)}>
          Reset to the starting rules
        </button>
      )}
    </div>
  );
}

/**
 * "Disagree" next to a piece of a grade: say what's true instead, and it becomes a grading rule. `about` is the
 * grader's text, kept in the rule so the grader knows exactly what not to say again.
 */
export function Disagree({ about }: { about: string }) {
  const { rules, save } = useRules();
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const submit = () => {
    const t = why.trim();
    if (!t) return;
    save([...rules, `The grader once said "${about.slice(0, 160)}". The student disagrees: ${t}`]);
    setOpen(false);
    setWhy("");
    toast.ok("Saved as a grading rule. Regrade to apply it.");
  };
  if (!open)
    return (
      <button className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-navy" onClick={() => setOpen(true)} title="Teach the grader your view">
        <ThumbsDown className="size-3" /> Disagree
      </button>
    );
  return (
    <div className="mt-1 space-y-1.5 rounded-md border border-line bg-panel p-2">
      <Textarea autoFocus rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="What's true instead? e.g. the best chats are long and personal, never cap that" />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={submit} disabled={!why.trim()}>
          Save as a rule
        </Button>
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

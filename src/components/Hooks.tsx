"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { hooksOf } from "@/lib/hooks";
import type { EmailHook } from "@/lib/types";
import { uid } from "@/lib/util";
import { Badge, Button, Field, Input, Modal, Textarea } from "./ui";

/** Add / edit / remove hooks (the {{my_pitch}} sentence). Used on Email drafts and in Settings. */
export function HooksEditor() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const contacts = useStore((s) => s.contacts);
  const hooks = hooksOf(settings);
  const setHooks = (fn: (h: EmailHook[]) => EmailHook[]) => setSettings((s) => ({ ...s, hooks: fn(hooksOf(s)) }));
  const change = (id: string, patch: Partial<EmailHook>) => setHooks((list) => list.map((h) => (h.id === id ? { ...h, ...patch } : h)));

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-ink-2">
        The sentence right after “…I am very interested in pursuing investment banking.” Each person gets the hook whose team words match their team
        (the fallback otherwise), and you can switch it per person in the Hook column.
      </p>
      <ul className="space-y-3">
        {hooks.map((h) => {
          const pinned = contacts.filter((c) => c.hookId === h.id).length;
          return (
            <li key={h.id} className="rounded-lg border border-line p-3">
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-end">
                <Field label="Name">
                  <Input value={h.name} onChange={(e) => change(h.id, { name: e.target.value })} />
                </Field>
                <Field label={h.fallback ? "Used for everyone else" : "Picked automatically for teams containing"}>
                  {h.fallback ? (
                    <div className="flex h-9 items-center text-[12.5px] text-muted">Anyone whose team matches no other hook</div>
                  ) : (
                    <Input
                      value={h.teams.join(", ")}
                      placeholder="tech, tmt"
                      onChange={(e) => change(h.id, { teams: e.target.value.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean) })}
                    />
                  )}
                </Field>
                {!h.fallback && (
                  <button
                    className="mb-2 rounded p-1 text-muted hover:text-red"
                    aria-label={`Delete ${h.name}`}
                    onClick={() => setHooks((list) => list.filter((x) => x.id !== h.id))}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="mt-2">
                <Textarea
                  rows={2}
                  value={h.text}
                  placeholder={h.fallback ? "Leave empty for no hook sentence" : "One or two sentences, e.g. “Through my … I've developed a strong interest in …”"}
                  onChange={(e) => change(h.id, { text: e.target.value })}
                />
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-[11.5px]">
                {!h.text.trim() && !h.fallback && (
                  <span className="text-amber">Empty: people it matches get no hook sentence until you write this one.</span>
                )}
                {!h.text.trim() && h.fallback && <span className="text-muted">No hook sentence: the email goes straight from your intro to the next paragraph.</span>}
                {pinned > 0 && <span className="text-muted">Chosen by hand for {pinned} contact{pinned > 1 ? "s" : ""}.</span>}
              </div>
            </li>
          );
        })}
      </ul>
      <Button
        size="sm"
        icon={<Plus className="size-3.5" />}
        onClick={() => setHooks((list) => [...list.filter((h) => !h.fallback), { id: uid("hook"), name: "New hook", text: "", teams: [] }, ...list.filter((h) => h.fallback)])}
      >
        Add a hook
      </Button>
    </div>
  );
}

/** Compact list for the Email drafts sidebar, with the editor in a modal. */
export function HooksCard() {
  const settings = useStore((s) => s.settings);
  const [open, setOpen] = useState(false);
  const hooks = hooksOf(settings);
  const empty = hooks.filter((h) => !h.fallback && !h.text.trim());
  return (
    <>
      <ul className="divide-y divide-line">
        {hooks.map((h) => (
          <li key={h.id} className="flex items-center gap-2 px-4 py-2 text-[12.5px]">
            <span className="font-medium">{h.name}</span>
            {h.fallback ? <Badge>everyone else</Badge> : <span className="truncate text-[11.5px] text-muted">{h.teams.join(", ")}</span>}
            {!h.text.trim() && !h.fallback && <Badge tone="amber">empty</Badge>}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[11.5px]">
        {empty.length ? <span className="text-amber">Write your {empty.map((h) => h.name).join(", ")} hook.</span> : <span className="text-muted">Switch per person in the Hook column.</span>}
        <button className="font-medium text-navy hover:underline" onClick={() => setOpen(true)}>
          Edit hooks
        </button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Hooks" wide>
        <HooksEditor />
      </Modal>
    </>
  );
}

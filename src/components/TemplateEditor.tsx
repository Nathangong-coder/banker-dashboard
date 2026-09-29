"use client";

import { useState } from "react";
import { PLACEHOLDERS, REQUIRED_FACTS } from "@/lib/template";
import { DEFAULT_TEMPLATES } from "@/lib/defaults";
import type { RequiredFact, Template } from "@/lib/types";
import { uid } from "@/lib/util";
import { Button, Checkbox, Field, Input, Modal, Select, Textarea, toast } from "./ui";

export function TemplateEditor({
  template,
  onSave,
  onClose,
  onDelete,
}: {
  template: Template | null;
  onSave: (t: Template) => void;
  onClose: () => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <Modal open={!!template} onClose={onClose} title={template?.name || "New template"} wide>
      {template && <Inner key={template.id} t={template} onSave={onSave} onClose={onClose} onDelete={onDelete} />}
    </Modal>
  );
}

function Inner({ t, onSave, onClose, onDelete }: { t: Template; onSave: (t: Template) => void; onClose: () => void; onDelete?: (id: string) => void }) {
  const [d, setD] = useState(t);
  const starter = DEFAULT_TEMPLATES.find((x) => x.id === t.id || x.name.toLowerCase() === t.name.toLowerCase());
  return (
    <div className="grid gap-5 md:grid-cols-[1fr_220px]">
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Field label="Name">
            <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </Field>
          <Field label="Type">
            <Select className="w-full" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Template["kind"] })}>
              <option value="initial">First email</option>
              <option value="follow_up">Follow-up</option>
            </Select>
          </Field>
        </div>
        <Field label="When to use" hint="Auto-assign reads this. Example: “Contact went to a UC school.”">
          <Input value={d.whenToUse} onChange={(e) => setD({ ...d, whenToUse: e.target.value })} />
        </Field>
        <Field label="Subject">
          <Input value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} />
        </Field>
        <Field label="Body">
          <Textarea rows={14} className="font-mono text-[12.5px]" value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={d.attachResume} onChange={(v) => setD({ ...d, attachResume: v })} /> Attach my resume
        </label>
        {d.kind === "initial" && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md bg-[#fbfaf6] px-3 py-2 text-[12.5px] text-ink-2">
            <span className="text-muted">Needs before drafting:</span>
            {(Object.keys(REQUIRED_FACTS) as RequiredFact[]).map((k) => (
              <label key={k} className="flex items-center gap-1.5" title="Drafting asks you for it instead of letting AI guess or drop the sentence">
                <Checkbox
                  checked={!!d.requires?.includes(k)}
                  onChange={(v) => setD({ ...d, requires: v ? [...(d.requires ?? []), k] : (d.requires ?? []).filter((x) => x !== k) })}
                />
                {REQUIRED_FACTS[k].label.toLowerCase()}
              </label>
            ))}
            <label className="flex items-center gap-1.5" title="Always uses the Original base wording, even during a base A/B test">
              <Checkbox checked={!!d.lockBase} onChange={(v) => setD({ ...d, lockBase: v || undefined })} /> keep exact wording
            </label>
            {starter && (starter.body !== d.body || starter.subject !== d.subject) && (
              <button className="text-navy hover:underline" onClick={() => setD({ ...d, subject: starter.subject, body: starter.body, requires: starter.requires, lockBase: starter.lockBase })}>
                Reset to starter wording
              </button>
            )}
          </div>
        )}
        {d.kind === "initial" && (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-[#fbfaf6] px-3 py-2 text-[12.5px] text-ink-2">
            {d.experimental && (
              <label className="flex items-center gap-2">
                <Checkbox checked={!!d.experimental} onChange={(v) => setD({ ...d, experimental: v || undefined })} /> Experimental (untick once it&apos;s proven)
              </label>
            )}
            {d.variantGroup ? (
              <>
                <span className="text-blue">Part of an A/B test: drafts alternate between its variants.</span>
                <button className="text-navy hover:underline" onClick={() => setD({ ...d, variantGroup: undefined })}>
                  Take out of the test
                </button>
              </>
            ) : (
              <button
                className="text-navy hover:underline"
                title="Copies this template as variant B. New drafts alternate between the two and the Email lab compares reply rates."
                onClick={() => {
                  const group = d.id;
                  onSave({ ...d, variantGroup: group });
                  onSave({ ...d, id: uid("tpl"), name: `${d.name || "Template"} (B)`, variantGroup: group, experimental: true });
                  toast.ok(`Made “${d.name || "Template"} (B)”. Edit it to change one thing (subject line, hook, or ask), then drafts alternate between A and B.`);
                  onClose();
                }}
              >
                Make an A/B variant
              </button>
            )}
          </div>
        )}
      </div>
      <div className="text-[12px]">
        <div className="mb-1.5 font-medium text-ink-2">Placeholders</div>
        <ul className="space-y-1">
          {PLACEHOLDERS.map((p) => (
            <li key={p.key}>
              <code className="rounded bg-[#efede5] px-1 text-[11px]">{`{{${p.key}}}`}</code> <span className="text-muted">{p.desc}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 mb-1.5 font-medium text-ink-2">AI slots</div>
        <p className="text-muted">
          <code className="rounded bg-[#efede5] px-1 text-[11px]">[[AI: instruction]]</code> AI writes this part for each person, using
          only facts from your sheet (school, notes, group). Everything else stays word for word.
        </p>
      </div>
      <div className="flex justify-between border-t border-line pt-4 md:col-span-2">
        {onDelete ? (
          <Button variant="danger" size="sm" onClick={() => { onDelete(t.id); onClose(); }}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => { onSave(d); onClose(); }}>Save template</Button>
        </div>
      </div>
    </div>
  );
}

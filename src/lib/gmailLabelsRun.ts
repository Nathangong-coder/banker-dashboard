"use client";

import { useStore } from "./store";
import { gmailModify } from "./gmail";
import { googleClientId } from "./keys";
import { DEFAULT_LABELS, planLabels, threadsOf, type LabelChange } from "./gmailLabels";

type Call = NonNullable<Awaited<ReturnType<typeof gmailModify>>>;
type Label = { id: string; name: string; type?: string };

async function labelsOf(call: Call) {
  return (await call<{ labels: Label[] }>("/labels")).labels;
}

/** Reads the labels on every thread you wrote in and works out the changes (nothing is changed yet). */
export async function previewLabels(opts: { interactive?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<LabelChange[] | null> {
  const st = useStore.getState();
  const rules = st.settings.labels ?? DEFAULT_LABELS;
  const call = await gmailModify(googleClientId(st.settings), opts.interactive ?? true);
  if (!call) return null;
  const labels = await labelsOf(call);
  const nameOf = new Map(labels.map((l) => [l.id, l.name]));
  const threads = [...new Set(st.contacts.flatMap(threadsOf))];
  const current = new Map<string, string[]>();
  for (let i = 0; i < threads.length; i += 10) {
    await Promise.all(
      threads.slice(i, i + 10).map(async (t) => {
        const r = await call<{ messages?: { labelIds?: string[] }[] }>(`/threads/${t}?format=minimal`).catch(() => null);
        if (r) current.set(t, [...new Set((r.messages ?? []).flatMap((m) => m.labelIds ?? []))].map((id) => nameOf.get(id) ?? id));
      }),
    );
    opts.onProgress?.(Math.min(i + 10, threads.length), threads.length);
  }
  return planLabels(st.contacts, rules, current, labels.filter((l) => l.type !== "system").map((l) => l.name));
}

async function ensureIds(call: Call, names: string[]) {
  const labels = await labelsOf(call);
  const id = new Map(labels.map((l) => [l.name, l.id]));
  for (const n of [...new Set(names)].sort((a, b) => a.split("/").length - b.split("/").length)) {
    // Parents first, so Gmail nests them ("IB" → "IB/SF" → "IB/SF/Bank/…").
    const parts = n.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      if (id.has(p)) continue;
      const made = await call<Label>("/labels", { method: "POST", body: JSON.stringify({ name: p, labelListVisibility: "labelShow", messageListVisibility: "show" }) });
      id.set(p, made.id);
    }
  }
  return id;
}

/** Applies the changes and logs them (Undo reverses one run). */
export async function applyLabels(changes: LabelChange[], interactive = true) {
  const st = useStore.getState();
  const call = await gmailModify(googleClientId(st.settings), interactive);
  if (!call || !changes.length) return 0;
  const id = await ensureIds(call, changes.flatMap((c) => [...c.add, ...c.remove]));
  for (const ch of changes)
    await call(`/threads/${ch.threadId}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: ch.add.map((n) => id.get(n)!).filter(Boolean), removeLabelIds: ch.remove.map((n) => id.get(n)!).filter(Boolean) }),
    });
  const rules = st.settings.labels ?? DEFAULT_LABELS;
  const run = { at: new Date().toISOString(), changes: changes.slice(0, 400).map(({ threadId, contactId, name, add, remove }) => ({ threadId, contactId, name, add, remove })) };
  st.setSettings((s) => ({ ...s, labels: { ...rules, ...s.labels, log: [run, ...(s.labels?.log ?? [])].slice(0, 5) } }));
  return changes.length;
}

/** Puts back what one run changed. */
export async function undoLabels(at: string) {
  const st = useStore.getState();
  const run = st.settings.labels?.log?.find((r) => r.at === at);
  if (!run) return 0;
  const call = await gmailModify(googleClientId(st.settings), true);
  if (!call) return 0;
  const id = await ensureIds(call, run.changes.flatMap((c) => [...c.add, ...c.remove]));
  for (const ch of run.changes)
    await call(`/threads/${ch.threadId}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: ch.remove.map((n) => id.get(n)!).filter(Boolean), removeLabelIds: ch.add.map((n) => id.get(n)!).filter(Boolean) }),
    });
  st.setSettings((s) => ({ ...s, labels: { ...(s.labels ?? DEFAULT_LABELS), log: (s.labels?.log ?? []).filter((r) => r.at !== at) } }));
  return run.changes.length;
}

/** For the background Sync: only when "keep them up to date" is on and the label permission is already granted. */
export async function autoLabels() {
  const st = useStore.getState();
  if (!st.settings.labels?.auto) return 0;
  const plan = await previewLabels({ interactive: false });
  return plan ? applyLabels(plan, false) : 0;
}

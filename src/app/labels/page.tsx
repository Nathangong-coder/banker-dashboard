"use client";

import { useMemo, useState } from "react";
import { Eye, RotateCcw, Tags } from "lucide-react";
import { useStore } from "@/lib/store";
import { DEFAULT_LABELS, STATE, type LabelChange } from "@/lib/gmailLabels";
import { applyLabels, previewLabels, undoLabels } from "@/lib/gmailLabelsRun";
import { Button, Card, CardHeader, Checkbox, Empty, PageHeader, Progress, toast } from "@/components/ui";

const Chip = ({ children, tone }: { children: string; tone: "add" | "remove" }) => (
  <span className={tone === "add" ? "mr-1 inline-block rounded bg-green-soft px-1.5 text-[11.5px] text-green" : "mr-1 inline-block rounded bg-red-soft px-1.5 text-[11.5px] text-red line-through"}>
    {tone === "add" ? "+ " : "− "}
    {children}
  </span>
);

/**
 * Gmail labels (L-6 setup + a preview table): Coverage labels each person's threads to match the tracker, shows every
 * change before making it, and keeps the last 5 runs so one can be undone.
 */
export default function LabelsPage() {
  const rules = useStore((s) => s.settings.labels) ?? DEFAULT_LABELS;
  const setSettings = useStore((s) => s.setSettings);
  const [plan, setPlan] = useState<LabelChange[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof rules>) => setSettings((s) => ({ ...s, labels: { ...(s.labels ?? DEFAULT_LABELS), ...patch } }));

  const preview = async () => {
    setBusy(true);
    setProgress({ done: 0, total: 1 });
    try {
      setPlan(await previewLabels({ onProgress: (done, total) => setProgress({ done, total }) }));
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const apply = async () => {
    if (!plan?.length) return;
    setBusy(true);
    try {
      const n = await applyLabels(plan);
      toast.ok(`Labelled ${n} thread${n === 1 ? "" : "s"} in Gmail. Undo is under Recent changes.`);
      setPlan(null);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const byPerson = useMemo(() => {
    const m = new Map<string, LabelChange[]>();
    for (const c of plan ?? []) m.set(c.contactId, [...(m.get(c.contactId) ?? []), c]);
    return [...m.values()];
  }, [plan]);

  return (
    <>
      <PageHeader
        title="Gmail labels"
        sub="Label each banker's threads to match your tracker. You see every change first."
        right={
          <Button variant="primary" icon={<Eye className="size-3.5" />} loading={busy && !!progress} onClick={() => void preview()}>
            Preview changes
          </Button>
        }
      />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title={plan ? `${plan.length} thread${plan.length === 1 ? "" : "s"} to change` : "Changes"} right={plan?.length ? <Button variant="primary" loading={busy} onClick={() => void apply()}>Apply {plan.length} changes</Button> : undefined} />
          {progress ? (
            <div className="p-4">
              <Progress value={progress.done} max={progress.total} label={`Reading labels on ${progress.done}/${progress.total} threads`} />
            </div>
          ) : !plan ? (
            <Empty icon={<Tags className="size-6" />} title="Nothing previewed yet">
              Preview reads the labels on every thread you wrote in (Gmail asks once for permission to change labels) and lists what would change. Nothing changes until you press Apply.
            </Empty>
          ) : !plan.length ? (
            <Empty icon={<Tags className="size-6" />} title="Gmail already matches your tracker" />
          ) : (
            <ul className="divide-y divide-line">
              {byPerson.map((list) => (
                <li key={list[0].contactId} className="px-4 py-2.5">
                  <div className="text-[13px] font-semibold text-ink">{list[0].name}</div>
                  {list.map((ch) => (
                    <div key={ch.threadId} className="mt-1 text-[12px]">
                      <span className="mr-2 text-muted">{ch.subject || "(no subject)"}</span>
                      {ch.remove.map((l) => <Chip key={l} tone="remove">{l}</Chip>)}
                      {ch.add.map((l) => <Chip key={l} tone="add">{l}</Chip>)}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="grid content-start gap-3">
          <Card>
            <CardHeader title="Which labels" />
            <div className="grid gap-3 px-4 pb-4 text-[13px]">
              <label className="flex items-center gap-2 font-medium text-ink"><Checkbox checked={rules.state} onChange={(v) => set({ state: v })} label="Where they are" />Where they are</label>
              <p className="-mt-2 ml-6 text-[12px] text-muted">
                One of {Object.values(STATE).join(", ")}. The old one comes off when it changes.
              </p>
              <label className="flex items-center gap-2 font-medium text-ink"><Checkbox checked={rules.office} onChange={(v) => set({ office: v })} label="Office, bank and group" />Office, bank and group</label>
              <p className="-mt-2 ml-6 text-[12px] text-muted">IB/SF, IB/SF/Bank/Evercore, IB/SF/Group/Tech. Uses your existing bank labels (e.g. Houlihan) when they match. Only ever added.</p>
              <label className="flex items-center gap-2 font-medium text-ink"><Checkbox checked={rules.auto} onChange={(v) => set({ auto: v })} label="Keep them up to date on every Sync" />Keep them up to date on every Sync</label>
              <p className="-mt-2 ml-6 text-[12px] text-muted">Only while Gmail&apos;s label permission is granted in an open tab (after a Preview). Each run is logged below.</p>
              <p className="text-[12px] text-muted">Labels you made yourself (DO NOT SEND, HOLD, Good…) are never removed.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Recent changes" />
            {(rules.log ?? []).length === 0 ? (
              <p className="px-4 pb-4 text-[12px] text-muted">None yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {rules.log!.map((r) => (
                  <li key={r.at} className="flex items-center gap-2 px-4 py-2 text-[12px]">
                    <span className="flex-1 text-ink-2">
                      {new Date(r.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {r.changes.length} thread{r.changes.length === 1 ? "" : "s"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<RotateCcw className="size-3.5" />}
                      onClick={() =>
                        void undoLabels(r.at)
                          .then((n) => toast.ok(`Put back the labels on ${n} thread${n === 1 ? "" : "s"}.`))
                          .catch((e: Error) => toast.err(e.message))
                      }
                    >
                      Undo
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

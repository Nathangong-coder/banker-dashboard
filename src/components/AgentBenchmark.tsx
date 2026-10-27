"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Download, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { FILL_LABELS, type FillRun } from "@/lib/apply";
import { cn, fmtDate } from "@/lib/util";
import { Badge, Button, Input } from "@/components/ui";

const EMPTY_RUNS: FillRun[] = [];

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const mins = (ms: number) => (ms ? `${(ms / 60_000).toFixed(1)} min` : "—");
const kTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));

/**
 * Applications → Agent benchmark (owner, 2026-10-26: "compare DeepSeek to Qwen: how long they take to finish an
 * application, how many errors / fields I had to correct"). Every fill is a FillRun (applyBridge.ts): who filled what
 * (rules / Jev / learned / answer model), what was left, the agent's model / steps / tokens / time, how it ended, and
 * the fields you fixed (typed here). Benchmark mode in the extension's Options rotates the agent models across jobs.
 */
export function AgentBenchmark() {
  const runs = useStore((s) => s.apply.runs) ?? EMPTY_RUNS;
  const prices = useStore((s) => s.apply.prices);
  const learned = useStore((s) => s.apply.learned);
  const setApply = useStore((s) => s.setApply);
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => {
    const by = new Map<string, FillRun[]>();
    for (const r of runs) {
      if (!r.endedAt) continue;
      const k = r.agent ? `${r.agent.provider}/${r.agent.model}` : "rules + Jev only";
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return [...by.entries()].map(([key, rs]) => {
      const agent = rs.filter((r) => r.agent);
      const price = prices?.[key];
      const cost = price && agent.length ? avg(agent.map((r) => ((r.agent!.inTokens - r.agent!.cachedTokens) * price.in + r.agent!.cachedTokens * price.in * 0.25 + r.agent!.outTokens * price.out) / 1e6)) : undefined;
      const fixed = rs.filter((r) => typeof r.fixes === "number");
      return {
        key,
        n: rs.length,
        review: rs.filter((r) => r.outcome === "ready").length / rs.length,
        time: median(rs.map((r) => Date.parse(r.endedAt!) - Date.parse(r.startedAt))),
        steps: avg(agent.map((r) => r.agent!.steps)),
        failed: avg(agent.map((r) => r.agent!.failedActions)),
        inTok: avg(agent.map((r) => r.agent!.inTokens)),
        cached: agent.length ? agent.reduce((a, r) => a + r.agent!.cachedTokens, 0) / Math.max(1, agent.reduce((a, r) => a + r.agent!.inTokens, 0)) : 0,
        outTok: avg(agent.map((r) => r.agent!.outTokens)),
        left: avg(rs.map((r) => r.left)),
        fixes: fixed.length ? avg(fixed.map((r) => r.fixes!)) : undefined,
        cost,
      };
    });
  }, [runs, prices]);

  const learnedCount = Object.entries(learned ?? {}).map(([site, qs]) => [site, Object.keys(qs).length] as const);
  const setPrice = (key: string, side: "in" | "out", v: string) =>
    setApply((a) => ({ ...a, prices: { ...(a.prices ?? {}), [key]: { in: a.prices?.[key]?.in ?? 0, out: a.prices?.[key]?.out ?? 0, [side]: Math.max(0, Number(v) || 0) } } }));
  const setFixes = (id: string, v: string) => setApply((a) => ({ ...a, runs: (a.runs ?? []).map((r) => (r.id === id ? { ...r, fixes: v === "" ? undefined : Math.max(0, Math.round(Number(v) || 0)) } : r)) }));
  const download = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), runs, prices, learned }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `coverage-agent-benchmark-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  return (
    <details className="group rounded-lg border border-line bg-panel" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13.5px] font-semibold [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" />
        Agent benchmark
        <span className="font-normal text-muted">
          {runs.filter((r) => r.endedAt).length} fills recorded{rows.length ? ` · ${rows.length} model${rows.length === 1 ? "" : "s"}` : ""}
        </span>
      </summary>
      {open && (
        <div className="space-y-4 border-t border-line px-4 py-4 text-[12.5px]">
          <p className="text-muted">
            Every fill is recorded: time to its final status, who filled what, what was left for you, and the AI agent&apos;s steps and tokens. Type the fields you
            had to fix after reviewing each one. To compare models fairly, turn on Benchmark mode in the extension&apos;s Options (it takes turns through the models
            ticked in the agent test bench). Cost uses the $/million-token prices you enter (cached input counted at a quarter).
          </p>
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead className="bg-subtle text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    {["Model", "Fills", "Reached review", "Median time", "Agent steps", "Failed actions", "Tokens in (cached)", "Tokens out", "Left for you", "You fixed", "$ / M in · out", "Cost / fill"].map((h) => (
                      <th key={h} className="px-2 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-b border-line">
                      <td className="px-2 py-2 font-medium text-ink">{r.key}</td>
                      <td className="px-2 py-2">{r.n}</td>
                      <td className="px-2 py-2">{Math.round(r.review * 100)}%</td>
                      <td className="px-2 py-2">{mins(r.time)}</td>
                      <td className="px-2 py-2">{r.steps ? r.steps.toFixed(1) : "—"}</td>
                      <td className="px-2 py-2">{r.steps ? r.failed.toFixed(1) : "—"}</td>
                      <td className="px-2 py-2">{r.inTok ? `${kTok(r.inTok)} (${Math.round(r.cached * 100)}%)` : "—"}</td>
                      <td className="px-2 py-2">{r.outTok ? kTok(r.outTok) : "—"}</td>
                      <td className="px-2 py-2">{r.left.toFixed(1)}</td>
                      <td className="px-2 py-2">{r.fixes === undefined ? "—" : r.fixes.toFixed(1)}</td>
                      <td className="px-2 py-2">
                        {r.key !== "rules + Jev only" && (
                          <span className="flex gap-1">
                            <Input className="h-7 w-16" defaultValue={prices?.[r.key]?.in ?? ""} placeholder="in" aria-label={`${r.key} $ per million input tokens`} onBlur={(e) => setPrice(r.key, "in", e.target.value)} />
                            <Input className="h-7 w-16" defaultValue={prices?.[r.key]?.out ?? ""} placeholder="out" aria-label={`${r.key} $ per million output tokens`} onBlur={(e) => setPrice(r.key, "out", e.target.value)} />
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">{r.cost === undefined ? "—" : `$${r.cost.toFixed(3)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Recent fills</p>
            <ul className="divide-y divide-line rounded-md border border-line">
              {runs.slice(-25).reverse().map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-medium text-ink">{r.company}</span>
                  <span className="text-muted">
                    {r.site} · {fmtDate(r.startedAt)} · {r.endedAt ? mins(Date.parse(r.endedAt) - Date.parse(r.startedAt)) : "running"}
                  </span>
                  {r.outcome && <Badge tone={r.outcome === "ready" ? "green" : r.outcome === "error" ? "red" : "amber"}>{FILL_LABELS[r.outcome]}</Badge>}
                  <span className={cn("text-muted")}>
                    rules {r.rules} · Jev {r.jev} · learned {r.learned} · AI {r.ai} · left {r.left}
                    {r.agent ? ` · agent ${r.agent.model}: ${r.agent.steps} steps, ${kTok(r.agent.inTokens)} in (${kTok(r.agent.cachedTokens)} cached), ${r.agent.failedActions} failed` : ""}
                  </span>
                  <div className="flex-1" />
                  <label className="flex items-center gap-1 text-muted">
                    fixed
                    <Input className="h-7 w-14" type="number" min={0} defaultValue={r.fixes ?? ""} aria-label={`Fields you fixed for ${r.company}`} onBlur={(e) => setFixes(r.id, e.target.value)} />
                  </label>
                </li>
              ))}
              {!runs.length && <li className="px-3 py-3 text-muted">No fills recorded yet. Press Fill selected on a few jobs.</li>}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">
              Learned answers: {learnedCount.length ? learnedCount.map(([s, n]) => `${s} ${n}`).join(" · ") : "none yet"} (reused on the same platform before any AI call)
            </span>
            <div className="flex-1" />
            <Button size="sm" variant="secondary" icon={<Download className="size-3.5" />} onClick={download}>
              Download JSON
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setApply((a) => ({ ...a, learned: {} }))}>
              Forget learned answers
            </Button>
          </div>
        </div>
      )}
    </details>
  );
}

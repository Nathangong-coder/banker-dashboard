"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Filter, Plus, Search, Sparkles, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { callApi } from "@/lib/api";
import { addProspects, enrichContacts } from "@/lib/actions";
import type { Prospect } from "@/lib/types";
import { chunk, cn, guessDomain, linkedinSlug } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Input, PageHeader, Progress, Textarea, toast } from "@/components/ui";
import { aiReady, hasKey } from "@/lib/keys";

type Verdict = {
  id: string;
  verdict: "match" | "maybe" | "no";
  score: number;
  firstName: string;
  lastName: string;
  position: string;
  team: string;
  school: string;
  location: string;
  region: "SF" | "NY" | "Other";
  reasons: string;
};

export default function FindPage() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const contacts = useStore((s) => s.contacts);
  const bankMeta = useStore((s) => s.banks);
  const prospects = useStore((s) => s.prospects);
  const setProspects = useStore((s) => s.setProspects);
  const hasBook = useStore((s) => !!s.workbook);

  const knownBanks = useMemo(() => [...new Set(contacts.map((c) => c.bank))].sort(), [contacts]);
  const [banks, setBanks] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [useApollo, setUseApollo] = useState(false);
  const [apolloMax, setApolloMax] = useState(10);
  const [autoScreen, setAutoScreen] = useState(true);
  const [showQueries, setShowQueries] = useState(false);
  const [phase, setPhase] = useState<null | { label: string; done: number; total: number }>(null);
  const [tab, setTab] = useState<"match" | "maybe" | "no" | "all">("match");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [toSheet, setToSheet] = useState(true);
  const [thenEnrich, setThenEnrich] = useState(true);

  const existing = useMemo(() => {
    const slugs = new Set(contacts.map((c) => linkedinSlug(c.linkedin)).filter(Boolean));
    const names = new Set(contacts.map((c) => `${c.name.toLowerCase().trim()}|${c.bank.toLowerCase()}`));
    return (p: Prospect) => slugs.has(linkedinSlug(p.linkedin)) || names.has(`${p.name.toLowerCase().trim()}|${p.bank.toLowerCase()}`);
  }, [contacts]);

  const screen = async (list: Prospect[]) => {
    if (!aiReady(settings)) {
      toast.err("Add an AI key in Settings to screen candidates.");
      return list;
    }
    const todo = list.filter((p) => !p.verdict);
    const batches = chunk(todo, 15);
    const byId = new Map(list.map((p) => [p.id, p]));
    let done = 0;
    setPhase({ label: "Screening with AI", done: 0, total: todo.length });
    for (const b of batches) {
      try {
        const { results } = await callApi<{ results: Verdict[] }>(
          "/api/prospect/filter",
          {
            criteria: settings.prospect.criteria,
            candidates: b.map(({ id, name, bank, title, snippet }) => ({ id, name, bank, title, snippet })),
          },
          settings,
        );
        for (const v of results) {
          const p = byId.get(v.id);
          if (!p) continue;
          byId.set(v.id, {
            ...p,
            verdict: v.verdict,
            score: v.score,
            firstName: v.firstName || p.firstName,
            lastName: v.lastName || p.lastName,
            position: v.position,
            team: v.team,
            school: v.school,
            location: v.location,
            region: v.region,
            reasons: v.reasons,
          });
        }
      } catch (e) {
        toast.err((e as Error).message);
        break;
      }
      done += b.length;
      setPhase({ label: "Screening with AI", done, total: todo.length });
      setProspects([...byId.values()]);
    }
    setPhase(null);
    return [...byId.values()];
  };

  const run = async () => {
    if (!banks.length) return toast.err("Pick at least one bank.");
    if (!hasKey(settings, "serper") && !(useApollo && hasKey(settings, "apollo")))
      return toast.err("Add a Serper key (Google search) in Settings, or turn on Apollo search.");
    const found = new Map<string, Prospect>(prospects.map((p) => [p.id, p]));
    setPhase({ label: "Searching", done: 0, total: banks.length });
    let i = 0;
    for (const bank of banks) {
      try {
        const res = await callApi<{ prospects: Prospect[]; warnings: string[] }>(
          "/api/prospect/search",
          {
            bank: { name: bank, domain: Object.values(bankMeta).find((b) => b.name === bank)?.domain || guessDomain(bank) },
            queries: settings.prospect.queries,
            perQuery: settings.prospect.resultsPerQuery,
            apollo: { enabled: useApollo, maxPeople: apolloMax },
          },
          settings,
        );
        res.warnings.forEach((w) => toast.info(w));
        for (const p of res.prospects) if (!found.has(p.id) && !existing(p)) found.set(p.id, p);
      } catch (e) {
        toast.err(`${bank}: ${(e as Error).message}`);
      }
      setPhase({ label: "Searching", done: ++i, total: banks.length });
    }
    let list = [...found.values()];
    setProspects(list);
    setPhase(null);
    toast.ok(`${list.length} candidates collected (people already in your sheet are skipped).`);
    if (autoScreen && aiReady(settings)) list = await screen(list);
  };

  const shown = prospects
    .filter((p) => (tab === "all" ? true : tab === "match" ? p.verdict === "match" : tab === "maybe" ? p.verdict === "maybe" || !p.verdict : p.verdict === "no"))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const counts = {
    match: prospects.filter((p) => p.verdict === "match").length,
    maybe: prospects.filter((p) => p.verdict === "maybe" || !p.verdict).length,
    no: prospects.filter((p) => p.verdict === "no").length,
    all: prospects.length,
  };

  const add = async () => {
    const chosen = prospects.filter((p) => sel.has(p.id));
    if (!chosen.length) return;
    const added = addProspects(chosen, toSheet && hasBook);
    setProspects(prospects.filter((p) => !sel.has(p.id)));
    setSel(new Set());
    toast.ok(`Added ${added.length} contact${added.length === 1 ? "" : "s"}${toSheet && hasBook ? " to your spreadsheet (save to write them)" : ""}.`);
    if (thenEnrich && (hasKey(settings, "apollo") || hasKey(settings, "hunter")) && added.length) {
      setPhase({ label: "Finding emails", done: 0, total: added.length });
      const r = await enrichContacts(
        added.map((c) => c.id),
        (done, total) => setPhase({ label: "Finding emails", done, total }),
      );
      setPhase(null);
      toast.ok(`Found ${r.found} of ${r.attempted} emails.`);
    }
  };

  return (
    <>
      <PageHeader
        title="Find people"
        sub="Searches public LinkedIn profiles through Google, then AI keeps only the bankers who match your criteria. Add the good ones to your sheet with one click."
      />

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="1 · Banks" sub="Where to look" />
            <div className="space-y-3 p-4">
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {[...new Set([...knownBanks, ...banks])].map((b) => (
                  <button
                    key={b}
                    onClick={() => setBanks(banks.includes(b) ? banks.filter((x) => x !== b) : [...banks, b])}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px]",
                      banks.includes(b) ? "border-navy bg-navy text-white" : "border-line-2 bg-panel text-ink-2 hover:border-navy/50",
                    )}
                  >
                    {b}
                  </button>
                ))}
                {knownBanks.length === 0 && banks.length === 0 && <span className="text-[12px] text-muted">Upload your sheet, or add banks below.</span>}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (custom.trim()) setBanks([...new Set([...banks, custom.trim()])]);
                  setCustom("");
                }}
              >
                <Input className="h-8" placeholder="Add a bank, e.g. Qatalyst" value={custom} onChange={(e) => setCustom(e.target.value)} />
                <Button size="sm" type="submit" icon={<Plus className="size-3.5" />}>
                  Add
                </Button>
              </form>
              {banks.length > 0 && (
                <button className="text-[12px] text-muted hover:text-ink" onClick={() => setBanks([])}>
                  Clear {banks.length} selected
                </button>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="2 · Who qualifies" sub="AI reads each profile snippet against this" right={<Filter className="size-4 text-muted" />} />
            <div className="space-y-3 p-4">
              <Textarea
                rows={9}
                className="text-[12.5px]"
                value={settings.prospect.criteria}
                onChange={(e) => setSettings((s) => ({ ...s, prospect: { ...s.prospect, criteria: e.target.value } }))}
              />
              <button className="text-[12px] font-medium text-navy hover:underline" onClick={() => setShowQueries(!showQueries)}>
                {showQueries ? "Hide" : "Edit"} Google search queries ({settings.prospect.queries.length})
              </button>
              {showQueries && (
                <div className="space-y-2">
                  <p className="text-[11.5px] text-muted">
                    <code>{"{bank}"}</code> is replaced with each bank name. Each query costs one Serper credit per bank.
                  </p>
                  {settings.prospect.queries.map((q, i) => (
                    <div key={i} className="flex gap-1.5">
                      <Textarea
                        rows={3}
                        className="font-mono text-[11.5px]"
                        value={q}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            prospect: { ...s.prospect, queries: s.prospect.queries.map((x, j) => (j === i ? e.target.value : x)) },
                          }))
                        }
                      />
                      <button
                        aria-label="Remove query"
                        className="self-start p-1 text-muted hover:text-red"
                        onClick={() => setSettings((s) => ({ ...s, prospect: { ...s.prospect, queries: s.prospect.queries.filter((_, j) => j !== i) } }))}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <Button size="sm" onClick={() => setSettings((s) => ({ ...s, prospect: { ...s.prospect, queries: [...s.prospect.queries, 'site:linkedin.com/in "{bank}" "investment banking"'] } }))}>
                    Add query
                  </Button>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="3 · Run" />
            <div className="space-y-2.5 p-4 text-[13px]">
              <label className="flex items-center gap-2">
                <Checkbox checked={autoScreen} onChange={setAutoScreen} /> Screen with AI automatically
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={useApollo} onChange={setUseApollo} /> Also search Apollo
                <span className="text-[11.5px] text-muted">(uses credits to reveal names)</span>
              </label>
              {useApollo && (
                <label className="flex items-center gap-2 pl-6 text-[12.5px] text-ink-2">
                  Max people per bank
                  <Input type="number" min={1} max={30} className="h-7 w-16" value={apolloMax} onChange={(e) => setApolloMax(Number(e.target.value) || 10)} />
                </label>
              )}
              {phase ? (
                <div className="pt-2">
                  <div className="mb-1 text-[12px] text-ink-2">{phase.label}…</div>
                  <Progress value={phase.done} max={phase.total} />
                </div>
              ) : (
                <div className="flex gap-2 pt-2">
                  <Button variant="primary" icon={<Search className="size-3.5" />} onClick={run} disabled={!banks.length}>
                    Search {banks.length || ""} bank{banks.length === 1 ? "" : "s"}
                  </Button>
                  {prospects.some((p) => !p.verdict) && (
                    <Button icon={<Sparkles className="size-3.5" />} onClick={() => screen(prospects)}>
                      Screen unscreened
                    </Button>
                  )}
                </div>
              )}
              {(!hasKey(settings, "serper") || !aiReady(settings)) && (
                <p className="text-[12px] text-amber">
                  Needs {[!hasKey(settings, "serper") && "a Serper key", !aiReady(settings) && "an AI key + model"].filter(Boolean).join(" and ")} ·{" "}
                  <Link href="/settings" className="underline">
                    Settings
                  </Link>
                </p>
              )}
            </div>
          </Card>
        </div>

        <Card className="flex min-h-[500px] flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
            {(["match", "maybe", "no", "all"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn("rounded px-2.5 py-1 text-[12.5px]", tab === t ? "bg-navy text-white" : "text-ink-2 hover:bg-[#f0eee7]")}
              >
                {{ match: "Matches", maybe: "Maybe / unscreened", no: "Rejected", all: "All" }[t]}{" "}
                <span className="num opacity-70">{counts[t]}</span>
              </button>
            ))}
            <div className="flex-1" />
            {prospects.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => { setProspects([]); setSel(new Set()); }}>
                Clear results
              </Button>
            )}
          </div>

          {shown.length === 0 ? (
            <Empty icon={<Search className="size-6" />} title={prospects.length ? "Nothing in this bucket" : "No candidates yet"}>
              {prospects.length ? "Check the other tabs." : "Pick banks on the left and run a search."}
            </Empty>
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10 bg-[#faf9f5] text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-line">
                    <th className="w-8 px-3 py-2">
                      <Checkbox
                        label="Select all"
                        checked={shown.every((p) => sel.has(p.id))}
                        onChange={(v) => {
                          const s = new Set(sel);
                          shown.forEach((p) => (v ? s.add(p.id) : s.delete(p.id)));
                          setSel(s);
                        }}
                      />
                    </th>
                    <th className="px-2 py-2 font-medium">Person</th>
                    <th className="px-2 py-2 font-medium">Group · School · Location</th>
                    <th className="px-2 py-2 font-medium">Why</th>
                    <th className="px-3 py-2 text-right font-medium">Fit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((p) => (
                    <tr key={p.id} className={cn("align-top", sel.has(p.id) && "bg-blue-soft/40")}>
                      <td className="px-3 py-2.5">
                        <Checkbox
                          label={`Select ${p.name}`}
                          checked={sel.has(p.id)}
                          onChange={(v) => {
                            const s = new Set(sel);
                            if (v) s.add(p.id);
                            else s.delete(p.id);
                            setSel(s);
                          }}
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1.5 font-medium">
                          {p.name}
                          {p.linkedin && (
                            <a href={p.linkedin} target="_blank" rel="noreferrer" className="text-muted hover:text-blue" aria-label="LinkedIn">
                              <ExternalLink className="size-3" />
                            </a>
                          )}
                        </div>
                        <div className="text-[12px] text-muted">
                          {p.bank} · {p.position || p.title || "—"}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-[12px]">
                        {p.verdict ? (
                          <div className="flex flex-wrap gap-1">
                            {p.team && <Badge tone={/health/i.test(p.team) ? "red" : "blue"}>{p.team}</Badge>}
                            {p.school && <Badge>{p.school}</Badge>}
                            {p.location && <Badge tone="neutral">{p.location}</Badge>}
                          </div>
                        ) : (
                          <span className="line-clamp-2 text-muted">{p.snippet}</span>
                        )}
                      </td>
                      <td className="max-w-[320px] px-2 py-2.5 text-[12px] text-ink-2">{p.reasons ?? <span className="text-muted">Not screened</span>}</td>
                      <td className="px-3 py-2.5 text-right">
                        {p.verdict && (
                          <Badge tone={p.verdict === "match" ? "green" : p.verdict === "maybe" ? "amber" : "neutral"}>
                            <span className="num">{p.score}</span>
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sel.size > 0 && (
            <div className="flex flex-wrap items-center gap-4 border-t border-line bg-[#faf9f5] px-4 py-3 text-[12.5px]">
              <span className="font-medium">{sel.size} selected</span>
              <label className="flex items-center gap-1.5">
                <Checkbox checked={toSheet && hasBook} onChange={setToSheet} /> Write into bank tabs of my spreadsheet
              </label>
              <label className="flex items-center gap-1.5">
                <Checkbox checked={thenEnrich} onChange={setThenEnrich} /> Find their emails
              </label>
              <div className="flex-1" />
              <Button variant="brass" icon={<Plus className="size-3.5" />} onClick={add} disabled={!!phase}>
                Add to contacts
              </Button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

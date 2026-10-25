"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Globe, Search, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { callApi } from "@/lib/api";
import { usableKeys } from "@/lib/keys";
import { canonBank } from "@/lib/banks";
import { boardOf, companyFor, freshJobs, mergeBoards, rankJobs, searchQueries, type Board, type FoundJob } from "@/lib/jobFinder";
import type { JobApplication } from "@/lib/apply";
import { sendCommand, useExtension, useFinderStatus } from "@/lib/applyBridge";
import { cn, relDays, uid } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, toast } from "@/components/ui";
import { askSignIn } from "@/lib/session";

const SOURCE: Record<FoundJob["source"], string> = { workday: "Workday", greenhouse: "Greenhouse", lever: "Lever", search: "Google", linkedin: "LinkedIn" };
const THIS_YEAR = new Date().getFullYear();
const YEARS = [THIS_YEAR + 1, THIS_YEAR + 2];

/**
 * Applications → Find jobs: internships from the banks' own career boards (Workday, Greenhouse, Lever) and a Google
 * search over them, plus the extension's opt-in LinkedIn job search. Finds are listed here; you pick which to track.
 */
export function JobFinder() {
  const finder = useStore((s) => s.apply.finder);
  const jobs = useStore((s) => s.apply.jobs);
  const settings = useStore((s) => s.settings);
  const targets = useStore((s) => s.targets);
  const added = useStore((s) => s.coverage.added);
  const contacts = useStore((s) => s.contacts);
  const setApply = useStore((s) => s.setApply);
  const features = useExtension((s) => s.features);
  const liStatus = useFinderStatus();
  const [terms, setTerms] = useState(finder.terms ?? "summer analyst");
  const [years, setYears] = useState<number[]>(finder.years ?? [YEARS[0]]);
  const [location, setLocation] = useState(finder.location ?? "United States");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [usOnly, setUsOnly] = useState(true);

  // Banks you cover: workbook targets, banks you added, banks of your contacts.
  const banks = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of [...targets.map((t) => t.name), ...added.map((t) => t.name), ...contacts.map((c) => c.bank)]) if (n && !m.has(canonBank(n))) m.set(canonBank(n), n);
    return [...m.values()];
  }, [targets, added, contacts]);
  const hasSearch = usableKeys(settings, "serper").length > 0 || usableKeys(settings, "brave").length > 0;
  // Boards learned before, plus any your tracked jobs live on.
  const boards = useMemo(() => mergeBoards(finder.boards, jobs.flatMap((j) => [j.url, j.applyUrl].flatMap((u) => (u && boardOf(u)) || []))), [finder.boards, jobs]);
  const fresh = useMemo(() => rankJobs(freshJobs(finder.found, jobs, finder.dismissed), banks), [finder.found, finder.dismissed, jobs, banks]);
  const known = useMemo(() => new Set(banks.map(canonBank)), [banks]);
  const shown = showAll ? fresh : fresh.slice(0, 40);

  const search = async () => {
    if (askSignIn("search for jobs")) return;
    if (!hasSearch && !boards.length) return toast.err("Add a Serper or Brave Search key (Settings → Data), or track a job on a bank's Workday / Greenhouse / Lever site first.");
    setBusy(true);
    try {
      const r = await callApi<{ jobs: Omit<FoundJob, "foundAt">[]; boards: Board[]; warnings: string[] }>(
        "/api/jobs/search",
        { terms, years, usOnly, boards: boards.slice(-40), queries: hasSearch ? searchQueries(terms, years, banks.slice(0, 24)) : [] },
        settings,
      );
      const at = new Date().toISOString();
      const found = r.jobs.map((j) => ({ ...j, company: companyFor(j.company, banks), foundAt: at }));
      setApply((a) => {
        const byKey = new Map(a.finder.found.map((f) => [f.key, f]));
        for (const f of found) byKey.set(f.key, { ...f, foundAt: byKey.get(f.key)?.foundAt ?? at });
        return { ...a, finder: { ...a.finder, found: [...byKey.values()].slice(-300), boards: mergeBoards(boards, r.boards), at, terms, years, location } };
      });
      const n = freshJobs(found, jobs, finder.dismissed).length;
      toast.ok(`${n} new internship${n === 1 ? "" : "s"} found across ${mergeBoards(boards, r.boards).length} career boards.`);
      if (r.warnings.length) toast.info(r.warnings.slice(0, 2).join(" · "));
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const searchLinkedIn = async (watch: boolean) => {
    setApply((a) => ({ ...a, finder: { ...a.finder, terms, years, location } }));
    try {
      const r = await sendCommand<{ max: number }>("linkedinJobs", { terms: `${terms} ${years.join(" ")}`.trim(), location, max: 15, watch });
      useFinderStatus.getState().set(`Reading up to ${r.max} LinkedIn jobs at a person's pace (about 10 seconds each)…`, true);
    } catch (e) {
      toast.err((e as Error).message);
    }
  };

  const track = (list: FoundJob[]) => {
    const now = new Date().toISOString();
    const add: JobApplication[] = list.map((f) => ({
      id: uid("job"),
      company: f.company,
      role: f.title,
      url: f.url,
      applyUrl: f.applyUrl,
      linkedinJobId: f.linkedinJobId,
      description: f.description,
      location: f.location,
      status: "saved",
      createdAt: now,
    }));
    setApply((a) => ({ ...a, jobs: [...add, ...a.jobs] }));
    setPicked(new Set());
    toast.ok(`Tracking ${add.length} job${add.length === 1 ? "" : "s"}. Tick them below and press Fill selected when you're ready.`);
  };
  const dismiss = (keys: string[]) => {
    setApply((a) => ({ ...a, finder: { ...a.finder, dismissed: [...new Set([...a.finder.dismissed, ...keys])].slice(-2000) } }));
    setPicked(new Set());
  };
  const toggle = (k: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  const chosen = fresh.filter((f) => picked.has(f.key));

  return (
    <Card>
      <CardHeader
        title="Find jobs"
        sub={
          <>
            Internships on the banks&apos; own career boards (Workday, Greenhouse, Lever) and a Google search over them
            {features.linkedinJobs ? ", plus LinkedIn Jobs from your browser" : ""}. {boards.length ? `${boards.length} career boards known so far` : "Career boards are learned as you search and track jobs"}
            {finder.at ? ` · last searched ${relDays(finder.at)}` : ""}.
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 pb-3 md:grid-cols-[2fr_auto_1.2fr_auto] md:items-end">
        <Field label="Looking for">
          <Input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="summer analyst" />
        </Field>
        <Field label="Summer">
          <div className="flex h-9 items-center gap-3 text-[13px]">
            {YEARS.map((y) => (
              <label key={y} className="flex items-center gap-1.5">
                <Checkbox checked={years.includes(y)} onChange={(on) => setYears((ys) => (on ? [...ys, y] : ys.filter((x) => x !== y)))} label={`Summer ${y}`} />
                {y}
              </label>
            ))}
            <label className="flex items-center gap-1.5 text-ink-2">
              <Checkbox checked={usOnly} onChange={setUsOnly} label="US only" />
              US only
            </label>
          </div>
        </Field>
        <Field label="Location (LinkedIn)">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} disabled={!features.linkedinJobs} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<Search className="size-3.5" />} loading={busy} onClick={search}>
            Find jobs
          </Button>
          {features.linkedinJobs && (
            <Button variant="brass" icon={<Globe className="size-3.5" />} disabled={liStatus.running} onClick={() => searchLinkedIn(true)}>
              Search LinkedIn Jobs
            </Button>
          )}
        </div>
      </div>
      {liStatus.text && <p className={cn("px-4 pb-3 text-[12.5px]", liStatus.running ? "text-ink-2" : "text-muted")}>LinkedIn: {liStatus.text}</p>}
      {!hasSearch && <p className="px-4 pb-3 text-[12.5px] text-muted">No Serper / Brave key: only the career boards Coverage already knows are listed. Add a key in Settings → Data to search for more.</p>}

      {fresh.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-y border-line bg-subtle px-4 py-2 text-[12.5px]">
            <Checkbox checked={chosen.length === shown.length && shown.length > 0} onChange={(on) => setPicked(new Set(on ? shown.map((f) => f.key) : []))} label="Select all shown" />
            <span className="text-muted">{chosen.length ? `${chosen.length} selected` : `${fresh.length} new`}</span>
            <div className="flex-1" />
            <Button size="sm" variant="primary" disabled={!chosen.length} onClick={() => track(chosen)}>
              Track {chosen.length || ""}
            </Button>
            <Button size="sm" variant="ghost" disabled={!chosen.length} onClick={() => dismiss(chosen.map((f) => f.key))}>
              Not interested
            </Button>
          </div>
          <ul className="max-h-[420px] divide-y divide-line overflow-auto">
            {shown.map((f) => (
              <li key={f.key} className="group flex items-start gap-3 px-4 py-2 text-[13px] hover:bg-subtle">
                <span className="pt-0.5">
                  <Checkbox checked={picked.has(f.key)} onChange={(on) => toggle(f.key, on)} label={`Select ${f.company} ${f.title}`} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium text-ink">{f.company}</span>
                    <span className="text-ink-2">{f.title}</span>
                    {known.has(canonBank(f.company)) && <Badge tone="green" className="px-1.5 py-0 text-[10.5px]">on your list</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-muted">
                    <span>{SOURCE[f.source]}</span>
                    {f.location && <span>{f.location}</span>}
                    {f.posted && <span>{/^\d{4}-/.test(f.posted) ? relDays(f.posted) : f.posted}</span>}
                    <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 hover:text-navy">
                      open <ExternalLink className="size-3" />
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <Button size="sm" variant="brass" onClick={() => track([f])}>
                    Track
                  </Button>
                  <button className="rounded p-1 text-muted hover:bg-hover hover:text-ink" title="Not interested" aria-label="Not interested" onClick={() => dismiss([f.key])}>
                    <X className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {fresh.length > shown.length && (
            <button className="w-full border-t border-line px-4 py-2 text-[12.5px] font-medium text-navy hover:bg-subtle" onClick={() => setShowAll(true)}>
              Show all {fresh.length}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

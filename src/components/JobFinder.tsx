"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ExternalLink, Globe, GraduationCap, Search, Sparkles, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { callApi } from "@/lib/api";
import { usableKeys } from "@/lib/keys";
import { canonBank } from "@/lib/banks";
import { boardOf, companyFor, freshJobs, handshakeJobsUrl, knownIds, mergeBoards, searchQueries, type Board, type FoundJob } from "@/lib/jobFinder";
import { judge, rulesOf, sortReviewed, type Verdict } from "@/lib/jobReview";
import { addReviewRule, reviewPending, summarize, trackedFrom } from "@/lib/jobReviewRun";
import { sendCommand, useExtension, useFinderStatus } from "@/lib/applyBridge";
import { cn, relDays } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, Segmented, toast } from "@/components/ui";
import { JobRules, WhyModal } from "@/components/JobRules";
import { askSignIn } from "@/lib/session";

const SOURCE: Record<FoundJob["source"], string> = { workday: "Workday", greenhouse: "Greenhouse", lever: "Lever", search: "Google", linkedin: "LinkedIn", handshake: "Handshake" };
const VERDICT_TONE: Record<Verdict, "green" | "amber" | "neutral"> = { apply: "green", maybe: "amber", skip: "neutral" };
type List = "review" | "pending" | "skipped";
const THIS_YEAR = new Date().getFullYear();
const YEARS = [THIS_YEAR + 1, THIS_YEAR + 2];

/**
 * Applications → Find jobs: internships from the banks' own career boards (Workday, Greenhouse, Lever) and a Google
 * search over them, plus the extension's opt-in LinkedIn / Handshake readers. Every find is reviewed by the AI against
 * "What jobs I want" (lib/jobReview.ts): Apply jobs go onto the tracker under "Added by AI", Maybe jobs are listed here,
 * Skip jobs are kept under "Skipped". A run only starts when you press a button (the 9 PM text reminds you).
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
  const gradDate = useStore((s) => s.apply.profile.gradDate);
  const rules = useMemo(() => rulesOf(finder.rules, gradDate), [finder.rules, gradDate]);
  const [list, setList] = useState<List>("review");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ask, setAsk] = useState<Parameters<typeof WhyModal>[0]["ask"]>(null);
  const [reviewing, setReviewing] = useState(false);
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
  const known = useMemo(() => new Set(banks.map(canonBank)), [banks]);
  const fresh = useMemo(() => sortReviewed(freshJobs(finder.found, jobs, finder.dismissed), rules, known), [finder.found, finder.dismissed, jobs, rules, known]);
  const verdictOf = (f: FoundJob) => (f.review ? judge(f.review, rules, f.location) : null);
  const lists = useMemo(() => {
    const out: Record<List, FoundJob[]> = { review: [], pending: [], skipped: [] };
    for (const f of fresh) {
      const v = f.review ? judge(f.review, rules, f.location).verdict : null;
      out[!v ? "pending" : v === "skip" ? "skipped" : "review"].push(f);
    }
    return out;
  }, [fresh, rules]);
  const current = lists[list];
  const shown = showAll ? current : current.slice(0, 40);
  const stale = finder.found.filter((f) => f.review && !f.review.quick && f.review.version < rules.version && freshJobs([f], jobs, finder.dismissed).length).length;

  // Finds without a review (a run that ended before the AI was reachable): review them when the page opens.
  useEffect(() => {
    if (useStore.getState().apply.finder.found.some((f) => !f.review)) void reviewPending({ quiet: true });
    // The 9 PM text's reminder links here (/applications?find=1).
    if (new URLSearchParams(window.location.search).has("find")) document.getElementById("find-jobs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const review = async (recheck = false) => {
    setReviewing(true);
    try {
      const r = await reviewPending({ recheck });
      if (r) toast.ok(`Reviewed ${r.reviewed} job${r.reviewed === 1 ? "" : "s"}${r.added ? `, ${r.added} added to your tracker` : ""}.`);
    } finally {
      setReviewing(false);
    }
  };
  const ran = () => setApply((a) => ({ ...a, finder: { ...a.finder, terms, years, location, lastRunAt: new Date().toISOString() } }));

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
        // A job found again keeps its stored review (never sent to the AI twice).
        for (const f of found) byKey.set(f.key, { ...f, review: byKey.get(f.key)?.review, foundAt: byKey.get(f.key)?.foundAt ?? at });
        return { ...a, finder: { ...a.finder, found: [...byKey.values()].slice(-400), boards: mergeBoards(boards, r.boards), at, terms, years, location, lastRunAt: at } };
      });
      const newKeys = freshJobs(found, jobs, finder.dismissed).map((f) => f.key);
      if (r.warnings.length) toast.info(r.warnings.slice(0, 2).join(" · "));
      const rv = await reviewPending({ quiet: true });
      toast.ok(`${newKeys.length} new internship${newKeys.length === 1 ? "" : "s"} across ${mergeBoards(boards, r.boards).length} career boards. ${summarize(newKeys, rv?.added ?? 0)}.`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** LinkedIn / Handshake: the extension reads up to 30 new postings in your own browser (ids you have are skipped). */
  const searchSite = async (site: "linkedin" | "handshake", watch: boolean) => {
    if (askSignIn("search for jobs")) return;
    ran();
    const name = site === "linkedin" ? "LinkedIn" : "Handshake";
    try {
      const have = knownIds(finder.found, finder.dismissed, jobs, site);
      const q = `${terms} ${years.join(" ")}`.trim();
      const r =
        site === "linkedin"
          ? await sendCommand<{ max: number }>("linkedinJobs", { terms: q, location, max: 30, watch, known: have })
          : await sendCommand<{ max: number }>("handshakeJobs", { url: handshakeJobsUrl(q), max: 30, watch, known: have });
      useFinderStatus.getState().set(`Reading up to ${r.max} new ${name} jobs at a person's pace (about 10 seconds each); the AI reviews them as they come in…`, true);
    } catch (e) {
      toast.err((e as Error).message);
    }
  };

  const track = (list: FoundJob[]) => {
    const now = new Date().toISOString();
    const add = list.map((f) => trackedFrom(f, now));
    setApply((a) => ({ ...a, jobs: [...add, ...a.jobs] }));
    setPicked(new Set());
    toast.ok(`Tracking ${add.length} job${add.length === 1 ? "" : "s"}. Tick them below and press Fill selected when you're ready.`);
  };
  /** "This should be Apply": track it on My list, and the reason becomes a rule. */
  const overrule = (f: FoundJob) =>
    setAsk({
      title: `Track ${f.company} · ${f.title}`,
      placeholder: "e.g. rotational finance programs at banks count as banking",
      act: (why) => {
        if (why) addReviewRule(`Should apply: ${f.company} "${f.title}". ${why}`);
        track([f]);
      },
    });
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
  const chosen = current.filter((f) => picked.has(f.key));

  return (
    <Card id="find-jobs" className="scroll-mt-20">
      <CardHeader
        title="Find jobs"
        sub={
          <>
            Internships on the banks&apos; own career boards (Workday, Greenhouse, Lever) and a Google search over them
            {features.linkedinJobs || features.handshakeJobs ? `, plus ${[features.linkedinJobs && "LinkedIn", features.handshakeJobs && "Handshake"].filter(Boolean).join(" and ")} from your browser` : ""}. The AI
            reviews each one and adds the ones you want. {boards.length ? `${boards.length} career boards known so far` : "Career boards are learned as you search and track jobs"}
            {finder.lastRunAt ?? finder.at ? ` · last searched ${relDays((finder.lastRunAt ?? finder.at)!)}` : ""}.
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
            <Button variant="brass" icon={<Globe className="size-3.5" />} disabled={liStatus.running} onClick={() => searchSite("linkedin", true)}>
              Search LinkedIn
            </Button>
          )}
          {features.handshakeJobs && (
            <Button variant="brass" icon={<GraduationCap className="size-3.5" />} disabled={liStatus.running} onClick={() => searchSite("handshake", true)}>
              Search Handshake
            </Button>
          )}
        </div>
      </div>
      {liStatus.text && <p className={cn("px-4 pb-3 text-[12.5px]", liStatus.running ? "text-ink-2" : "text-muted")}>{liStatus.text}</p>}
      <details className="group border-t border-line" open={rulesOpen} onToggle={(e) => setRulesOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" />
          <Sparkles className="size-3.5 text-brass" /> What jobs I want
          <span className="font-normal text-muted">
            {rules.roleTypes.filter((t) => t.verdict === "apply").length} role types to apply to · class of {rules.classYears.join(" / ") || "?"}
            {stale ? ` · ${stale} to re-check` : ""}
          </span>
        </summary>
        {rulesOpen && <JobRules stale={stale} onRecheck={() => review(true)} />}
      </details>
      {!hasSearch && <p className="px-4 pb-3 text-[12.5px] text-muted">No Serper / Brave key: only the career boards Coverage already knows are listed. Add a key in Settings → Data to search for more.</p>}

      {fresh.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-y border-line px-4 py-2">
            <Segmented
              value={list}
              onChange={(v: List) => {
                setList(v);
                setPicked(new Set());
                setShowAll(false);
              }}
              options={[
                ["review", `To look at ${lists.review.length}`],
                ["pending", `Not reviewed ${lists.pending.length}`],
                ["skipped", `Skipped by AI ${lists.skipped.length}`],
              ]}
            />
            <div className="flex-1" />
            {lists.pending.length > 0 && (
              <Button size="sm" variant="brass" icon={<Sparkles className="size-3.5" />} loading={reviewing} onClick={() => review()}>
                Review {lists.pending.length} with AI
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle px-4 py-2 text-[12.5px]">
            <Checkbox checked={chosen.length === shown.length && shown.length > 0} onChange={(on) => setPicked(new Set(on ? shown.map((f) => f.key) : []))} label="Select all shown" />
            <span className="text-muted">{chosen.length ? `${chosen.length} selected` : `${current.length} here`}</span>
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
                    {(() => {
                      const v = verdictOf(f);
                      return v ? (
                        <Badge tone={VERDICT_TONE[v.verdict]} className="px-1.5 py-0 text-[10.5px]">
                          {v.roleLabel}
                          {f.review!.classYears.length ? ` · class of ${f.review!.classYears.join("/")}` : " · year unclear"}
                        </Badge>
                      ) : null;
                    })()}
                  </div>
                  {f.review && <p className="mt-0.5 text-[12px] text-ink-2">{verdictOf(f)?.why}</p>}
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
                  <Button size="sm" variant="brass" onClick={() => (list === "skipped" ? overrule(f) : track([f]))}>
                    {list === "skipped" ? "Should apply" : "Track"}
                  </Button>
                  <button className="rounded p-1 text-muted hover:bg-hover hover:text-ink" title="Not interested" aria-label="Not interested" onClick={() => dismiss([f.key])}>
                    <X className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {current.length > shown.length && (
            <button className="w-full border-t border-line px-4 py-2 text-[12.5px] font-medium text-navy hover:bg-subtle" onClick={() => setShowAll(true)}>
              Show all {current.length}
            </button>
          )}
        </>
      )}
      <WhyModal ask={ask} onClose={() => setAsk(null)} />
    </Card>
  );
}

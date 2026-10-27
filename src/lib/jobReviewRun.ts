/**
 * Runs the AI job review in the browser (lib/jobReview.ts has the pure rules): finds without a review are sent to
 * api/jobs/review a few at a time, the reviews are stored on the finds (synced like every found job, so a job is
 * never sent to the AI twice), and every "apply" verdict is added to the tracker under "Added by AI".
 */
import { useStore } from "./store";
import { callApi } from "./api";
import { aiReady } from "./keys";
import { canonBank } from "./banks";
import { freshJobs, type FoundJob } from "./jobFinder";
import { judge, quickReview, resumeFor, reviewText, rulesOf, runSummary, type JobReview, type ReviewRules } from "./jobReview";
import type { JobApplication } from "./apply";
import { assignJobRows } from "./jobSheet";
import { uid } from "./util";
import { toast } from "@/components/ui";

const BATCH = 6;

export function currentRules(): ReviewRules {
  const a = useStore.getState().apply;
  return rulesOf(a.finder.rules, a.profile.gradDate);
}

type Wire = Omit<JobReview, "at" | "version"> & { key: string };

let running: Promise<{ reviewed: number; added: number } | null> | null = null;

/**
 * Review every find that has no review yet (or, with `recheck`, one made under older rules; quick skips stay).
 * Single-flight: a second call while one runs waits for it, then picks up anything that arrived meanwhile.
 */
export function reviewPending(opts: { recheck?: boolean; quiet?: boolean } = {}): Promise<{ reviewed: number; added: number } | null> {
  const next = (running ?? Promise.resolve(null)).then(() => run(opts));
  running = next.finally(() => {
    if (running === next) running = null;
  });
  return next;
}

async function run({ recheck, quiet }: { recheck?: boolean; quiet?: boolean }) {
  const st = useStore.getState();
  const rules = currentRules();
  const at = new Date().toISOString();
  const pending = st.apply.finder.found.filter((f) => !f.review || (recheck && !f.review.quick && f.review.version < rules.version));
  if (!pending.length) return { reviewed: 0, added: autoAdd(quiet) };

  // Obvious skips cost no AI call.
  const quick = new Map<string, JobReview>();
  for (const f of pending) {
    const q = quickReview(f, rules.version, at);
    if (q) quick.set(f.key, q);
  }
  if (quick.size) store(quick);
  const toAi = pending.filter((f) => !quick.has(f.key));
  if (toAi.length && !aiReady(st.settings)) {
    if (!quiet) toast.info(`${toAi.length} job${toAi.length === 1 ? "" : "s"} waiting for the AI review: add an AI key in Settings → Data. Nothing is added until they're reviewed.`);
    return { reviewed: quick.size, added: autoAdd(quiet) };
  }
  let reviewed = quick.size;
  for (let i = 0; i < toAi.length; i += BATCH) {
    const batch = toAi.slice(i, i + BATCH);
    try {
      const r = await callApi<{ jobs: Wire[] }>(
        "/api/jobs/review",
        {
          jobs: batch.map((f) => ({
            key: f.key,
            company: f.company.slice(0, 200),
            title: f.title.slice(0, 300),
            location: f.location?.slice(0, 200),
            text: reviewText(f),
          })),
          roleTypes: rules.roleTypes.map((t) => ({
            id: t.id,
            label: t.label,
            covers: t.covers,
          })),
          classYears: rules.classYears,
          rules: rules.rules.slice(-40),
        },
        useStore.getState().settings,
      );
      const got = new Map(r.jobs.map((j) => [j.key, { ...j, at, version: rules.version } as JobReview & { key?: string }]));
      for (const v of got.values()) delete v.key;
      store(got);
      reviewed += got.size;
    } catch (e) {
      // Out of AI for now: the rest stay "not reviewed yet" and are picked up next time (no re-reading).
      if (!quiet) toast.err(`AI job review stopped: ${(e as Error).message}`);
      break;
    }
  }
  return { reviewed, added: autoAdd(quiet) };
}

function store(reviews: Map<string, JobReview>) {
  useStore.getState().setApply((a) => ({
    ...a,
    finder: {
      ...a.finder,
      found: a.finder.found.map((f) => (reviews.has(f.key) ? { ...f, review: reviews.get(f.key) } : f)),
    },
  }));
}

/** Every reviewed "apply" find that isn't tracked or dismissed yet goes onto the tracker under "Added by AI". */
export function autoAdd(quiet?: boolean): number {
  const st = useStore.getState();
  const rules = currentRules();
  const fresh = freshJobs(st.apply.finder.found, st.apply.jobs, st.apply.finder.dismissed);
  const add = fresh.filter((f) => f.review && judge(f.review, rules, f.location).verdict === "apply");
  if (!add.length) return 0;
  const now = new Date().toISOString();
  const jobs: JobApplication[] = add.map((f) =>
    trackedFrom(f, now, {
      addedBy: "ai",
      resumeId: resumeFor(f.review, st.apply.resumes),
    }),
  );
  st.setApply((a) => ({ ...a, jobs: [...jobs, ...a.jobs] }));
  if (!quiet) toast.ok(`AI added ${add.length} job${add.length === 1 ? "" : "s"} to Applications → Added by AI.`);
  return add.length;
}

/** A tracked job made from a find. */
export function trackedFrom(f: FoundJob, now: string, extra: Partial<JobApplication> = {}): JobApplication {
  return {
    id: uid("job"),
    company: f.company,
    role: f.title,
    url: f.url,
    applyUrl: f.applyUrl,
    linkedinJobId: f.linkedinJobId,
    handshakeJobId: f.handshakeJobId,
    description: f.description,
    location: f.location,
    review: f.review,
    status: "saved",
    createdAt: now,
    ...extra,
  };
}

/** A lesson from Keep / Remove / overrule: added to your review rules (bumps the version, so older reviews can be re-checked). */
export function addReviewRule(text: string) {
  const t = text.trim().replace(/\s+/g, " ").slice(0, 300);
  if (!t) return;
  useStore.getState().setApply((a) => {
    const rules = rulesOf(a.finder.rules, a.profile.gradDate);
    return {
      ...a,
      finder: {
        ...a.finder,
        rules: {
          ...rules,
          rules: [...rules.rules, t].slice(-40),
          version: rules.version + 1,
        },
      },
    };
  });
}

/** After a run: "Read 30 · 7 added · 9 maybe · 14 skipped" over the finds from this run. */
export function summarize(keys: string[], added: number): string {
  const st = useStore.getState();
  const rules = currentRules();
  const set = new Set(keys);
  let maybe = 0;
  let skipped = 0;
  for (const f of st.apply.finder.found) {
    if (!set.has(f.key) || !f.review) continue;
    const v = judge(f.review, rules, f.location).verdict;
    if (v === "maybe") maybe++;
    if (v === "skip") skipped++;
  }
  return runSummary({ read: keys.length, added, maybe, skipped });
}

/** Firms you know (lists + contacts), for ordering by firm rank. */
export function knownFirms(): Set<string> {
  const st = useStore.getState();
  return new Set([...st.targets.map((t) => t.name), ...st.coverage.added.map((t) => t.name), ...st.contacts.map((c) => c.bank)].filter(Boolean).map(canonBank));
}

/** Give every My list job a row on the workbook's applications tab (once; kept after). Written on the next Save. */
export function assignSheetRows() {
  const st = useStore.getState();
  if (!st.snapshots.length || !st.apply.jobs.some((j) => j.addedBy !== "ai" && !j.sheetRef)) return;
  const rows = assignJobRows(st.apply.jobs, st.snapshots);
  if (rows.size)
    st.setApply((a) => ({
      ...a,
      jobs: a.jobs.map((j) => (rows.has(j.id) && !j.sheetRef ? { ...j, sheetRef: rows.get(j.id) } : j)),
    }));
}

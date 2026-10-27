"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { blobs, useStore } from "./store";
import { callApi } from "./api";
import { aiReady } from "./keys";
import { FILL_LABELS, knownJobSite, planFill, sameJobSite, type ApplyState, type FillItem, type FillStatus, type FormField, type JobApplication } from "./apply";
import { jobKey, type FoundJob } from "./jobFinder";
import { toast } from "@/components/ui";
import { documentText } from "./fileText";
import { reviewPending, summarize } from "./jobReviewRun";

/**
 * The dashboard's half of the extension bridge (extension/content/dashboard.js is the other half).
 *
 * The extension's content script runs on the dashboard's own pages only. It relays two requests from the extension
 * as window messages, and this answers them:
 *   plan      { url, title, pageText, fields } → what to type in each field (decided here from your saved info,
 *             plus AI answers for open questions) and your resume file for upload fields.
 *   submitted { url } → marks the job as submitted.
 *   fillStatus { jobId, status, note, needs } → how a "Fill selected" job is going (1.3).
 *   foundJob / finderStatus → the opt-in LinkedIn / Handshake job readers' finds and progress (test build); each
 *             find is reviewed by the AI (lib/jobReviewRun.ts) and "apply" ones are added to the tracker.
 *   vault { op: get | put } → the extension's PIN-encrypted saved logins, synced through the account.
 * And it sends the extension commands (`sendCommand`): fillJobs, focusJob, linkedinJobs, handshakeJobs. The extension's worker
 * checks they come from the dashboard address set in its Options.
 * Your application info never leaves this page except as the values for the fields the extension scanned. The job
 * page itself has no way to reach this: only the extension's content script on THIS origin posts here.
 */

const CHANNEL = "coverage-ext";
const MAX_FIELDS = 250;
/** "Autofill" on a job counts for the next fill on that site within this long. */
const ACTIVE_FOR = 6 * 60 * 60 * 1000;
/** …and for a fill on ANY site within this long (a LinkedIn listing sends you on to the bank's own site). */
const JUST_CLICKED = 30 * 60 * 1000;

export interface ExtensionFeatures {
  fillJobs?: boolean;
  linkedinJobs?: boolean;
  handshakeJobs?: boolean;
}

export const useExtension = create<{ version?: string; features: ExtensionFeatures; setVersion: (v: string, f: ExtensionFeatures) => void }>((set) => ({
  features: {},
  setVersion: (version, features) => set({ version, features }),
}));

/** Progress of the LinkedIn job search (session only). */
export const useFinderStatus = create<{ text?: string; running: boolean; set: (text: string, running: boolean) => void }>((set) => ({
  running: false,
  set: (text, running) => set({ text, running }),
}));

let cmdSeq = 0;
/** Ask the extension to do something (only these commands exist; see extension/content/dashboard.js). */
export function sendCommand<T = unknown>(type: "fillJobs" | "focusJob" | "linkedinJobs" | "handshakeJobs", payload: unknown): Promise<T> {
  const id = `cmd${Date.now()}_${cmdSeq++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error("The Coverage extension didn't answer. Is version 1.3 installed and on?"));
    }, 15_000);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const m = e.data as { channel?: string; kind?: string; id?: string; ok?: boolean; result?: T; error?: string };
      if (m?.channel !== CHANNEL || m.kind !== "commandResult" || m.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      if (m.ok) resolve(m.result as T);
      else reject(new Error(m.error || "The extension couldn't do that."));
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ channel: CHANNEL, kind: "command", id, type, payload }, window.location.origin);
  });
}

type Req = { channel: typeof CHANNEL; kind: "request"; id: string; type: string; payload: unknown };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** The scanned form is untrusted (it comes from a third-party page): rebuild it field by field, with caps. */
function cleanFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return [];
  const kinds = new Set(["text", "email", "tel", "url", "number", "date", "month", "textarea", "select", "radio", "checkbox", "checkboxes", "file", "listbox", "typeahead"]);
  return raw.slice(0, MAX_FIELDS).flatMap((f): FormField[] => {
    if (!f || typeof f !== "object") return [];
    const o = f as Record<string, unknown>;
    const id = str(o.id, 40);
    const kind = str(o.kind, 20) as FormField["kind"];
    if (!/^cf\d+$/.test(id) || !kinds.has(kind)) return [];
    const options = Array.isArray(o.options)
      ? o.options.slice(0, 200).flatMap((x) => (x && typeof x === "object" ? [{ value: str((x as Record<string, unknown>).value, 300), label: str((x as Record<string, unknown>).label, 300) }] : []))
      : undefined;
    return [
      {
        id,
        kind,
        label: str(o.label, 600),
        required: o.required === true,
        options,
        maxLength: typeof o.maxLength === "number" && o.maxLength > 0 ? Math.min(o.maxLength, 20000) : undefined,
        placeholder: str(o.placeholder, 200) || undefined,
        filled: o.filled === true,
        accept: str(o.accept, 200) || undefined,
      },
    ];
  });
}

function base64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * The job this page belongs to: the one you clicked Autofill on (same site and recent, or any site within the last
 * half hour: a LinkedIn listing hands you on to the bank's site), else any job on that site.
 */
function jobFor(url: string): JobApplication | undefined {
  const { jobs, activeJob } = useStore.getState().apply;
  const age = activeJob ? Date.now() - Date.parse(activeJob.at) : Infinity;
  const active = age < ACTIVE_FOR ? jobs.find((j) => j.id === activeJob!.id) : undefined;
  const onSite = (j: JobApplication) => [j.url, j.applyUrl].some((u) => !!u && sameJobSite(u, url));
  if (active && (onSite(active) || age < JUST_CLICKED)) return active;
  return jobs.find((j) => [j.url, j.applyUrl].some((u) => !!u && url.startsWith(u))) ?? jobs.find((j) => onSite(j) && j.status !== "submitted");
}

async function resumeFile(job?: JobApplication) {
  const r = (job?.resumeId && (await blobs.appResume(job.resumeId))) || (await blobs.resume());
  if (!r) return undefined;
  // Its text is the AI's main source of facts for open questions (read here, in the browser; never stored).
  const text = await documentText(r.name, r.data).catch(() => "");
  return { name: r.name, type: r.type || "application/pdf", base64: base64(r.data), text: text.slice(0, 15000) };
}

export interface PlanResult {
  job?: { id: string; company: string; role: string };
  items: (FillItem & { fileData?: { name: string; type: string; base64: string } })[];
  skipped: { id: string; label: string; why: string }[];
  ai: { asked: number; error?: string };
}

async function plan(payload: unknown): Promise<PlanResult> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const url = str(p.url, 2000);
  const fields = cleanFields(p.fields);
  if (!fields.length) throw new Error("No form fields found on this page.");
  const st = useStore.getState();
  // A batch fill names its job; otherwise it's the one you clicked Autofill on / on this site.
  const named = typeof p.jobId === "string" ? st.apply.jobs.find((j) => j.id === p.jobId) : undefined;
  const job = named ?? jobFor(url);
  // A site that's neither a tracked job nor a known application system gets nothing until you confirm it in the popup.
  if (!job && !knownJobSite(url) && p.confirmed !== true) {
    let host = "this site";
    try {
      host = new URL(url).hostname;
    } catch {}
    throw new Error(`UNKNOWN_SITE:${host}`);
  }
  const file = await resumeFile(job);
  const base = planFill(fields, st.apply.profile, { hasResume: !!file });
  const fileData = file && { name: file.name, type: file.type, base64: file.base64 };
  const items: PlanResult["items"] = base.items.map((it) => (it.file === "resume" && fileData ? { ...it, fileData } : it));
  const skipped = [...base.skipped];
  const result: PlanResult = { job: job && { id: job.id, company: job.company, role: job.role }, items, skipped, ai: { asked: base.ai.length } };

  if (base.ai.length) {
    if (!aiReady(st.settings)) {
      for (const f of base.ai) skipped.push({ id: f.id, label: f.label, why: "Open question: add an AI key (Settings → Data) to have it drafted, or answer it yourself." });
      result.ai.error = "No AI key";
    } else {
      const pr = st.apply.profile;
      try {
        const r = await callApi<{ answers: { id: string; answer: string; needsYou: boolean; note: string }[] }>(
          "/api/apply/answer",
          {
            job: { company: job?.company ?? "", role: job?.role ?? str(p.title, 200), pageText: (str(p.pageText, 8000) || job?.description?.slice(0, 8000)) || undefined },
            questions: base.ai.map((f) => ({ id: f.id, label: f.label, kind: f.kind, options: f.options, maxLength: f.maxLength })),
            me: {
              name: [pr.firstName, pr.lastName].filter(Boolean).join(" ") || st.settings.profile.name,
              school: pr.school || st.settings.profile.school,
              major: pr.major || st.settings.profile.major,
              degree: pr.degree,
              gradDate: pr.gradDate,
              background: pr.background.slice(0, 12000),
              resume: file?.text || undefined,
              interests: pr.interests.slice(0, 4000),
              styleNotes: pr.styleNotes.slice(0, 2000),
            },
            samples: st.apply.samples.slice(0, 8).map((s) => ({ title: s.title.slice(0, 200), text: s.text.slice(0, 6000) })),
            library: st.apply.library.slice(0, 30).map((x) => ({ q: x.q.slice(0, 600), a: x.a.slice(0, 4000) })),
          },
          st.settings,
        );
        const byId = new Map(base.ai.map((f) => [f.id, f]));
        for (const a of r.answers) {
          const f = byId.get(a.id);
          if (!f) continue;
          byId.delete(a.id);
          if (!a.answer) skipped.push({ id: f.id, label: f.label, why: a.note || "The AI didn't have the facts for this one." });
          else items.push({ id: f.id, value: a.answer, source: "ai", label: f.label, note: a.needsYou ? a.note || "Check this one." : a.note || "AI draft: read it before you submit." });
        }
        for (const f of byId.values()) skipped.push({ id: f.id, label: f.label, why: "The AI skipped it." });
      } catch (e) {
        result.ai.error = (e as Error).message;
        for (const f of base.ai) skipped.push({ id: f.id, label: f.label, why: `AI answer failed (${(e as Error).message}).` });
      }
    }
  }

  if (job) {
    const at = new Date().toISOString();
    const written = items.filter((i) => i.source === "ai" && i.value).map((i) => ({ question: i.label, answer: i.value!, at }));
    st.setApply((a) => ({
      ...a,
      jobs: a.jobs.map((j) =>
        j.id === job.id
          ? {
              ...j,
              status: j.status === "saved" ? "applying" : j.status,
              lastFilledAt: at,
              answers: [...(j.answers ?? []), ...written].slice(-60),
              // Remember where the form really is (the tracked link was a listing on another site).
              applyUrl: j.applyUrl || (!sameJobSite(j.url, url) ? url : undefined),
            }
          : j,
      ),
    }));
  }
  if (p.batch !== true) toast.info(`Autofill: ${items.length} field${items.length === 1 ? "" : "s"} filled${job ? ` for ${job.company}` : ""}, ${skipped.length} left for you. Review before you submit.`);
  return result;
}

function submitted(payload: unknown) {
  const url = str((payload as Record<string, unknown> | null)?.url, 2000);
  const job = jobFor(url);
  if (!job) return { ok: false };
  const at = new Date().toISOString();
  useStore.getState().setApply((a) => ({ ...a, jobs: a.jobs.map((j) => (j.id === job.id ? { ...j, status: "submitted", submittedAt: at } : j)) }));
  toast.ok(`Marked ${job.company}${job.role ? ` · ${job.role}` : ""} as submitted.`);
  return { ok: true, company: job.company };
}

const FILL_STATUSES = new Set<FillStatus>(["queued", "filling", "ready", "needs_you", "signin", "account", "access", "error", "stopped"]);

function fillStatus(payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>;
  const jobId = str(p.jobId, 60);
  const status = str(p.status, 20) as FillStatus;
  if (!FILL_STATUSES.has(status)) return { ok: false };
  const needs = Array.isArray(p.needs) ? p.needs.slice(0, 10).map((x) => str(x, 200)).filter(Boolean) : undefined;
  const st = useStore.getState();
  const job = st.apply.jobs.find((j) => j.id === jobId);
  if (!job) return { ok: false };
  st.setApply((a) => ({
    ...a,
    jobs: a.jobs.map((j) =>
      j.id === jobId
        ? { ...j, fill: { status, note: str(p.note, 300) || undefined, needs, at: new Date().toISOString() }, ...(status === "ready" || status === "needs_you" ? { status: j.status === "saved" ? "applying" : j.status, lastFilledAt: new Date().toISOString() } : {}) }
        : j,
    ),
  }));
  if (status === "ready") toast.ok(`${job.company}: filled up to review. Check it and submit it yourself.`);
  if (DONE.has(status)) void batchDone();
  if (status === "signin" || status === "account") toast.info(`${job.company}: ${str(p.note, 200)}`);
  return { ok: true };
}

/** Finds of the current LinkedIn / Handshake run (for the end-of-run summary). */
let runKeys: string[] = [];
let reviewTimer: ReturnType<typeof setTimeout> | undefined;

/** A job the LinkedIn / Handshake reader read (untrusted: it comes from a web page). Added to finds, then reviewed. */
function foundJob(payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>;
  const site = p.site === "handshake" ? "handshake" : "linkedin";
  const id = str(site === "handshake" ? p.handshakeJobId : p.linkedinJobId, 20);
  if (!/^\d{3,15}$/.test(id)) return { ok: false };
  const url = site === "handshake" ? `https://app.joinhandshake.com/jobs/${id}` : `https://www.linkedin.com/jobs/view/${id}/`;
  const apply = str(p.applyUrl, 1000);
  const job: FoundJob = {
    key: jobKey(url),
    company: str(p.company, 120) || "Unknown company",
    title: str(p.title, 200),
    url,
    location: str(p.location, 120) || undefined,
    source: site,
    description: str(p.description, 6000) || undefined,
    applyUrl: /^https:\/\//.test(apply) && !/^https:\/\/([a-z0-9-]+\.)*(linkedin|joinhandshake)\.com\//i.test(apply) ? apply : undefined,
    ...(site === "handshake" ? { handshakeJobId: id } : { linkedinJobId: id }),
    posted: str(p.posted, 60) || undefined,
    foundAt: new Date().toISOString(),
  };
  useStore.getState().setApply((a) => {
    const prev = a.finder.found.find((f) => f.key === job.key);
    // A stored review is kept: the same job is never sent to the AI twice.
    const merged = prev ? { ...job, review: prev.review, foundAt: prev.foundAt } : job;
    return { ...a, finder: { ...a.finder, found: [merged, ...a.finder.found.filter((f) => f.key !== job.key)].slice(0, 400) } };
  });
  runKeys.push(job.key);
  // Review as jobs arrive, a few at a time.
  clearTimeout(reviewTimer);
  reviewTimer = setTimeout(() => void reviewPending({ quiet: true }), 8000);
  return { ok: true };
}

function finderStatus(payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>;
  const text = str(p.text, 300);
  useFinderStatus.getState().set(text, p.done !== true);
  if (p.done === true) {
    const keys = [...new Set(runKeys)];
    runKeys = [];
    clearTimeout(reviewTimer);
    if (text) toast.info(text);
    if (keys.length)
      void reviewPending({ quiet: true }).then((r) => {
        const line = summarize(keys, r?.added ?? 0);
        useFinderStatus.getState().set(`${text} ${line}.`, false);
        toast.ok(line);
      });
  }
  return { ok: true };
}

const DONE = new Set<FillStatus>(["ready", "needs_you", "signin", "account", "access", "error", "stopped"]);

/**
 * Mass apply: once every job of the last Fill selected run has finished, one WhatsApp text says how many are ready to
 * review and submit and what the rest need (owner, 2026-10-25). Needs the WhatsApp connection (Follow-ups → Reminders).
 */
async function batchDone() {
  const st = useStore.getState();
  const b = st.apply.batch;
  if (!b || b.texted) return;
  const jobs = b.ids.map((id) => st.apply.jobs.find((j) => j.id === id)).filter((j): j is JobApplication => !!j);
  if (!jobs.length || jobs.some((j) => !j.fill || !DONE.has(j.fill.status) || j.fill.at < b.at)) return;
  st.setApply((a) => ({ ...a, batch: a.batch && { ...a.batch, texted: true } }));
  const ready = jobs.filter((j) => j.fill!.status === "ready");
  const rest = jobs.filter((j) => j.fill!.status !== "ready");
  const lines = [
    `*Applications filled* (${jobs.length})`,
    `${ready.length} ready to review and submit${rest.length ? ` · ${rest.length} need you` : ""}.`,
    ...rest.slice(0, 12).map((j) => `• ${j.company}: ${FILL_LABELS[j.fill!.status]}${j.fill!.note ? ` (${j.fill!.note.slice(0, 90)})` : ""}`),
    `Review them: ${window.location.origin}/applications`,
  ];
  toast.ok(`All ${jobs.length} applications filled: ${ready.length} ready to review.`);
  const k = st.settings.keys;
  if (!k.whatsappPhone || !k.whatsappApiKey) return;
  try {
    await callApi("/api/notify", { channel: "whatsapp", title: "Applications filled", message: lines.join("\n"), whatsapp: { phone: k.whatsappPhone, apiKey: k.whatsappApiKey } }, st.settings);
  } catch (e) {
    toast.err(`Couldn't text you the summary: ${(e as Error).message}`);
  }
}

/**
 * The extension's saved logins, synced through the account (owner, 2026-10-25): only the PIN-encrypted vault
 * ({v, salt, iv, data}) is kept, in `apply.vault`; the PIN never leaves the extension, so neither this page nor the
 * server can read a login. The newer copy (`at`) wins on both sides.
 */
function vault(payload: unknown) {
  const p = (payload ?? {}) as { op?: string; blob?: unknown; at?: unknown };
  if (p.op === "get") return useStore.getState().apply.vault ?? null;
  if (p.op !== "put" || typeof p.at !== "string" || !/^\d{4}-\d\d-\d\dT/.test(p.at)) return { ok: false };
  const b = p.blob as Record<string, unknown> | null;
  const ok = b === null || (b && b.v === 1 && ["salt", "iv", "data"].every((k) => typeof b[k] === "string" && (b[k] as string).length < 400_000));
  if (!ok) return { ok: false };
  useStore.getState().setApply((a) => ({ ...a, vault: { blob: b as NonNullable<ApplyState["vault"]>["blob"], at: p.at as string } }));
  return { ok: true };
}

const HANDLERS: Record<string, (payload: unknown) => unknown> = { plan, submitted, fillStatus, foundJob, finderStatus, vault };

/** Mounted once in Shell: answers the extension, and learns whether it's installed (for the Applications page). */
export function useExtensionBridge(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const reply = (id: string, body: { ok: boolean; result?: unknown; error?: string }) =>
      window.postMessage({ channel: CHANNEL, kind: "response", id, ...body }, window.location.origin);
    const onMessage = async (e: MessageEvent) => {
      // Only messages from this same page (the content script shares the page's window), never from frames or popups.
      if (e.source !== window || e.origin !== window.location.origin) return;
      const m = e.data as Partial<Omit<Req, "kind">> & { kind?: string; version?: string; features?: ExtensionFeatures };
      if (!m || m.channel !== CHANNEL) return;
      if (m.kind === "hello" && typeof m.version === "string")
        useExtension.getState().setVersion(m.version.slice(0, 20), { fillJobs: m.features?.fillJobs === true, linkedinJobs: m.features?.linkedinJobs === true, handshakeJobs: m.features?.handshakeJobs === true });
      if (m.kind !== "request" || typeof m.id !== "string" || typeof m.type !== "string") return;
      const handler = HANDLERS[m.type];
      if (!handler) return reply(m.id, { ok: false, error: "Unknown request." });
      try {
        reply(m.id, { ok: true, result: await handler(m.payload) });
      } catch (err) {
        reply(m.id, { ok: false, error: (err as Error).message });
      }
    };
    window.addEventListener("message", onMessage);
    // Ask the content script (if the extension is installed) to say hello.
    window.postMessage({ channel: CHANNEL, kind: "ping" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, [ready]);
}

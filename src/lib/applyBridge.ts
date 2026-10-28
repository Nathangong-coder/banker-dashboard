"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { blobs, useStore } from "./store";
import { callApi } from "./api";
import { aiReady, googleClientId, hasKey } from "./keys";
import { gmailReadableQuietly, verificationLink } from "./gmail";
import { FILL_LABELS, NEVER_FILL, NEVER_LEARN, chooseResume, gradFor, learnKey, platformOf, knownJobSite, type FillRun, planFill, sameJobSite, type ApplyState, type FillItem, type FillStatus, type FormField, type JobApplication } from "./apply";
import { jobKey, type FoundJob } from "./jobFinder";
import { toast } from "@/components/ui";
import { uid } from "./util";
import { documentText } from "./fileText";
import { reviewPending, summarize } from "./jobReviewRun";
import { coverLetterFrom, letterPdf, templateFirm } from "./coverLetter";
import { STARTER_TARGETS } from "./banks";
import { openSummary } from "./opens";
import { prepareTracking } from "./trackingActions";

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
 *   agentBrief { jobId, url } → the facts the extension's AI agent may use to finish an application (1.5).
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

export const useExtension = create<{
  version?: string;
  features: ExtensionFeatures;
  /** The extension was reloaded / updated after this tab opened: its bridge here is dead until the tab reloads. */
  stale?: boolean;
  setVersion: (v: string, f: ExtensionFeatures) => void;
}>((set) => ({
  features: {},
  setVersion: (version, features) => set({ version, features, stale: false }),
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
      reject(new Error("The Coverage extension didn't answer. If you just installed, updated or reloaded it, reload this tab (Ctrl+R); otherwise check it's turned on in chrome://extensions."));
    }, 15_000);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const m = e.data as { channel?: string; kind?: string; id?: string; ok?: boolean; result?: T; error?: string };
      if (m?.channel !== CHANNEL || m.kind !== "commandResult" || m.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      if (m.ok) resolve(m.result as T);
      else if (m.error === "STALE") reject(new Error("The extension was updated or reloaded after this tab opened. Reload this tab (Ctrl+R) and try again."));
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
  return jobs.find((j) => [j.url, j.applyUrl].some((u) => !!u && url.startsWith(u))) ?? jobs.find((j) => onSite(j) && j.status !== "submitted" && j.status !== "confirmed");
}

async function resumeFile(job?: JobApplication, pageText = "") {
  const me = useStore.getState().apply.profile;
  const gradAs = job?.gradAs ?? me.gradDate;
  const pick = chooseResume(job, pageText, useStore.getState().apply.resumes, Number(gradAs.slice(0, 4)) || undefined, Number(me.gradDate.slice(0, 4)) || undefined);
  const r = (pick && (await blobs.appResume(pick))) || (await blobs.resume());
  if (!r) return undefined;
  // Its text is the AI's main source of facts for open questions (read here, in the browser; never stored).
  const text = await documentText(r.name, r.data).catch(() => "");
  return { name: r.name, type: r.type || "application/pdf", base64: base64(r.data), text: text.slice(0, 15000) };
}

/**
 * The cover letter for this job: made once, saved on the job (Applications → the job's row → Cover letter), reused on
 * every page. Your template (latest Writing sample marked "Cover letter") dated today with this firm's name; with an
 * AI model, also tailored to the posting (api/apply/cover: firm / role specifics rewritten from the job description,
 * every fact about you kept; checked server-side, else the plain swap).
 */
async function coverFor(job: JobApplication | undefined, pageText: string): Promise<string | undefined> {
  const st = useStore.getState();
  if (job?.coverLetter?.text) return job.coverLetter.text;
  const tpl = [...st.apply.samples].reverse().find((x) => x.kind === "cover_letter");
  if (!tpl?.text.trim() || !job?.company) return undefined;
  const known = [...STARTER_TARGETS.map((t) => t.name), ...st.targets.map((t) => t.name), ...st.coverage.added.map((t) => t.name), ...st.contacts.map((c) => c.bank), ...st.apply.jobs.map((j) => j.company)].filter(Boolean);
  const today = new Date();
  let text = coverLetterFrom(tpl.text, job.company, today, known);
  let tailored = false;
  if (aiReady(st.settings)) {
    try {
      const r = await callApi<{ letter: string | null }>(
        "/api/apply/cover",
        {
          template: tpl.text.slice(0, 8000),
          oldFirm: templateFirm(tpl.text, known),
          company: job.company,
          role: job.role,
          description: (job.description || pageText).slice(0, 8000),
          today: today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        },
        st.settings,
      );
      if (r.letter) {
        text = r.letter;
        tailored = true;
      }
    } catch {
      // The plain name + date swap stands.
    }
  }
  st.setApply((a) => ({ ...a, jobs: a.jobs.map((j) => (j.id === job.id ? { ...j, coverLetter: { text, at: new Date().toISOString(), tailored } } : j)) }));
  return text;
}

/** The letter as a PDF named like a file you'd upload ("Nathan Gong Cover Letter - RCLCO.pdf"). */
export function coverPdf(text: string, me: { firstName: string; lastName: string }, company?: string) {
  const bytes = letterPdf(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const firm = (company ?? "").replace(/[^\w &.-]+/g, "").trim().slice(0, 60);
  return { name: `${[me.firstName, me.lastName].filter(Boolean).join(" ") || "Cover"} Cover Letter${firm ? ` - ${firm}` : ""}.pdf`, type: "application/pdf", base64: btoa(bin) };
}

/**
 * The facts Jev picks option answers from: education, work authorization, how you heard, background, resume (short).
 * Never demographics / EEO (rules handle those or leave them for you).
 */
function jevFacts(job: JobApplication | undefined, resume?: string): string {
  const me = useStore.getState().apply.profile;
  const yn = (v: string) => (v === "yes" ? "yes" : v === "no" ? "no" : "not said");
  return [
    job && `Applying to: ${job.company}${job.role ? `, ${job.role}` : ""}${job.location ? ` (${job.location})` : ""}`,
    `Name: ${me.firstName} ${me.lastName}`,
    `School: ${me.school}; degree: ${me.degree}; major: ${me.major}; graduation (YYYY-MM): ${me.gradDate}${me.gpa ? `; GPA ${me.gpa}` : ""}`,
    `Lives in: ${[me.city, me.state, me.country].filter(Boolean).join(", ")}`,
    `Authorized to work in the US: ${yn(me.authorized)}; needs sponsorship now: ${yn(me.sponsorNow)}; later: ${yn(me.sponsorFuture)}; 18 or older: ${yn(me.over18)}; willing to relocate: ${yn(me.relocate)}`,
    me.howHeard && `Heard about the job via: ${me.howHeard}`,
    me.background && `Background: ${me.background.slice(0, 2000)}`,
    resume && `Resume: ${resume.replace(/\s+/g, " ").slice(0, 3000)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The extension agent couldn't find its wording in a dropdown: Jev picks from the options the dropdown actually shows
 * (the multi-step chain the owner asked for, 2026-10-26: the page says it's a dropdown, the agent says what it wants,
 * Jev picks the option). Returns the option text, or null when Jev isn't set up or isn't sure.
 */
async function pickOption(payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>;
  const st = useStore.getState();
  if (!hasKey(st.settings, "jev")) return null;
  const options = (Array.isArray(p.options) ? p.options : []).slice(0, 100).map((o) => str(o, 200)).filter(Boolean);
  if (options.length < 2) return null;
  const job = st.apply.jobs.find((j) => j.id === str(p.jobId, 60));
  const want = str(p.want, 200);
  const r = await callApi<{ picks: { label: string; confidence: number }[] }>(
    "/api/apply/choose",
    { facts: `${jevFacts(job)}${want ? `\nThe assistant filling the form wants to answer: "${want}"` : ""}`, questions: [{ id: "q", label: str(p.label, 600) || "Choose the right option", options: options.map((o) => ({ value: o, label: o })) }] },
    st.settings,
  ).catch(() => null);
  const pick = r?.picks[0];
  return pick && pick.confidence >= 0.5 ? pick.label : null;
}

/** Your email and name for a site's create-account form (extension 1.10, "Create accounts for me"). */
function accountInfo() {
  const st = useStore.getState();
  const me = st.apply.profile;
  return { email: me.email || st.settings.profile.email || "", firstName: me.firstName, lastName: me.lastName };
}

/** The extension created an account: listed under Applications → My info (the password stays in the PIN vault). */
function accountCreated(payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>;
  let origin = "";
  try {
    origin = new URL(str(p.origin, 300)).origin;
  } catch {
    return { ok: false };
  }
  const email = str(p.email, 200);
  const st = useStore.getState();
  const job = st.apply.jobs.find((j) => j.id === str(p.jobId, 60));
  st.setApply((a) => ({
    ...a,
    accounts: [...(a.accounts ?? []).filter((x) => !(x.origin === origin && x.email === email)), { origin, email, at: new Date().toISOString(), company: job?.company, jobId: job?.id }].slice(-200),
  }));
  toast.ok(`Created an account on ${new URL(origin).hostname}${job ? ` for ${job.company}` : ""}. Its password is in your saved logins.`);
  return { ok: true };
}

/**
 * The site emailed a verification link: look for it in Gmail (only without a popup: a Gmail token in this tab or the
 * connected Google account), every 15 s for up to ~2 minutes. Only an https link on that same site comes back.
 */
async function verifyLink(payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>;
  let host = "";
  try {
    host = new URL(str(p.url, 2000)).hostname;
  } catch {
    return null;
  }
  const st = useStore.getState();
  const clientId = googleClientId(st.settings);
  if (!(await gmailReadableQuietly(clientId))) return null;
  const since = Number(p.since) || Date.now() - 10 * 60_000;
  for (let i = 0; i < 8; i++) {
    const link = await verificationLink(clientId, host, since).catch(() => null);
    if (link) {
      st.setApply((a) => ({ ...a, accounts: (a.accounts ?? []).map((x) => (new URL(x.origin).hostname === host && !x.verified ? { ...x, verified: new Date().toISOString() } : x)) }));
      return link;
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  return null;
}

/**
 * Your saved details Jev may map an unplaced text field to: name → { what it is (sent), value (never sent) }.
 * Not demographics, work authorization or anything sensitive (those stay with the fixed rules).
 */
function factMenu(me: ApplyState["profile"]): Record<string, { what: string; value: string }> {
  const grad = /^\d{4}-\d{2}/.test(me.gradDate) ? `${me.gradDate.slice(5, 7)}/${me.gradDate.length >= 10 ? me.gradDate.slice(8, 10) : "15"}/${me.gradDate.slice(0, 4)}` : "";
  const all: Record<string, { what: string; value: string }> = {
    first: { what: "First name", value: me.firstName },
    last: { what: "Last name", value: me.lastName },
    full: { what: "Full name", value: [me.firstName, me.lastName].filter(Boolean).join(" ") },
    preferred: { what: "Preferred name / nickname", value: me.preferredName || me.firstName },
    email: { what: "Email address", value: me.email },
    phone: { what: "Phone number", value: me.phone },
    street: { what: "Street address", value: me.address1 },
    city: { what: "City where the student lives / current location (city)", value: me.city },
    state: { what: "State / province", value: me.state },
    zip: { what: "ZIP / postal code", value: me.zip },
    country: { what: "Country of residence", value: me.country },
    location: { what: "Current location as City, State", value: [me.city, me.state].filter(Boolean).join(", ") },
    linkedin: { what: "LinkedIn profile URL", value: me.linkedin },
    website: { what: "Personal website / portfolio URL", value: me.website },
    school: { what: "School / university name", value: me.school },
    degree: { what: "Degree (e.g. Bachelor's)", value: me.degree },
    major: { what: "Major / field of study", value: me.major },
    gpa: { what: "GPA", value: me.gpa },
    grad: { what: "Graduation / education end date", value: grad },
    gradYear: { what: "Graduation year", value: me.gradDate.slice(0, 4) },
    start: { what: "Date available to start", value: me.startDate },
    heard: { what: "How the student heard about the job", value: me.howHeard },
  };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v.value?.trim()));
}

/* ---------------- learned answers + the agent benchmark (2026-10-26) ---------------- */

/** Remember an answer that worked on this platform (from the agent, Jev or the answer model): short, non-sensitive. */
function rememberAnswer(url: string, label: string, value: string, kind?: string) {
  const site = platformOf(url);
  const key = learnKey(label);
  if (!site || !key || key.length < 3 || !value || value.length > 120 || NEVER_LEARN.test(label) || NEVER_FILL.test(label) || /\{\{\w+\}\}/.test(value)) return;
  useStore.getState().setApply((a) => {
    const learned = { ...(a.learned ?? {}) };
    const forSite = { ...(learned[site] ?? {}) };
    const prev = forSite[key];
    forSite[key] = { value, kind, at: new Date().toISOString(), n: (prev?.value === value ? prev.n : 0) + 1 };
    // Keep the 400 most recent per platform.
    learned[site] = Object.fromEntries(Object.entries(forSite).sort((x, y) => y[1].at.localeCompare(x[1].at)).slice(0, 400));
    return { ...a, learned };
  });
}

function learnAnswer(payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>;
  rememberAnswer(str(p.url, 2000), str(p.label, 300), str(p.value, 200), str(p.kind, 20) || undefined);
  return { ok: true };
}

/** The open benchmark record for a job (this fill), created on first use. */
function runFor(jobId: string, url: string): string | undefined {
  const st = useStore.getState();
  const job = st.apply.jobs.find((j) => j.id === jobId);
  if (!job) return undefined;
  const open = (st.apply.runs ?? []).find((r) => r.jobId === jobId && !r.endedAt);
  if (open) return open.id;
  const id = uid("run");
  st.setApply((a) => ({
    ...a,
    runs: [...(a.runs ?? []), { id, jobId, company: job.company, site: platformOf(url || job.applyUrl || job.url), startedAt: new Date().toISOString(), rules: 0, jev: 0, ai: 0, learned: 0, left: 0 }].slice(-300),
  }));
  return id;
}
function updateRun(id: string | undefined, fn: (r: FillRun) => FillRun) {
  if (!id) return;
  useStore.getState().setApply((a) => ({ ...a, runs: (a.runs ?? []).map((r) => (r.id === id ? fn(r) : r)) }));
}

/** The agent's run on a job (extension): model, steps, tokens, time, how it ended. */
function agentRun(payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
  const id = runFor(str(p.jobId, 60), str(p.url, 2000));
  updateRun(id, (r) => ({
    ...r,
    agent: {
      provider: str(p.provider, 40),
      model: str(p.model, 120),
      vision: str(p.vision, 120) || undefined,
      steps: num(p.steps),
      inTokens: num(p.inTokens),
      cachedTokens: num(p.cachedTokens),
      outTokens: num(p.outTokens),
      ms: num(p.ms),
      failedActions: num(p.failedActions),
      visionSteps: num(p.visionSteps),
      outcome: str(p.outcome, 30),
    },
  }));
  return { ok: true };
}

/**
 * Your AI keys for the extension's agent (it runs the agent in your browser with your own keys): the first working key
 * per provider, mapped to the extension's providers (an "Other OpenAI-compatible" key on Alibaba's DashScope = Qwen).
 * Only to the extension's bridge on this page; never to a server.
 */
function aiKeys() {
  const st = useStore.getState();
  const out = new Map<string, { provider: string; key: string; baseURL?: string; models?: string[] }>();
  for (const e of st.settings.vault.ai ?? []) {
    if (e.ok === false || !e.value || !e.provider) continue;
    const provider = e.provider === "custom" ? (/dashscope|aliyuncs/i.test(e.baseURL ?? "") ? "qwen" : "compatible") : e.provider === "gateway" ? "" : e.provider;
    if (!provider || out.has(provider)) continue;
    out.set(provider, { provider, key: e.value, baseURL: e.baseURL || undefined, models: e.models?.slice(0, 200) });
  }
  return [...out.values()];
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
  const pageText = str(p.pageText, 8000);
  // Which graduation date this application uses: your early one when the posting / form asks for that class
  // ("graduating in winter 2027 or summer 2028?"). Decided once per job, then everything follows it.
  const me = st.apply.profile;
  const formText = fields.map((f) => [f.label, ...(f.options ?? []).map((o) => o.label)].join(" ")).join("\n");
  const gradAs = gradFor(me, `${job?.description ?? ""}\n${pageText}\n${formText}`, job?.review?.classYears ?? [], job?.gradAs);
  const switched = !!job && gradAs !== me.gradDate && job.gradAs !== gradAs;
  if (switched) useStore.getState().setApply((a) => ({ ...a, jobs: a.jobs.map((j) => (j.id === job!.id ? { ...j, gradAs } : j)) }));
  const fileJob = job && { ...job, gradAs };
  const file = await resumeFile(fileJob, pageText);
  const cover = await coverFor(job, pageText);
  const learned = st.apply.learned?.[platformOf(url)];
  const base = planFill(fields, gradAs === me.gradDate ? me : { ...me, gradDate: gradAs }, { hasResume: !!file, coverText: cover, learned });
  const fileData = file && { name: file.name, type: file.type, base64: file.base64 };
  const coverFile = cover ? coverPdf(cover, st.apply.profile, job?.company) : undefined;
  const items: PlanResult["items"] = base.items.map((it) => (it.file === "resume" && fileData ? { ...it, fileData } : it.file === "cover" && coverFile ? { ...it, fileData: coverFile } : it));
  const skipped = [...base.skipped];
  if (switched && job?.lastFilledAt)
    skipped.push({ id: "grad-switch", label: "Resume", why: `This posting asks for the class of ${gradAs.slice(0, 4)}: if an earlier page already has your other resume, replace it with the ${gradAs.slice(0, 4)} one.` });
  const result: PlanResult = { job: job && { id: job.id, company: job.company, role: job.role }, items, skipped, ai: { asked: base.ai.length } };

  // Jev picks the option questions first (dropdowns, radios, "Select One" lists): cheap, and it can only pick an option
  // that's offered. What it isn't sure of (< 60%) goes on to the AI model below with the open questions.
  if (base.ai.length && hasKey(st.settings, "jev")) {
    const optionQs = base.ai.filter((f) => (f.kind === "select" || f.kind === "radio" || f.kind === "listbox") && (f.options?.length ?? 0) >= 2);
    if (optionQs.length) {
      try {
        const r = await callApi<{ picks: { id: string; value: string; label: string; confidence: number }[] }>(
          "/api/apply/choose",
          { facts: jevFacts(job, file?.text), questions: optionQs.map((f) => ({ id: f.id, label: f.label.slice(0, 600), options: f.options!.slice(0, 200) })) },
          st.settings,
        );
        const done = new Set<string>();
        for (const pk of r.picks) {
          const f = optionQs.find((x) => x.id === pk.id);
          if (!f || pk.confidence < 0.6) continue;
          done.add(f.id);
          items.push({ id: f.id, value: pk.value, optionLabel: f.kind === "listbox" ? pk.label : undefined, source: "ai", label: f.label, note: `Jev picked "${pk.label}" (${Math.round(pk.confidence * 100)}% sure)` });
        }
        base.ai = base.ai.filter((f) => !done.has(f.id));
      } catch (e) {
        result.ai.error = `Jev: ${(e as Error).message}`;
      }
    }
  }

  // Text fields no rule placed ("Location (City)", "Uni", "Current residence"): Jev picks which of your facts they
  // ask for, from the field's label and the facts' NAMES only (no values go to TypeSafe); the value is typed here.
  if (hasKey(st.settings, "jev")) {
    const facts = factMenu(gradAs === me.gradDate ? me : { ...me, gradDate: gradAs });
    const loose = base.skipped.filter((s) => /^Not sure what goes here/.test(s.why)).map((s) => fields.find((f) => f.id === s.id)).filter((f): f is FormField => !!f && ["text", "email", "tel", "url"].includes(f.kind));
    if (loose.length && Object.keys(facts).length) {
      try {
        const r = await callApi<{ picks: { id: string; value: string; label: string; confidence: number }[] }>(
          "/api/apply/choose",
          {
            facts: "Pick which of the student's saved details this application field asks for (or none).",
            questions: loose.slice(0, 20).map((f) => ({
              id: f.id,
              label: f.label.slice(0, 600),
              options: [...Object.entries(facts).map(([k, v]) => ({ value: k, label: v.what })), { value: "none", label: "None of these / something else" }],
            })),
          },
          st.settings,
        );
        for (const pk of r.picks) {
          const fact = facts[pk.value];
          if (!fact || pk.confidence < 0.7) continue;
          const f = loose.find((x) => x.id === pk.id)!;
          items.push({ id: f.id, value: f.maxLength ? fact.value.slice(0, f.maxLength) : fact.value, source: "profile", label: f.label, note: `Jev: this asks for your ${pk.label.toLowerCase()} (${Math.round(pk.confidence * 100)}% sure)` });
          const at = skipped.findIndex((s) => s.id === f.id);
          if (at >= 0) skipped.splice(at, 1);
        }
      } catch (e) {
        result.ai.error = `Jev: ${(e as Error).message}`;
      }
    }
  }

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

  // Benchmark: who filled what on this page; option answers from Jev / the answer model are remembered for the platform.
  if (job) {
    const fieldOf = new Map(fields.map((f) => [f.id, f]));
    for (const it of items)
      if (it.source === "ai" && it.value !== undefined) {
        const f = fieldOf.get(it.id);
        const shown = it.optionLabel ?? f?.options?.find((o) => o.value === it.value)?.label ?? (f && !f.options?.length && f.kind !== "textarea" ? it.value : undefined);
        if (f && shown) rememberAnswer(url, f.label, shown, f.kind);
      }
    const isJev = (n?: string) => /^Jev/.test(n ?? "");
    const isLearned = (n?: string) => /^Learned/.test(n ?? "");
    const runId = runFor(job.id, url);
    updateRun(runId, (r) => ({
      ...r,
      jev: r.jev + items.filter((i) => isJev(i.note)).length,
      learned: r.learned + items.filter((i) => isLearned(i.note)).length,
      ai: r.ai + items.filter((i) => i.source === "ai" && !isJev(i.note)).length,
      rules: r.rules + items.filter((i) => i.source !== "ai" && !isJev(i.note) && !isLearned(i.note)).length,
      left: r.left + skipped.length,
    }));
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
  useStore.getState().setApply((a) => ({ ...a, jobs: a.jobs.map((j) => (j.id === job.id ? { ...j, status: j.status === "confirmed" ? j.status : "submitted", submittedAt: j.submittedAt ?? at } : j)) }));
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
  // Benchmark: a fill starts at its first "filling", ends at its final status.
  const runId = runFor(job.id, job.applyUrl || job.url);
  if (DONE.has(status)) updateRun(runId, (r) => ({ ...r, endedAt: new Date().toISOString(), outcome: status }));
  if (status === "ready") toast.ok(`${job.company}: filled up to review. Check it and submit it yourself.`);
  // The batch text waits until every job has settled for 3 minutes (a job waiting on a sign-in carries on later, and
  // the agent may still be working: owner, 2026-10-26, "it texted 'applications filled' while DeepSeek was still at it").
  if (DONE.has(status)) {
    clearTimeout(batchTimer);
    batchTimer = setTimeout(() => void batchDone(), 180_000);
  }
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
let batchTimer: ReturnType<typeof setTimeout> | undefined;

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
  // Something moved in the last 3 minutes: not settled yet (the timer runs again on the next status).
  if (jobs.some((j) => Date.now() - Date.parse(j.fill!.at) < 170_000)) return;
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


/**
 * The AI agent's brief for finishing one application (extension 1.5, Fill selected): the facts it may type, the
 * job, your resume text and answer library. Contact details go as {{placeholders}} (the extension swaps the real
 * value in when it types); demographic / EEO answers aren't given at all (rules fill those, or they're left for you).
 */
async function agentBrief(payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>;
  const st = useStore.getState();
  const job = st.apply.jobs.find((j) => j.id === str(p.jobId, 60)) ?? jobFor(str(p.url, 2000));
  const me = st.apply.profile;
  const resume = await resumeFile(job);
  const yesNo = (v: string) => (v === "yes" ? "Yes" : v === "no" ? "No" : "(leave for the student)");
  // "2029-06-15" (or a month-only "2029-06", read as the 15th) → "June 15, 2029".
  const gd = job?.gradAs ?? me.gradDate;
  const grad = gd ? new Date(`${/^\d{4}-\d{2}$/.test(gd) ? `${gd}-15` : gd.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
  const facts = [
    `Name: ${me.firstName} ${me.lastName}${me.preferredName ? ` (goes by ${me.preferredName})` : ""}`,
    `Email: {{email}}`,
    `Phone: {{phone}}`,
    `Address: {{address1}}${me.address2 ? " {{address2}}" : ""}, ${me.city}, ${me.state} {{zip}}, ${me.country || "United States"}`,
    me.linkedin && `LinkedIn: ${me.linkedin}`,
    me.website && `Website: ${me.website}`,
    `School: ${me.school}; degree: ${me.degree}; major: ${me.major}; graduation: ${grad}${me.gpa ? `; GPA: ${me.gpa}` : ""}`,
    `Authorized to work in the US: ${yesNo(me.authorized)}; needs sponsorship now: ${yesNo(me.sponsorNow)}; in the future: ${yesNo(me.sponsorFuture)}${me.citizenship ? `; citizenship: ${me.citizenship}` : ""}`,
    `Eligibility (answer every eligibility / pre-screen question and confirmation from these): 18 or older: ${yesNo(me.over18)}; authorized to work in the US: ${yesNo(me.authorized)}; needs visa sponsorship now: ${yesNo(me.sponsorNow)}; in the future: ${yesNo(me.sponsorFuture)}`,
    `Willing to relocate: ${yesNo(me.relocate)}${me.startDate ? `; can start: ${me.startDate}` : ""}${me.howHeard ? `; how they heard about the job: ${me.howHeard}` : ""}`,
    "Demographic / EEO questions (gender, race, veteran, disability…): leave them alone.",
    "Salary questions, consent / certification checkboxes, signatures: leave them for the student.",
  ].filter(Boolean);
  const answers = [...(job?.answers ?? []).map((a) => ({ q: a.question, a: a.answer })), ...st.apply.library].slice(0, 20);
  const task = [
    `Fill out this application${job ? ` for ${job.company}${job.role ? ` · ${job.role}` : ""}` : ""}.`,
    `FACTS\n${facts.join("\n")}`,
    me.background && `BACKGROUND (the student's own words)\n${me.background.slice(0, 1500)}`,
    resume?.text && `RESUME (work experience, education, activities: add these as entries)\n${resume.text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").slice(0, 5000)}`,
    answers.length && `ANSWERS THE STUDENT ALREADY WROTE (reuse for the same questions)\n${answers.slice(0, 8).map((x) => `Q: ${x.q.slice(0, 200)}\nA: ${x.a.slice(0, 600)}`).join("\n\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { task, secrets: { email: me.email, phone: me.phone, address1: me.address1, address2: me.address2, zip: me.zip }, jobId: job?.id };
}

/* ---------------- open tracking (extension's Gmail pixel; see extension/tracking.js) ---------------- */

const PIXEL_ID = /^[A-Za-z0-9_-]{1,60}\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{11}$/;
const isoOk = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** The pixel key for the extension to mint ids offline; null when tracking is off. Only to the bridge on this page. */
async function pixelKey() {
  const st = useStore.getState();
  if (!st.settings.tracking?.on) return null;
  await prepareTracking().catch(() => {});
  const t = useStore.getState().tracking;
  const accountId = useStore.getState().settings.server?.id;
  if (!t.key || !t.base || !accountId || t.account !== accountId) return null;
  return { key: t.key, base: t.base, accountId };
}

/** An email sent from Gmail's own compose window with a pixel the extension added. */
function pixelSent(payload: unknown) {
  const p = (payload ?? {}) as { id?: unknown; to?: unknown; subject?: unknown; at?: unknown; scheduledFor?: unknown; threadId?: unknown };
  const st = useStore.getState();
  const account = st.tracking.account;
  if (typeof p.id !== "string" || !PIXEL_ID.test(p.id) || !account || !p.id.startsWith(account + ".")) throw new Error("Bad pixel id.");
  if (!Array.isArray(p.to) || p.to.length > 20) throw new Error("Bad recipients.");
  const to = p.to.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 200).toLowerCase());
  if (!isoOk(p.at)) throw new Error("Bad time.");
  st.registerTracked({
    id: p.id,
    to,
    subject: typeof p.subject === "string" ? p.subject.slice(0, 300) : "",
    kind: "gmail",
    source: "gmail",
    createdAt: p.at,
    sentAt: isoOk(p.scheduledFor) ? p.scheduledFor : p.at,
    threadId: typeof p.threadId === "string" ? p.threadId.slice(0, 80) : undefined,
    hits: [],
    seen: [],
  });
  return true;
}

/** Times you had a tracked email on screen (so your own views aren't counted as theirs). */
function pixelSeen(payload: unknown) {
  const items = ((payload ?? {}) as { items?: unknown }).items;
  if (!Array.isArray(items)) throw new Error("Bad list.");
  const add = useStore.getState().addSeen;
  let n = 0;
  for (const it of items.slice(0, 200)) {
    const x = it as { id?: unknown; at?: unknown };
    if (typeof x?.id === "string" && PIXEL_ID.test(x.id) && isoOk(x.at)) {
      add(x.id, x.at);
      n++;
    }
  }
  return n;
}

/** Opens so far for the ids Gmail's content script is showing. */
function pixelStatus(payload: unknown) {
  const ids = ((payload ?? {}) as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) throw new Error("Bad list.");
  const t = useStore.getState().tracking;
  const want = new Set(ids.slice(0, 500).filter((x): x is string => typeof x === "string"));
  const out: Record<string, { opens: number; lastAt?: string; forwarded: boolean }> = {};
  for (const m of t.messages) {
    if (!want.has(m.id)) continue;
    const s = openSummary(m, t.mx);
    out[m.id] = { opens: s.opens, lastAt: s.lastAt, forwarded: s.forwarded };
  }
  return out;
}

const HANDLERS: Record<string, (payload: unknown) => unknown> = { plan, submitted, fillStatus, foundJob, finderStatus, vault, agentBrief, pickOption, accountInfo, accountCreated, verifyLink, learnAnswer, agentRun, aiKeys, pixelKey, pixelSent, pixelSeen, pixelStatus };

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
      if (m.kind === "stale") useExtension.setState({ stale: true });
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

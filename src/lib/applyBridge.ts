"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { blobs, useStore } from "./store";
import { callApi } from "./api";
import { aiReady } from "./keys";
import { knownJobSite, planFill, sameJobSite, type FillItem, type FormField, type JobApplication } from "./apply";
import { toast } from "@/components/ui";

/**
 * The dashboard's half of the extension bridge (extension/content/dashboard.js is the other half).
 *
 * The extension's content script runs on the dashboard's own pages only. It relays two requests from the extension
 * as window messages, and this answers them:
 *   plan      { url, title, pageText, fields } → what to type in each field (decided here from your saved info,
 *             plus AI answers for open questions) and your resume file for upload fields.
 *   submitted { url } → marks the job as submitted.
 * Your application info never leaves this page except as the values for the fields the extension scanned. The job
 * page itself has no way to reach this: only the extension's content script on THIS origin posts here.
 */

const CHANNEL = "coverage-ext";
const MAX_FIELDS = 250;
/** "Autofill" on a job counts for the next fill on that site within this long. */
const ACTIVE_FOR = 6 * 60 * 60 * 1000;

export const useExtension = create<{ version?: string; setVersion: (v: string) => void }>((set) => ({
  setVersion: (version) => set({ version }),
}));

type Req = { channel: typeof CHANNEL; kind: "request"; id: string; type: string; payload: unknown };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** The scanned form is untrusted (it comes from a third-party page): rebuild it field by field, with caps. */
function cleanFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return [];
  const kinds = new Set(["text", "email", "tel", "url", "number", "date", "month", "textarea", "select", "radio", "checkbox", "checkboxes", "file"]);
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

/** The job this page belongs to: the one you clicked Autofill on (same site, recent), else any job on that site. */
function jobFor(url: string): JobApplication | undefined {
  const { jobs, activeJob } = useStore.getState().apply;
  const active = activeJob && Date.now() - Date.parse(activeJob.at) < ACTIVE_FOR ? jobs.find((j) => j.id === activeJob.id) : undefined;
  if (active && sameJobSite(active.url, url)) return active;
  return jobs.find((j) => j.url && url.startsWith(j.url)) ?? jobs.find((j) => j.url && sameJobSite(j.url, url) && j.status !== "submitted");
}

async function resumeFile(job?: JobApplication) {
  const r = (job?.resumeId && (await blobs.appResume(job.resumeId))) || (await blobs.resume());
  return r ? { name: r.name, type: r.type || "application/pdf", base64: base64(r.data) } : undefined;
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
  const job = jobFor(url);
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
  const items: PlanResult["items"] = base.items.map((it) => (it.file === "resume" && file ? { ...it, fileData: file } : it));
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
            job: { company: job?.company ?? "", role: job?.role ?? str(p.title, 200), pageText: str(p.pageText, 8000) || undefined },
            questions: base.ai.map((f) => ({ id: f.id, label: f.label, kind: f.kind, options: f.options, maxLength: f.maxLength })),
            me: {
              name: [pr.firstName, pr.lastName].filter(Boolean).join(" ") || st.settings.profile.name,
              school: pr.school || st.settings.profile.school,
              major: pr.major || st.settings.profile.major,
              degree: pr.degree,
              gradDate: pr.gradDate,
              background: pr.background.slice(0, 12000),
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
        j.id === job.id ? { ...j, status: j.status === "saved" ? "applying" : j.status, lastFilledAt: at, answers: [...(j.answers ?? []), ...written].slice(-60) } : j,
      ),
    }));
  }
  toast.info(`Autofill: ${items.length} field${items.length === 1 ? "" : "s"} filled${job ? ` for ${job.company}` : ""}, ${skipped.length} left for you. Review before you submit.`);
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

const HANDLERS: Record<string, (payload: unknown) => unknown> = { plan, submitted };

/** Mounted once in Shell: answers the extension, and learns whether it's installed (for the Applications page). */
export function useExtensionBridge(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const reply = (id: string, body: { ok: boolean; result?: unknown; error?: string }) =>
      window.postMessage({ channel: CHANNEL, kind: "response", id, ...body }, window.location.origin);
    const onMessage = async (e: MessageEvent) => {
      // Only messages from this same page (the content script shares the page's window), never from frames or popups.
      if (e.source !== window || e.origin !== window.location.origin) return;
      const m = e.data as Partial<Omit<Req, "kind">> & { kind?: string; version?: string };
      if (!m || m.channel !== CHANNEL) return;
      if (m.kind === "hello" && typeof m.version === "string") useExtension.getState().setVersion(m.version.slice(0, 20));
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

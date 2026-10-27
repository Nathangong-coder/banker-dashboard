/**
 * Applications → "Check Gmail" (owner, 2026-10-26; rules in lib/appEmails.ts): reads application emails you haven't
 * read yet, has the AI (or the fixed rules, without a key) say what each one is, then
 *   - moves the tracked job forward: confirmation → Off. applied, interview / rejection / offer as they come; a job
 *     with an email about it is on My list (an AI-added job you applied to is kept);
 *   - adds jobs you applied to elsewhere (a confirmation for a firm + role you don't track);
 *   - labels the emails in Gmail by summer ("Applications/Summer 2027" …). Labelling needs Gmail's modify
 *     permission, asked on click; an automatic run keeps the labels for the next click.
 * Message ids are remembered, so an email is read (and sent to the AI) only once.
 */
import { useStore } from "./store";
import { callApi } from "./api";
import { aiReady, googleClientId } from "./keys";
import { applicationEmails, gmailConnected, labelMessages } from "./gmail";
import { applicationQuery, labelFor, matchJob, ruleRead, statusAfter, summerOf, type AppEmail, type AppEmailRead } from "./appEmails";
import type { JobApplication } from "./apply";
import { uid } from "./util";

export interface MailScan {
  read: number;
  confirmed: number;
  updated: number;
  added: number;
  labeled: number;
  /** Labels waiting for a click (automatic runs can't ask for the permission). */
  pending: number;
}

let running: Promise<MailScan> | null = null;

/** Single-flight. `interactive` = from a click (may open Google's permission window). */
export function scanApplicationEmails(opts: { interactive: boolean }): Promise<MailScan> {
  running ??= run(opts).finally(() => (running = null));
  return running;
}

async function readAll(emails: AppEmail[]): Promise<AppEmailRead[]> {
  const st = useStore.getState();
  if (!aiReady(st.settings)) return emails.map(ruleRead);
  const out: AppEmailRead[] = [];
  for (let i = 0; i < emails.length; i += 10) {
    const batch = emails.slice(i, i + 10);
    try {
      const r = await callApi<{ emails: AppEmailRead[] }>("/api/apply/emails", { emails: batch.map((e) => ({ id: e.id, from: e.from.slice(0, 300), subject: e.subject.slice(0, 500), date: e.date, text: e.text.slice(0, 4000) })) }, st.settings);
      const got = new Map(r.emails.map((x) => [x.id, x]));
      // An explicit "Summer 2027" in the email fills in a year the AI left open; anything the AI skipped gets the rules.
      for (const e of batch) {
        const a = got.get(e.id);
        out.push(a ? { ...a, summer: a.summer ?? summerOf(`${e.subject}\n${e.text}`) } : ruleRead(e));
      }
    } catch {
      out.push(...batch.map(ruleRead));
    }
  }
  return out;
}

async function run({ interactive }: { interactive: boolean }): Promise<MailScan> {
  const st = useStore.getState();
  const clientId = googleClientId(st.settings);
  if (!clientId) throw new Error("Connect Gmail first (Settings → Email, or the Gmail sync on Follow-ups).");
  if (!interactive && !gmailConnected(clientId)) return { read: 0, confirmed: 0, updated: 0, added: 0, labeled: 0, pending: st.apply.mail?.pendingLabels?.length ?? 0 };
  const mail = st.apply.mail ?? { seen: [] };
  const emails = await applicationEmails(clientId, applicationQuery(), new Set(mail.seen), 150);
  const reads = await readAll(emails);
  const byId = new Map(emails.map((e) => [e.id, e]));

  let jobs: JobApplication[] = [...useStore.getState().apply.jobs];
  const labels: { id: string; label: string }[] = [...(mail.pendingLabels ?? [])];
  const scan: MailScan = { read: emails.length, confirmed: 0, updated: 0, added: 0, labeled: 0, pending: 0 };
  // Oldest first, so a confirmation is applied before the interview / rejection that followed it.
  for (const r of [...reads].sort((a, b) => (byId.get(a.id)?.date ?? "").localeCompare(byId.get(b.id)?.date ?? ""))) {
    if (r.kind === "other") continue;
    const e = byId.get(r.id)!;
    const note = { id: e.id, kind: r.kind, at: e.date, subject: e.subject.slice(0, 200) };
    const job = matchJob(r, jobs);
    let summer = r.summer;
    if (job) {
      const status = statusAfter(job.status, r.kind);
      summer ??= job.summer;
      if (status === "confirmed" && job.status !== "confirmed") scan.confirmed++;
      else if (status !== job.status) scan.updated++;
      jobs = jobs.map((j) =>
        j.id === job.id
          ? {
              ...j,
              status,
              addedBy: undefined,
              summer: j.summer ?? r.summer,
              submittedAt: j.submittedAt ?? (status !== "saved" && status !== "applying" ? e.date : undefined),
              emails: [...(j.emails ?? []).filter((x) => x.id !== e.id), note].slice(-20),
            }
          : j,
      );
    } else if (r.company) {
      // Applied somewhere you don't track yet (on the firm's site, Handshake…): add it to My list.
      const status = statusAfter("submitted", r.kind);
      if (status === "confirmed") scan.confirmed++;
      scan.added++;
      jobs = [{ id: uid("job"), company: r.company, role: r.role || "Application", url: "", status, submittedAt: e.date, summer: r.summer, emails: [note], createdAt: new Date().toISOString() }, ...jobs];
    }
    labels.push({ id: e.id, label: labelFor(summer) });
  }

  let pending = labels;
  if (interactive && labels.length) {
    const byLabel: Record<string, string[]> = {};
    for (const l of labels) (byLabel[l.label] ??= []).push(l.id);
    scan.labeled = await labelMessages(clientId, byLabel);
    pending = [];
  }
  scan.pending = pending.length;
  useStore.getState().setApply((a) => ({
    ...a,
    jobs: mergeJobs(a.jobs, jobs),
    mail: { seen: [...mail.seen, ...emails.map((e) => e.id)].slice(-5000), at: new Date().toISOString(), pendingLabels: pending.slice(-2000) },
  }));
  return scan;
}

/** The scan's job list, applied over whatever changed meanwhile (other edits to the same jobs are kept). */
function mergeJobs(now: JobApplication[], scanned: JobApplication[]): JobApplication[] {
  const byId = new Map(scanned.map((j) => [j.id, j]));
  const known = new Set(now.map((j) => j.id));
  const added = scanned.filter((j) => !known.has(j.id));
  return [...added, ...now.map((j) => (byId.has(j.id) ? { ...j, ...pick(byId.get(j.id)!) } : j))];
}
const pick = (j: JobApplication) => ({ status: j.status, addedBy: j.addedBy, summer: j.summer, submittedAt: j.submittedAt, emails: j.emails });

/** "Read 14 emails · 5 Off. applied · 2 updated · 1 added · 14 labelled" */
export function scanSummary(s: MailScan): string {
  const parts = [`Read ${s.read} new email${s.read === 1 ? "" : "s"}`];
  if (s.confirmed) parts.push(`${s.confirmed} now Off. applied`);
  if (s.updated) parts.push(`${s.updated} status update${s.updated === 1 ? "" : "s"}`);
  if (s.added) parts.push(`${s.added} added from your inbox`);
  if (s.labeled) parts.push(`${s.labeled} labelled in Gmail`);
  if (s.pending) parts.push(`${s.pending} to label (press Check Gmail)`);
  return parts.join(" · ");
}

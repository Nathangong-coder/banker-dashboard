"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BriefcaseBusiness, ChevronDown, ChevronRight, ExternalLink, Eye, Mail, Plus, Puzzle, Sparkles, Trash2, Wand2 } from "lucide-react";
import { scanApplicationEmails, scanSummary } from "@/lib/appEmailsRun";
import { useStore } from "@/lib/store";
import { sendCommand, useExtension } from "@/lib/applyBridge";
import { FILL_LABELS, JOB_STATUSES, guessFromUrl, parseJobCapture, type FillStatus, type JobApplication, type JobCapture, type JobStatus } from "@/lib/apply";
import { isRecruiter } from "@/lib/recruiters";
import { canonBank } from "@/lib/banks";
import { cn, fmtDate, relDays, uid } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Field, Input, Kpi, Menu, PageHeader, Segmented, Select, Textarea, toast } from "@/components/ui";
import { JobFinder } from "@/components/JobFinder";
import { SITE } from "@/lib/site";
import { WhyModal } from "@/components/JobRules";
import { addReviewRule, assignSheetRows, currentRules } from "@/lib/jobReviewRun";
import { judge } from "@/lib/jobReview";
import { jobKey } from "@/lib/jobFinder";
import { ApplyInfo } from "@/components/ApplyInfo";
import { ApplyResumes, ApplyWriting } from "@/components/ApplyWriting";

type Tab = "jobs" | "info" | "writing" | "resumes";
const TABS: readonly (readonly [Tab, string])[] = [
  ["jobs", "Jobs"],
  ["info", "My info"],
  ["writing", "Writing"],
  ["resumes", "Resumes"],
];

const OPEN: JobStatus[] = ["saved", "applying"];
/** Only http(s) links are opened or linked (a "javascript:" link would run inside the dashboard). */
const webLink = (url: string) => (/^https?:\/\//i.test(url.trim()) ? url.trim() : "");

/** "Track this job" on a LinkedIn job page (extension): add it, or refresh the copy you already track. */
/** "Save + fill" from the popup: start Fill selected on this one job (watching), once the extension bridge is up. */
function fillNow(job: JobApplication) {
  const url = job.applyUrl || job.url;
  const at = new Date().toISOString();
  useStore.getState().setApply((a) => ({ ...a, batch: { ids: [job.id], at }, jobs: a.jobs.map((j) => (j.id === job.id ? { ...j, fill: { status: "queued", note: "Sent to the extension…", at } } : j)) }));
  setTimeout(
    () =>
      sendCommand("fillJobs", { jobs: [{ id: job.id, url, company: job.company }], watch: true }).then(
        () => toast.ok(`Filling ${job.company} in a new tab. Nothing gets submitted.`),
        (e) => toast.err((e as Error).message),
      ),
    1500,
  );
}

function addCapturedJob(cap: JobCapture) {
  const st = useStore.getState();
  const same = st.apply.jobs.find(
    (j) =>
      (cap.linkedinJobId && j.linkedinJobId === cap.linkedinJobId) ||
      (cap.handshakeJobId && j.handshakeJobId === cap.handshakeJobId) ||
      (canonBank(j.company) === canonBank(cap.company) && j.role.toLowerCase() === cap.title.toLowerCase()),
  );
  if (same) {
    st.setApply((a) => ({
      ...a,
      jobs: a.jobs.map((j) =>
        j.id === same.id
          ? { ...j, linkedinJobId: j.linkedinJobId ?? cap.linkedinJobId, handshakeJobId: j.handshakeJobId ?? cap.handshakeJobId, applyUrl: j.applyUrl ?? cap.applyUrl, description: cap.description || j.description, location: j.location ?? (cap.location || undefined), addedBy: undefined }
          : j,
      ),
    }));
    if (cap.fill) return fillNow({ ...same, applyUrl: same.applyUrl ?? cap.applyUrl });
    return toast.info(`Already tracking ${same.company} · ${same.role || cap.title}. Updated its details.`);
  }
  const job: JobApplication = {
    id: uid("job"),
    company: cap.company || guessFromUrl(cap.applyUrl ?? "").company || "Unknown company",
    role: cap.title,
    url: cap.url,
    applyUrl: cap.applyUrl,
    linkedinJobId: cap.linkedinJobId,
    handshakeJobId: cap.handshakeJobId,
    description: cap.description || undefined,
    location: cap.location || undefined,
    status: "saved",
    createdAt: new Date().toISOString(),
  };
  st.setApply((a) => ({ ...a, jobs: [job, ...a.jobs] }));
  if (cap.fill) return fillNow(job);
  toast.ok(`Tracking ${job.company} · ${job.role}${job.applyUrl ? "" : ". Its application link appears once you autofill it on the bank's site."}`);
}

export default function ApplicationsPage() {
  const [tab, setTab] = useState<Tab>(() => {
    const t = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return TABS.some(([id]) => id === t) ? (t as Tab) : "jobs";
  });
  const version = useExtension((s) => s.version);
  // A job sent from LinkedIn arrives in the address fragment (never sent to a server).
  useEffect(() => {
    if (!window.location.hash.startsWith("#job=")) return;
    const cap = parseJobCapture(window.location.hash);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setTimeout(() => (cap ? addCapturedJob(cap) : toast.err("Couldn't read that job. Open it on LinkedIn or Handshake and try again.")), 0);
  }, []);
  const choose = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, "", t === "jobs" ? "/applications" : `/applications?tab=${t}`);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Applications"
        sub="Track the jobs you're applying to, keep your application info in one place, and let the Coverage extension fill the forms: your details, your resume, and first drafts of open answers in your own voice. You always review and submit."
        right={<Segmented value={tab} onChange={choose} options={TABS} />}
      />
      <ExtensionNotice version={version} />
      {tab === "jobs" && <JobsTab onTab={choose} />}
      {tab === "info" && <ApplyInfo />}
      {tab === "writing" && <ApplyWriting />}
      {tab === "resumes" && <ApplyResumes />}
    </div>
  );
}

/** "1.10.0" > "1.9.2" (numeric parts). */
const newer = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let k = 0; k < Math.max(pa.length, pb.length); k++) if ((pa[k] ?? 0) !== (pb[k] ?? 0)) return (pa[k] ?? 0) > (pb[k] ?? 0);
  return false;
};

/**
 * Is the extension here, current and connected? The dashboard and the extension ship together (SITE.extension.version
 * = the extension built from the same commit), so an older copy is asked to update, a newer one means this page is
 * older (reload it, or the deploy is still going out), and a copy reloaded after this tab opened needs a tab reload.
 */
function ExtensionNotice({ version }: { version?: string }) {
  const stale = useExtension((s) => s.stale);
  const latest = SITE.extension.version;
  const box = "-mt-2 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[12.5px]";
  if (stale)
    return (
      <div className={cn(box, "border-amber/40 bg-amber-soft text-ink")}>
        <Puzzle className="size-3.5 text-amber" />
        The Coverage extension was updated or reloaded after this tab opened, so this tab can&apos;t reach it.
        <Button size="sm" variant="primary" onClick={() => window.location.reload()}>
          Reload this tab
        </Button>
      </div>
    );
  if (version && newer(latest, version))
    return (
      <div className={cn(box, "border-amber/40 bg-amber-soft text-ink")}>
        <Puzzle className="size-3.5 text-amber" />
        Your Coverage extension is v{version}; this dashboard works with v{latest}. Load the new copy (chrome://extensions → Load unpacked, or the
        updated zip), then reload this tab.
      </div>
    );
  if (version && newer(version, latest))
    return (
      <div className={cn(box, "border-line bg-subtle text-ink-2")}>
        <Puzzle className="size-3.5 text-brass" />
        Your extension (v{version}) is newer than this page (built for v{latest}). Reload this tab; if it stays, the dashboard update is still deploying.
        <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  if (version)
    return (
      <div className="-mt-2 flex items-center gap-2 text-[12.5px] text-green">
        <Puzzle className="size-3.5" /> Coverage extension connected (v{version}). On an application form, click its toolbar icon → <b className="font-medium">Autofill this page</b>.
      </div>
    );
  return (
    <div className={cn(box, "border-line bg-subtle text-ink-2")}>
      <Puzzle className="size-3.5 text-brass" />
      Autofill needs the Coverage browser extension (v{latest}), with this tab open while it fills. Just installed or reloaded it? Reload this tab.
      <Link href="/extension" className="font-medium text-navy hover:underline">
        Get the extension
      </Link>
    </div>
  );
}

function JobsTab({ onTab }: { onTab: (t: Tab) => void }) {
  const jobs = useStore((s) => s.apply.jobs);
  const profile = useStore((s) => s.apply.profile);
  const resumes = useStore((s) => s.apply.resumes);
  const resumeName = useStore((s) => s.resumeName);
  const contacts = useStore((s) => s.contacts);
  const targets = useStore((s) => s.targets);
  const setApply = useStore((s) => s.setApply);
  const version = useExtension((s) => s.version);
  const features = useExtension((s) => s.features);
  const [view, setView] = useState<"open" | "done" | "all" | "ai">("open");
  const [ask, setAsk] = useState<Parameters<typeof WhyModal>[0]["ask"]>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [watch, setWatch] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ url: "", company: "", role: "", location: "", deadline: "" });
  const [now] = useState(() => Date.now());
  const snapshots = useStore((s) => s.snapshots);
  // My list jobs get a row on your spreadsheet's applications tab (written on the next Save).
  useEffect(() => assignSheetRows(), [jobs, snapshots]);

  // Gmail: application emails → Off. applied / interviews / rejections + labels by summer.
  const mailAt = useStore((s) => s.apply.mail?.at);
  const [mailBusy, setMailBusy] = useState(false);
  const checkGmail = async (interactive: boolean) => {
    if (interactive) setMailBusy(true);
    try {
      const r = await scanApplicationEmails({ interactive });
      if (interactive || r.confirmed || r.updated || r.added) toast.ok(scanSummary(r));
    } catch (e) {
      if (interactive) toast.err((e as Error).message);
    } finally {
      setMailBusy(false);
    }
  };
  // Quietly on open when Gmail is already connected in this tab (never opens Google's window by itself).
  useEffect(() => {
    void checkGmail(false);
  }, []);

  const update = (id: string, patch: Partial<JobApplication>) => setApply((a) => ({ ...a, jobs: a.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
  const remove = (j: JobApplication) => {
    setApply((a) => ({ ...a, jobs: a.jobs.filter((x) => x.id !== j.id) }));
    toast.info(`Removed ${j.company}${j.role ? ` · ${j.role}` : ""}.`);
  };
  /** "Added by AI" → My list (and onto your spreadsheet's applications tab). */
  const keep = (list: JobApplication[]) => {
    const ids = new Set(list.map((j) => j.id));
    setApply((a) => ({ ...a, jobs: a.jobs.map((j) => (ids.has(j.id) ? { ...j, addedBy: undefined } : j)) }));
    toast.ok(`Moved ${list.length} job${list.length === 1 ? "" : "s"} to My list${useStore.getState().snapshots.length ? " (and your spreadsheet's applications tab, on the next Save)" : ""}.`);
    setSelected(new Set());
  };
  /** Remove an AI-added job: asks why (the answer becomes a review rule) and never adds it again. */
  const removeAi = (list: JobApplication[]) =>
    setAsk({
      title: list.length === 1 ? `Remove ${list[0].company} · ${list[0].role}` : `Remove ${list.length} jobs`,
      placeholder: "e.g. no insurance companies' rotational programs",
      act: (why) => {
        if (why) addReviewRule(`Not for me: ${list.map((j) => `${j.company} "${j.role}"`).join("; ").slice(0, 160)}. ${why}`);
        const ids = new Set(list.map((j) => j.id));
        const keys = list.flatMap((j) => [j.url && jobKey(j.url), j.applyUrl && jobKey(j.applyUrl)].filter((k): k is string => !!k));
        setApply((a) => ({ ...a, jobs: a.jobs.filter((x) => !ids.has(x.id)), finder: { ...a.finder, dismissed: [...new Set([...a.finder.dismissed, ...keys])].slice(-2000) } }));
        setSelected(new Set());
      },
    });

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const url = draft.url.trim();
    if (url && !/^https?:\/\//i.test(url)) return toast.err("The job link should start with https://");
    const company = draft.company.trim() || guessFromUrl(url).company;
    if (!company) return toast.err("Add the company (or a job link to guess it from).");
    const job: JobApplication = {
      id: uid("job"),
      company,
      role: draft.role.trim(),
      url,
      location: draft.location.trim() || undefined,
      deadline: draft.deadline || undefined,
      status: "saved",
      createdAt: new Date().toISOString(),
    };
    setApply((a) => ({ ...a, jobs: [job, ...a.jobs] }));
    setDraft({ url: "", company: "", role: "", location: "", deadline: "" });
    toast.ok(`Tracking ${company}${job.role ? ` · ${job.role}` : ""}.`);
  };

  const autofill = (j: JobApplication) => {
    const url = webLink(j.applyUrl ?? "") || webLink(j.url);
    if (!url) return toast.err("Add the job's application link first (open the row to edit it).");
    setApply((a) => ({ ...a, activeJob: { id: j.id, at: new Date().toISOString() } }));
    window.open(url, "_blank", "noopener");
    if (!version) toast.info("Opened the job. Install the Coverage extension to fill it automatically.");
    else if (/(^|\.)linkedin\.com\//i.test(url.replace(/^https?:\/\//, "")))
      toast.info("Opened the LinkedIn listing. Click Apply there (not Easy Apply); on the bank's form, click the Coverage icon → Autofill this page.");
    else toast.info("Opened the job. On the application form, click the Coverage icon → Autofill this page. Keep this tab open.");
  };

  // Networking at each firm, so you can see who to mention or reach out to before applying.
  const network = useMemo(() => {
    const m = new Map<string, { people: number; emailed: number; replied: number; referral: number; recruiters: string[] }>();
    for (const c of contacts) {
      if (c.status === "ignored") continue;
      const k = canonBank(c.bank);
      const n = m.get(k) ?? { people: 0, emailed: 0, replied: 0, referral: 0, recruiters: [] };
      if (isRecruiter(c)) n.recruiters.push(c.name);
      n.people++;
      if (c.sentAt || ["sent", "followed_up", "replied", "call_scheduled", "done"].includes(c.status)) n.emailed++;
      if (c.repliedAt || ["replied", "call_scheduled", "done"].includes(c.status)) n.replied++;
      if (c.referral) n.referral++;
      m.set(k, n);
    }
    return m;
  }, [contacts]);

  const sheetApps = useMemo(
    () => targets.flatMap((t) => (t.applied ?? []).map((a) => ({ firm: t.name, ...a }))).filter((a) => !jobs.some((j) => canonBank(j.company) === canonBank(a.firm) && j.role === a.program)),
    [targets, jobs],
  );

  // My list = jobs you added or kept; "Added by AI" = the AI's adds you haven't kept or removed yet.
  const mine = jobs.filter((j) => j.addedBy !== "ai");
  const aiJobs = jobs.filter((j) => j.addedBy === "ai");
  const shown = (view === "ai" ? aiJobs : mine.filter((j) => view === "all" || (view === "open" ? OPEN.includes(j.status) : !OPEN.includes(j.status))))
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || b.createdAt.localeCompare(a.createdAt));
  const counts = {
    open: mine.filter((j) => OPEN.includes(j.status)).length,
    submitted: jobs.filter((j) => j.status === "submitted" || j.status === "confirmed").length,
    confirmed: jobs.filter((j) => j.status === "confirmed").length,
    interview: jobs.filter((j) => j.status === "interview" || j.status === "offer").length,
    soon: jobs.filter((j) => OPEN.includes(j.status) && j.deadline && Date.parse(j.deadline) - now < 7 * 86_400_000 && Date.parse(j.deadline) >= now - 86_400_000).length,
  };
  // Fill selected: the extension opens each in a "Coverage" tab group and fills it up to review.
  const fillable = (j: JobApplication) => {
    const u = webLink(j.applyUrl ?? "") || webLink(j.url);
    // https only (plain http just for a local dev server).
    return /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(u) && !/(^|\.)linkedin\.com$/i.test(guessFromUrl(u).host) ? u : "";
  };
  const picked = shown.filter((j) => selected.has(j.id));
  const fillSelected = async () => {
    const list = picked.filter(fillable);
    if (!list.length) return toast.err("None of those has the bank's own https application link yet (a LinkedIn listing isn't enough).");
    if (list.length > 50) return toast.err("Up to 50 at a time: select fewer.");
    const at = new Date().toISOString();
    // Mass apply: when all of these finish, one WhatsApp text says what's ready (applyBridge.ts#batchDone).
    setApply((a) => ({
      ...a,
      batch: { ids: list.map((j) => j.id), at },
      jobs: a.jobs.map((j) => (list.some((x) => x.id === j.id) ? { ...j, fill: { status: "queued", note: "Sent to the extension…", at } } : j)),
    }));
    try {
      await sendCommand("fillJobs", { jobs: list.map((j) => ({ id: j.id, url: fillable(j), company: j.company })), watch });
      toast.ok(
        `Filling ${list.length} application${list.length === 1 ? "" : "s"} in a “Coverage” tab group${watch ? ", one at a time so you can watch" : ", two at a time"}. Nothing gets submitted; you'll get a WhatsApp text when they're all done.`,
      );
      setSelected(new Set());
    } catch (e) {
      toast.err((e as Error).message);
      setApply((a) => ({ ...a, jobs: a.jobs.map((j) => (list.some((x) => x.id === j.id) ? { ...j, fill: { status: "error", note: (e as Error).message, at } } : j)) }));
    }
  };
  const showTab = (j: JobApplication) =>
    sendCommand<{ found: boolean }>("focusJob", { jobId: j.id }).then(
      (r) => {
        if (!r.found) toast.info("That tab is closed. Press Fill again to reopen it.");
      },
      (e) => toast.err((e as Error).message),
    );

  const infoGaps = [!profile.firstName && "name", !profile.email && "email", !profile.school && "school", !profile.authorized && "work authorization"].filter(Boolean);

  return (
    <>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="To apply" value={counts.open} sub={counts.soon ? `${counts.soon} due within a week` : "no deadlines this week"} tone={counts.soon ? "bad" : undefined} />
        <Kpi label="Applied" value={counts.submitted} sub={`${counts.confirmed} Off. applied · ${counts.submitted - counts.confirmed} pending`} />
        <Kpi label="Interviewing / offers" value={counts.interview} tone={counts.interview ? "good" : undefined} />
        <Kpi
          label="Autofill ready"
          value={infoGaps.length ? "Not yet" : "Yes"}
          sub={
            infoGaps.length ? (
              <button className="text-navy hover:underline" onClick={() => onTab("info")}>
                Add your {infoGaps.join(", ")}
              </button>
            ) : (
              `${resumeName || resumes.length ? "resume ready" : "no resume yet"}`
            )
          }
          tone={infoGaps.length ? "bad" : "good"}
        />
      </div>

      <JobFinder />

      <Card>
        <CardHeader title="Add a job" sub="Paste the application link; the company is guessed from it (Workday, Greenhouse, Lever…). Then hit Autofill when you're ready to apply." />
        <form onSubmit={add} className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 pb-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto] md:items-end">
          <Field label="Application link">
            <Input
              value={draft.url}
              placeholder="https://…myworkdayjobs.com/…"
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              onBlur={() => !draft.company && draft.url && setDraft((d) => ({ ...d, company: guessFromUrl(d.url).company }))}
            />
          </Field>
          <Field label="Company">
            <Input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
          </Field>
          <Field label="Role">
            <Input value={draft.role} placeholder="2027 IB Summer Analyst" onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
          </Field>
          <Field label="Deadline">
            <Input type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} />
          </Field>
          <Button type="submit" variant="primary" icon={<Plus className="size-3.5" />}>
            Track
          </Button>
        </form>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              ["open", `To apply ${counts.open}`],
              ["done", `Applied ${mine.length - counts.open}`],
              ["all", `My list ${mine.length}`],
              ["ai", `Added by AI ${aiJobs.length}`],
            ]}
          />
          <div className="flex-1" />
          <Button
            size="sm"
            variant="secondary"
            icon={<Mail className="size-3.5" />}
            loading={mailBusy}
            onClick={() => checkGmail(true)}
            title={`Reads application emails: confirmations make a job Off. applied; each email is labelled "Applications/Summer 20XX" in Gmail${mailAt ? `. Last checked ${relDays(mailAt)}` : ""}`}
          >
            Check Gmail
          </Button>
          {view === "ai" && picked.length > 0 && (
            <>
              <Button size="sm" variant="secondary" onClick={() => keep(picked)}>
                Keep {picked.length}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => removeAi(picked)}>
                Remove {picked.length}
              </Button>
            </>
          )}
          {features.fillJobs ? (
            <>
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2" title="One tab at a time in front of you: it types visibly, with a Stop button on the page">
                <Checkbox checked={watch} onChange={setWatch} label="Watch it work" /> <Eye className="size-3.5 text-muted" /> Watch it work
              </label>
              <Button size="sm" variant="primary" icon={<Wand2 className="size-3.5" />} disabled={!picked.length} onClick={fillSelected}>
                Fill selected{picked.length ? ` (${picked.length})` : ""}
              </Button>
            </>
          ) : (
            version && <span className="text-[12px] text-muted">Update the extension (v{SITE.extension.version}) to fill several at once.</span>
          )}
        </div>
        {shown.length === 0 ? (
          <Empty icon={<BriefcaseBusiness className="size-6" />} title={jobs.length ? "Nothing here" : "No jobs tracked yet"}>
            {view === "ai" ? "Jobs the AI review adds land here. Press Find jobs above to search." : jobs.length ? "Switch tabs above." : "Paste an application link above to start."}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead className="bg-subtle text-left text-[11px] uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="w-8 py-2 pl-4">
                    <Checkbox checked={picked.length > 0 && picked.length === shown.length} onChange={(on) => setSelected(new Set(on ? shown.map((j) => j.id) : []))} label="Select all" />
                  </th>
                  <th className="px-2 py-2 font-medium">Job</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Deadline</th>
                  <th className="px-2 py-2 font-medium">Networking there</th>
                  <th className="px-2 py-2 font-medium">Resume</th>
                  <th className="px-4 py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {shown.map((j) => {
                  const n = network.get(canonBank(j.company));
                  const isOpen = open === j.id;
                  const days = j.deadline ? Math.ceil((Date.parse(j.deadline) - now) / 86_400_000) : undefined;
                  return (
                    <Fragment key={j.id}>
                      <tr className={cn("group border-b border-line hover:bg-subtle", isOpen && "bg-subtle")}>
                        <td className="py-2.5 pl-4 align-top">
                          <Checkbox
                            checked={selected.has(j.id)}
                            onChange={(on) =>
                              setSelected((p) => {
                                const n = new Set(p);
                                if (on) n.add(j.id);
                                else n.delete(j.id);
                                return n;
                              })
                            }
                            label={`Select ${j.company}`}
                          />
                        </td>
                        <td className="px-2 py-2.5">
                          <button type="button" className="flex items-center gap-1.5 text-left font-medium text-ink" onClick={() => setOpen(isOpen ? null : j.id)} aria-expanded={isOpen}>
                            {isOpen ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}
                            {j.company}
                            {j.role && <span className="font-normal text-ink-2">· {j.role}</span>}
                          </button>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 pl-5 text-[11.5px] text-muted">
                            {webLink(j.applyUrl ?? "") || webLink(j.url) ? (
                              <a href={webLink(j.applyUrl ?? "") || webLink(j.url)} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 hover:text-navy">
                                {guessFromUrl(j.applyUrl || j.url).host} <ExternalLink className="size-3" />
                              </a>
                            ) : (
                              <span>no link</span>
                            )}
                            {j.lastFilledAt && <span>filled {relDays(j.lastFilledAt)}</span>}
                            {j.submittedAt && <span>applied {fmtDate(j.submittedAt)}</span>}
                            {j.summer && <span>Summer {j.summer}</span>}
                            {j.emails?.length ? (
                              <span title={j.emails.map((e) => `${fmtDate(e.at)} ${e.kind}: ${e.subject}`).join("\n")}>
                                {j.emails.length} email{j.emails.length === 1 ? "" : "s"} ({j.emails[j.emails.length - 1].kind})
                              </span>
                            ) : null}
                          </div>
                          {j.review && j.addedBy === "ai" && (
                            <p className="mt-0.5 pl-5 text-[12px] text-ink-2">
                              <Sparkles className="mr-1 inline size-3 text-brass" />
                              {judge(j.review, currentRules(), j.location).why}
                              <span className="text-muted"> · {j.review.classYears.length ? `class of ${j.review.classYears.join("/")}` : "year unclear"}</span>
                            </p>
                          )}
                          {j.fill && <FillLine fill={j.fill} onShow={() => showTab(j)} />}
                        </td>
                        <td className="px-2 py-2.5">
                          <Select
                            className={cn("h-8 text-[12.5px]")}
                            value={j.status}
                            aria-label={`Status of ${j.company}`}
                            onChange={(e) => {
                              const status = e.target.value as JobStatus;
                              update(j.id, { status, ...((status === "submitted" || status === "confirmed") && !j.submittedAt ? { submittedAt: new Date().toISOString() } : {}) });
                            }}
                          >
                            {JOB_STATUSES.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.label}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-2 py-2.5 text-[12.5px]">
                          {j.deadline ? (
                            <span className={cn(OPEN.includes(j.status) && days !== undefined && days <= 7 && "font-medium text-red")}>
                              {fmtDate(j.deadline)}
                              {OPEN.includes(j.status) && days !== undefined && days >= 0 && <span className="text-muted"> · {days === 0 ? "today" : `${days}d`}</span>}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-[12.5px]">
                          {n ? (
                            <Link href={`/coverage`} className="text-ink-2 hover:text-navy hover:underline" title="People you have at this firm">
                              {n.people} people · {n.emailed} emailed
                              {n.replied ? ` · ${n.replied} replied` : ""}
                              {n.referral ? <Badge tone="green" className="ml-1 px-1 py-0 text-[10.5px]">referral</Badge> : null}
                              {n.recruiters.length ? (
                                <span className="block text-[11.5px] text-muted" title="Recruiters you know at this firm">
                                  Recruiter: {n.recruiters.slice(0, 2).join(", ")}
                                  {n.recruiters.length > 2 ? ` +${n.recruiters.length - 2}` : ""}
                                </span>
                              ) : null}
                            </Link>
                          ) : (
                            <Link href={`/find?banks=${encodeURIComponent(j.company)}`} className="text-muted hover:text-navy hover:underline">
                              Nobody yet: find people
                            </Link>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <Select className="h-8 max-w-[150px] text-[12.5px]" value={j.resumeId ?? ""} aria-label="Resume to upload" onChange={(e) => update(j.id, { resumeId: e.target.value || undefined })}>
                            <option value="">{resumeName ? `Main (${resumeName})` : "Main resume"}</option>
                {resumes.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                                {r.classYear ? ` (class of ${r.classYear})` : ""}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            {j.addedBy === "ai" && (
                              <>
                                <Button size="sm" variant="secondary" onClick={() => keep([j])}>
                                  Keep
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => removeAi([j])}>
                                  Remove
                                </Button>
                              </>
                            )}
                            {OPEN.includes(j.status) && (
                              <Button size="sm" variant="brass" icon={<Wand2 className="size-3.5" />} onClick={() => autofill(j)} disabled={!webLink(j.url)}>
                                Autofill
                              </Button>
                            )}
                            <Menu
                              items={[
                                !!webLink(j.url) && { label: "Open the job page", icon: <ExternalLink />, onClick: () => window.open(webLink(j.url), "_blank", "noopener") },
                                !!j.fill && { label: "Show its tab", icon: <Eye />, onClick: () => showTab(j) },
                                { label: "Mark applied (pending confirmation)", onClick: () => update(j.id, { status: "submitted", submittedAt: j.submittedAt ?? new Date().toISOString() }) },
                                "divider",
                                { label: "Delete", icon: <Trash2 />, danger: true, onClick: () => remove(j) },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-line bg-subtle">
                          <td colSpan={7} className="px-4 py-4">
                            <JobDetail j={j} onChange={(patch) => update(j.id, patch)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <WhyModal ask={ask} onClose={() => setAsk(null)} />

      {sheetApps.length > 0 && (
        <details className="group rounded-lg border border-line bg-panel">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13.5px] font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" />
            From your spreadsheet <span className="font-normal text-muted">({sheetApps.length} applications on your applications tab)</span>
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {sheetApps.map((a) => (
              <li key={`${a.sheet}:${a.row}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12.5px]">
                <span className="font-medium">{a.firm}</span>
                <span className="text-ink-2">{a.program}</span>
                <span className="text-muted">{[a.submitted && `submitted ${a.submitted}`, a.status, a.location].filter(Boolean).join(" · ")}</span>
                <div className="flex-1" />
                <button
                  className="text-[12px] font-medium text-navy hover:underline"
                  onClick={() => {
                    const submitted = !!a.submitted && !/oops/i.test(a.submitted);
                    const status: JobStatus = /reject/i.test(a.status) ? "rejected" : /interview|superday/i.test(a.status) ? "interview" : submitted ? "submitted" : "saved";
                    setApply((s) => ({ ...s, jobs: [{ id: uid("job"), company: a.firm, role: a.program, url: "", location: a.location || undefined, status, createdAt: new Date().toISOString() }, ...s.jobs] }));
                    toast.ok(`Tracking ${a.firm} · ${a.program} here too. Add its link to autofill it.`);
                  }}
                >
                  Track here
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

const FILL_TONE: Record<FillStatus, "green" | "amber" | "red" | "blue" | "neutral"> = {
  queued: "neutral",
  filling: "blue",
  ready: "green",
  needs_you: "amber",
  signin: "amber",
  account: "amber",
  access: "amber",
  error: "red",
  stopped: "neutral",
};

/** How the last "Fill selected" run on a job went, with a link to its tab. */
function FillLine({ fill, onShow }: { fill: NonNullable<JobApplication["fill"]>; onShow: () => void }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 text-[11.5px]">
      <Badge tone={FILL_TONE[fill.status]} className="px-1.5 py-0 text-[10.5px]">
        {FILL_LABELS[fill.status]}
      </Badge>
      {fill.note && <span className="text-ink-2">{fill.note}</span>}
      {fill.needs?.length ? <span className="text-muted">({fill.needs.slice(0, 3).join(", ")})</span> : null}
      {!["queued", "access", "error"].includes(fill.status) && (
        <button className="font-medium text-navy hover:underline" onClick={onShow}>
          Show tab
        </button>
      )}
    </div>
  );
}

function JobDetail({ j, onChange }: { j: JobApplication; onChange: (patch: Partial<JobApplication>) => void }) {
  const setApply = useStore((s) => s.setApply);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
      <div className="grid gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          <Field label="Application link">
            <Input
              defaultValue={j.url}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v === j.url) return;
                if (v && !webLink(v)) return toast.err("The job link should start with https://");
                onChange({ url: v });
              }}
            />
          </Field>
          <Field label="Role">
            <Input defaultValue={j.role} onBlur={(e) => e.target.value.trim() !== j.role && onChange({ role: e.target.value.trim() })} />
          </Field>
          <Field label="Company">
            <Input defaultValue={j.company} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== j.company && onChange({ company: e.target.value.trim() })} />
          </Field>
          <Field label="Deadline">
            <Input type="date" defaultValue={j.deadline ?? ""} onBlur={(e) => (e.target.value || undefined) !== j.deadline && onChange({ deadline: e.target.value || undefined })} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={3} defaultValue={j.notes ?? ""} placeholder="Program details, who referred you, what to mention…" onBlur={(e) => e.target.value !== (j.notes ?? "") && onChange({ notes: e.target.value })} />
        </Field>
      </div>
      <div className="min-w-0">
        <h4 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">
          <Sparkles className="size-3.5 text-brass" /> AI answers written for this job ({j.answers?.length ?? 0})
        </h4>
        {j.answers?.length ? (
          <ul className="max-h-80 space-y-2 overflow-auto">
            {j.answers.map((a, i) => (
              <li key={i} className="rounded-md border border-line bg-panel p-2.5 text-[12.5px]">
                <div className="font-medium text-ink">{a.question}</div>
                <p className="mt-1 whitespace-pre-wrap text-ink-2">{a.answer}</p>
                <div className="mt-1 flex items-center gap-3 text-[11.5px] text-muted">
                  {fmtDate(a.at)}
                  <button
                    className="text-navy hover:underline"
                    onClick={() => {
                      setApply((s) => ({ ...s, library: [...s.library, { q: a.question, a: a.answer }].slice(-30) }));
                      toast.ok("Saved to your answer library (Writing). Edit it there so the next one sounds like you.");
                    }}
                  >
                    Save to answer library
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">None yet. Open questions the extension drafts for this job are kept here, so you can check or reuse them.</p>
        )}
      </div>
    </div>
  );
}

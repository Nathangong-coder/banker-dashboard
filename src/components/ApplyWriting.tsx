"use client";

import { useRef, useState } from "react";
import { FileText, FileUp, Plus, Trash2, Upload } from "lucide-react";
import { blobs, useStore } from "@/lib/store";
import { documentText } from "@/lib/fileText";
import type { WritingSample } from "@/lib/apply";
import { fmtDate, uid } from "@/lib/util";
import { Button, Card, CardHeader, Empty, Field, Input, Select, Textarea, toast } from "./ui";
import { ResumeCard } from "./ResumeCard";

/** Applications → Writing: samples of your writing (for the AI's voice) and your answer library (facts + voice). */

const KINDS: { id: WritingSample["kind"]; label: string }[] = [
  { id: "cover_letter", label: "Cover letter" },
  { id: "essay", label: "Essay" },
  { id: "short_answer", label: "Short answer" },
  { id: "email", label: "Email" },
  { id: "other", label: "Other" },
];
const MAX_SAMPLE = 20_000;
const MAX_SAMPLES = 20;

export function ApplyWriting() {
  const samples = useStore((s) => s.apply.samples);
  const library = useStore((s) => s.apply.library);
  const setApply = useStore((s) => s.setApply);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ title: string; kind: WritingSample["kind"]; text: string }>({ title: "", kind: "cover_letter", text: "" });
  const [qa, setQa] = useState({ q: "", a: "" });

  const addSample = (title: string, kind: WritingSample["kind"], text: string) => {
    const t = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (t.length < 80) return toast.err("That's too short to show your style. Add at least a paragraph.");
    if (samples.length >= MAX_SAMPLES) return toast.err(`You have ${MAX_SAMPLES} samples. Delete one first.`);
    setApply((a) => ({ ...a, samples: [{ id: uid("ws"), title: title.trim() || "Untitled", kind, text: t.slice(0, MAX_SAMPLE), addedAt: new Date().toISOString() }, ...a.samples] }));
    toast.ok(t.length > MAX_SAMPLE ? `Added (kept the first ${MAX_SAMPLE.toLocaleString()} characters).` : "Added.");
  };

  const onFiles = async (files: FileList | null) => {
    for (const f of [...(files ?? [])]) {
      try {
        addSample(f.name.replace(/\.[^.]+$/, ""), /cover/i.test(f.name) ? "cover_letter" : /essay/i.test(f.name) ? "essay" : "other", await documentText(f.name, await f.arrayBuffer()));
      } catch (e) {
        toast.err(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader
          title="Writing samples"
          sub="Cover letters, essays, past short answers: the AI copies your voice from these (only the first 8 are sent, ~6k characters each). Facts still come from My info and the answer library."
          right={
            <>
              <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
              <Button size="sm" variant="secondary" icon={<FileUp className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                Upload
              </Button>
            </>
          }
        />
        <div className="grid gap-2 border-b border-line px-4 pb-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input placeholder="Title (e.g. Evercore cover letter)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as WritingSample["kind"] })} aria-label="Kind">
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </Select>
          </div>
          <Textarea rows={5} placeholder="Or paste something you wrote…" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          <div>
            <Button
              size="sm"
              icon={<Plus className="size-3.5" />}
              disabled={!draft.text.trim()}
              onClick={() => {
                addSample(draft.title, draft.kind, draft.text);
                setDraft({ title: "", kind: draft.kind, text: "" });
              }}
            >
              Add sample
            </Button>
          </div>
        </div>
        {samples.length === 0 ? (
          <Empty icon={<FileText className="size-6" />} title="No samples yet">
            Two or three pieces you&apos;re happy with are enough.
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {samples.map((s) => (
              <li key={s.id} className="group px-4 py-2.5">
                <details>
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] [&::-webkit-details-marker]:hidden">
                    <FileText className="size-3.5 shrink-0 text-brass" />
                    <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                    <span className="text-[11.5px] text-muted">
                      {KINDS.find((k) => k.id === s.kind)?.label} · {s.text.split(/\s+/).length} words · {fmtDate(s.addedAt)}
                    </span>
                    <button
                      type="button"
                      className="rounded p-1 text-muted opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-red focus:opacity-100"
                      aria-label={`Delete ${s.title}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setApply((a) => ({ ...a, samples: a.samples.filter((x) => x.id !== s.id) }));
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </summary>
                  <p className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-[12.5px] text-ink-2">{s.text}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Answer library"
          sub="Your own answers to the questions that keep coming up (“Tell us about yourself”, “Why investment banking?”). The AI uses them as facts and as your voice; save good AI drafts here from a job's row, then edit them."
        />
        <div className="grid gap-2 border-b border-line px-4 pb-4">
          <Field label="Question">
            <Input value={qa.q} placeholder="Why investment banking?" onChange={(e) => setQa({ ...qa, q: e.target.value })} />
          </Field>
          <Field label="Your answer">
            <Textarea rows={4} value={qa.a} onChange={(e) => setQa({ ...qa, a: e.target.value })} />
          </Field>
          <div>
            <Button
              size="sm"
              icon={<Plus className="size-3.5" />}
              disabled={!qa.q.trim() || !qa.a.trim()}
              onClick={() => {
                if (library.length >= 30) return toast.err("The library holds 30 answers. Delete one first.");
                setApply((a) => ({ ...a, library: [...a.library, { q: qa.q.trim().slice(0, 600), a: qa.a.trim().slice(0, 4000) }] }));
                setQa({ q: "", a: "" });
              }}
            >
              Add answer
            </Button>
          </div>
        </div>
        {library.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-muted">No answers yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {library.map((x, i) => (
              <li key={i} className="group px-4 py-2.5 text-[12.5px]">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 font-medium text-ink">{x.q}</span>
                  <button
                    type="button"
                    className="rounded p-1 text-muted opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-red focus:opacity-100"
                    aria-label="Delete this answer"
                    onClick={() => setApply((a) => ({ ...a, library: a.library.filter((_, j) => j !== i) }))}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <Textarea
                  key={`${i}:${x.a.length}`}
                  rows={3}
                  className="mt-1"
                  defaultValue={x.a}
                  aria-label={`Answer to ${x.q}`}
                  onBlur={(e) => e.target.value !== x.a && setApply((a) => ({ ...a, library: a.library.map((y, j) => (j === i ? { ...y, a: e.target.value.slice(0, 4000) } : y)) }))}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const MAX_RESUME = 5 * 1024 * 1024;

/** Applications → Resumes: your main resume (also attached to first cold emails) plus versions for specific jobs. */
export function ApplyResumes() {
  const resumes = useStore((s) => s.apply.resumes);
  const setApply = useStore((s) => s.setApply);
  const ref = useRef<HTMLInputElement>(null);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(pdf|docx?)$/i.test(f.name)) return toast.err("Use a PDF or Word file.");
    if (f.size > MAX_RESUME) return toast.err("That file is over 5 MB; most application sites won't take it.");
    const id = uid("rs");
    await blobs.setAppResume(id, { name: f.name, type: f.type || "application/pdf", data: await f.arrayBuffer() });
    setApply((a) => ({ ...a, resumes: [...a.resumes, { id, name: f.name, size: f.size, addedAt: new Date().toISOString() }] }));
    if (ref.current) ref.current.value = "";
    toast.ok(`Added ${f.name}. Pick it on a job's row to upload it there instead of your main resume.`);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
      <div className="grid content-start gap-2">
        <ResumeCard />
        <p className="px-1 text-[12px] text-muted">Your main resume: uploaded to every application unless a job picks another one, and attached to first cold emails.</p>
      </div>
      <Card>
        <CardHeader
          title="Other versions"
          sub="A tech-focused or restructuring-focused resume, say. Choose one per job on the Jobs tab."
          right={
            <>
              <input ref={ref} type="file" accept=".pdf,.doc,.docx" hidden onChange={(e) => void upload(e.target.files?.[0])} />
              <Button size="sm" variant="secondary" icon={<Upload className="size-3.5" />} onClick={() => ref.current?.click()}>
                Upload
              </Button>
            </>
          }
        />
        {resumes.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-muted">No other versions.</p>
        ) : (
          <ul className="divide-y divide-line">
            {resumes.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                <FileText className="size-3.5 text-brass" />
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                {/* Postings only open to this class year go out with this version (the AI job review picks it). */}
                <select
                  className="h-7 rounded-md border border-line-2 bg-panel px-1.5 text-[12px] text-ink-2"
                  aria-label={`Class year ${r.name} is for`}
                  value={r.classYear ?? ""}
                  onChange={(e) => setApply((a) => ({ ...a, resumes: a.resumes.map((x) => (x.id === r.id ? { ...x, classYear: Number(e.target.value) || undefined } : x)) }))}
                >
                  <option value="">Any class year</option>
                  {[0, 1, 2, 3].map((d) => {
                    const y = new Date().getFullYear() + d;
                    return (
                      <option key={y} value={y}>
                        For class of {y} postings
                      </option>
                    );
                  })}
                </select>
                <span className="text-[11.5px] text-muted">
                  {Math.round(r.size / 1024)} KB · {fmtDate(r.addedAt)}
                </span>
                <button
                  type="button"
                  className="rounded p-1 text-muted hover:bg-hover hover:text-red"
                  aria-label={`Delete ${r.name}`}
                  onClick={async () => {
                    await blobs.setAppResume(r.id, undefined);
                    setApply((a) => ({ ...a, resumes: a.resumes.filter((x) => x.id !== r.id), jobs: a.jobs.map((j) => (j.resumeId === r.id ? { ...j, resumeId: undefined } : j)) }));
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

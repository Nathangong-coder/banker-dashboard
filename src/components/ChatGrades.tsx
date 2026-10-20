"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, ClipboardCopy, FileUp, GraduationCap, Handshake, Save, Sparkles, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { callApi } from "@/lib/api";
import { aiReady } from "@/lib/keys";
import { hookFor } from "@/lib/hooks";
import { DEFAULT_GENERAL_QUESTIONS } from "@/lib/defaults";
import type { ChatGrade, ChatLog, Contact } from "@/lib/types";
import { cn, relDays, uid } from "@/lib/util";
import { Badge, Button, Card, Checkbox, Input, Textarea, toast } from "@/components/ui";

const MAX_CHARS = 120_000;
const MIN_CHARS = 200;

/* ---------------- transcript files ---------------- */

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

/** Paragraph text of a .docx (JSZip loaded on demand: it's only needed for Word files). */
async function docxText(data: ArrayBuffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("That doesn't look like a Word document.");
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [])
    .map((p) =>
      [...p.matchAll(/<w:(t|tab|br)(?: [^>]*)?(?:\/>|>([^<]*)<\/w:t>)/g)]
        .map((m) => (m[1] === "t" ? decodeXml(m[2] ?? "") : m[1] === "tab" ? "\t" : "\n"))
        .join(""),
    )
    .join("\n");
}

/**
 * Captions (.vtt / .srt) → "Speaker: text" lines: drops the WEBVTT header, NOTE blocks, cue numbers and timestamps,
 * turns `<v Name>` voice tags into "Name:", and merges consecutive cues from the same speaker.
 */
export function cleanCaptions(raw: string): string {
  const out: { who: string; text: string }[] = [];
  const blocks = raw.replace(/\r/g, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    for (const line of lines) {
      if (/^\d+$/.test(line.trim()) || line.includes("-->")) continue;
      let who = "";
      let text = line.replace(/<v(?:\.[^ >]*)? ([^>]+)>/, (_, name: string) => ((who = name.trim()), ""));
      text = text.replace(/<[^>]+>/g, "").trim();
      if (!who) {
        const m = text.match(/^([A-Z][\w.'-]*(?: [A-Z][\w.'-]*){0,3}|Speaker \d+):\s+(.*)$/);
        if (m) [who, text] = [m[1], m[2]];
      }
      if (!text) continue;
      const last = out[out.length - 1];
      if (last && (last.who === who || !who)) last.text += ` ${text}`;
      else out.push({ who, text });
    }
  }
  return out.map((x) => (x.who ? `${x.who}: ${x.text}` : x.text)).join("\n");
}

async function readTranscriptFile(f: File): Promise<string> {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "docx") return docxText(await f.arrayBuffer());
  if (ext === "doc") throw new Error("Old .doc files can't be read. Save it as .docx or .txt first.");
  if (!["txt", "vtt", "srt", "md"].includes(ext)) throw new Error("Use a .txt, .vtt, .srt, .md or .docx file.");
  const text = await f.text();
  return ext === "vtt" || ext === "srt" || /^WEBVTT/.test(text) ? cleanCaptions(text) : text;
}

const tidy = (s: string) => s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/* ---------------- dates ---------------- */

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** The call's own date when it already happened (or is today), else today. */
function defaultDate(c: Contact) {
  const now = new Date();
  if (c.call?.at) {
    const at = new Date(c.call.at);
    if (!Number.isNaN(at.getTime()) && ymd(at) <= ymd(now)) return ymd(at);
  }
  return ymd(now);
}
/** Noon local, so the date doesn't slip a day in another zone. */
const isoOf = (date: string) => new Date(`${date}T12:00:00`).toISOString();
const showDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const tone = (score: number) => (score >= 85 ? "green" : score >= 70 ? "brass" : score >= 55 ? "amber" : "red");

/* ---------------- card ---------------- */

export function ChatGrades({ c }: { c: Contact }) {
  const settings = useStore((s) => s.settings);
  const updateContact = useStore((s) => s.updateContact);
  const chats = c.chats;
  const list = chats ?? [];
  const [date, setDate] = useState(() => defaultDate(c));
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(() => chats?.[0]?.id ?? null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canGrade = aiReady(settings);

  const save = (next: ChatLog[]) => updateContact(c.id, { chats: next });
  const latest = () => useStore.getState().contacts.find((x) => x.id === c.id)?.chats ?? [];

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const t = tidy(await readTranscriptFile(f));
      if (!t) return toast.err("That file has no text in it.");
      setText(t.slice(0, MAX_CHARS));
      setSource(f.name);
      if (t.length > MAX_CHARS) toast.info(`That transcript is long, so only the first ${MAX_CHARS / 1000}k characters were kept.`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const grade = async (transcript: string, notes?: string): Promise<ChatGrade> => {
    const p = settings.profile;
    const prep = c.prep;
    const general = settings.prep?.generalQuestions?.length ? settings.prep.generalQuestions : DEFAULT_GENERAL_QUESTIONS;
    const r = await callApi<Omit<ChatGrade, "gradedAt">>(
      "/api/prep/grade",
      {
        transcript: transcript.slice(0, MAX_CHARS),
        contact: { name: c.name, bank: c.bank, position: c.position, team: c.team ?? "", school: c.school ?? "" },
        me: { name: p.name, school: p.school, major: p.major, pitch: hookFor(c, settings).text.slice(0, 1000) },
        prep: prep
          ? { brief: prep.brief.slice(0, 2000), intro: prep.intro.slice(0, 2000), questions: [...prep.tailored.map((t) => t.question), ...general].slice(0, 20).map((q) => q.slice(0, 400)) }
          : undefined,
        notes: (notes ?? prep?.notes)?.slice(0, 4000) || undefined,
      },
      settings,
    );
    return { ...r, gradedAt: new Date().toISOString() };
  };

  const add = async (withGrade: boolean) => {
    const t = tidy(text);
    if (!t) return toast.err("Upload or paste a transcript first.");
    if (withGrade && t.length < MIN_CHARS) return toast.err("That's too short to grade. Paste the whole call.");
    if (withGrade && !canGrade) return toast.err("Add an AI key in Settings to grade calls. You can still save the transcript.");
    const log: ChatLog = { id: uid("chat"), at: isoOf(date), transcript: t, source: source || "pasted" };
    setBusy("new");
    try {
      if (withGrade) log.grade = await grade(t);
      save([log, ...latest()].sort((a, b) => b.at.localeCompare(a.at)));
      setText("");
      setSource("");
      setOpen(log.id);
      toast.ok(withGrade ? `Graded: ${log.grade!.score}/100 (${log.grade!.letter}).` : "Transcript saved.");
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const regrade = async (log: ChatLog) => {
    if (!log.transcript) return;
    if (!canGrade) return toast.err("Add an AI key in Settings first.");
    setBusy(log.id);
    try {
      const g = await grade(log.transcript, log.notes);
      save(latest().map((x) => (x.id === log.id ? { ...x, grade: g } : x)));
      setOpen(log.id);
      toast.ok(`Graded: ${g.score}/100 (${g.letter}).`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = (log: ChatLog) => {
    if (!window.confirm(`Delete the ${showDate(log.at)} call${log.grade ? " and its grade" : ""}? This can't be undone.`)) return;
    save(latest().filter((x) => x.id !== log.id));
  };

  const setReferral = (on: boolean) => updateContact(c.id, { referral: on ? { at: new Date().toISOString(), note: c.referral?.note } : undefined });

  return (
    <Card className="p-4 print:hidden">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Transcripts &amp; grades</div>
        {list.length > 0 && <span className="text-[11.5px] text-muted">{list.length} call{list.length === 1 ? "" : "s"}</span>}
      </div>

      {/* New transcript */}
      <div className="space-y-2 rounded-lg bg-subtle p-3">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <label className="flex items-center gap-1.5 text-ink-2">
            Call on
            <Input type="date" className="h-8 w-[150px]" value={date} max={ymd(new Date())} onChange={(e) => setDate(e.target.value || defaultDate(c))} />
          </label>
          <Button size="sm" icon={<FileUp className="size-3.5" />} onClick={() => fileRef.current?.click()}>
            Upload transcript
          </Button>
          <input ref={fileRef} type="file" accept=".txt,.vtt,.srt,.md,.docx,text/plain,text/vtt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <span className="text-[11.5px] text-muted">.txt .vtt .srt .md .docx (Zoom, Teams, Otter, Google Meet)</span>
        </div>
        <Textarea
          rows={text ? 8 : 4}
          value={text}
          onChange={(e) => {
            setText(e.target.value.slice(0, MAX_CHARS));
            if (!e.target.value) setSource("");
          }}
          placeholder="…or paste the transcript here. Speaker names help (“Nathan: …”, “Elixa: …”)."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="brass" size="sm" loading={busy === "new"} disabled={!!busy || !text.trim()} icon={<Sparkles className="size-3.5" />} onClick={() => add(true)}>
            Grade it
          </Button>
          <Button size="sm" variant="ghost" disabled={!!busy || !text.trim()} icon={<Save className="size-3.5" />} onClick={() => add(false)}>
            Save without grading
          </Button>
          <span className="text-[11.5px] text-muted">
            {text ? `${(text.length / 1000).toFixed(1)}k chars${source ? ` from ${source}` : ""}. ` : ""}
            {canGrade ? "Graded by your AI model; the transcript stays in this browser." : "No AI key yet: you can save it now and grade it later."}
          </span>
        </div>
      </div>

      {/* Referral */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <label className="flex items-center gap-1.5">
          <Checkbox checked={!!c.referral} onChange={setReferral} label="They referred me or did what they said" />
          <Handshake className="size-3.5 text-green" />
          They referred me / did what they said
        </label>
        {c.referral && (
          <>
            <span className="text-[11.5px] text-muted">{relDays(c.referral.at)}</span>
            <Input
              key={c.referral.at}
              className="h-7 min-w-0 flex-1 basis-[200px] text-[12.5px]"
              placeholder="Note (e.g. passed my resume to the SF Tech staffer)"
              defaultValue={c.referral.note ?? ""}
              onBlur={(e) => {
                const note = e.target.value.trim() || undefined;
                if (c.referral && note !== c.referral.note) updateContact(c.id, { referral: { ...c.referral, note } });
              }}
            />
          </>
        )}
      </div>

      {/* Past calls */}
      {list.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {list.map((log) => {
            const expanded = open === log.id;
            return (
              <li key={log.id}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(expanded ? null : log.id)} aria-expanded={expanded}>
                    {expanded ? <ChevronDown className="size-3.5 shrink-0 text-muted" /> : <ChevronRight className="size-3.5 shrink-0 text-muted" />}
                    <span className="text-[13px] font-medium">{showDate(log.at)}</span>
                    {log.grade ? (
                      <Badge tone={tone(log.grade.score)}>
                        <span className="num">{log.grade.score}</span> · {log.grade.letter}
                      </Badge>
                    ) : (
                      <Badge>Not graded</Badge>
                    )}
                    {log.source && <span className="truncate text-[11.5px] text-muted">{log.source}</span>}
                  </button>
                  {log.transcript && (
                    <Button size="sm" variant="ghost" loading={busy === log.id} disabled={!!busy} icon={<GraduationCap className="size-3.5" />} onClick={() => regrade(log)}>
                      {log.grade ? "Regrade" : "Grade it"}
                    </Button>
                  )}
                  <button className="rounded p-1 text-muted hover:bg-red-soft hover:text-red" aria-label="Delete this call" onClick={() => remove(log)}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {expanded && (
                  <div className="border-t border-line px-3 py-3">
                    {log.grade ? <GradeView g={log.grade} name={c.firstName || c.name} /> : <p className="text-[12.5px] text-muted">Not graded yet.</p>}
                    {log.transcript && (
                      <details className="mt-3 text-[12.5px]">
                        <summary className="cursor-pointer text-navy">Transcript ({(log.transcript.length / 1000).toFixed(1)}k chars)</summary>
                        <pre className="mt-2 max-h-72 overflow-auto rounded bg-subtle p-2.5 font-sans text-[12.5px] whitespace-pre-wrap text-ink-2">{log.transcript}</pre>
                      </details>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">{children}</div>;
}

function GradeView({ g, name }: { g: ChatGrade; name: string }) {
  const t = tone(g.score);
  const copyThanks = () =>
    navigator.clipboard.writeText(g.thankYouPoints.map((x) => `- ${x}`).join("\n")).then(
      () => toast.ok("Copied. Work them into your thank-you email."),
      () => toast.err("Couldn't copy."),
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div
          className={cn(
            "flex shrink-0 flex-col items-center rounded-lg px-4 py-2.5",
            t === "green" && "bg-green-soft text-green",
            t === "brass" && "bg-brass-soft text-brass-ink",
            t === "amber" && "bg-amber-soft text-amber",
            t === "red" && "bg-red-soft text-red",
          )}
        >
          <span className="num text-[34px] leading-none">{g.score}</span>
          <span className="mt-1 text-[15px] font-semibold">{g.letter}</span>
        </div>
        <div className="min-w-0 flex-1 basis-[240px]">
          <p className="text-[13.5px] leading-relaxed">{g.summary}</p>
          <p className="mt-1 text-[11.5px] text-muted">Graded {relDays(g.gradedAt)}</p>
        </div>
      </div>

      {g.rubric.length > 0 && (
        <div>
          <Title>Rubric</Title>
          <ul className="space-y-2">
            {g.rubric.map((r, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-0.5 sm:grid-cols-[200px_minmax(0,1fr)]">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] font-medium" title={r.area}>
                    {r.area}
                  </span>
                  <span className="num ml-auto text-[12px] text-muted">{r.score}/5</span>
                </div>
                <div className="min-w-0">
                  <div className="h-1.5 overflow-hidden rounded-full bg-track" role="meter" aria-valuemin={1} aria-valuemax={5} aria-valuenow={r.score} aria-label={r.area}>
                    <div className={cn("h-full rounded-full", r.score >= 4 ? "bg-green" : r.score === 3 ? "bg-brass" : "bg-red")} style={{ width: `${(r.score / 5) * 100}%` }} />
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-2">{r.comment}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[1fr_1.4fr]">
        <div>
          <Title>What went well</Title>
          <ul className="space-y-1 text-[13px]">
            {g.strengths.map((s, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-green">●</span> {s}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Title>Do better next time</Title>
          <ol className="space-y-2.5 text-[13px]">
            {g.improvements.map((x, i) => (
              <li key={i}>
                <div className="font-medium">{x.issue}</div>
                {x.quote && <div className="mt-0.5 border-l-2 border-line-2 pl-2 text-[12px] text-muted italic">“{x.quote}”</div>}
                <div className="mt-0.5 text-ink-2">→ {x.suggestion}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
        <div>
          <Title>{name} said they&apos;d…</Title>
          {g.commitments.length ? (
            <ul className="space-y-1 text-[13px]">
              {g.commitments.map((s, i) => (
                <li key={i} className="flex gap-1.5">
                  <Handshake className="mt-0.5 size-3.5 shrink-0 text-green" /> {s}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted">No promises in the transcript.</p>
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <Title>For your thank-you</Title>
            {g.thankYouPoints.length > 0 && (
              <button className="mb-1.5 ml-auto flex items-center gap-1 text-[12px] text-navy hover:underline" onClick={copyThanks}>
                <ClipboardCopy className="size-3" /> Copy
              </button>
            )}
          </div>
          <ul className="space-y-1 text-[13px]">
            {g.thankYouPoints.map((s, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-brass">●</span> {s}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

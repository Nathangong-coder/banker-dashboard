"use client";

import { Fragment, useRef, useState } from "react";
import { AlertTriangle, FileUp, Link2, Sparkles } from "lucide-react";
import { useStore } from "@/lib/store";
import { callApi } from "@/lib/api";
import { aiReady } from "@/lib/keys";
import { PLACEHOLDERS } from "@/lib/template";
import { docxToBlocks, parseTemplateBlocks, sameWording, textToBlocks, toTemplate, type ImportCandidate, type ImportResult } from "@/lib/templateImport";
import { cn, uid } from "@/lib/util";
import { Badge, Button, Checkbox, Input, Modal, toast } from "./ui";

/** Render text with {{placeholders}} and [[AI: slots]] highlighted, so every substitution is visible. */
function Marked({ text }: { text: string }) {
  const parts = text.split(/(\{\{\s*\w+\s*\}\}|\[\[[\s\S]*?\]\])/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("{{") ? (
          <mark key={i} className="rounded bg-blue-soft px-0.5 text-blue">{p}</mark>
        ) : p.startsWith("[[") ? (
          <mark key={i} className="rounded bg-amber-soft px-0.5 text-amber">{p}</mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export function TemplateImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const templates = useStore((s) => s.templates);
  const upsert = useStore((s) => s.upsertTemplate);
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [generalize, setGeneralize] = useState(true);
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [aiRejected, setAiRejected] = useState<string[]>([]);

  const existingByName = new Map(templates.map((t) => [t.name.toLowerCase().trim(), t]));

  const analyze = async (getBytes: () => Promise<{ bytes?: ArrayBuffer; text?: string }>) => {
    setBusy("Reading document…");
    setResult(null);
    setAiRejected([]);
    try {
      const { bytes, text } = await getBytes();
      const blocks = bytes ? await docxToBlocks(bytes) : textToBlocks(text ?? "");
      const p = settings.profile;
      let r = parseTemplateBlocks(blocks, {
        senderName: p.name,
        generalize: generalize ? { name: p.name, school: p.school, major: p.major, pitch: p.pitch, club: p.club, schoolNickname: p.schoolNickname, hometown: p.hometown } : undefined,
      });
      if (!r.candidates.length) throw new Error("No emails found. Each template needs a greeting line like “Hi NAME,”.");
      if (useAi && aiReady(settings)) {
        setBusy("AI is naming templates and resolving blanks…");
        r = await refineWithAi(r);
      }
      setResult(r);
      setPicked(new Set(r.candidates.map((c) => c.key)));
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const refineWithAi = async (r: ImportResult): Promise<ImportResult> => {
    try {
      const { templates: out } = await callApi<{ templates: { key: string; name: string; whenToUse: string; subject: string; body: string }[] }>(
        "/api/templates/organize",
        {
          placeholders: PLACEHOLDERS.map((p) => p.key),
          candidates: r.candidates.map(({ key, tab, heading, name, whenToUse, subject, body, unknownBlanks }) => ({ key, tab, heading, name, whenToUse, subject, body, unknownBlanks })),
        },
        settings,
      );
      const byKey = new Map(out.map((t) => [t.key, t]));
      const rejected: string[] = [];
      const candidates = r.candidates.map((c) => {
        const t = byKey.get(c.key);
        if (!t) return c;
        // Wording guard: accept the AI's text only if every original word survives.
        const wordingOk = sameWording(c.body, t.body) && sameWording(c.subject, t.subject);
        if (!wordingOk) rejected.push(c.name);
        return {
          ...c,
          name: t.name || c.name,
          whenToUse: t.whenToUse || c.whenToUse,
          ...(wordingOk ? { subject: t.subject, body: t.body, unknownBlanks: [] } : {}),
        };
      });
      setAiRejected(rejected);
      return { ...r, candidates };
    } catch (e) {
      toast.info(`AI pass skipped (${(e as Error).message}). Showing the rule-based result.`);
      return r;
    }
  };

  const onFile = (f: File) =>
    analyze(async () => (/\.docx$/i.test(f.name) ? { bytes: await f.arrayBuffer() } : /\.doc$/i.test(f.name) ? Promise.reject(new Error("Old .doc files aren't supported. In Word: File → Save As → .docx")) : { text: await f.text() }));

  const onLink = () =>
    analyze(async () => {
      const res = await fetch("/api/templates/gdoc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: link.trim() }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      return { bytes: await res.arrayBuffer() };
    });

  const doImport = () => {
    if (!result) return;
    let added = 0;
    let updated = 0;
    for (const c of result.candidates.filter((c) => picked.has(c.key))) {
      const existing = existingByName.get(c.name.toLowerCase().trim());
      upsert(toTemplate(c, existing?.id ?? uid("tpl")));
      if (existing) updated++;
      else added++;
    }
    toast.ok(`Imported templates: ${added} new, ${updated} updated.`);
    setResult(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Import templates from a document" wide>
      {!result ? (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-2">
            Works best with one section per template, using <b>Google Docs tabs</b> or <b>headings/bold titles</b>, the <b>subject line</b> just above{" "}
            <b>“Hi NAME,”</b>, and blanks in ALL CAPS (NAME, FIRM, POSITION, SCHOOL, HOMETOWN, CLUB, CITY…). Every change is shown for review before anything is saved.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-line p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium"><FileUp className="size-4 text-brass" /> Word / Google Docs file</div>
              <p className="mb-2 text-[12px] text-muted">.docx, or in Google Docs: File → Download → Microsoft Word (.docx). Tabs are kept. Also takes .txt / .md.</p>
              <Button onClick={() => fileRef.current?.click()} loading={!!busy}>Choose file</Button>
              <input ref={fileRef} type="file" accept=".docx,.doc,.txt,.md" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
            </div>
            <div className="rounded-lg border border-line p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium"><Link2 className="size-4 text-brass" /> Google Docs link</div>
              <p className="mb-2 text-[12px] text-muted">The doc must be shared as “Anyone with the link can view”.</p>
              <div className="flex gap-1.5">
                <Input className="text-[12.5px]" placeholder="https://docs.google.com/document/d/…" value={link} onChange={(e) => setLink(e.target.value)} />
                <Button onClick={onLink} disabled={!link.trim()} loading={!!busy}>Read</Button>
              </div>
            </div>
          </div>
          <div className="space-y-1.5 text-[12.5px]">
            <label className="flex items-center gap-2">
              <Checkbox checked={generalize} onChange={setGeneralize} /> Replace my own details (name, school, major, background line…) with placeholders, so edits to my profile flow into every template
            </label>
            <label className={cn("flex items-center gap-2", !aiReady(settings) && "opacity-50")}>
              <Checkbox checked={useAi && aiReady(settings)} onChange={setUseAi} /> <Sparkles className="size-3.5 text-brass" /> Use AI to name templates, write “when to use” rules, and resolve unusual blanks
              {!aiReady(settings) && <span className="text-muted">(add an AI key in Settings)</span>}
            </label>
          </div>
          {busy && <p className="text-[12.5px] text-ink-2">{busy}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="font-medium">{result.candidates.length} templates found</span>
            <span className="text-muted">· <mark className="rounded bg-blue-soft px-0.5 text-blue">{"{{blue}}"}</mark> filled automatically · <mark className="rounded bg-amber-soft px-0.5 text-amber">[[amber]]</mark> written by AI per contact</span>
          </div>
          {aiRejected.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-soft/60 p-2 text-[12px] text-amber">
              <AlertTriangle className="mt-px size-3.5 shrink-0" /> The AI tried to reword {aiRejected.join(", ")}, so its edits there were discarded and your original wording was kept.
            </p>
          )}
          <ul className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {result.candidates.map((c) => (
              <CandidateCard
                key={c.key}
                c={c}
                exists={existingByName.has(c.name.toLowerCase().trim())}
                checked={picked.has(c.key)}
                onCheck={(v) => {
                  const n = new Set(picked);
                  if (v) n.add(c.key);
                  else n.delete(c.key);
                  setPicked(n);
                }}
              />
            ))}
          </ul>
          {(result.skipped.length > 0 || result.notes.length > 0) && (
            <div className="rounded-md bg-[#f4f2eb] p-2.5 text-[12px] text-ink-2">
              {result.skipped.map((s) => (
                <div key={s.where}>Skipped <b>{s.where}</b>: {s.reason}.</div>
              ))}
              {result.notes.length > 0 && <div className="mt-1">Notes in the doc (not templates): {result.notes.join(" · ")}</div>}
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-3">
            <Button variant="ghost" onClick={() => setResult(null)}>Back</Button>
            <Button variant="primary" onClick={doImport} disabled={!picked.size}>
              Import {picked.size} template{picked.size === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function CandidateCard({ c, exists, checked, onCheck }: { c: ImportCandidate; exists: boolean; checked: boolean; onCheck: (v: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={cn("rounded-lg border p-3", checked ? "border-line-2 bg-panel" : "border-line bg-[#fbfaf6] opacity-70")}>
      <div className="flex items-start gap-2.5">
        <div className="pt-0.5"><Checkbox checked={checked} onChange={onCheck} label={`Import ${c.name}`} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{c.name}</span>
            <Badge tone={exists ? "amber" : "green"}>{exists ? "updates existing" : "new"}</Badge>
            {c.kind === "follow_up" && <Badge>follow-up #{c.step}</Badge>}
            {c.unknownBlanks.length > 0 && <Badge tone="red">check: {c.unknownBlanks.join(", ")}</Badge>}
            <span className="text-[11.5px] text-muted">from “{c.tab === c.heading ? c.tab : `${c.tab} → ${c.heading}`}”</span>
          </div>
          <div className="mt-0.5 text-[12px] text-ink-2">{c.whenToUse}</div>
          <div className="mt-1.5 text-[12.5px]"><span className="text-muted">Subject: </span><Marked text={c.subject || "(none)"} /></div>
          <button className="mt-1 text-[12px] text-navy hover:underline" onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Show"} body & {c.substitutions.length} substitution{c.substitutions.length === 1 ? "" : "s"}
          </button>
          {open && (
            <div className="mt-2 grid gap-3 md:grid-cols-[1fr_240px]">
              <pre className="font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap"><Marked text={c.body} /></pre>
              <ul className="space-y-1 text-[11.5px]">
                {c.substitutions.map((s, i) => (
                  <li key={i}>
                    <span className="num text-red/80 line-through">{s.from}</span> → <span className="num text-blue">{s.to}</span>
                    <div className="text-muted">{s.why}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

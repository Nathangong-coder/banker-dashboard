"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileText, FileUp, Mail, Paperclip, Pencil, Plus, Send, Sparkles, Wand2 } from "lucide-react";
import { blobs, useStore } from "@/lib/store";
import { callApi } from "@/lib/api";
import { connectGmail, createDraft } from "@/lib/gmail";
import { fillPlaceholders, hasAiSlots, missingPlaceholders, ruleAssign, AI_SLOT } from "@/lib/template";
import { EMAIL_FONTS, type Contact, type Template } from "@/lib/types";
import { chunk, cn, pool, uid } from "@/lib/util";
import { overCap } from "@/lib/followups";
import { bodyToPlain, normalizeBody, normalizeSubject, withSignature } from "@/lib/emailFormat";
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Field, Input, Modal, PageHeader, Progress, Select, StatusBadge, Textarea, toast } from "@/components/ui";
import { FilterBar, useContactFilter, type Filters } from "@/components/ContactsTable";
import { TemplateEditor } from "@/components/TemplateEditor";
import { TemplateImport } from "@/components/TemplateImport";
import { FirmPanel, FirmSummary, useFirmRows } from "@/components/FirmContext";
import { DEFAULT_TEMPLATES } from "@/lib/defaults";
import { aiReady, googleClientId } from "@/lib/keys";

export default function DraftsPage() {
  return (
    <Suspense>
      <DraftsInner />
    </Suspense>
  );
}

function DraftsInner() {
  const params = useSearchParams();
  const s = useStore();
  const { settings, templates, contacts } = s;
  const [f, setF] = useState<Filters>(() => ({ q: "", bank: params.get("bank") ?? "", region: "", status: "new", email: "" }));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Template | null>(null);
  const [preview, setPreview] = useState<Contact | null>(null);
  const [phase, setPhase] = useState<null | { label: string; done: number; total: number }>(null);
  const [importOpen, setImportOpen] = useState(false);
  const resumeRef = useRef<HTMLInputElement>(null);

  const rows = useContactFilter(contacts, f);
  const chosen = contacts.filter((c) => sel.has(c.id));
  const initialTemplates = templates.filter((t) => t.kind === "initial");
  const contextBanks = useMemo(() => {
    const fromSel = [...new Set(chosen.map((c) => c.bank))];
    return (fromSel.length ? fromSel : f.bank ? [f.bank] : []).slice(0, 6);
  }, [chosen, f.bank]);
  // Per-bank count of people already emailed, for the "N already contacted here" chip on each row.
  const reachedByBank = useMemo(() => {
    const m = new Map<string, Contact[]>();
    for (const c of contacts) if (c.sentAt || ["sent", "followed_up", "replied", "call_scheduled", "done"].includes(c.status)) m.set(c.bank, [...(m.get(c.bank) ?? []), c]);
    return m;
  }, [contacts]);
  const missingStarters = DEFAULT_TEMPLATES.filter((d) => !templates.some((t) => t.id === d.id || t.name.toLowerCase() === d.name.toLowerCase()));
  const profileMissing = !settings.profile.name || !settings.profile.school;

  const assign = async () => {
    if (!chosen.length) return toast.err("Select contacts first.");
    if (!initialTemplates.length) return toast.err("Add a template first.");
    if (!aiReady(settings)) {
      s.updateContacts(chosen.map((c) => ({ id: c.id, patch: { templateId: ruleAssign(c, templates)?.id } })));
      toast.info("Assigned with simple keyword rules. Add an AI key for smarter matching.");
      return;
    }
    setPhase({ label: "Assigning templates", done: 0, total: chosen.length });
    let done = 0;
    for (const b of chunk(chosen, 20)) {
      try {
        const { assignments } = await callApi<{ assignments: { contactId: string; templateId: string }[] }>(
          "/api/draft",
          {
            mode: "assign",
            templates: initialTemplates.map(({ id, name, whenToUse }) => ({ id, name, whenToUse })),
            contacts: b.map(facts),
          },
          settings,
        );
        const valid = new Set(initialTemplates.map((t) => t.id));
        s.updateContacts(assignments.filter((a) => valid.has(a.templateId)).map((a) => ({ id: a.contactId, patch: { templateId: a.templateId } })));
      } catch (e) {
        toast.err((e as Error).message);
        break;
      }
      done += b.length;
      setPhase({ label: "Assigning templates", done, total: chosen.length });
    }
    setPhase(null);
  };

  const generate = async () => {
    const list = chosen.filter((c) => c.templateId || initialTemplates[0]);
    if (!list.length) return toast.err("Select contacts first.");
    const over = overCap(contacts, list, settings.followUp.livePerBank);
    if (over.length)
      toast.info(
        `Heads up: this puts ${over.map(([b, n]) => `${b} at ${n}`).join(", ")} live contacts (your cap is ${settings.followUp.livePerBank} per bank).`,
      );
    if (profileMissing) toast.info("Tip: fill in your name and school in Settings so {{my_*}} placeholders work.");
    setPhase({ label: "Writing drafts", done: 0, total: list.length });
    let failed = 0;
    await pool(
      list,
      4,
      async (c) => {
        const t = templates.find((x) => x.id === c.templateId) ?? ruleAssign(c, templates)!;
        let subject = fillPlaceholders(t.subject, c, settings);
        let body = fillPlaceholders(t.body, c, settings);
        body = withSignature(body, settings.profile);
        const needsAi = hasAiSlots(subject + body) || missingPlaceholders(subject + body).length > 0;
        if (needsAi && aiReady(settings)) {
          try {
            const r = await callApi<{ subject: string; body: string }>(
              "/api/draft",
              { mode: "fill", contact: facts(c), sender: senderFacts(), subject, body },
              settings,
            );
            subject = r.subject;
            body = r.body;
          } catch (e) {
            failed++;
            toast.err(`${c.name}: ${(e as Error).message}`);
            return;
          }
        } else if (needsAi) {
          body = body.replace(new RegExp(AI_SLOT.source, "g"), "").replace(/\n{3,}/g, "\n\n");
        }
        s.updateContact(c.id, { templateId: t.id, draft: { subject: normalizeSubject(subject), body: normalizeBody(body), createdAt: new Date().toISOString() } });
      },
      (done) => setPhase({ label: "Writing drafts", done, total: list.length }),
    );
    setPhase(null);
    toast.ok(`Drafted ${list.length - failed} emails. Review them, then send to Gmail.`);
  };

  const senderFacts = () => {
    const p = settings.profile;
    return { name: p.name, school: p.school, year: p.year, major: p.major, hometown: p.hometown, linkedin: p.linkedin, phone: p.phone };
  };

  const toGmail = async () => {
    const list = chosen.filter((c) => c.draft && c.email);
    const skipped = chosen.length - list.length;
    if (!list.length) return toast.err("None of the selected contacts have both a draft and an email.");
    try {
      await connectGmail(googleClientId(settings));
    } catch (e) {
      return toast.err((e as Error).message);
    }
    const resume = await blobs.resume();
    setPhase({ label: "Creating Gmail drafts", done: 0, total: list.length });
    let ok = 0;
    await pool(
      list,
      3,
      async (c) => {
        const t = templates.find((x) => x.id === c.templateId);
        try {
          const r = await createDraft(googleClientId(settings), {
            to: c.email,
            subject: c.draft!.subject,
            body: c.draft!.body,
            attachment: t?.attachResume && resume ? resume : undefined,
            font: EMAIL_FONTS[settings.emailStyle.font]?.css,
          });
          ok++;
          const st = useStore.getState();
          st.updateContact(c.id, { draft: { ...c.draft!, gmailDraftId: r.id } });
          if (c.status === "new") st.setStatus([c.id], "drafted", "Gmail draft created");
        } catch (e) {
          toast.err(`${c.name}: ${(e as Error).message}`);
        }
      },
      (done) => setPhase({ label: "Creating Gmail drafts", done, total: list.length }),
    );
    setPhase(null);
    toast.ok(`${ok} drafts are waiting in Gmail.${skipped ? ` ${skipped} skipped (no email or no draft).` : ""}`);
  };

  const onResume = async (file: File) => {
    await blobs.setResume({ name: file.name, type: file.type || "application/pdf", data: await file.arrayBuffer() });
    s.setResumeName(file.name);
    toast.ok(`Resume saved: ${file.name}`);
  };

  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));

  return (
    <>
      <PageHeader
        title="Email drafts"
        sub="Select contacts, assign each a template, have AI fill in the personal lines, and create Gmail drafts with your resume attached. Nothing sends until you hit send in Gmail."
      />

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_auto]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Templates"
              right={
                <>
                  <Button size="sm" variant="ghost" icon={<FileUp className="size-3.5" />} onClick={() => setImportOpen(true)}>
                    Import doc
                  </Button>
                  <Button
                    size="sm"
                    icon={<Plus className="size-3.5" />}
                    onClick={() => setEditing({ id: uid("tpl"), name: "", whenToUse: "", subject: "", body: "Hi {{first_name}},\n\n", attachResume: true, kind: "initial" })}
                  >
                    New
                  </Button>
                </>
              }
            />
            <ul className="divide-y divide-line">
              {templates.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setEditing(t)} className="group flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-[#fbfaf6]">
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-brass" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-medium">
                        {t.name || "Untitled"}
                        {t.kind === "follow_up" && <Badge>follow-up</Badge>}
                        {t.attachResume && <Paperclip className="size-3 text-muted" />}
                      </div>
                      <div className="truncate text-[12px] text-muted">{t.whenToUse || "No rule set"}</div>
                    </div>
                    <Pencil className="size-3.5 text-muted opacity-0 group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[11.5px] text-muted">
              <span>Import a Word / Google Doc with one section per template.</span>
              {missingStarters.length > 0 && (
                <button
                  className="font-medium text-navy hover:underline"
                  onClick={() => {
                    missingStarters.forEach((t) => s.upsertTemplate(t));
                    toast.ok(`Added ${missingStarters.length} starter template${missingStarters.length > 1 ? "s" : ""}.`);
                  }}
                >
                  + Add {missingStarters.length} starter template{missingStarters.length > 1 ? "s" : ""}
                </button>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Resume" sub="Attached to templates marked with a paperclip" />
            <div className="flex items-center gap-2 p-4">
              <Paperclip className="size-4 text-muted" />
              <span className="flex-1 truncate text-[13px]">{s.resumeName ?? <span className="text-muted">No resume uploaded</span>}</span>
              <Button size="sm" onClick={() => resumeRef.current?.click()}>
                {s.resumeName ? "Replace" : "Upload"}
              </Button>
              <input
                ref={resumeRef}
                type="file"
                accept=".pdf,.doc,.docx"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onResume(file);
                }}
              />
            </div>
          </Card>

          {(profileMissing || !googleClientId(settings)) && (
            <Card className="border-amber/30 bg-amber-soft/40 p-4 text-[12.5px] text-ink-2">
              {profileMissing && <p>Your profile (name, school, year) fills the {"{{my_*}}"} placeholders.</p>}
              {!googleClientId(settings) && <p className="mt-1">Gmail drafts need a Google OAuth Client ID.</p>}
              <Link href="/settings" className="mt-2 inline-block font-medium text-navy underline">
                Open settings
              </Link>
            </Card>
          )}
        </div>

        <Card className="flex min-h-[520px] flex-col overflow-hidden">
          <FilterBar f={f} setF={setF} contacts={contacts} />
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#faf9f5] px-3 py-2">
            <span className="text-[12.5px] text-ink-2">{sel.size} selected</span>
            <div className="flex-1" />
            {phase ? (
              <div className="w-72">
                <div className="mb-0.5 text-[11.5px] text-ink-2">{phase.label}…</div>
                <Progress value={phase.done} max={phase.total} />
              </div>
            ) : (
              <>
                <Button size="sm" icon={<Wand2 className="size-3.5" />} onClick={assign} disabled={!sel.size}>
                  Auto-assign templates
                </Button>
                <Button size="sm" variant="brass" icon={<Sparkles className="size-3.5" />} onClick={generate} disabled={!sel.size}>
                  Generate drafts
                </Button>
                <Button size="sm" variant="primary" icon={<Mail className="size-3.5" />} onClick={toGmail} disabled={!chosen.some((c) => c.draft)}>
                  Create in Gmail
                </Button>
              </>
            )}
          </div>

          {rows.length === 0 ? (
            <Empty icon={<Mail className="size-6" />} title="No contacts match">
              The default filter shows people you haven’t contacted yet. Change it above, or add people from Find people.
            </Empty>
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10 bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-line">
                    <th className="w-8 px-3 py-2">
                      <Checkbox
                        label="Select all"
                        checked={allSel}
                        onChange={(v) => {
                          const n = new Set(sel);
                          rows.forEach((r) => (v ? n.add(r.id) : n.delete(r.id)));
                          setSel(n);
                        }}
                      />
                    </th>
                    <th className="px-2 py-2 font-medium">Contact</th>
                    <th className="px-2 py-2 font-medium">Template</th>
                    <th className="px-2 py-2 font-medium">Draft</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((c) => (
                    <tr key={c.id} className={cn(sel.has(c.id) && "bg-blue-soft/40")}>
                      <td className="px-3 py-2">
                        <Checkbox
                          label={`Select ${c.name}`}
                          checked={sel.has(c.id)}
                          onChange={(v) => {
                            const n = new Set(sel);
                            if (v) n.add(c.id);
                            else n.delete(c.id);
                            setSel(n);
                          }}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-[12px] text-muted">
                          {c.bank} · {c.email || <span className="text-red/80">no email</span>}
                        </div>
                        {(() => {
                          const others = (reachedByBank.get(c.bank) ?? []).filter((o) => o.id !== c.id);
                          return others.length ? (
                            <div className="mt-0.5 text-[11.5px] text-amber" title={others.map((o) => `${o.name} (${o.status.replace("_", " ")})`).join("\n")}>
                              {others.length} already contacted here: {others.slice(0, 2).map((o) => o.firstName || o.name).join(", ")}
                              {others.length > 2 ? "…" : ""}
                            </div>
                          ) : null;
                        })()}
                      </td>
                      <td className="px-2 py-2">
                        <Select
                          className="h-8 max-w-[190px]"
                          value={c.templateId ?? ""}
                          onChange={(e) => s.updateContact(c.id, { templateId: e.target.value || undefined })}
                          aria-label="Template"
                        >
                          <option value="">— auto —</option>
                          {initialTemplates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="max-w-[340px] px-2 py-2">
                        {c.draft ? (
                          <button onClick={() => setPreview(c)} className="block w-full text-left hover:underline">
                            <div className="truncate text-[12.5px] font-medium">{c.draft.subject}</div>
                            <div className="truncate text-[12px] text-muted">{c.draft.body.replace(/\s+/g, " ").slice(0, 110)}</div>
                          </button>
                        ) : (
                          <span className="text-[12px] text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={c.status} />
                          {c.draft?.gmailDraftId && <Badge tone="green">in Gmail</Badge>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="hidden xl:block">
          <FirmPanel banks={contextBanks} highlight={sel} />
        </div>
      </div>

      <TemplateImport open={importOpen} onClose={() => setImportOpen(false)} />
      <TemplateEditor template={editing} onClose={() => setEditing(null)} onSave={s.upsertTemplate} onDelete={templates.some((t) => t.id === editing?.id) ? s.removeTemplate : undefined} />
      <DraftModal contact={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function facts(c: Contact) {
  return {
    id: c.id,
    name: c.name,
    bank: c.bank,
    position: c.position,
    location: c.location,
    region: c.region,
    school: c.school,
    headline: c.headline,
    comment: c.comment,
  };
}

function DraftModal({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  return (
    <Modal open={!!contact} onClose={onClose} title={contact ? `Draft to ${contact.name}` : ""} wide>
      {contact?.draft && <DraftEditor key={contact.id} c={contact} onClose={onClose} />}
    </Modal>
  );
}

function DraftEditor({ c, onClose }: { c: Contact; onClose: () => void }) {
  const update = useStore((s) => s.updateContact);
  const setStatus = useStore((s) => s.setStatus);
  const [subject, setSubject] = useState(c.draft!.subject);
  const firm = useFirmRows([c.bank])[0];
  const [body, setBody] = useState(c.draft!.body);
  const mailto = useMemo(
    () => `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyToPlain(body))}`,
    [c.email, subject, body],
  );
  const save = () => update(c.id, { draft: { ...c.draft!, subject, body } });
  return (
    <div className="space-y-3">
      <div className="text-[12.5px] text-muted">To: {c.email || "no email yet"}</div>
      {firm && (
        <div className="rounded-md border border-line bg-[#fbfaf6] p-3">
          <FirmSummary r={firm} highlight={new Set([c.id])} compact />
        </div>
      )}
      <Field label="Subject">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label="Body">
        <Textarea rows={16} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {c.draft!.gmailDraftId && <p className="text-[12px] text-amber">Already in Gmail. Edits here won’t update that Gmail draft.</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <a
          href={c.email ? mailto : undefined}
          onClick={save}
          aria-disabled={!c.email}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-md border border-line-2 bg-panel px-3.5 text-[13.5px] font-medium hover:bg-[#f0eee7]",
            !c.email && "pointer-events-none opacity-50",
          )}
        >
          <Send className="size-3.5" /> Open in mail app
        </a>
        <Button
          onClick={() => {
            save();
            setStatus([c.id], "sent", "Marked sent manually");
            onClose();
          }}
        >
          Mark as sent
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            save();
            onClose();
          }}
        >
          Save draft
        </Button>
      </div>
    </div>
  );
}

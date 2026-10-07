"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileText, FileUp, Mail, Paperclip, Pencil, Plus, Send, Sparkles, Wand2 } from "lucide-react";
import { blobs, useStore } from "@/lib/store";
import { callApi } from "@/lib/api";
import { connectGmail, deleteDraft, upsertDraft } from "@/lib/gmail";
import { fillPlaceholders, hasAiSlots, missingPlaceholders, ruleAssign, AI_SLOT } from "@/lib/template";
import { EMAIL_FONTS, type Contact, type RequiredFact, type Template } from "@/lib/types";
import { chunk, cn, pool, uid } from "@/lib/util";
import { teamOf } from "@/lib/locationTeam";
import { overCapDesks } from "@/lib/desks";
import { assignTrial, pickBase, pickVariant, trialTally, usageTally } from "@/lib/experiments";
import { assignOutreachArms, composeOutreach, emailVerified, leftFirm, rulesOf, seniorSkipReason, settleOutreachArms } from "@/lib/outreach";
import { windowLabel, windowOf } from "@/lib/sendWindow";
import { autoHook, hookFor, hooksOf } from "@/lib/hooks";
import { HooksCard } from "@/components/Hooks";
import { REQUIRED_FACTS, guessSchool, missingFacts } from "@/lib/template";
import { bodyToPlain, normalizeBody, normalizeSubject, withSignature } from "@/lib/emailFormat";
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Field, Input, Modal, PageHeader, Progress, Select, StatusBadge, Textarea, toast } from "@/components/ui";
import { FilterBar, useContactFilter, type Filters } from "@/components/ContactsTable";
import { TemplateEditor } from "@/components/TemplateEditor";
import { TemplateImport } from "@/components/TemplateImport";
import { FirmPanel, FirmSummary, useFirmRows } from "@/components/FirmContext";
import { DEFAULT_TEMPLATES, ORIGINAL_BASE } from "@/lib/defaults";
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

  const [needs, setNeeds] = useState<{ c: Contact; t: Template; missing: RequiredFact[] }[] | null>(null);

  const generate = async (skip: Set<string> = new Set()) => {
    const eligible = chosen.filter((c) => (c.templateId || initialTemplates[0]) && !skip.has(c.id));
    // Outreach rule: no verified address = "needs email", no draft.
    const unverified = eligible.filter((c) => !emailVerified(c));
    const list = eligible.filter((c) => emailVerified(c));
    if (unverified.length)
      toast.info(
        `${unverified.length} skipped: no verified email (${unverified.slice(0, 3).map((c) => c.firstName || c.name).join(", ")}${unverified.length > 3 ? "…" : ""}). Enrich them, or add an address you've confirmed.`,
      );
    if (!list.length) return toast.err(skip.size || unverified.length ? "Nothing left to draft." : "Select contacts first.");
    const senior = list.filter((c) => seniorSkipReason(c, rulesOf(settings)));
    if (senior.length)
      toast.info(`Heads up: ${senior.map((c) => c.name).join(", ")} ${senior.length > 1 ? "are" : "is"} MD / Head / Partner with none of your senior-exception ties (Settings → Outreach rules). The rule is VPs and below.`);
    // Templates like "Non-target school" can't be written without a fact (their university): ask instead of guessing.
    const latest = useStore.getState().contacts;
    const blocked = list
      .map((c0) => {
        const c = latest.find((x) => x.id === c0.id) ?? c0;
        const t = templates.find((x) => x.id === c.templateId) ?? ruleAssign(c, templates)!;
        return { c, t, missing: t ? missingFacts(t, c) : [] };
      })
      .filter((x) => x.missing.length);
    if (blocked.length) {
      setNeeds(blocked);
      return;
    }
    // The cap is per desk (bank + office + team): SF Tech and NY Generalist at the same bank don't crowd each other.
    const over = overCapDesks(contacts, list, settings.followUp.livePerBank);
    if (over.length)
      toast.info(
        `Heads up: this puts ${over.map((d) => `${d.bank} ${d.label} at ${d.live}`).join(", ")} live contacts (your cap is ${settings.followUp.livePerBank} per team).`,
      );
    if (profileMissing) toast.info("Tip: fill in your name and school in Settings so {{my_*}} placeholders work.");
    setPhase({ label: "Writing drafts", done: 0, total: list.length });
    let failed = 0;
    // A/B tests (Email lab): each draft gets the least-used active base and template variant, recorded on the contact.
    const tally = usageTally(useStore.getState().contacts);
    // Outreach experiments (E1–E4) shape the wording, so their arms are assigned here, by target share.
    const outreachTally = trialTally(useStore.getState().contacts);
    await pool(
      list,
      4,
      async (c) => {
        const assigned = templates.find((x) => x.id === c.templateId) ?? ruleAssign(c, templates)!;
        const t = pickVariant(assigned, templates, tally.template);
        // Word-for-word templates keep the Original wording and stay out of base tests.
        const base = t.lockBase ? (settings.emailBases?.find((b) => b.id === ORIGINAL_BASE.id) ?? ORIGINAL_BASE) : pickBase(settings, tally.base);
        let cc = c;
        if (/\{\{\s*outreach_/.test(t.subject + t.body + base.ask + base.close)) {
          const assigned = assignOutreachArms(c, settings, outreachTally);
          cc = { ...c, trial: { ...(c.trial ?? { at: new Date().toISOString() }), arms: assigned } };
          const plan = composeOutreach(cc, settings);
          cc = { ...cc, trial: { ...cc.trial!, arms: settleOutreachArms(assigned, plan.arms, outreachTally) } };
        }
        let subject = fillPlaceholders(t.subject, cc, settings, {}, base);
        let body = fillPlaceholders(t.body, cc, settings, {}, base);
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
        const createdAt = new Date().toISOString();
        s.updateContact(c.id, {
          templateId: t.id,
          draft: { subject: normalizeSubject(subject), body: normalizeBody(body), createdAt, gmailDraftId: c.draft?.gmailDraftId },
          draftMeta: { templateId: t.id, baseId: base.id, hookId: hookFor(c, settings).id, createdAt },
          ...(cc.trial !== c.trial ? { trial: cc.trial } : {}),
        });
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
    // Only verified addresses (outreach rule); older drafts may predate the check.
    const list = chosen.filter((c) => c.draft && c.email && emailVerified(c));
    const skipped = chosen.length - list.length;
    if (!list.length) return toast.err("None of the selected contacts have both a draft and a verified email.");
    try {
      await connectGmail(googleClientId(settings));
    } catch (e) {
      return toast.err((e as Error).message);
    }
    const resume = await blobs.resume();
    setPhase({ label: "Creating Gmail drafts", done: 0, total: list.length });
    let ok = 0;
    // Running experiments (Email lab): font + arm per draft, balanced across the batch.
    const trials = trialTally(useStore.getState().contacts);
    await pool(
      list,
      3,
      async (c) => {
        const t = templates.find((x) => x.id === c.templateId);
        const trial = assignTrial(c, settings, trials);
        try {
          // Already in Gmail → update that draft in place (or recreate it if it was deleted), never a duplicate.
          const r = await upsertDraft(googleClientId(settings), c.draft!.gmailDraftId, {
            to: c.email,
            subject: c.draft!.subject,
            body: c.draft!.body,
            attachment: t?.attachResume && resume ? resume : undefined,
            font: EMAIL_FONTS[trial.font]?.css,
          });
          ok++;
          const st = useStore.getState();
          st.updateContact(c.id, { draft: { ...c.draft!, gmailDraftId: r.id }, trial });
          if (c.status === "new") st.setStatus([c.id], "drafted", "Gmail draft created");
        } catch (e) {
          toast.err(`${c.name}: ${(e as Error).message}`);
        }
      },
      (done) => setPhase({ label: "Creating Gmail drafts", done, total: list.length }),
    );
    setPhase(null);
    toast.ok(`${ok} drafts are waiting in Gmail (existing ones were updated, not duplicated).${skipped ? ` ${skipped} skipped (no draft, or no verified email).` : ""}`);
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

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[280px_minmax(0,1fr)_auto]">
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
                        {t.experimental && <Badge tone="brass">experiment</Badge>}
                        {t.variantGroup && templates.filter((x) => x.variantGroup === t.variantGroup).length > 1 && <Badge tone="blue">A/B</Badge>}
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
              <span>
                Import a Word / Google Doc with one section per template, or{" "}
                <Link href="/lab" className="font-medium text-navy hover:underline">
                  test and generate templates in the Email lab
                </Link>
                .
              </span>
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
            <CardHeader title="Hooks" sub="The sentence after your intro, picked by team" />
            <HooksCard />
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
                <Button size="sm" variant="brass" icon={<Sparkles className="size-3.5" />} onClick={() => generate()} disabled={!sel.size}>
                  Generate drafts
                </Button>
                <Button size="sm" variant={chosen.some((c) => c.draft) ? "primary" : "secondary"} icon={<Mail className="size-3.5" />} onClick={toGmail} disabled={!chosen.some((c) => c.draft)}>
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
                    <th className="px-2 py-2 font-medium">Notes</th>
                    <th className="px-2 py-2 font-medium" title="Their team decides the hook automatically; switch it here to include or leave out a blurb">
                      Team · hook
                    </th>
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
                        <RowChecks c={c} onLeft={(employer) => {
                          s.setStatus([c.id], "ignored", `Left firm (headline: ${employer})`);
                          s.updateContact(c.id, { comment: [c.comment, `left firm (now ${employer})`].filter(Boolean).join("; ") });
                        }} />
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
                      <td className="max-w-[240px] px-2 py-2 text-[12px]">
                        {/* The sheet's Connection / Comment column (J on bank tabs); the AI uses it when picking a template. */}
                        {c.comment ? (
                          <p className="line-clamp-3 text-ink-2" title={c.comment}>
                            {c.comment}
                          </p>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-[12px]">
                        {/* Team from the sheet; the hook follows it unless picked by hand (then the draft needs regenerating). */}
                        <div className={cn("mb-1", teamOf(c) ? "text-ink-2" : "text-muted")}>{teamOf(c) || "team not set"}</div>
                        <Select
                          className="h-7 max-w-[150px] text-[12px]"
                          value={c.hookId ?? ""}
                          aria-label={`Hook for ${c.name}`}
                          onChange={(e) => {
                            s.updateContact(c.id, { hookId: e.target.value || undefined });
                            if (c.draft) toast.info(`Hook changed for ${c.name}. Generate their draft again to use it.`);
                          }}
                        >
                          <option value="">Auto: {autoHook(teamOf(c), settings).name}</option>
                          {hooksOf(settings).map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.name}
                              {!h.text.trim() && !h.fallback ? " (empty)" : ""}
                            </option>
                          ))}
                        </Select>
                        {c.draftMeta?.hookId && c.draftMeta.hookId !== hookFor(c, settings).id && <div className="mt-0.5 text-[11px] text-amber">draft uses the old hook</div>}
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
                          {/* A running send-time experiment planned a window for this draft (recipient's local time). */}
                          {!c.sentAt &&
                            (settings.experiments ?? [])
                              .filter((e) => e.kind === "time" && e.status === "running" && c.trial?.arms[e.id])
                              .map((e) => (
                                <Badge key={e.id} tone="blue">
                                  send {e.arms.find((a) => a.id === c.trial!.arms[e.id])?.label} their time
                                </Badge>
                              ))}
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
      <NeedsModal
        needs={needs}
        onClose={() => setNeeds(null)}
        onDone={(skip) => {
          setNeeds(null);
          generate(skip);
        }}
      />
    </>
  );
}

/** Outreach-rule checks for one row: seniority, left the firm, unverified email, when to send. */
function RowChecks({ c, onLeft }: { c: Contact; onLeft: (employer: string) => void }) {
  const rules = useStore((s) => s.settings.outreach);
  const senior = seniorSkipReason(c, rules);
  const left = leftFirm(c);
  const verified = emailVerified(c);
  const w = useStore((s) => windowOf(s.settings));
  const send = { label: windowLabel(w), hourPT: w.start };
  return (
    <div className="mt-0.5 space-y-0.5 text-[11.5px]">
      {senior && (
        <div className="text-amber" title="Rule: only VPs and below, unless they share one of your senior-exception ties (Settings → Outreach rules).">
          Senior: {senior}
        </div>
      )}
      {left && (
        <div className="text-red">
          Headline says {left}. Left {c.bank}?{" "}
          <button className="underline" onClick={() => onLeft(left)}>
            Mark as left firm
          </button>
        </div>
      )}
      {c.email && !verified && (
        <div className="text-red" title={c.emailStatus}>
          Email not verified ({c.emailSource}: {c.emailStatus || "unknown"}). No draft until it is.
        </div>
      )}
      {!c.profile && <div className="text-muted">Check their LinkedIn: title, team and office come from the current profile.</div>}
      <div className="text-muted">Send at {send.label}</div>
    </div>
  );
}

function facts(c: Contact) {
  return {
    id: c.id,
    name: c.name,
    bank: c.bank,
    position: c.position,
    location: [c.location, c.team].filter(Boolean).join(" · "),
    region: c.region,
    school: c.school,
    headline: c.headline,
    comment: c.comment,
    // The captured LinkedIn profile: the only source for "your path from X to Y" (never web snippets).
    profile: c.profile?.text.slice(0, 6000),
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
  const [gmailBusy, setGmailBusy] = useState(false);
  const settings = useStore((s) => s.settings);
  const templates = useStore((s) => s.templates);
  /** Push the edits to Gmail: updates the existing Gmail draft, or makes a new one if it was deleted there. */
  const pushToGmail = async () => {
    if (!c.email) return toast.err("Add their email first.");
    setGmailBusy(true);
    try {
      save();
      const t = templates.find((x) => x.id === c.templateId);
      const resume = t?.attachResume ? await blobs.resume() : undefined;
      const trial = assignTrial(c, settings, trialTally(useStore.getState().contacts));
      const r = await upsertDraft(googleClientId(settings), c.draft!.gmailDraftId, { to: c.email, subject, body, attachment: resume, font: EMAIL_FONTS[trial.font]?.css });
      update(c.id, { draft: { ...c.draft!, subject, body, gmailDraftId: r.id }, trial });
      if (c.status === "new") setStatus([c.id], "drafted", "Gmail draft created");
      toast.ok(c.draft!.gmailDraftId ? "Gmail draft updated." : "Draft created in Gmail.");
      onClose();
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setGmailBusy(false);
    }
  };
  /** Forget the Gmail link (the Gmail draft, if any, stays) so this can be edited and sent to Gmail again. */
  const unlink = () => {
    update(c.id, { draft: { ...c.draft!, subject, body, gmailDraftId: undefined } }, { at: new Date().toISOString(), type: "note", note: "Unlinked from Gmail draft" });
    toast.info("Unlinked. The dashboard draft is editable again; the Gmail draft (if it still exists) wasn't touched.");
  };
  const removeFromGmail = async () => {
    setGmailBusy(true);
    try {
      await deleteDraft(googleClientId(settings), c.draft!.gmailDraftId!);
      update(c.id, { draft: { ...c.draft!, subject, body, gmailDraftId: undefined } }, { at: new Date().toISOString(), type: "note", note: "Gmail draft deleted from the dashboard" });
      toast.ok("Deleted the Gmail draft. It's still here in your dashboard drafts.");
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setGmailBusy(false);
    }
  };
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
      {c.draft!.gmailDraftId && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-green/30 bg-green-soft/50 px-3 py-2 text-[12.5px]">
          <span className="text-green">In Gmail as a draft.</span>
          <span className="text-muted">Edit here and hit “Update Gmail draft”, or take it back:</span>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={unlink} disabled={gmailBusy} title="Keep the Gmail draft, but let this one be edited and re-sent">
            Unlink
          </Button>
          <Button size="sm" variant="danger" onClick={removeFromGmail} loading={gmailBusy} title="Delete the draft in Gmail; the text stays here">
            Delete Gmail draft
          </Button>
        </div>
      )}
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
        <Button variant="secondary" icon={<Mail className="size-3.5" />} loading={gmailBusy} onClick={pushToGmail} disabled={!c.email || !googleClientId(settings)}>
          {c.draft!.gmailDraftId ? "Update Gmail draft" : "Send to Gmail"}
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

/**
 * Before drafting: people whose template needs a fact we don't have (e.g. their university for the non-target
 * template). Suggestions come from their captured LinkedIn profile / notes; nothing is filled in without the user.
 */
function NeedsModal({
  needs,
  onClose,
  onDone,
}: {
  needs: { c: Contact; t: Template; missing: RequiredFact[] }[] | null;
  onClose: () => void;
  onDone: (skip: Set<string>) => void;
}) {
  return (
    <Modal open={!!needs} onClose={onClose} title="A few details before drafting" wide>
      {needs && <NeedsForm key={needs.map((n) => n.c.id).join()} needs={needs} onDone={onDone} onClose={onClose} />}
    </Modal>
  );
}

function NeedsForm({ needs, onDone, onClose }: { needs: { c: Contact; t: Template; missing: RequiredFact[] }[]; onDone: (skip: Set<string>) => void; onClose: () => void }) {
  const update = useStore((s) => s.updateContact);
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const { c, missing } of needs) for (const k of missing) v[`${c.id}|${k}`] = k === "their_school" ? (guessSchool(c) ?? "") : "";
    return v;
  });
  const filled = (id: string, missing: RequiredFact[]) => missing.every((k) => vals[`${id}|${k}`]?.trim());
  const ready = needs.filter((n) => filled(n.c.id, n.missing)).length;

  const save = () => {
    const skip = new Set<string>();
    for (const { c, missing } of needs) {
      if (!filled(c.id, missing)) {
        skip.add(c.id);
        continue;
      }
      const patch: Partial<Contact> = {};
      for (const k of missing) patch[REQUIRED_FACTS[k].field] = vals[`${c.id}|${k}`].trim();
      update(c.id, patch);
    }
    onDone(skip);
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-2">
        These templates only work with the right facts, so they won&apos;t be guessed. Check their LinkedIn, fill these in, and the drafts are written word
        for word. Anyone left blank is skipped this time.
      </p>
      <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
        {needs.map(({ c, t, missing }) => (
          <li key={c.id} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-medium">{c.name}</span>
              <span className="text-muted">
                {c.bank} · template “{t.name}”
              </span>
              {c.linkedin && (
                <a href={c.linkedin} target="_blank" rel="noreferrer" className="ml-auto text-[12px] text-[#0a66c2] hover:underline">
                  Open LinkedIn ↗
                </a>
              )}
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
              {missing.map((k) => (
                <Field
                  key={k}
                  label={REQUIRED_FACTS[k].label}
                  hint={k === "their_school" && guessSchool(c) ? "Suggested from their profile/notes. Check it." : undefined}
                >
                  <Input
                    value={vals[`${c.id}|${k}`] ?? ""}
                    placeholder={REQUIRED_FACTS[k].placeholder}
                    onChange={(e) => setVals((v) => ({ ...v, [`${c.id}|${k}`]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
        <span className="mr-auto text-[12px] text-muted">
          {ready}/{needs.length} ready
        </span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save}>
          {ready === needs.length ? "Save & write drafts" : `Save & draft (skip ${needs.length - ready})`}
        </Button>
      </div>
    </div>
  );
}

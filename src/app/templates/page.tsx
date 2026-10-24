"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, FileUp, Paperclip, Pencil, Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import type { Template } from "@/lib/types";
import { uid } from "@/lib/util";
import { DEFAULT_TEMPLATES } from "@/lib/defaults";
import { Badge, Button, Card, CardHeader, Empty, Menu, PageHeader, Segmented, toast } from "@/components/ui";
import { TemplateEditor } from "@/components/TemplateEditor";
import { TemplateImport } from "@/components/TemplateImport";
import { HooksCard } from "@/components/Hooks";
import { ResumeCard } from "@/components/ResumeCard";

type Kind = "all" | "initial" | "follow_up";

/** Templates, hooks and the resume: what every draft is built from (moved off /drafts so that page is just the people). */
export default function TemplatesPage() {
  const templates = useStore((s) => s.templates);
  const upsertTemplate = useStore((s) => s.upsertTemplate);
  const removeTemplate = useStore((s) => s.removeTemplate);
  const [editing, setEditing] = useState<Template | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("all");

  const missingStarters = DEFAULT_TEMPLATES.filter((d) => !templates.some((t) => t.id === d.id || t.name.toLowerCase() === d.name.toLowerCase()));
  const shown = templates.filter((t) => kind === "all" || t.kind === kind);
  const newTemplate = () => setEditing({ id: uid("tpl"), name: "", whenToUse: "", subject: "", body: "Hi {{first_name}},\n\n", attachResume: true, kind: "initial" });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Templates"
        sub="The emails your drafts are written from, the hook sentence picked by each person's team, and the resume attached to first emails."
        right={
          <>
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={newTemplate}>
              New template
            </Button>
            <Menu
              items={[
                { label: "Import a Word / Google Doc", hint: "One section per template", icon: <FileUp />, onClick: () => setImportOpen(true) },
                missingStarters.length > 0 && {
                  label: `Add ${missingStarters.length} starter template${missingStarters.length > 1 ? "s" : ""}`,
                  icon: <Plus />,
                  onClick: () => {
                    missingStarters.forEach((t) => upsertTemplate(t));
                    toast.ok(`Added ${missingStarters.length} starter template${missingStarters.length > 1 ? "s" : ""}.`);
                  },
                },
              ]}
            />
          </>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <Segmented
              value={kind}
              onChange={setKind}
              options={[
                ["all", `All ${templates.length}`],
                ["initial", `First emails ${templates.filter((t) => t.kind === "initial").length}`],
                ["follow_up", `Follow-ups ${templates.filter((t) => t.kind === "follow_up").length}`],
              ]}
            />
            <div className="flex-1" />
            <Link href="/lab" className="text-[12.5px] font-medium text-navy hover:underline">
              Test and generate templates in the Email lab
            </Link>
          </div>
          {shown.length === 0 ? (
            <Empty icon={<FileText className="size-6" />} title="No templates yet">
              Write one, import a doc, or add the starter templates from the ⋯ menu.
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead className="bg-subtle text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-medium">Template</th>
                    <th className="px-2 py-2 font-medium">When to use</th>
                    <th className="px-2 py-2 font-medium">Subject</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((t) => (
                    <tr key={t.id} className="group cursor-pointer hover:bg-subtle" onClick={() => setEditing(t)}>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5 font-medium">
                          <FileText className="size-3.5 shrink-0 text-brass" />
                          {t.name || "Untitled"}
                          {t.kind === "follow_up" && <Badge>follow-up{t.step ? ` #${t.step}` : ""}</Badge>}
                          {t.experimental && <Badge tone="brass">experiment</Badge>}
                          {t.variantGroup && templates.filter((x) => x.variantGroup === t.variantGroup).length > 1 && <Badge tone="blue">A/B</Badge>}
                          {t.attachResume && (
                            <span title="Attaches your resume">
                              <Paperclip className="size-3 text-muted" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="max-w-[320px] px-2 py-2.5 text-[12.5px] text-ink-2">
                        <span className="line-clamp-2">{t.whenToUse || <span className="text-muted">No rule set</span>}</span>
                      </td>
                      <td className="max-w-[260px] truncate px-2 py-2.5 text-[12.5px] text-muted">{t.subject || "—"}</td>
                      <td className="pr-3">
                        <Pencil className="size-3.5 text-muted opacity-0 group-hover:opacity-100" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
          <Card>
            <CardHeader title="Hooks" sub="The sentence after your intro, picked by team" />
            <HooksCard />
          </Card>
          <ResumeCard />
        </div>
      </div>

      <TemplateImport open={importOpen} onClose={() => setImportOpen(false)} />
      <TemplateEditor template={editing} onClose={() => setEditing(null)} onSave={upsertTemplate} onDelete={templates.some((t) => t.id === editing?.id) ? removeTemplate : undefined} />
    </div>
  );
}

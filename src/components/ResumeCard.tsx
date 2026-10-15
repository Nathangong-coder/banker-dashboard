"use client";

import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { blobs, useStore } from "@/lib/store";
import { Button, Card, CardHeader, toast } from "./ui";

/**
 * The resume attached to first cold emails (never follow-ups or replies). One file, kept in IndexedDB under
 * `blob:resume`. Replacing it only affects drafts made from now on: Gmail drafts that already exist keep the file they
 * were created with until they're updated ("Update Gmail draft" re-attaches the current one).
 */
export function ResumeCard() {
  const ref = useRef<HTMLInputElement>(null);
  const name = useStore((s) => s.resumeName);
  const addedAt = useStore((s) => s.resumeAddedAt);
  const setName = useStore((s) => s.setResumeName);
  const contacts = useStore((s) => s.contacts);
  // Unsent first emails already in Gmail that were drafted before this file was uploaded.
  const stale = addedAt
    ? contacts.filter((c) => c.draft?.gmailDraftId && !c.sentAt && (c.status === "new" || c.status === "drafted") && c.draft.createdAt < addedAt).length
    : 0;

  const onFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) return toast.err("That file is over 10 MB. Gmail drafts work best with a resume under a few MB.");
    await blobs.setResume({ name: file.name, type: file.type || "application/pdf", data: await file.arrayBuffer() });
    setName(file.name, new Date().toISOString());
    toast.ok(`Resume saved: ${file.name}. New first emails will attach it.`);
  };
  const open = async () => {
    const r = await blobs.resume();
    if (!r) return toast.err("The file isn't stored in this browser any more. Upload it again.");
    const url = URL.createObjectURL(new Blob([r.data], { type: r.type }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <Card>
      <CardHeader title="Resume" sub="Attached to first cold emails only. Follow-ups and replies never attach it." />
      <div className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <Paperclip className="size-4 shrink-0 text-muted" />
          {name ? (
            <button className="min-w-0 flex-1 truncate text-left text-[13px] text-navy hover:underline" onClick={open} title="Open the stored file">
              {name}
            </button>
          ) : (
            <span className="flex-1 text-[13px] text-muted">No resume uploaded</span>
          )}
          <Button size="sm" onClick={() => ref.current?.click()}>
            {name ? "Replace" : "Upload"}
          </Button>
          <input
            ref={ref}
            type="file"
            accept=".pdf,.doc,.docx"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onFile(file);
            }}
          />
        </div>
        {addedAt && <div className="text-[12px] text-muted">Uploaded {new Date(addedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>}
        {stale > 0 && (
          <div className="rounded-md border border-brass/40 bg-brass-soft/40 px-3 py-2 text-[12.5px] text-ink-2">
            {stale} unsent Gmail draft{stale > 1 ? "s were" : " was"} made before this upload and still {stale > 1 ? "have" : "has"} the previous resume. Open one
            on Drafts and hit “Update Gmail draft” to attach this file, or delete and re-create them.
          </div>
        )}
      </div>
    </Card>
  );
}

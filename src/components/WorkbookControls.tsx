"use client";

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Save, Upload } from "lucide-react";
import { importFile, pickAndImport, saveWorkbook } from "@/lib/actions";
import { useStore } from "@/lib/store";
import { Button, toast } from "./ui";

export function UploadButton({ variant = "secondary", label }: { variant?: "primary" | "secondary" | "brass"; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const hasBook = useStore((s) => !!s.workbook);

  const report = (r: { added: number; updated: number }) =>
    toast.ok(`Imported — ${r.added} new contact${r.added === 1 ? "" : "s"}, ${r.updated} refreshed.`);

  const onClick = async () => {
    setBusy(true);
    try {
      const r = await pickAndImport();
      if (r === "fallback") input.current?.click();
      else if (r) report(r);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant={variant} icon={<Upload className="size-3.5" />} loading={busy} onClick={onClick}>
        {label ?? (hasBook ? "Re-import spreadsheet" : "Upload spreadsheet")}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".xlsx"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            report(await importFile(f));
          } catch (err) {
            toast.err(`Couldn't read that file: ${(err as Error).message}`);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

export function SaveButtons() {
  const meta = useStore((s) => s.workbook);
  const [busy, setBusy] = useState<string | null>(null);
  if (!meta) return null;
  const run = async (mode: "in-place" | "download") => {
    setBusy(mode);
    try {
      const name = await saveWorkbook(mode);
      toast.ok(mode === "in-place" ? `Saved changes to ${name}` : `Downloaded ${name}`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {meta.hasHandle && (
        <Button variant="primary" icon={<Save className="size-3.5" />} loading={busy === "in-place"} onClick={() => run("in-place")}>
          Save to {meta.fileName.length > 22 ? "original file" : meta.fileName}
        </Button>
      )}
      <Button icon={<Download className="size-3.5" />} loading={busy === "download"} onClick={() => run("download")}>
        Download .xlsx
      </Button>
    </>
  );
}

export function WorkbookEmpty() {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line-2 bg-panel px-6 py-16 text-center">
      <FileSpreadsheet className="size-8 text-brass" />
      <h2 className="mt-3 font-serif text-[24px]">Start with your recruiting spreadsheet</h2>
      <p className="mt-2 max-w-lg text-[13.5px] text-ink-2">
        Upload your .xlsx. Every tab with a <b>Name</b> column plus an <b>Email</b> or <b>LinkedIn</b> column is read as a
        contact table, and each tab title becomes the bank. Your file stays in this browser. Nothing is uploaded to a server.
      </p>
      <div className="mt-5">
        <UploadButton variant="primary" />
      </div>
      <p className="mt-3 text-[12px] text-muted">
        In Chrome or Edge you can save updates straight back to the same file. Other browsers download an updated copy.
      </p>
    </div>
  );
}

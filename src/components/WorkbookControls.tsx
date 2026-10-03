"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, Save, Upload } from "lucide-react";
import { type TabChanges, currentPatches, describeTabChanges, importFile, pickAndImport, saveWorkbook } from "@/lib/actions";
import { useStore } from "@/lib/store";
import { Button, toast } from "./ui";

export function UploadButton({ variant = "secondary", label }: { variant?: "primary" | "secondary" | "brass"; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const hasBook = useStore((s) => !!s.workbook);

  const report = (r: { added: number; updated: number; tabs?: TabChanges }) => {
    toast.ok(`Imported — ${r.added} new contact${r.added === 1 ? "" : "s"}, ${r.updated} refreshed.`);
    const tabs = r.tabs && describeTabChanges(r.tabs);
    if (tabs) toast.info(`Spreadsheet tabs: ${tabs}`);
  };

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

let saving = false;

/**
 * Ctrl+S / Cmd+S saves the spreadsheet instead of opening the browser's "Save page as" dialog (which the owner kept
 * hitting by habit). Saves in place when the file is connected; otherwise explains how to get the file.
 */
export function useSaveShortcut() {
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (saving) return;
      const s = useStore.getState();
      if (!s.workbook) return toast.info("Nothing to save yet. Upload your spreadsheet on the Spreadsheet page first.");
      const pending = Object.values(currentPatches()).reduce((n, p) => n + Object.keys(p).length, 0);
      if (!pending) return toast.info("Everything's already saved.");
      if (!s.workbook.hasHandle) return toast.info(`This browser can't write to the original file. Use "Download .xlsx" on the Spreadsheet page (${pending} unsaved change${pending > 1 ? "s" : ""}).`);
      saving = true;
      try {
        const { name, rebased } = await saveWorkbook("in-place");
        toast.ok(`Saved ${pending} change${pending > 1 ? "s" : ""} to ${name}${rebased ? " (kept the edits made in Excel)" : ""}.`);
      } catch (err) {
        toast.err((err as Error).message);
      } finally {
        saving = false;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

export function SaveButtons() {
  const meta = useStore((s) => s.workbook);
  const [busy, setBusy] = useState<string | null>(null);
  if (!meta) return null;
  const run = async (mode: "in-place" | "download") => {
    setBusy(mode);
    try {
      const { name, rebased } = await saveWorkbook(mode);
      toast.ok(
        mode === "in-place"
          ? `Saved changes to ${name}${rebased ? ". The file had been edited outside the app, so your Excel edits were kept and the dashboard changes were applied on top." : ""}`
          : `Downloaded ${name}`,
      );
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

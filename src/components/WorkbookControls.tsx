"use client";

import { useMemo, useRef, useState } from "react";
import { Download, Eraser, FileSpreadsheet, Save, Upload } from "lucide-react";
import { type TabChanges, describeTabChanges, downloadBlankCopy, importFile, pickAndImport, saveWorkbook } from "@/lib/actions";
import { useStore } from "@/lib/store";
import { hasDashboardWork } from "@/lib/workbook";
import { Button, Checkbox, Modal, toast } from "./ui";

/** Import (or re-import) a workbook: the picker where the browser has one, else a hidden file input. Render `input` once. */
export function useImportWorkbook() {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const report = (r: { added: number; updated: number; tabs?: TabChanges }) => {
    toast.ok(`Imported — ${r.added} new contact${r.added === 1 ? "" : "s"}, ${r.updated} refreshed.`);
    const tabs = r.tabs && describeTabChanges(r.tabs);
    if (tabs) toast.info(`Spreadsheet tabs: ${tabs}`);
  };

  const run = async () => {
    setBusy(true);
    try {
      const r = await pickAndImport();
      if (r === "fallback") ref.current?.click();
      else if (r) report(r);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = (
    <input
      ref={ref}
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
  );
  return { run, busy, input };
}

export function UploadButton({ variant = "secondary", label }: { variant?: "primary" | "secondary" | "brass"; label?: string }) {
  const hasBook = useStore((s) => !!s.workbook);
  const { run, busy, input } = useImportWorkbook();
  return (
    <>
      <Button variant={variant} icon={<Upload className="size-3.5" />} loading={busy} onClick={run}>
        {label ?? (hasBook ? "Re-import spreadsheet" : "Upload spreadsheet")}
      </Button>
      {input}
    </>
  );
}

/** Save in place (when the browser holds the file) or download a copy. */
export function useSaveWorkbook() {
  const [busy, setBusy] = useState<"in-place" | "download" | null>(null);
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
  return { run, busy };
}

export function SaveButtons() {
  const meta = useStore((s) => s.workbook);
  const { run, busy } = useSaveWorkbook();
  if (!meta) return null;
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
      <h2 className="mt-3 text-[22px] font-medium tracking-tight">Start with your recruiting spreadsheet</h2>
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

/**
 * "Reset tracker": blank the contact tables but keep the tracker's layout and formatting. Either as pending changes
 * (review, then save) or as a separate blank copy that leaves everything as it is.
 */
export function ResetTracker({ activeSheet }: { activeSheet?: string }) {
  const meta = useStore((s) => s.workbook);
  const [open, setOpen] = useState(false);
  if (!meta) return null;
  return (
    <>
      <Button icon={<Eraser className="size-3.5" />} onClick={() => setOpen(true)} title="Blank the contact tables but keep the tracker's tabs, headers and formatting">
        Reset tracker
      </Button>
      <ResetTrackerModal open={open} onClose={() => setOpen(false)} activeSheet={activeSheet} />
    </>
  );
}

/** The Reset tracker dialog on its own, for opening from a menu. */
export function ResetTrackerModal({ open, onClose, activeSheet }: { open: boolean; onClose: () => void; activeSheet?: string }) {
  const meta = useStore((s) => s.workbook);
  const setOpen = (v: boolean) => !v && onClose();
  const contacts = useStore((s) => s.contacts);
  const tables = useStore((s) => s.tables);
  const resetTracker = useStore((s) => s.resetTracker);
  const [scope, setScope] = useState<"all" | "tab">("all");
  const [everything, setEverything] = useState(true);
  const [busy, setBusy] = useState(false);
  const sheets = useMemo(() => (scope === "tab" && activeSheet ? [activeSheet] : undefined), [scope, activeSheet]);
  const hit = useMemo(() => {
    const inScope = contacts.filter((c) => c.ref && (!sheets || sheets.includes(c.ref.sheet)));
    const loose = scope === "all" ? contacts.filter((c) => !c.ref) : [];
    return { inScope, loose, work: [...inScope, ...(everything ? loose : [])].filter(hasDashboardWork).length };
  }, [contacts, scope, everything, sheets]);
  const tabCount = new Set(tables.filter((t) => !sheets || sheets.includes(t.sheet)).map((t) => t.sheet)).size;
  if (!meta) return null;

  const clear = () => {
    const r = resetTracker({ sheets, everything: scope === "all" && everything });
    setOpen(false);
    toast.ok(
      `Cleared ${r.rows} row${r.rows === 1 ? "" : "s"} and removed ${r.removed} contact${r.removed === 1 ? "" : "s"}. ` +
        `Check the highlighted cells, then save (Download a copy keeps your current file as it is). Ctrl+Z in Sheet view undoes it.`,
    );
  };
  const blankCopy = async () => {
    setBusy(true);
    try {
      const r = await downloadBlankCopy();
      toast.ok(`Downloaded ${r.name}: ${r.rows} rows blanked, formatting kept. Nothing in the dashboard changed.`);
      setOpen(false);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={() => setOpen(false)} title="Reset tracker">
        <div className="space-y-3 text-[13px] text-ink-2">
          <p>
            Empties the contact tables (names, emails, positions, LinkedIn, team, status, notes, dates). The tabs, headers,
            banners, the # numbering, OVERVIEW / COVERAGE / application tabs and all formatting stay, so it works as a blank
            template.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2">
              <input type="radio" className="accent-navy" checked={scope === "all"} onChange={() => setScope("all")} />
              Every tab
            </label>
            {activeSheet && (
              <label className="flex items-center gap-2">
                <input type="radio" className="accent-navy" checked={scope === "tab"} onChange={() => setScope("tab")} />
                Only the &ldquo;{activeSheet}&rdquo; tab
              </label>
            )}
          </div>
          {scope === "all" && hit.loose.length > 0 && (
            <label className="flex items-start gap-2">
              <Checkbox checked={everything} onChange={setEverything} label="Also delete contacts that aren't in the spreadsheet" />
              <span>Also delete the {hit.loose.length} contact{hit.loose.length === 1 ? "" : "s"} that aren&rsquo;t in the spreadsheet (added in the dashboard, or left over from another file).</span>
            </label>
          )}
          <p className="text-[12.5px]">
            {tabCount} tab{tabCount === 1 ? "" : "s"} with contact tables · {hit.inScope.length + (everything ? hit.loose.length : 0)} contacts removed from the dashboard
            {hit.work > 0 && <span className="text-red"> · {hit.work} have outreach history, which is deleted too</span>}
          </p>
          <div className="rounded-md border border-line bg-subtle p-2.5 text-[12.5px]">
            <b>Clear tracker</b> makes these pending changes. Saving to {meta.fileName} overwrites it; <b>Download a copy</b> (in the ⋯ menu) writes a new
            file instead. <b>Download blank copy</b> makes a separate blank file and changes nothing here.
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button icon={<Download className="size-3.5" />} loading={busy} onClick={blankCopy} title="Every contact table blanked, in a new file. The dashboard and your file are untouched.">
              Download blank copy
            </Button>
            <Button variant="danger" icon={<Eraser className="size-3.5" />} onClick={clear}>
              Clear tracker
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

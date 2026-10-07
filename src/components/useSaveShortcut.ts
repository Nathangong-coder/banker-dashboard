"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { toast } from "./ui";

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
      // The spreadsheet code loads on first use, so it isn't in every page's bundle.
      const { currentPatches, saveWorkbook } = await import("@/lib/actions");
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

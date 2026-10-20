"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Columns2, Download, Eraser, FileSpreadsheet, Link2, Plus, Save, Sparkles, Upload } from "lucide-react";
import { useStore } from "@/lib/store";
import { bankTabsSkipped, describeTabChanges, enrichContacts, ensureBankTabs, restorableTabLinks, restoreTabLinks, splitLocationTeamColumns, undoBankTabs } from "@/lib/actions";
import { contactPatches, mergePatches, splitLocationTeamPatches } from "@/lib/workbook";
import { Button, Card, Menu, PageHeader, Progress, Segmented, toast } from "@/components/ui";
import { ResetTrackerModal, WorkbookEmpty, useImportWorkbook, useSaveWorkbook } from "@/components/WorkbookControls";
import { SheetGrid } from "@/components/SheetGrid";
import { ContactsTable } from "@/components/ContactsTable";
import { hasKey } from "@/lib/keys";

export default function SheetPage() {
  return (
    <Suspense>
      <SheetInner />
    </Suspense>
  );
}

function SheetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const view = params.get("view") === "contacts" ? "contacts" : "grid";
  const meta = useStore((s) => s.workbook);
  const contacts = useStore((s) => s.contacts);
  const snapshots = useStore((s) => s.snapshots);
  const settings = useStore((s) => s.settings);
  const [sheet, setSheet] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const importer = useImportWorkbook();
  const saver = useSaveWorkbook();

  const manual = useStore((s) => s.patches);
  const patches = useMemo(
    () => mergePatches(contactPatches(contacts, snapshots), manual),
    [contacts, snapshots, manual],
  );
  const activeSheet = sheet ?? snapshots.find((s) => contacts.some((c) => c.ref?.sheet === s.name))?.name ?? snapshots[0]?.name;

  const extraSheets = Object.keys(patches).filter((n) => !snapshots.some((s) => s.name === n));
  const pendingChanges = Object.values(patches).reduce((n, p) => n + Object.keys(p).length, 0);

  const tables = useStore((s) => s.tables);
  const combinedTables = useMemo(() => splitLocationTeamPatches(snapshots, tables).tables, [snapshots, tables]);
  // New bank tabs waiting to be saved (made automatically for firms on your lists with no tab).
  const sheetOps = useStore((s) => s.sheetOps);
  const newTabs = sheetOps?.clones ?? [];
  const renames = sheetOps?.renames ?? [];
  const rebuilt = sheetOps?.replaces ?? [];
  const tabChangeText = [
    newTabs.length && `${newTabs.length} new bank tab${newTabs.length > 1 ? "s" : ""}`,
    renames.length && `${renames.length} renamed`,
    rebuilt.length && `${rebuilt.map((r) => r.name).join(", ")} rebuilt`,
  ]
    .filter(Boolean)
    .join(" · ");
  // Banks with no tab that won't get one, and why (hidden, PE, undone…). Recomputed when the sheets or lists change.
  const coverageState = useStore((s) => s.coverage);
  const targets = useStore((s) => s.targets);
  const skippedBanks = useMemo(() => bankTabsSkipped(), [snapshots, manual, contacts, targets, coverageState]); // eslint-disable-line react-hooks/exhaustive-deps
  const runAddTabs = () => {
    const text = describeTabChanges(ensureBankTabs());
    if (text) toast.ok(text);
    else toast.info("Every bank on your lists already has a tab.");
  };
  const runUndoTabs = () => {
    if (undoBankTabs()) toast.info(`Tab changes undone for now. They come back on the next load or save; hide a bank on Bank coverage to leave it out.`);
    else toast.info("Nothing to undo here. Re-import the spreadsheet to discard the pending tab changes.");
  };
  const linksToRestore = useMemo(() => restorableTabLinks(snapshots, patches).count, [snapshots, patches]);
  const runRestoreLinks = () => {
    const n = restoreTabLinks();
    toast.ok(`Restored ${n} links between tabs (OVERVIEW ↔ bank tabs). They're highlighted; save to write them into the file.`);
  };
  const runSplit = () => {
    const n = splitLocationTeamColumns();
    toast.ok(`Split Location/Team on ${n} table${n === 1 ? "" : "s"}. Check the highlighted cells, then save. Saving also adds the dropdowns in Excel.`);
  };

  const scope = useMemo(() => {
    if (view === "contacts" && selected.size) return contacts.filter((c) => selected.has(c.id));
    if (view === "grid" && activeSheet) return contacts.filter((c) => c.ref?.sheet === activeSheet);
    return contacts;
  }, [view, selected, contacts, activeSheet]);
  const missing = scope.filter((c) => !c.email && (c.linkedin || c.lastName));

  const runEnrich = async () => {
    if (!hasKey(settings, "apollo") && !hasKey(settings, "hunter")) {
      toast.err("Add an Apollo or Hunter API key in Settings first.");
      return;
    }
    if (!missing.length) {
      toast.info("Everyone in scope already has an email (or has no name/LinkedIn to match on).");
      return;
    }
    setProgress({ done: 0, total: missing.length });
    const r = await enrichContacts(
      missing.map((c) => c.id),
      (done, total) => setProgress({ done, total }),
    );
    setProgress(null);
    if (r.errors.length) toast.err(r.errors[0]);
    toast.ok(`Found ${r.found} of ${r.attempted} emails. Save or download to write them into your spreadsheet.`);
  };

  if (!meta && contacts.length === 0) {
    return (
      <>
        <PageHeader title="Spreadsheet" />
        <WorkbookEmpty />
      </>
    );
  }

  const setView = (v: string) => router.replace(`/sheet?view=${v}`);
  const isGrid = view === "grid";
  const canAddTabs = isGrid && !tabChangeText && skippedBanks.some((b) => !/private equity|hidden/.test(b.why));
  const skippedWhy = skippedBanks.map((b) => `${b.bank}: ${b.why}`).join("\n");
  const enrichScope = isGrid
    ? `Looks up emails for everyone on the "${activeSheet}" tab who's missing one.`
    : selected.size
      ? `Looks up emails for the ${selected.size} selected contacts.`
      : "Looks up emails for everyone missing one. Select rows to narrow it down.";

  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <FileSpreadsheet className="size-4 shrink-0 text-brass" />
        <span className="truncate text-[13.5px] font-medium text-ink" title={meta?.fileName}>
          {meta?.fileName ?? "Contacts"}
        </span>
        {pendingChanges > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-brass-ink" title="Cell changes not written to the file yet">
            <span className="size-2 rounded-full bg-brass" />
            <span className="num">{pendingChanges}</span> unsaved
          </span>
        )}
      </div>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          ["grid", "Grid"],
          ["contacts", "Contacts"],
        ]}
      />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {progress ? (
          <div className="w-56 max-w-full">
            <Progress value={progress.done} max={progress.total} label={`${progress.done}/${progress.total} looked up`} />
          </div>
        ) : (
          <Button variant="brass" icon={<Sparkles className="size-3.5" />} onClick={runEnrich} title={enrichScope}>
            Find <span className="num">{missing.length}</span> email{missing.length === 1 ? "" : "s"}
          </Button>
        )}
        {meta && (
          <Button
            variant="primary"
            icon={meta.hasHandle ? <Save className="size-3.5" /> : <Download className="size-3.5" />}
            loading={saver.busy === (meta.hasHandle ? "in-place" : "download")}
            onClick={() => saver.run(meta.hasHandle ? "in-place" : "download")}
            title={meta.hasHandle ? `Save to ${meta.fileName} (Ctrl+S)` : "This browser can't write to the file, so Save downloads an updated copy"}
          >
            Save
          </Button>
        )}
        <Menu
          items={[
            canAddTabs && {
              label: "Add missing bank tabs",
              hint: `${skippedBanks.length} bank${skippedBanks.length > 1 ? "s" : ""} without a tab`,
              icon: <Plus />,
              onClick: runAddTabs,
            },
            isGrid &&
              !canAddTabs &&
              skippedBanks.length > 0 && {
                label: `${skippedBanks.length} bank${skippedBanks.length > 1 ? "s" : ""} without a tab`,
                hint: skippedBanks
                  .slice(0, 3)
                  .map((b) => `${b.bank}: ${b.why}`)
                  .join(" · ") + (skippedBanks.length > 3 ? " …" : ""),
                icon: <Plus />,
                disabled: true,
                onClick: () => {},
              },
            isGrid &&
              linksToRestore > 0 && {
                label: "Restore tab links",
                hint: `${linksToRestore} OVERVIEW ↔ bank-tab links an older save dropped`,
                icon: <Link2 />,
                onClick: runRestoreLinks,
              },
            isGrid &&
              combinedTables > 0 && {
                label: "Split Location/Team",
                hint: `${combinedTables} table${combinedTables === 1 ? "" : "s"}: two columns, each with a dropdown`,
                icon: <Columns2 />,
                onClick: runSplit,
              },
            "divider",
            meta && {
              label: "Download a copy",
              hint: "An updated .xlsx; your file stays as it is",
              icon: <Download />,
              disabled: saver.busy === "download",
              onClick: () => saver.run("download"),
            },
            {
              label: meta ? "Import another workbook" : "Import a workbook",
              hint: meta ? "Or re-import this one after editing it in Excel" : undefined,
              icon: <Upload />,
              disabled: importer.busy,
              onClick: importer.run,
            },
            "divider",
            meta && {
              label: "Reset tracker…",
              hint: "Blank the contact tables, keep tabs and formatting",
              icon: <Eraser />,
              danger: true,
              onClick: () => setResetOpen(true),
            },
          ]}
        />
      </div>
      {importer.input}
    </div>
  );

  const notice = isGrid && tabChangeText && (
    <div
      className="flex items-center gap-2 border-b border-line bg-brass-soft px-3 py-1.5 text-[12px] text-brass-ink"
      title={[
        ...newTabs.map((t) => `${t.name}: ${t.bank}`),
        ...renames.map((r) => `${r.from} → ${r.to}`),
        ...rebuilt.map((r) => `${r.name}: rebuilt`),
        skippedWhy && `\nWithout a tab:\n${skippedWhy}`,
      ]
        .filter(Boolean)
        .join("\n")}
    >
      <span className="min-w-0 truncate">{tabChangeText} (unsaved)</span>
      <button className="shrink-0 font-medium underline-offset-2 hover:underline" onClick={runUndoTabs}>
        Undo
      </button>
    </div>
  );

  return (
    <>
      <PageHeader title="Spreadsheet" sub={`${contacts.length} contacts · ${contacts.filter((c) => !c.email).length} missing email`} />

      {isGrid ? (
        <SheetGrid
          toolbar={
            <>
              {toolbar}
              {notice}
            </>
          }
          snapshots={snapshots}
          extraSheets={extraSheets}
          patches={patches}
          active={activeSheet}
          onSelectSheet={setSheet}
          contacts={contacts}
        />
      ) : (
        <>
          <Card className="mb-3">{toolbar}</Card>
          <ContactsTable selected={selected} onSelected={setSelected} initialFilter={params.get("filter") ?? undefined} initialBank={params.get("bank") ?? undefined} />
        </>
      )}
      <ResetTrackerModal open={resetOpen} onClose={() => setResetOpen(false)} activeSheet={isGrid ? activeSheet : undefined} />
    </>
  );
}

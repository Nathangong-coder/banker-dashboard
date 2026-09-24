"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Table2, Users } from "lucide-react";
import { useStore } from "@/lib/store";
import { enrichContacts } from "@/lib/actions";
import { contactPatches, mergePatches } from "@/lib/workbook";
import { Button, PageHeader, Progress, toast } from "@/components/ui";
import { SaveButtons, UploadButton, WorkbookEmpty } from "@/components/WorkbookControls";
import { SheetGrid } from "@/components/SheetGrid";
import { ContactsTable } from "@/components/ContactsTable";
import { cn } from "@/lib/util";
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

  const manual = useStore((s) => s.patches);
  const patches = useMemo(
    () => mergePatches(contactPatches(contacts, snapshots), manual),
    [contacts, snapshots, manual],
  );
  const activeSheet = sheet ?? snapshots.find((s) => contacts.some((c) => c.ref?.sheet === s.name))?.name ?? snapshots[0]?.name;

  const extraSheets = Object.keys(patches).filter((n) => !snapshots.some((s) => s.name === n));
  const pendingChanges = Object.values(patches).reduce((n, p) => n + Object.keys(p).length, 0);

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

  return (
    <>
      <PageHeader
        title="Spreadsheet"
        sub={
          <>
            {meta?.fileName} · {contacts.length} contacts · {contacts.filter((c) => !c.email).length} missing email
            {pendingChanges > 0 && (
              <span className="ml-2 rounded bg-brass-soft px-1.5 py-0.5 text-[12px] text-[#7d5d1f]">
                {pendingChanges} unsaved cell change{pendingChanges > 1 ? "s" : ""}
              </span>
            )}
          </>
        }
        right={
          <>
            <UploadButton />
            <SaveButtons />
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-line-2 bg-panel p-0.5">
          {[
            { v: "grid", label: "Sheet view", icon: Table2 },
            { v: "contacts", label: "All contacts", icon: Users },
          ].map(({ v, label, icon: Icon }) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px]",
                view === v ? "bg-navy text-white" : "text-ink-2 hover:bg-[#f0eee7]",
              )}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {progress ? (
          <div className="w-72">
            <Progress value={progress.done} max={progress.total} label={`${progress.done}/${progress.total} looked up`} />
          </div>
        ) : (
          <Button variant="brass" icon={<Sparkles className="size-3.5" />} onClick={runEnrich}>
            Enrich contact info
            <span className="num rounded bg-white/20 px-1 text-[11px]">{missing.length}</span>
          </Button>
        )}
      </div>
      <p className="-mt-2 mb-4 text-[12px] text-muted">
        {view === "grid"
          ? `Enrich looks up emails for everyone on the "${activeSheet}" tab who's missing one.`
          : selected.size
            ? `Enrich looks up emails for the ${selected.size} selected contacts.`
            : "Enrich looks up emails for everyone missing one. Select rows to narrow it down."}
      </p>

      {view === "grid" ? (
        <SheetGrid
          snapshots={snapshots}
          extraSheets={extraSheets}
          patches={patches}
          active={activeSheet}
          onSelectSheet={setSheet}
          contacts={contacts}
        />
      ) : (
        <ContactsTable selected={selected} onSelected={setSelected} initialFilter={params.get("filter") ?? undefined} />
      )}
    </>
  );
}

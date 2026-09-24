"use client";

import { useMemo, useState } from "react";
import { ChevronRight, ExternalLink, PanelRightClose, PanelRightOpen, Table2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { buildCoverage, type CoverageRow } from "@/lib/coverage";
import { canonBank } from "@/lib/banks";
import type { Contact } from "@/lib/types";
import { cn, fmtDate, relDays } from "@/lib/util";
import { Badge, StatusBadge } from "./ui";

const CONTACTED = new Set(["drafted", "sent", "followed_up", "replied", "call_scheduled", "done", "ignored"]);
const BUCKET_LABEL = { reached: ["Reached", "green"], ready: ["Not reached yet", "amber"], cold: ["Cold", "neutral"], hidden: ["Hidden", "neutral"] } as const;

/** Coverage rows for a set of bank names (matched by canonical name). */
export function useFirmRows(banks: string[]) {
  const { contacts, tables, targets, coverage, banks: meta, settings } = useStore();
  const all = useMemo(
    () => buildCoverage({ contacts, tables, targets, coverage, banks: meta, followUp: settings.followUp }),
    [contacts, tables, targets, coverage, meta, settings.followUp],
  );
  const keys = banks.map(canonBank);
  return keys.map((k) => all.find((r) => r.key === k)).filter(Boolean) as CoverageRow[];
}

function touchDate(c: Contact) {
  if (c.repliedAt) return `replied ${fmtDate(c.repliedAt)}`;
  if (c.lastTouchAt && c.lastTouchAt !== c.sentAt) return `followed up ${fmtDate(c.lastTouchAt)}`;
  if (c.sentAt) return `emailed ${fmtDate(c.sentAt)}`;
  if (c.status === "drafted") return "draft ready";
  return "";
}

/** One firm: who's already been contacted, live-cap status, and (optionally) the sheet rows. */
export function FirmSummary({ r, highlight, compact }: { r: CoverageRow; highlight?: Set<string>; compact?: boolean }) {
  const cap = useStore((s) => s.settings.followUp.livePerBank);
  const [sheet, setSheet] = useState(false);
  const contacted = r.contacts
    .filter((c) => CONTACTED.has(c.status) || c.sentAt)
    .sort((a, b) => (b.lastTouchAt ?? b.sentAt ?? "").localeCompare(a.lastTouchAt ?? a.sentAt ?? ""));
  const notYet = r.contacts.filter((c) => !contacted.includes(c));
  const [label, tone] = BUCKET_LABEL[r.bucket];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{r.name}</span>
        {r.tier && <span className="text-[11px] text-muted">{r.tier}</span>}
        <Badge tone={tone}>{label}</Badge>
        <Badge tone={r.live >= cap ? "red" : "neutral"}>
          <span className="num">
            {r.live}/{cap} live
          </span>
        </Badge>
        {r.replied > 0 && <Badge tone="green">{r.replied} replied</Badge>}
      </div>
      {r.live >= cap && (
        <p className="text-[11.5px] text-red">
          At your limit of {cap} live people here. Wait for a reply or move someone on before emailing more.
        </p>
      )}

      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Already contacted ({contacted.length})</div>
        {contacted.length === 0 ? (
          <p className="text-[12px] text-muted">Nobody yet. You’d be the first email to {r.name}.</p>
        ) : (
          <ul className="space-y-1">
            {contacted.slice(0, compact ? 4 : 50).map((c) => (
              <li key={c.id} className={cn("rounded px-1.5 py-1 text-[12px]", highlight?.has(c.id) && "bg-blue-soft/50")}>
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{c.name}</span>
                  {c.linkedin && (
                    <a href={c.linkedin} target="_blank" rel="noreferrer" className="text-muted hover:text-blue" aria-label={`${c.name} on LinkedIn`}>
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                  <span className="ml-auto shrink-0">
                    <StatusBadge status={c.status} />
                  </span>
                </div>
                <div className="truncate text-[11.5px] text-muted">
                  {[c.position, c.region !== "Other" ? c.region : "", touchDate(c)].filter(Boolean).join(" · ")}
                  {c.followUps > 0 && ` · ${c.followUps} follow-up${c.followUps > 1 ? "s" : ""}`}
                </div>
                {!compact && c.comment && <div className="truncate text-[11.5px] text-ink-2" title={c.comment}>“{c.comment}”</div>}
              </li>
            ))}
            {compact && contacted.length > 4 && <li className="px-1.5 text-[11.5px] text-muted">+{contacted.length - 4} more</li>}
          </ul>
        )}
      </div>

      {!compact && notYet.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Not contacted yet ({notYet.length})</div>
          <p className="text-[12px] leading-relaxed text-ink-2">
            {notYet.map((c, i) => (
              <span key={c.id} className={cn(highlight?.has(c.id) && "rounded bg-blue-soft/60 px-0.5 font-medium")}>
                {c.name}
                {!c.email && <span className="text-red/70"> (no email)</span>}
                {i < notYet.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
        </div>
      )}

      {!compact && r.contacts.length > 0 && (
        <div>
          <button className="flex items-center gap-1 text-[12px] font-medium text-navy hover:underline" onClick={() => setSheet(!sheet)}>
            <Table2 className="size-3.5" /> {sheet ? "Hide" : "Show"} sheet rows
          </button>
          {sheet && (
            <div className="mt-1.5 max-h-72 overflow-auto rounded border border-line">
              <table className="grid-sheet w-full">
                <thead>
                  <tr>
                    <th className="text-left">Name</th>
                    <th className="text-left">Position</th>
                    <th className="text-left">Loc/Team</th>
                    <th className="text-left">Email</th>
                    <th className="text-left">Status</th>
                    <th className="text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {r.contacts.map((c) => (
                    <tr key={c.id} className={cn(highlight?.has(c.id) && "bg-blue-soft/40")}>
                      <td>{c.name}</td>
                      <td>{c.position}</td>
                      <td>{c.location}</td>
                      <td className={cn(!c.email && "text-red/70")}>{c.email || "missing"}</td>
                      <td>{c.sheetStatus && c.status === "new" ? c.sheetStatus : c.status.replace("_", " ")}</td>
                      <td title={c.comment}>{c.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {r.lastOutreach && <p className="text-[11px] text-muted">Last outreach here {relDays(r.lastOutreach)}.</p>}
    </div>
  );
}

const STORE_KEY = "drafts-firm-panel";

/** Collapsible right-hand panel on the Drafts page. */
export function FirmPanel({ banks, highlight }: { banks: string[]; highlight: Set<string> }) {
  const rows = useFirmRows(banks);
  // The app renders client-side only (Shell waits for hydration), so reading localStorage here is safe.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORE_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(STORE_KEY, next ? "open" : "closed");
    } catch {}
  };

  if (!open)
    return (
      <button
        onClick={toggle}
        className="sticky top-6 flex h-fit flex-col items-center gap-2 rounded-lg border border-line bg-panel px-1.5 py-3 text-[12px] text-ink-2 hover:border-navy/40"
        aria-label="Show firm context"
        title="Who you’ve already contacted at these firms"
      >
        <PanelRightOpen className="size-4 text-brass" />
        <span className="[writing-mode:vertical-rl]">At this firm{rows.length ? ` · ${rows.length}` : ""}</span>
      </button>
    );

  return (
    <aside className="sticky top-6 h-fit max-h-[calc(100vh-3rem)] w-[320px] overflow-y-auto rounded-lg border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-[13.5px] font-semibold">At this firm</div>
          <div className="text-[11.5px] text-muted">Who you’ve already reached, before you email more</div>
        </div>
        <button onClick={toggle} className="rounded p-1 text-muted hover:bg-[#efede5] hover:text-ink" aria-label="Collapse panel">
          <PanelRightClose className="size-4" />
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-muted">
          Select contacts (or filter by a bank) to see who else you’ve emailed or talked to there.
        </p>
      ) : (
        <div className="divide-y divide-line">
          {rows.map((r) => (
            <details key={r.key} open={rows.length <= 2} className="group px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-[12.5px] font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
                {r.name}
                <span className="num ml-auto text-[11.5px] text-muted">
                  {r.reached} reached · {r.replied} replied
                </span>
              </summary>
              <div className="mt-2">
                <FirmSummary r={r} highlight={highlight} />
              </div>
            </details>
          ))}
        </div>
      )}
    </aside>
  );
}

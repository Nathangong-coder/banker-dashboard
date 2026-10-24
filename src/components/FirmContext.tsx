"use client";

import { Fragment, useMemo, useState } from "react";
import { ExternalLink, Table2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { buildCoverage, type CoverageRow } from "@/lib/coverage";
import { canonBank } from "@/lib/banks";
import { DESK_STATE_LABEL, deskKey, deskLabel, deskOf, targetLabel } from "@/lib/desks";
import { LIVE_STATUSES } from "@/lib/followups";
import { STATUS_LABEL, type Contact } from "@/lib/types";
import { teamOf } from "@/lib/locationTeam";
import { cn, fmtDate, relDays } from "@/lib/util";
import { Badge, StatusBadge } from "./ui";

const CONTACTED = new Set(["drafted", "sent", "followed_up", "replied", "call_scheduled", "done", "ignored"]);
const BUCKET_LABEL = { reached: ["Reached", "green"], ready: ["Not reached yet", "amber"], cold: ["Cold", "neutral"], hidden: ["Hidden", "neutral"] } as const;

/** Coverage rows for a set of bank names (matched by canonical name). */
export function useFirmRows(banks: string[]) {
  const { contacts, tables, targets, coverage, banks: meta, settings } = useStore();
  const all = useMemo(
    () => buildCoverage({ contacts, tables, targets, coverage: { ...coverage, plan: undefined }, banks: meta, followUp: settings.followUp }),
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
  // Live people per desk (office + team): the cap applies to each desk separately.
  const desks = [...r.contacts.filter((c) => LIVE_STATUSES.has(c.status)).reduce((m, c) => {
    const k = deskKey(c);
    const d = deskOf(c);
    m.set(k, { label: deskLabel(d.region, d.team), live: (m.get(k)?.live ?? 0) + 1 });
    return m;
  }, new Map<string, { label: string; live: number }>()).values()];
  const full = desks.filter((d) => d.live >= cap);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{r.name}</span>
        {r.tier && <span className="text-[11px] text-muted">{r.tier}</span>}
        <Badge tone={tone}>{label}</Badge>
{desks.length === 0 && (
          <Badge tone="neutral">
            <span className="num">0 live</span>
          </Badge>
        )}
        {desks.map((d) => (
          <Badge key={d.label} tone={d.live >= cap ? "red" : "neutral"}>
            <span className="num">
              {d.label} {d.live}/{cap}
            </span>
          </Badge>
        ))}
        {r.replied > 0 && <Badge tone="green">{r.replied} replied</Badge>}
      </div>
      {full.length > 0 && (
        <p className="text-[11.5px] text-red">
          {full.map((d) => d.label).join(", ")} {full.length > 1 ? "are" : "is"} at your limit of {cap} live people. Other teams and offices here are
          fine to email.
        </p>
      )}
      {r.desks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {r.desks.map((d) => (
            <Badge key={d.target.id} tone={d.state === "replied" || d.state === "emailed" ? "green" : d.state === "ready" ? "amber" : "neutral"}>
              {targetLabel(d.target)}: {DESK_STATE_LABEL[d.state]}
            </Badge>
          ))}
        </div>
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
                  {[c.position, [c.region !== "Other" ? c.region : "", c.team].filter(Boolean).join(" "), touchDate(c)].filter(Boolean).join(" · ")}
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
                      <td>{[c.location, c.team].filter(Boolean).join(" · ")}</td>
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

const STATUS_TEXT: Record<Contact["status"], string> = {
  new: "text-muted",
  drafted: "text-brass-ink",
  sent: "text-navy",
  followed_up: "text-amber",
  replied: "font-medium text-green",
  call_scheduled: "font-medium text-green",
  done: "text-ink-2",
  ignored: "text-muted line-through",
};

const SHEET_ORDER: Record<Contact["status"], number> = { call_scheduled: 0, replied: 1, done: 2, followed_up: 3, sent: 4, drafted: 5, new: 6, ignored: 7 };

/**
 * "At this firm" on the Drafts page, laid out like the spreadsheet: one banner row per firm (emailed / replied and
 * the live count per desk against your cap), then one row per person with their desk, status and last email.
 */
export function FirmSheet({ banks, highlight }: { banks: string[]; highlight: Set<string> }) {
  const rows = useFirmRows(banks);
  const cap = useStore((s) => s.settings.followUp.livePerBank);
  return (
    <aside className="flex max-h-[calc(100vh-3rem)] min-h-[320px] flex-col overflow-hidden rounded-lg border border-line bg-panel xl:sticky xl:top-6">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Table2 className="size-4 text-brass" />
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold">At this firm</div>
          <div className="truncate text-[11.5px] text-muted">Everyone you have there, before you email more</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12.5px] text-muted">Select contacts (or filter by a bank) to see everyone you have at their firm.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="grid-sheet w-full">
            <thead>
              <tr>
                <th className="w-7" />
                <th className="text-left">Name</th>
                <th className="text-left">Desk</th>
                <th className="text-left">Status</th>
                <th className="text-left">Last email</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const people = [...r.contacts].sort((a, b) => SHEET_ORDER[a.status] - SHEET_ORDER[b.status] || a.name.localeCompare(b.name));
                const desks = [...people.filter((c) => LIVE_STATUSES.has(c.status)).reduce((m, c) => {
                  const k = deskKey(c);
                  const d = deskOf(c);
                  m.set(k, { label: deskLabel(d.region, d.team), live: (m.get(k)?.live ?? 0) + 1 });
                  return m;
                }, new Map<string, { label: string; live: number }>()).values()];
                const emailed = people.filter((c) => c.sentAt || (CONTACTED.has(c.status) && c.status !== "drafted" && c.status !== "ignored")).length;
                return (
                  <Fragment key={r.key}>
                    <tr>
                      <th />
                      <td colSpan={4} className="!h-auto !max-w-none bg-subtle !py-1 font-semibold whitespace-normal text-ink">
                        {r.name}
                        <span className="num ml-2 text-[11.5px] font-normal text-muted">
                          {people.length} · {emailed} emailed · {r.replied} replied
                        </span>
                        {desks.length > 0 && (
                          <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                            {desks.map((d) => (
                              <span
                                key={d.label}
                                title={d.live >= cap ? `At your limit of ${cap} live people on this desk` : undefined}
                                className={cn("num rounded px-1 text-[10.5px] font-normal", d.live >= cap ? "bg-red-soft text-red" : "bg-hover text-ink-2")}
                              >
                                {d.label} {d.live}/{cap}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                    </tr>
                    {people.map((c, i) => (
                      <tr key={c.id} className={cn(highlight.has(c.id) && "bg-blue-soft/50")}>
                        <th>{i + 1}</th>
                        <td title={[c.position, c.email].filter(Boolean).join(" · ")}>
                          {c.linkedin ? (
                            <a href={c.linkedin} target="_blank" rel="noreferrer" className="hover:text-navy hover:underline">
                              {c.name}
                            </a>
                          ) : (
                            c.name
                          )}
                          {!c.email && <span className="ml-1 text-[10.5px] text-red/80">no email</span>}
                        </td>
                        <td className="text-ink-2">{[c.region !== "Other" ? c.region : "", teamOf(c)].filter(Boolean).join(" · ") || "—"}</td>
                        <td className={STATUS_TEXT[c.status]}>{STATUS_LABEL[c.status]}</td>
                        <td className="num text-muted">{touchDate(c).replace(/^emailed /, "") || "—"}</td>
                      </tr>
                    ))}
                    {!people.length && (
                      <tr>
                        <th />
                        <td colSpan={4} className="text-muted">
                          Nobody yet. You’d be the first email to {r.name}.
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </aside>
  );
}

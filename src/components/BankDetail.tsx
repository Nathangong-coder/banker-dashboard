"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useStore } from "@/lib/store";
import type { CoverageRow } from "@/lib/coverage";
import { liveKind, wasEmailed, type BankTodo, type BankWork, type OfficeSlot, type Urgency } from "@/lib/bankWork";
import { canonBank } from "@/lib/banks";
import type { OffSheetPerson } from "@/lib/offSheet";
import { regionInfo, type Contact } from "@/lib/types";
import { teamOf } from "@/lib/locationTeam";
import { cn, fmtDate, relDays } from "@/lib/util";
import { Badge, Menu, StatusBadge, toast } from "./ui";
import { markHandled, notThem } from "./CalendarActions";
import { DeskChips, OfficePicker, SpecialtyPicker } from "./RecruitingPlan";

/**
 * One bank opened up (Bank coverage, Process tracker): what to do there, why it's urgent, its desks, and its people
 * with a ⋯ menu each. Moved out of app/coverage on 2026-11-21 so both pages share it.
 */
export interface BankDetailView {
  r: CoverageRow;
  w: BankWork;
  u: Urgency;
  /** The contacts shown (all of the bank's, or the ones on a desk filter). */
  people: Contact[];
  /** At that office with no team set. */
  unsorted: Contact[];
}

/** One chip per office: green when maxed out (referral / live / the cap awaiting), red with a Find link when not. */
export function OfficeChips({ name, slots }: { name: string; slots: OfficeSlot[] }) {
  const cap = useStore((s) => Math.max(1, s.settings.followUp.livePerBank));
  if (!slots.length) return <span className="text-[12px] text-muted">—</span>;
  return (
    <div className="flex max-w-[240px] flex-wrap gap-1">
      {slots.map((o) =>
        o.full ? (
          <Badge key={o.office} tone="green" className="px-1.5 py-0 text-[10.5px]">
            {o.office} {o.referral.length ? "referral" : o.live.length ? "live" : `${o.awaiting.length}/${cap}`}
          </Badge>
        ) : (
          <Link
            key={o.office}
            href={`/find?banks=${encodeURIComponent(name)}&desk=${encodeURIComponent(`${o.office}|${o.team}`)}`}
            title={`${o.office}: ${o.awaiting.length} of ${cap} awaiting, nobody live. Find people here.`}
          >
            <Badge tone="red" className="px-1.5 py-0 text-[10.5px]">
              {o.office} {o.awaiting.length}/{cap}
            </Badge>
          </Link>
        ),
      )}
    </div>
  );
}

export function NextStep({ t }: { t?: BankTodo }) {
  if (!t) return <span className="text-[12px] text-muted">—</span>;
  if (!t.href) return <span className="text-[12.5px] text-muted">{t.label}</span>;
  return (
    <Link
      href={t.href}
      onClick={(e) => e.stopPropagation()}
      className={cn("inline-flex max-w-[260px] min-w-0 items-center gap-1 text-[12.5px] font-medium hover:underline", t.outstanding ? "text-brass-ink" : "text-navy")}
    >
      <span className="truncate">{t.label}</span> <ArrowRight className="size-3 shrink-0" />
    </Link>
  );
}

export function BankDetail({ x }: { x: BankDetailView }) {
  const { r, w, u } = x;
  const people = [...x.people].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
        <div>
          <h4 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">What to do here</h4>
          {w.todos.length ? (
            <ul className="divide-y divide-line rounded-md border border-line bg-panel">
              {w.todos.map((t, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                  <span className={cn("size-1.5 shrink-0 rounded-full", t.kind === "reply" || t.kind === "thank" ? "bg-red" : t.outstanding ? "bg-brass" : "bg-line-2")} />
                  <span className="min-w-0 flex-1 text-ink">
                    {t.label}
                    {/* Already done outside what the dashboard sees (a text, LinkedIn, an email it missed): settle it here. */}
                    {(t.kind === "thank" || t.kind === "reply" || t.kind === "check_in") && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {t.people.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="rounded border border-line-2 px-1.5 py-0.5 text-[11px] text-ink-2 hover:border-brass-strong hover:text-ink"
                            title={`You already ${t.kind === "check_in" ? "checked in with" : t.kind === "thank" ? "thanked" : "answered"} ${c.name} (a text, LinkedIn, an email the dashboard missed)`}
                            onClick={() => {
                              markHandled(c.id);
                              toast.ok(`${c.name}: marked done.`);
                            }}
                          >
                            ✓ {c.firstName || c.name} done
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                  {t.href && (
                    <Link href={t.href} className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-navy hover:underline">
                      Open <ArrowRight className="size-3" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted">Nothing to do here right now.</p>
          )}
        </div>
        <div>
          <h4 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Why urgency {u.score}</h4>
          <ul className="grid gap-2">
            {u.parts.map((p) => (
              <li key={p.id}>
                <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="font-medium text-ink">{p.label}</span>
                  <span className="num text-ink-2">
                    {p.points} / {p.max}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-track">
                  <div className="h-full rounded-full bg-brass" style={{ width: `${(p.points / p.max) * 100}%` }} />
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted">{p.detail}</div>
              </li>
            ))}
            {!u.parts.some((p) => p.id === "timeline") && <li className="text-[11.5px] text-muted">Timeline: counts once a tracked job here has a deadline (Applications → My list).</li>}
          </ul>
        </div>
        {(r.desks.length > 0 || r.offices.all.length > r.offices.cap) && (
          <div>
            <h4 className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Desks in your plan</h4>
            <DeskChips r={r} />
            <OfficePicker r={r} />
          </div>
        )}
        <SpecialtyPicker r={r} />
      </div>
      <div className="min-w-0">
        <h4 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">People ({people.length})</h4>
        {people.length ? (
          <div className="max-h-80 overflow-auto rounded-md border border-line bg-panel">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-subtle text-left text-[10.5px] uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-1.5 font-medium">Name</th>
                  <th className="px-2 py-1.5 font-medium">Office · team</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5 font-medium">Last</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {people.map((c) => (
                  <tr key={c.id} className={cn(c.status === "ignored" && "opacity-55")}>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <Link href={`/person?id=${encodeURIComponent(c.id)}`} className="font-medium text-brass-ink hover:underline">
                          {c.name}
                        </Link>
                        <KindBadge c={c} />
                      </div>
                      <div className="truncate text-[11px] text-muted">{c.position || (c.email ? c.email : "no email")}</div>
                    </td>
                    <td className="px-2 py-1.5 text-ink-2">{[c.region !== "Other" ? regionInfo(c.region).short : c.location, teamOf(c)].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-2 py-1.5">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-3 py-1.5 text-[11.5px] text-muted">{lastTouch(c)}</td>
                    <td className="px-1 py-1.5">
                      <PersonMenu c={c} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">Nobody found here yet.</p>
        )}
        <OffSheetHere bank={r.name} />
        {x.unsorted.length > 0 && <p className="mt-1.5 text-[11.5px] text-muted">{x.unsorted.length} more at this office with no team set: {x.unsorted.map((c) => c.name).join(", ")}.</p>}
        <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
          <Link href={`/find?banks=${encodeURIComponent(r.name)}`} className="font-medium text-navy hover:underline">
            Find people
          </Link>
          <Link href={`/drafts?bank=${encodeURIComponent(r.name)}`} className="font-medium text-navy hover:underline">
            Draft emails
          </Link>
          <Link href={`/sheet?view=contacts&bank=${encodeURIComponent(r.name)}`} className="font-medium text-navy hover:underline">
            Open in spreadsheet
          </Link>
          {w.lastActivity && <span className="text-muted">Last activity {relDays(w.lastActivity)}</span>}
        </div>
      </div>
    </div>
  );
}

/** People you emailed at this bank who aren't in the tracker yet (from your sent mail), with Add. */
export function OffSheetHere({ bank }: { bank: string }) {
  const off = useStore((s) => s.offSheet);
  const contacts = useStore((s) => s.contacts);
  const [list, setList] = useState<OffSheetPerson[]>([]);
  useEffect(() => {
    let live = true;
    void import("@/lib/gmailSync").then((m) => live && setList(m.offSheetList().filter((p) => canonBank(p.bank) === canonBank(bank))));
    return () => {
      live = false;
    };
  }, [off, contacts, bank]);
  if (!list.length) return null;
  return (
    <div className="mt-2 rounded-md border border-amber/40 bg-amber-soft/40 px-3 py-2 text-[12px]">
      <span className="font-medium text-ink">Emailed, not in the tracker:</span>
      <span className="ml-1 inline-flex flex-wrap gap-1.5">
        {list.map((p) => (
          <button
            key={p.email}
            type="button"
            className="rounded border border-line-2 bg-panel px-1.5 py-0.5 text-ink-2 hover:border-brass-strong hover:text-ink"
            title={`${p.email} · last ${fmtDate(p.lastAt)} · "${p.subject}"`}
            onClick={() =>
              void import("@/lib/gmailSync").then(async (m) => {
                await m.addOffSheet(p);
                toast.ok(`${p.name || p.email} added to the tracker.`);
              })
            }
          >
            + {p.name || p.email}
          </button>
        ))}
      </span>
    </div>
  );
}

/** Referral / live / awaiting, and "set by you" when you marked it. */
export function KindBadge({ c }: { c: Contact }) {
  const k = liveKind(c);
  if (!k && c.liveMark !== "off") return null;
  const by = c.liveMark ? " (set by you)" : "";
  if (!k) return <Badge className="px-1 py-0 text-[10px]">Not live{by}</Badge>;
  return (
    <Badge tone={k === "referral" ? "amber" : k === "live" ? "green" : "neutral"} className="px-1 py-0 text-[10px]">
      {k === "referral" ? "⚠ Referral" : k === "live" ? "Live" : "Awaiting"}
      {by}
    </Badge>
  );
}

/**
 * ⋯ per person (owner, 2026-10-28: "let me be more manual"): settle what the dashboard can't see, fix a calendar
 * match that was someone else, set live by hand, move on now or bring them back.
 */
export function PersonMenu({ c }: { c: Contact }) {
  const update = useStore((s) => s.updateContact);
  const note = (n: string) => ({ at: new Date().toISOString(), type: "note" as const, note: n });
  const movedOn = c.status === "ignored";
  return (
    <Menu
      label={`Actions for ${c.name}`}
      items={[
        { label: "Done by hand", hint: "Thanked / messaged them outside the dashboard (text, LinkedIn)", onClick: () => (markHandled(c.id), toast.ok(`${c.name}: marked done.`)) },
        c.call &&
          !c.call.invited && {
            label: "Not them (calendar)",
            hint: `The event on ${fmtDate(c.call.at)} was with someone else`,
            onClick: () => (notThem(c.id), toast.ok(`Calendar event taken off ${c.name}.`)),
          },
        "divider",
        c.liveMark !== "live" && { label: "Mark live", hint: "You're talking (e.g. by text)", onClick: () => update(c.id, { liveMark: "live" }, note("Marked live by hand")) },
        c.liveMark !== "off" && { label: "Not live", hint: "Whatever the dates say", onClick: () => update(c.id, { liveMark: "off" }, note("Marked not live by hand")) },
        c.liveMark && { label: "Live: automatic", onClick: () => update(c.id, { liveMark: undefined }) },
        "divider",
        !movedOn && {
          label: "Move on now",
          onClick: () => update(c.id, { status: "ignored", outcome: { kind: "no_reply", at: new Date().toISOString(), note: "Moved on by hand", confirmed: true } }, note("Moved on by hand")),
        },
        movedOn &&
          (c.outcome?.kind === "no_reply" || !c.outcome) && {
            label: "Bring back",
            onClick: () =>
              update(
                c.id,
                { status: c.repliedAt ? "replied" : c.followUps > 0 ? "followed_up" : c.sentAt ? "sent" : "new", outcome: undefined, snoozeUntil: new Date(Date.now() + 7 * 86_400_000).toISOString() },
                note("Brought back by hand"),
              ),
          },
      ]}
    />
  );
}

export function lastTouch(c: Contact) {
  if (c.repliedAt) return `replied ${fmtDate(c.repliedAt)}`;
  const last = c.lastEmailedAt ?? c.lastTouchAt ?? c.sentAt;
  if (last) return `${c.followUps ? `follow-up ${c.followUps} · ` : ""}${fmtDate(last)}`;
  if (c.status === "drafted") return "draft ready";
  return wasEmailed(c) ? "emailed" : "—";
}

const ORDER: Record<Contact["status"], number> = { call_scheduled: 0, replied: 1, done: 2, followed_up: 3, sent: 4, drafted: 5, new: 6, ignored: 7 };
export const order = (c: Contact) => ORDER[c.status];

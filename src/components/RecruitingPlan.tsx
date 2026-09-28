"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Check, Plus, Target, Trash2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { canonBank } from "@/lib/banks";
import { tierRank, TIER_ORDER, type CoverageRow } from "@/lib/coverage";
import {
  DESK_STATE_LABEL,
  targetAppliesTo,
  targetLabel,
  type DeskState,
  type DeskTarget,
} from "@/lib/desks";
import { cn, uid } from "@/lib/util";
import { Badge, Button, Card, Checkbox, Input } from "./ui";
import { useLocationTeamOptions } from "./LocationTeam";

const enc = encodeURIComponent;
const DONE: DeskState[] = ["emailed", "replied"];

/** One-click starting points, from how the owner actually recruits. */
const PRESETS: Omit<DeskTarget, "id" | "enabled">[] = [
  { location: "SF", team: "Tech", scope: "all", tiers: [], banks: [] },
  {
    location: "NY",
    team: "Generalist",
    scope: "tiers",
    tiers: ["Bulge Bracket"],
    banks: [],
  },
  { location: "NY", team: "Tech", scope: "banks", tiers: [], banks: [] },
];

function scopeText(t: DeskTarget) {
  if (t.scope === "all") return "all banks";
  if (t.scope === "tiers")
    return t.tiers.length ? t.tiers.join(", ") : "no tiers picked";
  if (!t.banks.length) return "no firms picked";
  return t.banks.length <= 3
    ? t.banks.join(", ")
    : `${t.banks.slice(0, 3).join(", ")} +${t.banks.length - 3}`;
}

/** Banks a desk applies to, with where each one stands (from CoverageRow.desks). */
function deskRows(t: DeskTarget, rows: CoverageRow[]) {
  return rows
    .filter((r) => r.bucket !== "hidden" && targetAppliesTo(t, r))
    .map((r) => ({ row: r, status: r.desks.find((d) => d.target.id === t.id) }))
    .filter((x) => x.status) as {
    row: CoverageRow;
    status: NonNullable<CoverageRow["desks"][number]>;
  }[];
}

export function RecruitingPlan({ rows }: { rows: CoverageRow[] }) {
  const stored = useStore((s) => s.coverage.plan);
  const plan = stored ?? [];
  const setCoverage = useStore((s) => s.setCoverage);
  const contacts = useStore((s) => s.contacts);
  const noTeam = useMemo(
    () => contacts.filter((c) => !c.team && c.status !== "ignored").length,
    [contacts],
  );
  const [adding, setAdding] = useState(false);
  const setPlan = (fn: (p: DeskTarget[]) => DeskTarget[]) =>
    setCoverage((c) => ({ ...c, plan: fn(c.plan ?? []) }));
  const tiers = useMemo(
    () =>
      [
        ...new Set([
          ...TIER_ORDER,
          ...rows.map((r) => r.tier).filter((t): t is string => !!t),
        ]),
      ].sort((a, b) => tierRank(a) - tierRank(b)),
    [rows],
  );

  const addPreset = (p: Omit<DeskTarget, "id" | "enabled">) => {
    setPlan((list) => [...list, { ...p, id: uid("desk"), enabled: true }]);
    if (p.scope === "banks") setAdding(false);
  };

  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Target className="size-4 text-brass" />
        <h2 className="text-[14px] font-semibold">Recruiting plan</h2>
        <span className="text-[12px] text-muted">
          The offices and teams you&apos;re recruiting for. Every bank below
          shows which of these desks still need emails.
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          icon={<Plus className="size-3.5" />}
          onClick={() => setAdding(!adding)}
        >
          Add a desk
        </Button>
      </div>

      {plan.length === 0 && !adding && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-[12.5px] text-ink-2">
          Start with:
          {PRESETS.map((p) => (
            <button
              key={`${p.location}${p.team}${p.scope}`}
              onClick={() => addPreset(p)}
              className="rounded-full border border-line-2 px-2.5 py-1 hover:border-navy/50 hover:bg-[#f7f5ee]"
            >
              {targetLabel(p)} ·{" "}
              {p.scope === "all"
                ? "all banks"
                : p.scope === "tiers"
                  ? p.tiers.join(", ")
                  : "select firms"}
            </button>
          ))}
        </div>
      )}

      {plan.length > 0 && (
        <ul className="divide-y divide-line">
          {plan.map((t) => (
            <PlanRow
              key={t.id}
              t={t}
              rows={rows}
              tiers={tiers}
              onChange={(n) =>
                setPlan((l) => l.map((x) => (x.id === t.id ? n : x)))
              }
              onRemove={() => setPlan((l) => l.filter((x) => x.id !== t.id))}
            />
          ))}
        </ul>
      )}

      {plan.length > 0 && noTeam > 0 && (
        <p className="border-t border-line px-4 py-2 text-[12px] text-muted">
          {noTeam} contact{noTeam > 1 ? "s have" : " has"} no team set, so{" "}
          {noTeam > 1 ? "they don't" : "it doesn't"} count toward any desk yet.{" "}
          <Link
            href="/sheet?view=contacts&filter=noteam"
            className="font-medium text-navy hover:underline"
          >
            Set their teams
          </Link>{" "}
          (or split Location/Team on the Spreadsheet page).
        </p>
      )}

      {adding && (
        <AddDesk
          tiers={tiers}
          rows={rows}
          onAdd={(t) => {
            setPlan((l) => [...l, t]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </Card>
  );
}

function PlanRow({
  t,
  rows,
  tiers,
  onChange,
  onRemove,
}: {
  t: DeskTarget;
  rows: CoverageRow[];
  tiers: string[];
  onChange: (t: DeskTarget) => void;
  onRemove: () => void;
}) {
  // A "select firms" desk with no firms yet opens straight into the picker.
  const [editing, setEditing] = useState(
    () => t.scope === "banks" && !t.banks.length,
  );
  const list = deskRows(t, rows);
  const done = list.filter((x) => DONE.includes(x.status.state)).length;
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  return (
    <li className={cn("px-4 py-2.5", !t.enabled && "opacity-55")}>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          checked={t.enabled}
          onChange={(v) => onChange({ ...t, enabled: v })}
          label={`Recruiting for ${targetLabel(t)}`}
        />
        <span className="font-medium">{targetLabel(t)}</span>
        <button
          className="text-[12px] text-muted hover:text-navy hover:underline"
          onClick={() => setEditing(!editing)}
          title="Change which firms this applies to"
        >
          at {scopeText(t)}
        </button>
        <div className="flex-1" />
        {t.enabled && list.length > 0 && (
          <>
            <div
              className="h-1.5 w-28 overflow-hidden rounded-full bg-[#ecebe4]"
              role="img"
              aria-label={`${done} of ${list.length} banks emailed`}
            >
              <div className="h-full bg-green" style={{ width: `${pct}%` }} />
            </div>
            <span className="num text-[12px] text-ink-2">
              {done}/{list.length} emailed
            </span>
          </>
        )}
        <button
          onClick={onRemove}
          className="rounded p-1 text-muted hover:bg-[#efede5] hover:text-red"
          aria-label={`Remove ${targetLabel(t)}`}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {editing && (
        <div className="mt-2">
          <ScopePicker
            value={t}
            tiers={tiers}
            rows={rows}
            onChange={(s) => onChange({ ...t, ...s })}
          />
        </div>
      )}
    </li>
  );
}

function ScopePicker({
  value,
  tiers,
  rows,
  onChange,
}: {
  value: Pick<DeskTarget, "scope" | "tiers" | "banks">;
  tiers: string[];
  rows: CoverageRow[];
  onChange: (v: Pick<DeskTarget, "scope" | "tiers" | "banks">) => void;
}) {
  const [bank, setBank] = useState("");
  const names = useMemo(
    () =>
      [
        ...new Set(
          rows.filter((r) => r.bucket !== "hidden").map((r) => r.name),
        ),
      ].sort(),
    [rows],
  );
  const addBank = () => {
    const b = bank.trim();
    if (!b || value.banks.some((x) => canonBank(x) === canonBank(b)))
      return setBank("");
    onChange({ ...value, banks: [...value.banks, b] });
    setBank("");
  };
  return (
    <div className="space-y-2 rounded-md bg-[#fbfaf6] p-2.5 text-[12.5px]">
      <div className="flex flex-wrap gap-3">
        {(["all", "tiers", "banks"] as const).map((s) => (
          <label key={s} className="flex items-center gap-1.5">
            <input
              type="radio"
              className="accent-navy"
              checked={value.scope === s}
              onChange={() => onChange({ ...value, scope: s })}
            />
            {s === "all"
              ? "All banks"
              : s === "tiers"
                ? "By tier"
                : "Select firms"}
          </label>
        ))}
      </div>
      {value.scope === "tiers" && (
        <div className="flex flex-wrap gap-1.5">
          {tiers.map((t) => {
            const on = value.tiers.includes(t);
            return (
              <button
                key={t}
                onClick={() =>
                  onChange({
                    ...value,
                    tiers: on
                      ? value.tiers.filter((x) => x !== t)
                      : [...value.tiers, t],
                  })
                }
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2.5 py-0.5",
                  on
                    ? "border-navy bg-navy text-white"
                    : "border-line-2 hover:border-navy/50",
                )}
              >
                {on && <Check className="size-3" />} {t}
              </button>
            );
          })}
        </div>
      )}
      {value.scope === "banks" && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {value.banks.map((b) => (
              <span
                key={b}
                className="flex items-center gap-1 rounded-full border border-line-2 bg-panel px-2 py-0.5"
              >
                {b}
                <button
                  aria-label={`Remove ${b}`}
                  className="text-muted hover:text-red"
                  onClick={() =>
                    onChange({
                      ...value,
                      banks: value.banks.filter((x) => x !== b),
                    })
                  }
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {!value.banks.length && (
              <span className="text-muted">No firms yet.</span>
            )}
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              addBank();
            }}
          >
            <div className="w-56">
              <Input
                className="h-7 text-[12px]"
                list="plan-banks"
                placeholder="Add a firm…"
                value={bank}
                onChange={(e) => setBank(e.target.value)}
              />
            </div>
            <datalist id="plan-banks">
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <Button size="sm" type="submit">
              Add
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

function AddDesk({
  tiers,
  rows,
  onAdd,
  onCancel,
}: {
  tiers: string[];
  rows: CoverageRow[];
  onAdd: (t: DeskTarget) => void;
  onCancel: () => void;
}) {
  const { locations, teams } = useLocationTeamOptions();
  const [location, setLocation] = useState("SF");
  const [team, setTeam] = useState("Tech");
  const [scope, setScope] = useState<
    Pick<DeskTarget, "scope" | "tiers" | "banks">
  >({ scope: "all", tiers: [], banks: [] });
  return (
    <div className="space-y-2 border-t border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <div className="w-32">
          <Input
            className="h-8"
            list="plan-locations"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            aria-label="Office"
            placeholder="Office"
          />
        </div>
        <datalist id="plan-locations">
          {locations.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <div className="w-44">
          <Input
            className="h-8"
            list="plan-teams"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            aria-label="Team"
            placeholder="Team"
          />
        </div>
        <datalist id="plan-teams">
          {teams.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </div>
      <ScopePicker
        value={scope}
        tiers={tiers}
        rows={rows}
        onChange={setScope}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={!location.trim() || !team.trim()}
          onClick={() =>
            onAdd({
              id: uid("desk"),
              location: location.trim(),
              team: team.trim(),
              ...scope,
              enabled: true,
            })
          }
        >
          Add desk
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Per desk of the plan: which banks still need emails, split into what to do next. */
export function DeskChecklist({ rows }: { rows: CoverageRow[] }) {
  const stored = useStore((s) => s.coverage.plan);
  const plan = (stored ?? []).filter((t) => t.enabled);
  if (!plan.length) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-[14px] font-semibold">
        Desks that still need emails
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {plan.map((t) => {
          const list = deskRows(t, rows).sort(
            (a, b) =>
              tierRank(a.row.tier) - tierRank(b.row.tier) ||
              a.row.name.localeCompare(b.row.name),
          );
          const by = (s: DeskState) => list.filter((x) => x.status.state === s);
          const done = list.filter((x) => DONE.includes(x.status.state));
          const ready = by("ready");
          const noEmail = by("needs_email");
          const empty = by("empty");
          const deskParam = enc(`${t.location}|${t.team}`);
          return (
            <Card key={t.id} className="p-4">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{targetLabel(t)}</span>
                <span className="text-[12px] text-muted">
                  at {scopeText(t)}
                </span>
                <div className="flex-1" />
                <span className="num text-[12.5px] text-ink-2">
                  <span className="text-green">{done.length}</span>/
                  {list.length} emailed
                </span>
              </div>
              {!list.length ? (
                <p className="mt-2 text-[12.5px] text-muted">
                  No banks on your coverage list match this desk yet.
                </p>
              ) : done.length === list.length ? (
                <p className="mt-2 text-[12.5px] text-green">
                  Every bank on this desk has been emailed.
                </p>
              ) : (
                <div className="mt-2 space-y-2 text-[12.5px]">
                  <Group
                    title="Ready to email"
                    tone="text-amber"
                    items={ready.map((x) => ({
                      name: x.row.name,
                      href: `/drafts?bank=${enc(x.row.name)}`,
                      note: x.status.people
                        .map((p) => p.firstName || p.name)
                        .slice(0, 2)
                        .join(", "),
                    }))}
                  />
                  <Group
                    title="Have people, need email addresses"
                    tone="text-ink-2"
                    items={noEmail.map((x) => ({
                      name: x.row.name,
                      href: `/sheet?view=contacts&filter=noemail&bank=${enc(x.row.name)}`,
                    }))}
                  />
                  <Group
                    title="No one on this desk yet"
                    tone="text-red"
                    items={empty.map((x) => ({
                      name: x.row.name,
                      href: x.status.unsorted
                        ? `/sheet?view=contacts&bank=${enc(x.row.name)}`
                        : `/find?banks=${enc(x.row.name)}&desk=${deskParam}`,
                      note: x.status.unsorted
                        ? `${x.status.unsorted} here with no team set`
                        : undefined,
                    }))}
                    cta={
                      empty.length
                        ? {
                            href: `/find?banks=${enc(
                              empty
                                .slice(0, 8)
                                .map((x) => x.row.name)
                                .join("|"),
                            )}&desk=${deskParam}`,
                            label: `Find ${t.team} people at ${Math.min(empty.length, 8)}`,
                          }
                        : undefined
                    }
                  />
                  {done.length > 0 && (
                    <p className="text-[12px] text-muted">
                      <Check className="mr-0.5 inline size-3 text-green" />
                      Emailed: {done.map((x) => x.row.name).join(", ")}
                    </p>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function Group({
  title,
  tone,
  items,
  cta,
}: {
  title: string;
  tone: string;
  items: { name: string; href: string; note?: string }[];
  cta?: { href: string; label: string };
}) {
  if (!items.length) return null;
  return (
    <div>
      <div
        className={cn(
          "mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide",
          tone,
        )}
      >
        {title} <span className="num text-muted">{items.length}</span>
        {cta && (
          <Link
            href={cta.href}
            className="ml-auto flex items-center gap-1 text-[12px] font-medium normal-case tracking-normal text-navy hover:underline"
          >
            {cta.label} <ArrowRight className="size-3" />
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <Link
            key={i.name}
            href={i.href}
            className="rounded-md border border-line bg-panel px-2 py-0.5 hover:border-navy/50"
            title={i.note}
          >
            {i.name}
            {i.note && (
              <span className="ml-1 text-[11px] text-muted">· {i.note}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Compact desk chips for a bank card. */
export function DeskChips({ r }: { r: CoverageRow }) {
  if (!r.desks.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {r.desks.map((d) => {
        const ok = DONE.includes(d.state);
        return (
          <Badge
            key={d.target.id}
            tone={
              ok
                ? "green"
                : d.state === "ready"
                  ? "amber"
                  : d.state === "needs_email"
                    ? "neutral"
                    : "red"
            }
            className="px-1.5 py-0 text-[10.5px]"
          >
            {ok && <Check className="mr-0.5 inline size-2.5" />}
            {targetLabel(d.target)}
            {!ok && ` · ${DESK_STATE_LABEL[d.state]}`}
          </Badge>
        );
      })}
    </div>
  );
}

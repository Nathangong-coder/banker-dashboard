"use client";

import { useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { buildCoverage, tierRank, TIER_ORDER, type CoverageRow } from "@/lib/coverage";
import { canonBank, STARTER_TARGETS } from "@/lib/banks";
import { isBankFirm } from "@/lib/processTracker";
import { programKind, summerOf, targetSummer, type ProgramKind } from "@/lib/programs";
import { JOB_STATUSES, type JobApplication, type JobStatus } from "@/lib/apply";
import { cn } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Empty, Input, PageHeader, Segmented, Select, toast } from "@/components/ui";
import { SpecialtyPicker } from "@/components/RecruitingPlan";
import { setFirmKind } from "@/components/useBankViews";
import { OfficeFactsTable } from "@/components/OfficeFactsTable";

/**
 * Corrections (owner, 2026-11-21: "super manual… override any info that the program/AI automatically assumed"). Every
 * guess Coverage makes about a firm, a program or an office can be set by hand here, and what you set wins everywhere
 * (Process tracker, Bank coverage, the 9 PM text). Each change shows "set by you" with a way back to automatic.
 */
type Tab = "firms" | "programs" | "offices";
const KIND_LABEL: Record<ProgramKind, string> = { sa: "Summer Analyst", insight: "Insight / early program", other: "Other" };
const STARTER_TIER = new Map(STARTER_TARGETS.map((t) => [canonBank(t.name), t.tier]));

function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get("tab");
  return t === "programs" || t === "offices" ? t : "firms";
}

export default function CorrectionsPage() {
  const [tab, setTabState] = useState<Tab>(initialTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, "", t === "firms" ? "/corrections" : `/corrections?tab=${t}`);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Corrections"
        sub="Fix anything Coverage guessed wrong. What you set here wins everywhere: the Process tracker, Bank coverage and the 9 PM text."
        right={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              ["firms", "Firms"],
              ["programs", "Programs & applications"],
              ["offices", "Offices"],
            ]}
          />
        }
      />
      {tab === "firms" && <FirmsTab />}
      {tab === "programs" && <ProgramsTab />}
      {tab === "offices" && <OfficesTab />}
    </div>
  );
}

function useRows() {
  const contacts = useStore((s) => s.contacts);
  const tables = useStore((s) => s.tables);
  const targets = useStore((s) => s.targets);
  const coverage = useStore((s) => s.coverage);
  const banks = useStore((s) => s.banks);
  const followUp = useStore((s) => s.settings.followUp);
  return useMemo(
    () => buildCoverage({ contacts, tables, targets, coverage: { ...coverage, plan: undefined }, banks, followUp }).sort((a, b) => a.name.localeCompare(b.name)),
    [contacts, tables, targets, coverage, banks, followUp],
  );
}

const changed = (on: boolean) => (on ? <Badge tone="navy" className="px-1.5 py-0 text-[10.5px]">set by you</Badge> : null);

/* ---------------- Firms ---------------- */

type FirmFilter = "all" | "changed" | "hidden" | "other";

function FirmsTab() {
  const rows = useRows();
  const coverage = useStore((s) => s.coverage);
  const setCoverage = useStore((s) => s.setCoverage);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FirmFilter>("all");
  const [name, setName] = useState("");
  const [tier, setTier] = useState("Elite Boutique");
  const isChanged = (r: CoverageRow) => !!(coverage.tierOf?.[r.key] || coverage.firmKind?.[r.key] || coverage.specialty?.[r.key] !== undefined || coverage.added.some((t) => canonBank(t.name) === r.key));
  const list = rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "hidden") return r.bucket === "hidden";
    if (filter === "other") return !isBankFirm(r, coverage);
    if (filter === "changed") return isChanged(r);
    return true;
  });
  const setTierOf = (key: string, t: string) =>
    setCoverage((c) => {
      const m = { ...(c.tierOf ?? {}) };
      if (t) m[key] = t;
      else delete m[key];
      return { ...c, tierOf: m };
    });
  const hide = (key: string, on: boolean) => setCoverage((c) => ({ ...c, hidden: on ? [...new Set([...c.hidden, key])] : c.hidden.filter((k) => k !== key) }));
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            ["all", `All ${rows.length}`],
            ["changed", `Set by you ${rows.filter(isChanged).length}`],
            ["other", `Not banks ${rows.filter((r) => !isBankFirm(r, coverage)).length}`],
            ["hidden", `Hidden ${rows.filter((r) => r.bucket === "hidden").length}`],
          ]}
        />
        <div className="flex-1" />
        <div className="relative w-56 max-sm:w-full">
          <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted" />
          <Input className="h-8 pl-8" placeholder="Find a firm…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a firm" />
        </div>
      </div>
      <form
        className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle px-4 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          setCoverage((c) => ({ ...c, added: [...c.added, { name: n, tier, source: "manual" }], hidden: c.hidden.filter((k) => k !== canonBank(n)) }));
          setName("");
          toast.ok(`Added ${n} (${tier}).`);
        }}
      >
        <span className="text-[12.5px] font-medium text-ink">Add a firm</span>
        <div className="w-56 max-sm:w-full">
          <Input className="h-8" placeholder="Firm name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Firm name" />
        </div>
        <Select className="h-8" value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Tier">
          {[...TIER_ORDER, "Other"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <Button size="sm" type="submit" icon={<Plus className="size-3.5" />}>
          Add
        </Button>
      </form>
      {!list.length ? (
        <Empty title="No firms here">Nothing matches.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="bg-subtle text-left text-[11px] tracking-wide text-muted uppercase">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Firm</th>
                <th className="px-2 py-2 font-medium">Tier</th>
                <th className="px-2 py-2 font-medium">Bank?</th>
                <th className="px-2 py-2 font-medium">Teams</th>
                <th className="px-2 py-2 font-medium">Shown</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((r) => {
                const manual = coverage.added.find((t) => canonBank(t.name) === r.key);
                const tierSet = coverage.tierOf?.[r.key];
                const kindSet = coverage.firmKind?.[r.key];
                const auto = isBankFirm(r, { ...coverage, firmKind: undefined });
                const autoTier = r.tier && !tierSet ? r.tier : STARTER_TIER.get(r.key);
                return (
                  <tr key={r.key} className={cn(r.bucket === "hidden" && "opacity-60")}>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                        {r.name}
                        {manual && <Badge className="px-1.5 py-0 text-[10.5px]">added by you</Badge>}
                      </div>
                      <div className="text-[11.5px] text-muted">
                        {r.allContacts.length} contact{r.allContacts.length === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <Select className="h-8" value={tierSet ?? ""} onChange={(e) => setTierOf(r.key, e.target.value)} aria-label={`Tier of ${r.name}`}>
                          <option value="">{`Auto: ${autoTier ?? "unknown"}`}</option>
                          {[...TIER_ORDER, "Other"].map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </Select>
                        {changed(!!tierSet)}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <Select className="h-8" value={kindSet ?? ""} onChange={(e) => setFirmKind(r.key, (e.target.value || null) as "bank" | "other" | null)} aria-label={`Is ${r.name} a bank`}>
                          <option value="">{`Auto: ${auto ? "bank" : "not a bank"}`}</option>
                          <option value="bank">Bank</option>
                          <option value="other">Not a bank</option>
                        </Select>
                        {changed(!!kindSet)}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <SpecialtyPicker r={r} compact />
                    </td>
                    <td className="px-2 py-2">
                      <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                        <input type="checkbox" className="size-3.5 accent-brass-strong" checked={r.bucket !== "hidden"} onChange={(e) => hide(r.key, !e.target.checked)} />
                        {r.bucket === "hidden" ? "Hidden" : "Shown"}
                      </label>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {manual && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${r.name}`}
                          title="Remove the firm you added (contacts and spreadsheet tabs stay)"
                          onClick={() => setCoverage((c) => ({ ...c, added: c.added.filter((t) => canonBank(t.name) !== r.key) }))}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---------------- Programs & applications ---------------- */

function ProgramsTab() {
  const jobs = useStore((s) => s.apply.jobs);
  const gradDate = useStore((s) => s.apply.profile.gradDate);
  const classYear = useStore((s) => s.settings.profile.year);
  const setApply = useStore((s) => s.setApply);
  const rows = useRows();
  const target = targetSummer([gradDate, classYear]);
  const years = [target - 2, target - 1, target, target + 1];
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ company: "", role: "", program: "insight" as ProgramKind, summer: String(target - 1), status: "submitted" as JobStatus });
  const update = (id: string, patch: Partial<JobApplication>) => setApply((a) => ({ ...a, jobs: a.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
  const list = jobs.filter((j) => !q || `${j.company} ${j.role}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.company.localeCompare(b.company) || a.role.localeCompare(b.role));
  const sheetApps = rows.flatMap((r) => (r.applied ?? []).map((a) => ({ firm: r.name, ...a })));
  return (
    <>
      <Card>
        <CardHeader
          title="Tracked programs"
          sub={`Only a Summer Analyst application for Summer ${target} counts as "applied" on your main board. Insight and early programs go on the Summer ${target - 1} board (or wherever their summer is).`}
          right={
            <div className="relative w-56">
              <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted" />
              <Input className="h-8 pl-8" placeholder="Find a firm or program…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a program" />
            </div>
          }
        />
        <form
          className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.company.trim() || !form.role.trim()) return toast.err("Add the firm and the program's name.");
            const job: JobApplication = {
              id: `j_${Date.now().toString(36)}`,
              company: form.company.trim(),
              role: form.role.trim(),
              url: "",
              status: form.status,
              program: form.program,
              summer: Number(form.summer) || undefined,
              createdAt: new Date().toISOString(),
              ...(form.status === "submitted" || form.status === "confirmed" ? { submittedAt: new Date().toISOString() } : {}),
            };
            setApply((a) => ({ ...a, jobs: [job, ...a.jobs] }));
            setForm({ ...form, company: "", role: "" });
            toast.ok(`Added ${job.company}: ${job.role}.`);
          }}
        >
          <span className="text-[12.5px] font-medium text-ink">Add a program</span>
          <div className="w-40 max-sm:w-full">
            <Input className="h-8" placeholder="Firm" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} aria-label="Firm" />
          </div>
          <div className="w-56 max-sm:w-full">
            <Input className="h-8" placeholder="Program (e.g. Early Insight Day)" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Program" />
          </div>
          <Select className="h-8" value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value as ProgramKind })} aria-label="Program type">
            {(Object.keys(KIND_LABEL) as ProgramKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
          <Select className="h-8" value={form.summer} onChange={(e) => setForm({ ...form, summer: e.target.value })} aria-label="Summer">
            {years.map((y) => (
              <option key={y} value={y}>
                Summer {y}
              </option>
            ))}
          </Select>
          <Select className="h-8" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as JobStatus })} aria-label="Status">
            {JOB_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
          <Button size="sm" type="submit" icon={<Plus className="size-3.5" />}>
            Add
          </Button>
        </form>
        {!list.length ? (
          <Empty title="No tracked programs">Programs you track on Applications (or add above) show up here.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead className="bg-subtle text-left text-[11px] tracking-wide text-muted uppercase">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Firm · program</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Summer</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((j) => {
                  const autoKind = programKind({ ...j, program: undefined });
                  const autoSummer = summerOf({ role: j.role });
                  return (
                    <tr key={j.id}>
                      <td className="px-4 py-2">
                        <Input className="h-8 max-w-44 text-[12.5px]" value={j.company} onChange={(e) => update(j.id, { company: e.target.value })} aria-label="Firm" />
                        <Input className="mt-1 h-8 text-[12.5px]" value={j.role} onChange={(e) => update(j.id, { role: e.target.value })} aria-label="Program" />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          <Select className="h-8" value={j.program ?? ""} onChange={(e) => update(j.id, { program: (e.target.value || undefined) as ProgramKind | undefined })} aria-label={`Type of ${j.role}`}>
                            <option value="">{`Auto: ${KIND_LABEL[autoKind]}`}</option>
                            {(Object.keys(KIND_LABEL) as ProgramKind[]).map((k) => (
                              <option key={k} value={k}>
                                {KIND_LABEL[k]}
                              </option>
                            ))}
                          </Select>
                          {changed(!!j.program)}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <Select className="h-8" value={j.summer ? String(j.summer) : ""} onChange={(e) => update(j.id, { summer: Number(e.target.value) || undefined })} aria-label={`Summer of ${j.role}`}>
                          <option value="">{`Auto: ${autoSummer ?? "not in the title"}`}</option>
                          {years.map((y) => (
                            <option key={y} value={y}>
                              Summer {y}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-2">
                        <Select className="h-8" value={j.status} onChange={(e) => update(j.id, { status: e.target.value as JobStatus })} aria-label={`Status of ${j.role}`}>
                          {JOB_STATUSES.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${j.company} ${j.role}`}
                          onClick={() => {
                            if (!window.confirm(`Remove ${j.company}: ${j.role} from your tracked programs?`)) return;
                            setApply((a) => ({ ...a, jobs: a.jobs.filter((x) => x.id !== j.id) }));
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {sheetApps.length > 0 && (
        <Card>
          <CardHeader title="From your spreadsheet's applications tab" sub="These come from the workbook: change them there (Spreadsheet), and they update here on the next import or save." />
          <ul className="divide-y divide-line text-[12.5px]">
            {sheetApps.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <span className="min-w-[160px] font-medium text-ink">{a.firm}</span>
                <span className="text-ink-2">{a.program}</span>
                <Badge className="px-1.5 py-0 text-[10.5px]">{KIND_LABEL[programKind({ role: a.program })]}</Badge>
                <span className="text-muted">{[a.submitted && `submitted ${a.submitted}`, a.status].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/* ---------------- Offices ---------------- */

function OfficesTab() {
  const rows = useRows();
  const coverage = useStore((s) => s.coverage);
  const banks = rows.filter((r) => r.bucket !== "hidden" && isBankFirm(r, coverage)).sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name));
  const [pick, setPick] = useState("");
  const r = banks.find((b) => b.key === pick) ?? banks[0];
  if (!r) return <Card><Empty title="No banks yet" /></Card>;
  return (
    <Card>
      <CardHeader
        title="Offices"
        sub="Whether a bank hires summer analysts at an office, and which teams. It decides which offices show up under Offices to fill and on the Process tracker's targets."
        right={
          <Select className="h-8" value={r.key} onChange={(e) => setPick(e.target.value)} aria-label="Bank">
            {banks.map((b) => (
              <option key={b.key} value={b.key}>
                {b.name}
              </option>
            ))}
          </Select>
        }
      />
      <OfficeFactsTable name={r.name} />
    </Card>
  );
}

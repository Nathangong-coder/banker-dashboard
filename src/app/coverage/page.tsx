"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, EyeOff, Flame, Mail, Plus, Search, Snowflake, Sparkles, TrendingDown, TrendingUp, Undo2 } from "lucide-react";
import { blobs, useStore } from "@/lib/store";
import { buildCoverage, outreachBetween, tierRank, type Bucket, type CoverageRow } from "@/lib/coverage";
import { STARTER_TARGETS } from "@/lib/banks";
import { parseWorkbook } from "@/lib/workbook";
import { DAY, cn, relDays } from "@/lib/util";
import { Badge, Button, Card, Checkbox, Empty, Input, PageHeader, Select } from "@/components/ui";

const COLS: { bucket: Exclude<Bucket, "hidden">; title: string; sub: string; tone: string; dot: string }[] = [
  { bucket: "reached", title: "Reached out", sub: "At least one email sent", tone: "text-green", dot: "bg-green" },
  { bucket: "ready", title: "Contacts, not reached yet", sub: "People found. Next step: draft emails", tone: "text-amber", dot: "bg-brass" },
  { bucket: "cold", title: "Cold", sub: "No contacts yet. Next step: find people", tone: "text-ink-2", dot: "bg-line-2" },
];

const enc = encodeURIComponent;

export default function CoveragePage() {
  const { contacts, tables, targets, coverage, banks, settings, workbook, setCoverage } = useStore();
  const [tier, setTier] = useState("");
  const [q, setQ] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [newBank, setNewBank] = useState("");
  const [newTier, setNewTier] = useState("Elite Boutique");

  // Workbooks imported before target-list parsing existed: re-read the stored file once to pick up bank lists.
  useEffect(() => {
    if (targets.length || !workbook) return;
    let live = true;
    blobs.workbook().then(async (buf) => {
      if (!buf || !live) return;
      const parsed = await parseWorkbook(buf);
      if (live && parsed.targets.length) useStore.setState({ targets: parsed.targets });
    });
    return () => {
      live = false;
    };
  }, [targets.length, workbook]);

  const rows = useMemo(
    () => buildCoverage({ contacts, tables, targets, coverage, banks, followUp: settings.followUp }),
    [contacts, tables, targets, coverage, banks, settings.followUp],
  );
  const visible = rows.filter((r) => r.bucket !== "hidden");
  const tiers = [...new Set(visible.map((r) => r.tier).filter(Boolean) as string[])].sort((a, b) => tierRank(a) - tierRank(b));
  const shown = visible.filter((r) => (!tier || r.tier === tier) && (!q || r.name.toLowerCase().includes(q.toLowerCase())));
  const by = (b: Bucket) => shown.filter((r) => r.bucket === b);

  const counts = {
    reached: visible.filter((r) => r.bucket === "reached").length,
    ready: visible.filter((r) => r.bucket === "ready").length,
    cold: visible.filter((r) => r.bucket === "cold").length,
  };
  const total = counts.reached + counts.ready + counts.cold;
  const pct = total ? Math.round((counts.reached / total) * 100) : 0;
  const [now] = useState(() => Date.now());
  const { thisWeek, lastWeek } = useMemo(() => {
    const weekStart = now - 7 * DAY;
    return { thisWeek: outreachBetween(contacts, weekStart, now + DAY), lastWeek: outreachBetween(contacts, weekStart - 7 * DAY, weekStart) };
  }, [contacts, now]);
  const repliedBanks = visible.filter((r) => r.replied > 0).length;
  const quiet = visible.filter((r) => r.quiet);
  const cold = by("cold");
  const ready = by("ready");

  const hide = (key: string) => setCoverage((c) => ({ ...c, hidden: [...new Set([...c.hidden, key])] }));
  const unhide = (key: string) => setCoverage((c) => ({ ...c, hidden: c.hidden.filter((k) => k !== key) }));

  if (!total && !workbook)
    return (
      <>
        <PageHeader title="Bank coverage" />
        <Card>
          <Empty title="No banks yet">
            Upload your spreadsheet on the Overview page. Any bank tab, or a list of firms (like an “Institution Name” column), shows up here. Or{" "}
            <button className="text-navy underline" onClick={() => setCoverage((c) => ({ ...c, includeStarter: true }))}>
              start from a standard IB target list
            </button>
            .
          </Empty>
        </Card>
      </>
    );

  return (
    <>
      <PageHeader
        title="Bank coverage"
        sub="Every bank you could be recruiting at, sorted by how far along you are. Emptying the cold column is the job."
      />

      {/* Scoreboard */}
      <Card className="mb-5 grid gap-0 md:grid-cols-[1.4fr_1fr]">
        <div className="border-line p-5 md:border-r">
          <div className="flex items-baseline gap-2">
            <span className="num text-[44px] leading-none">{counts.reached}</span>
            <span className="text-[15px] text-ink-2">
              of {total} banks reached · <b>{pct}%</b>
            </span>
          </div>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-[#ecebe4]" role="img" aria-label={`${counts.reached} reached, ${counts.ready} with contacts, ${counts.cold} cold`}>
            <div className="bg-green transition-all" style={{ width: `${(counts.reached / Math.max(total, 1)) * 100}%` }} />
            <div className="bg-brass transition-all" style={{ width: `${(counts.ready / Math.max(total, 1)) * 100}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-[12.5px] text-ink-2">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-green" /> {counts.reached} reached</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-brass" /> {counts.ready} ready to email</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-line-2" /> {counts.cold} cold</span>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-line">
          <div className="p-5">
            <div className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Emails this week</div>
            <div className="num mt-1 flex items-center gap-2 text-[32px] leading-none">
              {thisWeek}
              {thisWeek !== lastWeek && (thisWeek > lastWeek ? <TrendingUp className="size-5 text-green" /> : <TrendingDown className="size-5 text-red" />)}
            </div>
            <div className="mt-1.5 text-[12px] text-muted">{lastWeek} the week before</div>
          </div>
          <div className="p-5">
            <div className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Banks that replied</div>
            <div className="num mt-1 text-[32px] leading-none text-green">{repliedBanks}</div>
            <div className="mt-1.5 text-[12px] text-muted">{counts.reached ? `${Math.round((repliedBanks / counts.reached) * 100)}% of banks reached` : "—"}</div>
          </div>
        </div>
      </Card>

      {/* Next moves */}
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <NextMove
          icon={<Mail className="size-4" />}
          show={ready.length > 0}
          title={`${counts.ready} bank${counts.ready === 1 ? "" : "s"} ready to email`}
          body={ready.slice(0, 4).map((r) => r.name).join(", ") + (ready.length > 4 ? "…" : "")}
          href="/drafts"
          cta="Draft emails"
        />
        <NextMove
          icon={<Snowflake className="size-4" />}
          show={cold.length > 0}
          title={`${counts.cold} cold bank${counts.cold === 1 ? "" : "s"}`}
          body="Find 2–3 people at each: UC grads, Washington, Tech/NY generalists."
          href={`/find?banks=${enc(cold.slice(0, 8).map((r) => r.name).join("|"))}`}
          cta={`Find people at ${Math.min(cold.length, 8)}`}
        />
        <NextMove
          icon={<Flame className="size-4" />}
          show={quiet.length > 0}
          title={`${quiet.length} bank${quiet.length === 1 ? "" : "s"} gone quiet`}
          body={`No reply in 3+ weeks and nobody live: ${quiet.slice(0, 3).map((r) => r.name).join(", ")}. Try someone new.`}
          href={`/find?banks=${enc(quiet.slice(0, 8).map((r) => r.name).join("|"))}`}
          cta="Find new people"
        />
        {!ready.length && !cold.length && !quiet.length && (
          <div className="rounded-lg border border-green/30 bg-green-soft p-4 text-[13px] text-green md:col-span-3">Every bank on your list has been reached. 🎉</div>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-52">
          <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted" />
          <Input className="h-8 pl-8" placeholder="Search banks…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {["", ...tiers].map((t) => (
          <button
            key={t || "all"}
            onClick={() => setTier(t)}
            className={cn("rounded-full border px-2.5 py-1 text-[12px]", tier === t ? "border-navy bg-navy text-white" : "border-line-2 bg-panel text-ink-2 hover:border-navy/50")}
          >
            {t || "All tiers"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {COLS.map((col) => {
          const list = by(col.bucket).sort((a, b) =>
            col.bucket === "reached"
              ? Number(b.due > 0) - Number(a.due > 0) || (b.lastOutreach ?? "").localeCompare(a.lastOutreach ?? "")
              : col.bucket === "ready"
                ? b.withEmail - a.withEmail || tierRank(a.tier) - tierRank(b.tier)
                : tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name),
          );
          return (
            <section key={col.bucket} className="min-w-0">
              <header className="mb-2 flex items-center gap-2 px-1">
                <span className={cn("size-2.5 rounded-full", col.dot)} />
                <h2 className={cn("text-[14px] font-semibold", col.tone)}>{col.title}</h2>
                <span className="num text-[13px] text-muted">{list.length}</span>
              </header>
              <p className="mb-2 px-1 text-[12px] text-muted">{col.sub}</p>
              <ul className="space-y-2">
                {list.map((r) => (
                  <BankCard key={r.key} r={r} onHide={() => hide(r.key)} />
                ))}
                {!list.length && <li className="rounded-lg border border-dashed border-line-2 px-3 py-6 text-center text-[12.5px] text-muted">Nothing here</li>}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Manage list */}
      <Card className="mt-8 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newBank.trim();
              if (!name) return;
              setCoverage((c) => ({ ...c, added: [...c.added, { name, tier: newTier, source: "manual" }] }));
              setNewBank("");
            }}
          >
            <Input className="h-8 w-56" placeholder="Add a bank to track…" value={newBank} onChange={(e) => setNewBank(e.target.value)} />
            <Select className="h-8" value={newTier} onChange={(e) => setNewTier(e.target.value)} aria-label="Tier">
              {["Bulge Bracket", "Elite Boutique", "Middle Market", "Private Equity", "Other"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
            <Button size="sm" type="submit" icon={<Plus className="size-3.5" />}>
              Add
            </Button>
          </form>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <Checkbox checked={coverage.includeStarter} onChange={(v) => setCoverage((c) => ({ ...c, includeStarter: v }))} />
            Include a standard IB target list ({STARTER_TARGETS.length} banks)
          </label>
          <div className="flex-1" />
          {rows.some((r) => r.bucket === "hidden") && (
            <button className="text-[12.5px] text-navy hover:underline" onClick={() => setShowHidden(!showHidden)}>
              {showHidden ? "Hide" : "Show"} {rows.filter((r) => r.bucket === "hidden").length} hidden banks
            </button>
          )}
        </div>
        {showHidden && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {rows
              .filter((r) => r.bucket === "hidden")
              .map((r) => (
                <li key={r.key}>
                  <button onClick={() => unhide(r.key)} className="flex items-center gap-1 rounded-full border border-line-2 px-2.5 py-1 text-[12px] text-ink-2 hover:border-navy/50" title="Show again">
                    <Undo2 className="size-3" /> {r.name}
                  </button>
                </li>
              ))}
          </ul>
        )}
        <p className="mt-3 text-[11.5px] text-muted">
          Banks come from your contacts, your bank tabs, and any list of firms in the spreadsheet (e.g. an OVERVIEW tab with “Institution Name / Institution Type”).
          Hide banks you’re not recruiting for.
        </p>
      </Card>
    </>
  );
}

function NextMove({ icon, show, title, body, href, cta }: { icon: React.ReactNode; show: boolean; title: string; body: string; href: string; cta: string }) {
  if (!show) return null;
  return (
    <Link href={href} className="group flex flex-col rounded-lg border border-line bg-panel p-4 transition-colors hover:border-brass/60">
      <div className="flex items-center gap-2 font-medium">
        <span className="text-brass">{icon}</span> {title}
      </div>
      <p className="mt-1 line-clamp-2 flex-1 text-[12.5px] text-muted">{body}</p>
      <span className="mt-2 flex items-center gap-1 text-[12.5px] font-medium text-navy">
        {cta} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function BankCard({ r, onHide }: { r: CoverageRow; onHide: () => void }) {
  const regions = (["SF", "NY"] as const).filter((k) => r.regions[k] > 0);
  let detail: React.ReactNode;
  let action: { href: string; label: string } | null = null;

  if (r.bucket === "reached") {
    detail = (
      <>
        <span className="num">{r.reached}</span> reached · <span className={cn("num", r.replied && "text-green")}>{r.replied}</span> replied ·{" "}
        <span className="num">{r.live}</span> live
        {r.lastOutreach && <span className="text-muted"> · last {relDays(r.lastOutreach)}</span>}
      </>
    );
    const next = r.contacts.find((c) => c.status === "new");
    if (r.due) action = { href: "/followups", label: `${r.due} follow-up${r.due > 1 ? "s" : ""} due` };
    else if (r.quiet) action = next ? { href: `/drafts?bank=${enc(r.name)}`, label: `Gone quiet. Email ${next.firstName || next.name}` } : { href: `/find?banks=${enc(r.name)}`, label: "Gone quiet. Find someone new" };
  } else if (r.bucket === "ready") {
    const active = r.contacts.filter((c) => c.status !== "ignored");
    detail = (
      <>
        <span className="num">{active.length}</span> contact{active.length > 1 ? "s" : ""} · <span className={cn("num", r.withEmail ? "text-green" : "text-red")}>{r.withEmail}</span> with email
      </>
    );
    action = r.withEmail
      ? { href: `/drafts?bank=${enc(r.name)}`, label: "Draft emails" }
      : { href: `/sheet?view=contacts&filter=noemail&bank=${enc(r.name)}`, label: "Find their emails" };
  } else {
    detail = <span className="text-muted">No contacts yet</span>;
    action = { href: `/find?banks=${enc(r.name)}`, label: "Find people" };
  }

  return (
    <li className={cn("group rounded-lg border bg-panel px-3 py-2.5", r.quiet ? "border-amber/40" : "border-line")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{r.name}</span>
            {r.tier && <span className="text-[11px] text-muted">{r.tier}</span>}
            {regions.map((k) => (
              <Badge key={k} tone="neutral" className="px-1 py-0 text-[10.5px]">
                {k} {r.regions[k]}
              </Badge>
            ))}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-2">{detail}</div>
        </div>
        <button onClick={onHide} className="rounded p-1 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[#efede5] hover:text-ink focus:opacity-100" title="Not recruiting here: hide" aria-label={`Hide ${r.name}`}>
          <EyeOff className="size-3.5" />
        </button>
      </div>
      {action && (
        <Link href={action.href} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-navy hover:underline">
          {r.bucket === "cold" && <Sparkles className="size-3 text-brass" />}
          {action.label} <ArrowRight className="size-3" />
        </Link>
      )}
    </li>
  );
}

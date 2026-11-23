"use client";

import { useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { TIER_ORDER, type CoverageRow } from "@/lib/coverage";
import { cleanUrl, type FirmProfile } from "@/lib/firmProfile";
import { isBankFirm } from "@/lib/processTracker";
import { Button, Field, Input, Modal, Select, Textarea, toast } from "./ui";
import { SpecialtyPicker } from "./RecruitingPlan";
import { OfficeFactsTable } from "./OfficeFactsTable";
import { setFirmKind } from "./useBankViews";

export type WikiInfo = { found: false } | { found: true; title: string; about: string; url?: string; website?: string; hq?: string; founded?: string; employees?: string };

/** Wikipedia / Wikidata facts for a firm name (api/firms/info). */
export async function fetchFirmInfo(name: string): Promise<WikiInfo> {
  const r = await fetch("/api/firms/info", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't reach Wikipedia.");
  return r.json();
}

export function saveFirm(key: string, patch: Partial<FirmProfile> | null) {
  useStore.getState().setCoverage((c) => {
    const m = { ...(c.firms ?? {}) };
    const next = patch === null ? undefined : { ...(m[key] ?? {}), ...patch };
    if (next) for (const k of Object.keys(next) as (keyof FirmProfile)[]) if (next[k] === undefined || next[k] === "") delete next[k];
    if (!next || !Object.keys(next).length) delete m[key];
    else m[key] = next;
    return { ...c, firms: m };
  });
}

/**
 * Edit everything about a firm (owner, 2026-11-22: "the companies are not directly editable"): name, tier, bank or
 * not, specialist teams, links (website, job portal), the About text and facts, your notes, the offices it hires in,
 * and whether it's hidden. Wikipedia can pre-fill the facts; nothing is saved until Save.
 */
export function FirmEditor({ r, open, onClose }: { r: CoverageRow; open: boolean; onClose: () => void }) {
  const coverage = useStore((s) => s.coverage);
  const setCoverage = useStore((s) => s.setCoverage);
  const saved = coverage.firms?.[r.key] ?? {};
  const [f, setF] = useState<FirmProfile>(() => ({ ...saved, name: saved.name ?? r.name }));
  const [tier, setTier] = useState(coverage.tierOf?.[r.key] ?? "");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof FirmProfile) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const hidden = coverage.hidden.includes(r.key);

  const fill = async () => {
    setBusy(true);
    try {
      const w = await fetchFirmInfo(f.name || r.name);
      if (!w.found) return toast.info("Wikipedia has no article that matches this firm. Type the details instead.");
      setF((x) => ({
        ...x,
        about: w.about,
        website: x.website || w.website,
        hq: w.hq ?? x.hq,
        founded: w.founded ?? x.founded,
        employees: w.employees ?? x.employees,
        source: { kind: "wikipedia", url: w.url, at: new Date().toISOString() },
      }));
      toast.ok(`Filled from Wikipedia: ${w.title}. Check it, then Save.`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const website = f.website ? cleanUrl(f.website) : undefined;
    const careersUrl = f.careersUrl ? cleanUrl(f.careersUrl) : undefined;
    if (f.website && !website) return toast.err("The website isn't a link (https://…).");
    if (f.careersUrl && !careersUrl) return toast.err("The job portal isn't a link (https://…).");
    const typedAbout = (f.about ?? "") !== (saved.about ?? "") && f.source?.kind !== "wikipedia";
    saveFirm(r.key, {
      ...f,
      // Cleared = back to the sheet's spelling; unchanged = whatever was set before.
      name: !f.name?.trim() ? undefined : f.name.trim() === r.name ? saved.name : f.name.trim(),
      website,
      careersUrl,
      source: typedAbout ? { kind: "you", at: new Date().toISOString() } : f.source,
    });
    setCoverage((c) => {
      const m = { ...(c.tierOf ?? {}) };
      if (tier) m[r.key] = tier;
      else delete m[r.key];
      return { ...c, tierOf: m };
    });
    toast.ok(`Saved ${f.name || r.name}.`);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${r.name}`} wide>
      <div className="grid gap-5">
        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={f.name ?? ""} onChange={set("name")} />
          </Field>
          <Field label="Tier" hint={tier ? "Set by you" : `Automatic: ${r.tier || "unknown"}`}>
            <Select value={tier} onChange={(e) => setTier(e.target.value)} className="w-full">
              <option value="">Automatic</option>
              {TIER_ORDER.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Kind of firm">
            <Select value={isBankFirm(r, coverage) ? "bank" : "other"} onChange={(e) => setFirmKind(r.key, e.target.value as "bank" | "other")} className="w-full">
              <option value="bank">Bank (on the boards)</option>
              <option value="other">Not a bank (under Other firms)</option>
            </Select>
          </Field>
          <Field label="Specialist in">
            <SpecialtyPicker r={r} />
          </Field>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Website">
            <Input value={f.website ?? ""} onChange={set("website")} placeholder="https://www.example.com" inputMode="url" />
          </Field>
          <Field label="Job application portal" hint="Where you apply (Workday, Greenhouse, the firm's careers page).">
            <Input value={f.careersUrl ?? ""} onChange={set("careersUrl")} placeholder="https://…myworkdayjobs.com/…" inputMode="url" />
          </Field>
          <Field label="Headquarters">
            <Input value={f.hq ?? ""} onChange={set("hq")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Founded">
              <Input value={f.founded ?? ""} onChange={set("founded")} />
            </Field>
            <Field label="Employees">
              <Input value={f.employees ?? ""} onChange={set("employees")} />
            </Field>
          </div>
        </section>

        <section className="grid gap-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <span className="text-[12px] text-muted">About{f.source?.kind === "wikipedia" ? " (from Wikipedia: check it)" : ""}</span>
            <Button size="sm" icon={busy ? <Loader2 className="size-3.5 animate-spin" /> : <BookOpen className="size-3.5" />} disabled={busy} onClick={() => void fill()}>
              Fill from Wikipedia
            </Button>
          </div>
          <Textarea rows={5} value={f.about ?? ""} onChange={set("about")} placeholder="What the firm does, its groups, anything worth knowing before a chat." aria-label="About" />
          <Field label="Your notes">
            <Textarea rows={3} value={f.notes ?? ""} onChange={set("notes")} placeholder="Culture, what people told you, why you want it." />
          </Field>
        </section>

        <section className="grid gap-2">
          <div className="text-[14px] font-semibold text-ink">Offices</div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <OfficeFactsTable name={r.name} />
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <Button
            variant="danger"
            onClick={() => {
              setCoverage((c) => ({ ...c, hidden: hidden ? c.hidden.filter((k) => k !== r.key) : [...new Set([...c.hidden, r.key])] }));
              toast.ok(hidden ? `${r.name} is back on your lists.` : `${r.name} is hidden (Corrections → Firms brings it back).`);
              onClose();
            }}
          >
            {hidden ? "Show this firm again" : "Hide this firm"}
          </Button>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

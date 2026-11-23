"use client";

import { Undo2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { officeInfo, officeKey, sheetOfficeInfo } from "@/lib/offices";
import { Badge, Input, Select } from "./ui";

const OFFICES = ["SF", "LA", "NY", "Chicago", "Texas"];
const changed = (on: boolean) => (on ? <Badge tone="navy" className="px-1.5 py-0 text-[10.5px]">set by you</Badge> : null);

/**
 * Per office: does this firm hire summer analysts there, and which teams (Corrections → Offices and the bank page's
 * Edit). What you set wins over your COVERAGE tab and the built-in lists (`coverage.officeFacts`).
 */
export function OfficeFactsTable({ name }: { name: string }) {
  const coverage = useStore((s) => s.coverage);
  const setCoverage = useStore((s) => s.setCoverage);
  const r = { name, key: name };
  const setFact = (office: string, patch: { hires?: boolean | null; teams?: string | null }) =>
    setCoverage((c) => {
      const k = officeKey(r.name, office);
      const cur = { ...(c.officeFacts?.[k] ?? {}) };
      if (patch.hires === null) delete cur.hires;
      else if (patch.hires !== undefined) cur.hires = patch.hires;
      if (patch.teams === null || patch.teams === "") delete cur.teams;
      else if (patch.teams !== undefined) cur.teams = patch.teams;
      const facts = { ...(c.officeFacts ?? {}) };
      if (cur.hires === undefined && !cur.teams) delete facts[k];
      else facts[k] = cur;
      return { ...c, officeFacts: facts };
    });
  return (
    <table className="w-full text-[13px]">
      <thead className="bg-subtle text-left text-[11px] tracking-wide text-muted uppercase">
        <tr className="border-b border-line">
          <th className="px-4 py-2 font-medium">Office</th>
          <th className="px-2 py-2 font-medium">Hires summer analysts?</th>
          <th className="px-2 py-2 font-medium">Teams</th>
          <th className="px-4 py-2 font-medium">Where it comes from</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {OFFICES.map((o) => {
          const mine = coverage.officeFacts?.[officeKey(r.name, o)];
          const info = officeInfo(r.name, o);
          const sheet = sheetOfficeInfo(r.name, o);
          const src = mine ? "You" : sheet ? "Your COVERAGE tab" : info ? "Built-in list" : "Nothing known (assumed yes)";
          return (
            <tr key={o}>
              <td className="px-4 py-2 font-medium text-ink">{o}</td>
              <td className="px-2 py-2">
                <div className="flex items-center gap-1.5">
                  <Select
                    className="h-8"
                    value={mine?.hires === undefined ? "" : mine.hires ? "yes" : "no"}
                    onChange={(e) => setFact(o, { hires: e.target.value === "" ? null : e.target.value === "yes" })}
                    aria-label={`Does ${r.name} hire in ${o}`}
                  >
                    <option value="">{`Auto: ${info?.hires === false ? "no" : info?.hires ? "yes" : "unknown"}`}</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </Select>
                  {changed(mine?.hires !== undefined)}
                </div>
              </td>
              <td className="px-2 py-2">
                <Input
                  key={`${r.key}|${o}`}
                  className="h-8 max-w-56 text-[12.5px]"
                  defaultValue={mine?.teams ?? ""}
                  placeholder={info?.teams ? `Auto: ${info.teams.slice(0, 40)}` : "e.g. Tech, Generalist"}
                  onBlur={(e) => e.target.value !== (mine?.teams ?? "") && setFact(o, { teams: e.target.value.trim() || null })}
                  aria-label={`Teams at ${r.name} ${o}`}
                />
              </td>
              <td className="px-4 py-2 text-[12px] text-muted">
                {src}
                {mine && (
                  <button className="ml-2 inline-flex items-center gap-0.5 text-navy hover:underline" onClick={() => setFact(o, { hires: null, teams: null })}>
                    <Undo2 className="size-3" /> automatic
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Mail, Search, Wand2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { gotReply, wasSent } from "@/lib/experiments";
import { SEGMENTS, crossTab, dimensionOf, dimensions, recipientTimeLabel, segmentOf, tierIndex, type Dimension, type Segment } from "@/lib/segments";
import { autoTagFontsFromGmail } from "@/lib/gmailSync";
import { googleClientId } from "@/lib/keys";
import { EMAIL_FONTS, type Contact, type EmailFont } from "@/lib/types";
import { cn } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Input, Progress, Select, toast } from "./ui";

const MIN_CELL = 5;

function useTiers() {
  const targets = useStore((s) => s.targets);
  const added = useStore((s) => s.coverage.added);
  return useMemo(() => tierIndex(targets, added), [targets, added]);
}

/* ================= explorer ================= */

/** Reply rate by any dimension, split by bank type / team / location: "which send time works for bulge brackets?" */
export function Explorer() {
  const settings = useStore((s) => s.settings);
  const templates = useStore((s) => s.templates);
  const contacts = useStore((s) => s.contacts);
  const tiers = useTiers();
  const [dim, setDim] = useState<Dimension>("time");
  const [seg, setSeg] = useState<Segment>("tier");
  const tab = useMemo(() => crossTab(contacts, dim, seg, { settings, templates }, tiers), [contacts, dim, seg, settings, templates, tiers]);
  const sent = contacts.filter(wasSent).length;
  const dimLabel = dimensions(settings).find((d) => d.id === dim)?.label ?? dim;

  const cellView = (c: { sent: number; replied: number } | undefined, best: boolean) => {
    if (!c) return <span className="text-muted">·</span>;
    const rate = c.replied / c.sent;
    const thin = c.sent < MIN_CELL;
    return (
      <div
        className={cn("rounded px-1.5 py-1 text-center", thin && "text-muted", best && "ring-1 ring-green")}
        style={{ background: thin ? undefined : `rgba(31, 122, 76, ${0.08 + rate * 0.6})` }}
        title={`${c.replied} replied of ${c.sent} sent${thin ? ` (fewer than ${MIN_CELL}: too few to read much into)` : ""}`}
      >
        <div className={cn("num font-medium", best && "text-green")}>{Math.round(rate * 100)}%</div>
        <div className="num text-[10.5px] text-muted">
          {c.replied}/{c.sent}
        </div>
      </div>
    );
  };
  const bestKey = (cells: Map<string, { sent: number; replied: number }>) =>
    [...cells.entries()].filter(([, c]) => c.sent >= MIN_CELL).sort((a, b) => b[1].replied / b[1].sent - a[1].replied / a[1].sent)[0]?.[0];

  return (
    <Card>
      <CardHeader
        title="What works for whom"
        sub="Reply rate for everything you've sent, compared by one thing and split by the kind of banker. Darker = more replies; outlined = best in that row (5+ sent)."
        right={
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            Compare
            <Select className="h-8 max-w-[14rem]" value={dim} onChange={(e) => setDim(e.target.value as Dimension)} aria-label="Compare by">
              {dimensions(settings).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
            by
            <Select className="h-8 max-w-[14rem]" value={seg} onChange={(e) => setSeg(e.target.value as Segment)} aria-label="Split by">
              {SEGMENTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      {tab.cols.length === 0 ? (
        <p className="px-4 py-4 text-[12.5px] text-muted">
          {sent ? `None of your ${sent} sent emails are tagged with ${dimLabel.toLowerCase()} yet. Tag them below.` : "Nothing sent yet. Results appear as Gmail sync finds your sent emails."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">{SEGMENTS.find((s) => s.id === seg)?.label}</th>
                {tab.cols.map((c) => (
                  <th key={c.key} className="px-1 py-2 text-center font-medium normal-case">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seg !== "none" && (
                <tr className="border-b border-line">
                  <td className="px-4 py-1 font-medium">All</td>
                  {tab.cols.map((c) => (
                    <td key={c.key} className="px-1 py-1">
                      {cellView(tab.totals.get(c.key), bestKey(tab.totals) === c.key)}
                    </td>
                  ))}
                </tr>
              )}
              {tab.rows.map((r) => (
                <tr key={r.label}>
                  <td className="px-4 py-1">
                    {r.label} <span className="num text-[11px] text-muted">({r.n})</span>
                  </td>
                  {tab.cols.map((c) => (
                    <td key={c.key} className="px-1 py-1">
                      {cellView(r.cells.get(c.key), bestKey(r.cells) === c.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-muted">
        Send times are in the recipient&apos;s time zone. Bank types come from your target list and Bank coverage (“Tier unknown” = add the bank there).
        {tab.untagged > 0 && ` ${tab.untagged} sent email${tab.untagged > 1 ? "s aren't" : " isn't"} tagged with ${dimLabel.toLowerCase()} and ${tab.untagged > 1 ? "are" : "is"} left out.`}
      </p>
    </Card>
  );
}

/* ================= tagging sent emails ================= */

/** Every sent email with its tags: auto (Gmail, send time, draft text) and editable (font, experiment options). */
export function SentEmails() {
  const settings = useStore((s) => s.settings);
  const templates = useStore((s) => s.templates);
  const contacts = useStore((s) => s.contacts);
  const update = useStore((s) => s.updateContact);
  const tiers = useTiers();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(100);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkFont, setBulkFont] = useState("");
  const taggable = (settings.experiments ?? []).filter((e) => e.kind !== "time");
  const sent = useMemo(() => contacts.filter(wasSent).sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? "")), [contacts]);
  const rows = sent.filter((c) => {
    if (q && !`${c.name} ${c.bank} ${c.team ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "nofont") return !c.trial?.font;
    if (filter.startsWith("exp:")) return !c.trial?.arms[filter.slice(4)];
    return true;
  });
  const noFont = sent.filter((c) => !c.trial?.font && c.email).length;

  const setFont = (c: Contact, font: string) =>
    update(c.id, { trial: { at: c.trial?.at ?? c.sentAt ?? new Date().toISOString(), arms: c.trial?.arms ?? {}, font: (font || undefined) as EmailFont | undefined, fontSource: font ? "manual" : undefined } });
  const setArm = (c: Contact, expId: string, armId: string) => {
    const arms = { ...(c.trial?.arms ?? {}) };
    if (armId) arms[expId] = armId;
    else delete arms[expId];
    update(c.id, { trial: { ...(c.trial ?? { at: c.sentAt ?? new Date().toISOString() }), arms } });
  };

  const autoTag = async () => {
    if (!googleClientId(settings)) return toast.err("Connect Gmail first (Settings → Gmail).");
    setProgress({ done: 0, total: noFont });
    try {
      const r = await autoTagFontsFromGmail((done, total) => setProgress({ done, total }));
      toast.ok(`Tagged ${r.tagged} of ${r.checked} sent emails with the font they went out in${r.noMail ? ` (${r.noMail} weren't found in your Sent mail)` : ""}.`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const bulk = (fn: (c: Contact) => void) => {
    const chosen = contacts.filter((c) => sel.has(c.id));
    chosen.forEach(fn);
    toast.ok(`Tagged ${chosen.length} email${chosen.length > 1 ? "s" : ""}.`);
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Mail className="size-4 text-brass" /> Sent emails &amp; tags
          </span>
        }
        sub="Send time, bank type, team and location are tagged automatically. Fonts can be read from Gmail; anything else you can tag by hand, one by one or in bulk."
        right={
          progress ? (
            <div className="w-56">
              <Progress value={progress.done} max={progress.total} label={`${progress.done}/${progress.total} checked`} />
            </div>
          ) : (
            <Button size="sm" variant="brass" icon={<Wand2 className="size-3.5" />} onClick={autoTag} disabled={!noFont}>
              Auto-tag fonts from Gmail ({noFont})
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="relative w-52">
          <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted" />
          <Input className="h-8 pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="h-8" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show">
          <option value="all">All sent ({sent.length})</option>
          <option value="nofont">No font tag</option>
          {taggable.map((e) => (
            <option key={e.id} value={`exp:${e.id}`}>
              Untagged in “{e.name}”
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-muted">{sel.size} selected:</span>
            <Select className="h-8" value={bulkFont} onChange={(e) => setBulkFont(e.target.value)} aria-label="Font for selected">
              <option value="">Font…</option>
              {(Object.keys(EMAIL_FONTS) as EmailFont[]).map((f) => (
                <option key={f} value={f}>
                  {EMAIL_FONTS[f].label}
                </option>
              ))}
            </Select>
            <Button size="sm" disabled={!bulkFont} onClick={() => bulk((c) => setFont(c, bulkFont))}>
              Set font
            </Button>
            {taggable.map((e) => (
              <Select key={e.id} className="h-8" value="" onChange={(ev) => ev.target.value && bulk((c) => setArm(c, e.id, ev.target.value))} aria-label={`Tag selected in ${e.name}`}>
                <option value="">{e.name}…</option>
                {e.arms.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            ))}
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-[12.5px] text-muted">{sent.length ? "Nothing matches." : "No sent emails yet. Gmail sync fills these in."}</p>
      ) : (
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="w-8 px-3 py-2">
                  <Checkbox
                    label="Select all"
                    checked={rows.length > 0 && rows.every((r) => sel.has(r.id))}
                    onChange={(v) => setSel(v ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </th>
                <th className="px-2 py-2 font-medium">Person</th>
                <th className="px-2 py-2 font-medium">Bank type · team · location</th>
                <th className="px-2 py-2 font-medium">Sent (their time)</th>
                <th className="px-2 py-2 font-medium">Reply</th>
                <th className="px-2 py-2 font-medium">Hook · template</th>
                <th className="px-2 py-2 font-medium">Font</th>
                {taggable.map((e) => (
                  <th key={e.id} className="px-2 py-2 font-medium normal-case">
                    {e.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.slice(0, limit).map((c) => {
                const hook = dimensionOf(c, "hook", { settings, templates });
                const tpl = dimensionOf(c, "template", { settings, templates });
                return (
                  <tr key={c.id} className={cn(sel.has(c.id) && "bg-blue-soft/40")}>
                    <td className="px-3 py-1.5">
                      <Checkbox
                        label={`Select ${c.name}`}
                        checked={sel.has(c.id)}
                        onChange={(v) => {
                          const n = new Set(sel);
                          if (v) n.add(c.id);
                          else n.delete(c.id);
                          setSel(n);
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-[11.5px] text-muted">{c.bank}</div>
                    </td>
                    <td className="px-2 py-1.5 text-[12px] text-ink-2">
                      {[segmentOf(c, "tier", tiers), c.team || "no team", segmentOf(c, "region", tiers).split(" /")[0]].join(" · ")}
                    </td>
                    <td className="num px-2 py-1.5 text-[12px]">{c.sentAt ? recipientTimeLabel(c.sentAt, c.region) : <span className="text-muted">date unknown</span>}</td>
                    <td className="px-2 py-1.5">{gotReply(c) ? <Badge tone="green">replied</Badge> : <span className="text-[12px] text-muted">—</span>}</td>
                    <td className="px-2 py-1.5 text-[12px] text-ink-2">{[hook?.label, tpl?.label].filter(Boolean).join(" · ") || <span className="text-muted">—</span>}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <Select className="h-7 text-[12px]" value={c.trial?.font ?? ""} onChange={(e) => setFont(c, e.target.value)} aria-label={`Font for ${c.name}`}>
                          <option value="">—</option>
                          {(Object.keys(EMAIL_FONTS) as EmailFont[]).map((f) => (
                            <option key={f} value={f}>
                              {EMAIL_FONTS[f].label.split(" (")[0]}
                            </option>
                          ))}
                        </Select>
                        {c.trial?.fontSource && c.trial.font && (
                          <span className="text-[10.5px] text-muted" title={c.trial.fontSource === "gmail" ? "Read from the sent email in Gmail" : c.trial.fontSource === "draft" ? "Recorded when the Gmail draft was made" : "Tagged by you"}>
                            {c.trial.fontSource === "gmail" ? "Gmail" : c.trial.fontSource === "draft" ? "auto" : "you"}
                          </span>
                        )}
                      </div>
                    </td>
                    {taggable.map((e) => (
                      <td key={e.id} className="px-2 py-1.5">
                        <Select className="h-7 text-[12px]" value={c.trial?.arms[e.id] ?? ""} onChange={(ev) => setArm(c, e.id, ev.target.value)} aria-label={`${e.name} for ${c.name}`}>
                          <option value="">—</option>
                          {e.arms.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > limit && (
            <div className="p-3 text-center">
              <button className="text-[12.5px] text-navy hover:underline" onClick={() => setLimit(limit + 200)}>
                Show more ({rows.length - limit} hidden)
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

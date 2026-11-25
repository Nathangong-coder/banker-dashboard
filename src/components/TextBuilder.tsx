"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Send, SlidersHorizontal, X } from "lucide-react";
import { Button, Card, Checkbox, Menu, Select, toast } from "@/components/ui";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";
import { whatsappDigest } from "@/lib/reminders";
import { progressFor, syncServer } from "@/lib/serverSync";
import {
  BLOCK_LABEL,
  BLOCK_PRESETS,
  STANDARD_LAYOUT,
  TEXT_PRESETS,
  newBlock,
  type BankField,
  type BankRank,
  type Block,
  type BlockType,
  type HealthColor,
  type TextLayout,
} from "@/lib/textLayout";

/**
 * Your 9 PM text (owner, 2026-11-24: customize it, split it into several texts, pick banks by color or rank them by
 * prestige / urgency, presets for each part). Left: the texts and their blocks; right: the preview, built by the same
 * function the server uses (lib/digestFormat.ts#nightMessages), so what you see is what arrives (the server adds
 * Google Calendar lines when it sends).
 */
const MAX_TEXTS = 4;
const COLORS: [HealthColor, string][] = [
  ["green", "🟢 Going well"],
  ["amber", "🟡 Emailed, no chat"],
  ["red", "🔴 Going badly"],
  ["white", "⚪ Not started"],
];
const RANKS: [BankRank, string][] = [
  ["prestige", "Prestige (stars, then tier)"],
  ["urgency", "Urgency"],
  ["health", "Health"],
  ["activity", "Most recent activity"],
];
const FIELDS: [BankField, string][] = [
  ["step", "Process step"],
  ["chats", "Chats / emailed"],
  ["app", "Application"],
  ["next", "Next step"],
];
const clone = (l: TextLayout): TextLayout => JSON.parse(JSON.stringify(l));
const numberInput = "h-7 w-16 rounded border border-line-2 bg-panel px-1.5 text-[12px] text-ink focus:border-brass-strong focus:outline-none";

export function TextBuilder() {
  const saved = useStore((s) => s.settings.textLayout);
  const setSettings = useStore((s) => s.setSettings);
  const contacts = useStore((s) => s.contacts);
  const banks = useStore((s) => s.banks);
  const fu = useStore((s) => s.settings.followUp);
  const [draft, setDraft] = useState<TextLayout | undefined>(() => (saved ? clone(saved) : undefined));
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const dirty = JSON.stringify(draft ?? null) !== JSON.stringify(saved ?? null);

  // The preview: every bank + the warm list (progressFor all), the same render as the server's.
  const progress = useMemo(() => progressFor(useStore.getState(), { all: true }), [contacts, banks, fu]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useMemo(() => whatsappDigest(contacts, banks, fu, { progress, layout: draft ?? null })?.messages ?? [], [contacts, banks, fu, progress, draft]);

  const edit = (fn: (l: TextLayout) => void) => {
    const l = clone(draft ?? STANDARD_LAYOUT);
    fn(l);
    l.messages = l.messages.filter((m) => m.blocks.length);
    l.preset = "custom";
    setDraft(l.messages.length ? l : undefined);
  };
  const setBlock = (mi: number, bi: number, patch: Partial<Block>) => edit((l) => Object.assign(l.messages[mi].blocks[bi], patch));
  const move = (mi: number, bi: number, dir: -1 | 1) =>
    edit((l) => {
      const b = l.messages[mi].blocks;
      const j = bi + dir;
      if (j < 0 || j >= b.length) return;
      [b[bi], b[j]] = [b[j], b[bi]];
    });
  const toText = (mi: number, bi: number, target: number | "new") =>
    edit((l) => {
      const [b] = l.messages[mi].blocks.splice(bi, 1);
      if (target === "new") l.messages.push({ blocks: [b] });
      else l.messages[target].blocks.push(b);
    });

  const presetId = draft?.preset && TEXT_PRESETS[draft.preset] ? draft.preset : draft ? "custom" : "standard";
  const save = async () => {
    setBusy("save");
    setSettings((s) => ({ ...s, textLayout: draft }));
    try {
      await syncServer();
      toast.ok("Saved. Tonight's 9 PM text uses it.");
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy("test");
    try {
      const { sendWhatsAppDigest } = await import("@/lib/reminders");
      const { callApi } = await import("@/lib/api");
      const st = useStore.getState();
      if (!st.settings.keys.whatsappPhone || !st.settings.keys.whatsappApiKey) throw new Error("Set up WhatsApp first (below).");
      // Same path as Reminders' "WhatsApp me today's list" (api/notify → CallMeBot).
      await sendWhatsAppDigest({ messages: preview }, (title, message) => callApi("/api/notify", { channel: "whatsapp", title, message, whatsapp: { phone: st.settings.keys.whatsappPhone, apiKey: st.settings.keys.whatsappApiKey } }, st.settings));
      toast.ok(`Sent ${preview.length} text${preview.length === 1 ? "" : "s"} to your WhatsApp.`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const layout = draft ?? STANDARD_LAYOUT;
  const options = (b: Block, mi: number, bi: number) => {
    if (b.type === "banks")
      return (
        <div className="grid gap-2 text-[12px]">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span className="text-muted">Colors</span>
            {COLORS.map(([c, label]) => (
              <Checkbox key={c} label={label} checked={!b.colors?.length || b.colors.includes(c)} onChange={(on) => setBlock(mi, bi, { colors: toggleIn(b.colors?.length ? b.colors : COLORS.map(([x]) => x), c, on) })} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-muted">
              Rank by
              <Select className="h-7 w-auto text-[12px]" value={b.rank ?? ""} onChange={(e) => setBlock(mi, bi, { rank: (e.target.value || undefined) as BankRank | undefined })}>
                <option value="">Preset&apos;s order</option>
                {RANKS.map(([r, label]) => (
                  <option key={r} value={r}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-1.5 text-muted">
              How many
              <input type="number" min={1} max={30} className={numberInput} value={b.max ?? 10} onChange={(e) => setBlock(mi, bi, { max: Number(e.target.value) || 10 })} />
            </label>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span className="text-muted">Each line shows</span>
            {FIELDS.map(([f, label]) => (
              <Checkbox key={f} label={label} checked={!b.fields?.length || b.fields.includes(f)} onChange={(on) => setBlock(mi, bi, { fields: toggleIn(b.fields?.length ? b.fields : FIELDS.map(([x]) => x), f, on) })} />
            ))}
          </div>
        </div>
      );
    if (b.type === "todo" || b.type === "cold")
      return (
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <label className="flex items-center gap-1.5 text-muted">
            Names per part
            <input type="number" min={1} max={20} className={numberInput} value={b.perKind ?? 8} onChange={(e) => setBlock(mi, bi, { perKind: Number(e.target.value) || 8 })} />
          </label>
          {b.type === "cold" && <Checkbox label="“Already scheduled” line" checked={b.scheduledLine !== false} onChange={(on) => setBlock(mi, bi, { scheduledLine: on })} />}
        </div>
      );
    if (b.type === "warm")
      return (
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          {b.preset === "not_heard" && (
            <label className="flex items-center gap-1.5 text-muted">
              Days
              <input type="number" min={3} max={120} className={numberInput} value={b.days ?? 21} onChange={(e) => setBlock(mi, bi, { days: Number(e.target.value) || 21 })} />
            </label>
          )}
          <label className="flex items-center gap-1.5 text-muted">
            Max people
            <input type="number" min={1} max={80} className={numberInput} value={b.max ?? 25} onChange={(e) => setBlock(mi, bi, { max: Number(e.target.value) || 25 })} />
          </label>
        </div>
      );
    if (b.type === "tips")
      return (
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          Tips
          <input type="number" min={1} max={3} className={numberInput} value={b.max ?? 3} onChange={(e) => setBlock(mi, bi, { max: Number(e.target.value) || 3 })} />
        </label>
      );
    return null;
  };

  return (
    <Card className="mb-3">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-[14px] font-semibold text-ink">Your text</h2>
        <Select
          className="h-8 w-auto"
          aria-label="Start from"
          value={presetId}
          onChange={(e) => {
            const p = TEXT_PRESETS[e.target.value];
            if (!p) return;
            setDraft(p.layout ? clone(p.layout) : undefined);
          }}
        >
          {Object.entries(TEXT_PRESETS).map(([id, p]) => (
            <option key={id} value={id}>
              {p.label}
            </option>
          ))}
          {presetId === "custom" && <option value="custom">Your own</option>}
        </Select>
        <span className="hidden text-[12px] text-muted md:inline">{TEXT_PRESETS[presetId]?.hint ?? "Edited by you"}</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {draft && (
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setDraft(undefined)}>
              Standard
            </Button>
          )}
          <Button size="sm" variant="secondary" icon={<Send className="size-3.5" />} loading={busy === "test"} onClick={() => void test()} disabled={!preview.length}>
            Send me a test
          </Button>
          <Button size="sm" variant="primary" loading={busy === "save"} disabled={!dirty} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          {layout.messages.map((m, mi) => (
            <section key={mi} className="rounded-lg border border-line">
              <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-1.5 text-[12px] font-semibold text-muted">
                Text {mi + 1}
                <AddBlock onAdd={(t) => edit((l) => l.messages[mi].blocks.push(newBlock(t)))} />
              </div>
              <ul className="divide-y divide-line">
                {m.blocks.map((b, bi) => {
                  const id = `${mi}:${bi}`;
                  const presets = BLOCK_PRESETS[b.type];
                  const current = "preset" in b ? b.preset : presets[0].id;
                  const hasOptions = b.type !== "week" && b.type !== "links";
                  return (
                    <li key={id} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-24 shrink-0 text-[13px] font-semibold text-ink">{BLOCK_LABEL[b.type]}</span>
                        {presets.length > 1 ? (
                          <Select className="h-7 w-auto max-w-[260px] text-[12px]" aria-label={`${BLOCK_LABEL[b.type]} preset`} value={current} onChange={(e) => setBlock(mi, bi, { preset: e.target.value } as Partial<Block>)}>
                            {presets.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span className="text-[12px] text-muted">{presets[0].label}</span>
                        )}
                        <span className="ml-auto flex items-center">
                          {hasOptions && (
                            <IconBtn label="Options" on={open === id} onClick={() => setOpen(open === id ? null : id)}>
                              <SlidersHorizontal className="size-3.5" />
                            </IconBtn>
                          )}
                          <IconBtn label="Move up" onClick={() => move(mi, bi, -1)} disabled={bi === 0}>
                            <ArrowUp className="size-3.5" />
                          </IconBtn>
                          <IconBtn label="Move down" onClick={() => move(mi, bi, 1)} disabled={bi === m.blocks.length - 1}>
                            <ArrowDown className="size-3.5" />
                          </IconBtn>
                          <Menu
                            label={`More for ${BLOCK_LABEL[b.type]}`}
                            items={[
                              layout.messages.length < MAX_TEXTS && m.blocks.length > 1 && { label: "Its own text", hint: "Sent as a separate WhatsApp message", onClick: () => toText(mi, bi, "new") },
                              ...layout.messages.map((_, ti) => ti !== mi && { label: `Move to text ${ti + 1}`, onClick: () => toText(mi, bi, ti) }),
                              { label: "Remove", icon: <X />, danger: true, onClick: () => edit((l) => void l.messages[mi].blocks.splice(bi, 1)) },
                            ]}
                          />
                        </span>
                      </div>
                      {open === id && <div className="mt-2 rounded bg-subtle p-2.5">{options(b, mi, bi)}</div>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {layout.messages.length < MAX_TEXTS && (
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => edit((l) => void l.messages.push({ blocks: [newBlock("todo")] }))} className="justify-self-start">
              Add a text
            </Button>
          )}
        </div>
        <div className="grid content-start gap-2" aria-label="Preview">
          <div className="text-[12px] font-semibold text-muted">
            Preview · {preview.length} text{preview.length === 1 ? "" : "s"}
            {dirty && <span className="font-normal text-amber"> · not saved</span>}
          </div>
          {!preview.length && <p className="text-[12.5px] text-muted">Nothing to send tonight with this layout.</p>}
          {preview.map((m, i) => (
            <pre key={i} className="rounded-lg rounded-tl-sm bg-green-soft px-3 py-2 font-sans text-[12px] leading-snug whitespace-pre-wrap text-ink">
              {m}
              <span className="mt-1 block text-right text-[10.5px] text-muted">{m.length} characters</span>
            </pre>
          ))}
        </div>
      </div>
    </Card>
  );
}

function toggleIn<T>(list: T[], x: T, on: boolean): T[] {
  const next = on ? [...new Set([...list, x])] : list.filter((y) => y !== x);
  return next.length ? next : list;
}

function IconBtn({ label, onClick, disabled, on, children }: { label: string; onClick: () => void; disabled?: boolean; on?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={cn("grid size-7 place-items-center rounded text-muted hover:bg-hover hover:text-ink disabled:opacity-30", on && "bg-hover text-ink")}>
      {children}
    </button>
  );
}

function AddBlock({ onAdd }: { onAdd: (t: BlockType) => void }) {
  return (
    <Menu
      label="Add a block"
      trigger={(toggle, open) => (
        <button type="button" onClick={toggle} aria-expanded={open} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-brass-ink hover:bg-hover">
          <Plus className="size-3.5" /> Add block
        </button>
      )}
      items={(Object.keys(BLOCK_LABEL) as BlockType[]).map((t) => ({ label: BLOCK_LABEL[t], onClick: () => onAdd(t) }))}
    />
  );
}

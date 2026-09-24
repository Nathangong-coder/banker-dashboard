"use client";

import { useState, type ReactNode } from "react";
import { ArrowUp, CheckCircle2, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import { mask, modelOptions, pickDefaultModel } from "@/lib/keys";
import { AI_PROVIDERS, type AiProvider, type ApiKeyEntry, type VaultService } from "@/lib/types";
import type { KeyTestResult } from "@/app/api/keys/test/route";
import { cn, fmtDate, uid } from "@/lib/util";
import { Badge, Button, Input, Select, toast } from "./ui";

export async function testKey(body: Record<string, unknown>): Promise<KeyTestResult> {
  const res = await fetch("/api/keys/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, note: j?.error ?? `HTTP ${res.status}` };
  return j as KeyTestResult;
}

function useVault(service: VaultService) {
  const list = useStore((s) => s.settings.vault[service]);
  const setSettings = useStore((s) => s.setSettings);
  const save = (next: ApiKeyEntry[]) => setSettings((s) => ({ ...s, vault: { ...s.vault, [service]: next } }));
  return { list, save };
}

function EntryRow({
  e,
  index,
  onRetest,
  onRemove,
  onTop,
  extra,
}: {
  e: ApiKeyEntry;
  index: number;
  onRetest: () => Promise<void>;
  onRemove: () => void;
  onTop: () => void;
  extra?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex items-start gap-2 rounded-md border border-line bg-[#fbfaf6] px-2.5 py-2">
      {e.ok === false ? (
        <XCircle className="mt-0.5 size-4 shrink-0 text-red" />
      ) : e.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green" />
      ) : (
        <span className="mt-1 size-3 shrink-0 rounded-full border-2 border-muted" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="num">{mask(e.value)}</span>
          {e.label && <span className="text-ink-2">· {e.label}</span>}
          {index === 0 && <Badge tone="navy">primary</Badge>}
          {extra}
        </div>
        <div className={cn("mt-0.5 text-[11.5px]", e.ok === false ? "text-red" : "text-muted")}>
          {e.note}
          {e.checkedAt && ` · checked ${fmtDate(e.checkedAt)}`}
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5">
        {index > 0 && (
          <button onClick={onTop} className="rounded p-1 text-muted hover:bg-[#efede5] hover:text-ink" title="Make primary" aria-label="Make primary">
            <ArrowUp className="size-3.5" />
          </button>
        )}
        <button
          onClick={async () => {
            setBusy(true);
            await onRetest();
            setBusy(false);
          }}
          className="rounded p-1 text-muted hover:bg-[#efede5] hover:text-ink"
          title="Re-test"
          aria-label="Re-test key"
        >
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
        </button>
        <button onClick={onRemove} className="rounded p-1 text-muted hover:bg-red-soft hover:text-red" title="Remove" aria-label="Remove key">
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

const moveTop = <T,>(arr: T[], i: number) => [arr[i], ...arr.filter((_, j) => j !== i)];

/** Multiple keys for one data service. A key is only stored after it passes a live test. */
export function KeyVault({ service, placeholder }: { service: "apollo" | "hunter" | "serper"; placeholder: string }) {
  const { list, save } = useVault(service);
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const v = value.trim();
    if (!v) return;
    if (list.some((k) => k.value === v)) return setError("That key is already saved.");
    setBusy(true);
    setError(null);
    const r = await testKey({ service, key: v });
    setBusy(false);
    if (!r.ok) return setError(r.note);
    const now = new Date().toISOString();
    save([...list, { id: uid("k"), value: v, label: label.trim() || undefined, addedAt: now, checkedAt: now, ok: true, note: r.note }]);
    setValue("");
    setLabel("");
    toast.ok(`${service[0].toUpperCase() + service.slice(1)} key verified and saved.`);
  };

  const retest = async (i: number) => {
    const r = await testKey({ service, key: list[i].value });
    const cur = useStore.getState().settings.vault[service];
    save(cur.map((k, j) => (j === i ? { ...k, ok: r.ok, note: r.note, checkedAt: new Date().toISOString() } : k)));
  };

  return (
    <div className="space-y-2">
      {list.length > 0 && (
        <ul className="space-y-1.5">
          {list.map((e, i) => (
            <EntryRow key={e.id} e={e} index={i} onRetest={() => retest(i)} onRemove={() => save(list.filter((_, j) => j !== i))} onTop={() => save(moveTop(list, i))} />
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <Input type="password" autoComplete="off" spellCheck={false} className="num text-[12.5px]" placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Input className="w-28 text-[12.5px]" placeholder="Label (opt.)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button onClick={add} loading={busy} disabled={!value.trim()} icon={<Plus className="size-3.5" />}>
          Test & add
        </Button>
      </div>
      {error && <p className="text-[12px] text-red">{error}</p>}
      {list.length > 1 && <p className="text-[11.5px] text-muted">Keys are used top to bottom. If one is rejected or out of credits, the next one is tried automatically.</p>}
    </div>
  );
}

/** AI keys for any provider, plus the active provider/model picker (the model is tested before it's selected). */
export function AiVault() {
  const { list, save } = useVault("ai");
  const settings = useStore((s) => s.settings);
  const aiSel = settings.ai;
  const setSettings = useStore((s) => s.setSettings);
  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [value, setValue] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [customModel, setCustomModel] = useState("");

  const meta = AI_PROVIDERS[provider];
  const needsBase = provider === "custom" || provider === "glm";

  const add = async () => {
    const v = value.trim();
    if (!v) return;
    if (list.some((k) => k.value === v)) return setError("That key is already saved.");
    setBusy(true);
    setError(null);
    const base = baseURL.trim() || meta.defaultBaseURL;
    const r = await testKey({ service: "ai", provider, key: v, baseURL: base });
    setBusy(false);
    if (!r.ok) return setError(r.note);
    const now = new Date().toISOString();
    const entry: ApiKeyEntry = { id: uid("k"), value: v, provider, baseURL: base, models: r.models, addedAt: now, checkedAt: now, ok: true, note: r.note };
    save([...list, entry]);
    setValue("");
    toast.ok(`${meta.label} key verified.`);
    // First key for a provider with no active model yet → auto-select a sensible default.
    if (!list.some((k) => k.provider === aiSel.provider)) {
      const first = pickDefaultModel(r.models ?? [], meta.suggested);
      if (first) await chooseModel(provider, first, entry);
      else toast.info("Pick a model below (type its id if the list is empty).");
    }
  };

  const retest = async (i: number) => {
    const e = list[i];
    const r = await testKey({ service: "ai", provider: e.provider, key: e.value, baseURL: e.baseURL });
    const cur = useStore.getState().settings.vault.ai;
    save(cur.map((k, j) => (j === i ? { ...k, ok: r.ok, note: r.note, models: r.models ?? k.models, checkedAt: new Date().toISOString() } : k)));
  };

  const chooseModel = async (p: AiProvider, model: string, keyOverride?: ApiKeyEntry) => {
    const key = keyOverride ?? useStore.getState().settings.vault.ai.find((k) => k.provider === p && k.ok !== false);
    if (!key) return toast.err(`Add a ${AI_PROVIDERS[p].label} key first.`);
    setModelBusy(true);
    const r = await testKey({ service: "ai", provider: p, key: key.value, baseURL: key.baseURL, model });
    setModelBusy(false);
    if (!r.ok) return toast.err(r.note);
    setSettings((s) => ({ ...s, ai: { provider: p, model } }));
    toast.ok(`Now using ${model}.`);
  };

  const providersWithKeys = [...new Set(list.filter((k) => k.ok !== false).map((k) => k.provider!))];
  const options = modelOptions(settings, aiSel.provider);

  return (
    <div className="space-y-3">
      {list.length > 0 && (
        <ul className="space-y-1.5">
          {list.map((e, i) => (
            <EntryRow
              key={e.id}
              e={e}
              index={list.findIndex((x) => x.provider === e.provider) === i ? 0 : 1}
              onRetest={() => retest(i)}
              onRemove={() => save(list.filter((_, j) => j !== i))}
              onTop={() => save(moveTop(list, i))}
              extra={<Badge tone="blue">{AI_PROVIDERS[e.provider!].label}</Badge>}
            />
          ))}
        </ul>
      )}

      <div className="space-y-1.5 rounded-md border border-dashed border-line-2 p-2.5">
        <div className="flex flex-wrap gap-1.5">
          <Select className="text-[12.5px]" value={provider} onChange={(e) => { setProvider(e.target.value as AiProvider); setBaseURL(""); setError(null); }} aria-label="Provider">
            {(Object.keys(AI_PROVIDERS) as AiProvider[]).map((p) => (
              <option key={p} value={p}>
                {AI_PROVIDERS[p].label}
              </option>
            ))}
          </Select>
          <Input type="password" autoComplete="off" spellCheck={false} className="num min-w-[180px] flex-1 text-[12.5px]" placeholder={meta.keyHint} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <Button onClick={add} loading={busy} disabled={!value.trim()} icon={<Plus className="size-3.5" />}>
            Test & add
          </Button>
        </div>
        {needsBase && (
          <Input
            className="text-[12.5px]"
            placeholder={meta.defaultBaseURL ? `Base URL (default ${meta.defaultBaseURL}; mainland China: https://open.bigmodel.cn/api/paas/v4)` : "Base URL, e.g. https://api.together.xyz/v1"}
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
          />
        )}
        {meta.docs && (
          <a href={meta.docs} target="_blank" rel="noreferrer" className="text-[11.5px] text-navy underline">
            Get a {meta.label} key
          </a>
        )}
        {error && <p className="text-[12px] text-red">{error}</p>}
      </div>

      <div className="rounded-md bg-[#f4f2eb] p-2.5">
        <div className="mb-1.5 text-[12px] font-medium text-ink-2">Model used for screening and drafting</div>
        {providersWithKeys.length === 0 ? (
          <p className="text-[12px] text-muted">Add a key above to choose a model.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <Select
              className="text-[12.5px]"
              value={providersWithKeys.includes(aiSel.provider) ? aiSel.provider : ""}
              onChange={(e) => {
                const p = e.target.value as AiProvider;
                const s2 = useStore.getState().settings;
                const first = pickDefaultModel(modelOptions(s2, p), AI_PROVIDERS[p].suggested);
                if (first) chooseModel(p, first);
              }}
              aria-label="Active provider"
            >
              {!providersWithKeys.includes(aiSel.provider) && <option value="">Pick provider…</option>}
              {providersWithKeys.map((p) => (
                <option key={p} value={p}>
                  {AI_PROVIDERS[p].label}
                </option>
              ))}
            </Select>
            {providersWithKeys.includes(aiSel.provider) && (
              <>
                <Select className="max-w-[260px] text-[12.5px]" value={options.includes(aiSel.model) ? aiSel.model : ""} onChange={(e) => e.target.value && chooseModel(aiSel.provider, e.target.value)} aria-label="Model" disabled={modelBusy}>
                  {!options.includes(aiSel.model) && <option value="">{aiSel.model || "Pick model…"}</option>}
                  {options.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
                <Input className="w-44 text-[12.5px]" placeholder="…or type a model id" value={customModel} onChange={(e) => setCustomModel(e.target.value)} />
                <Button size="sm" loading={modelBusy} disabled={!customModel.trim()} onClick={() => chooseModel(aiSel.provider, customModel.trim()).then(() => setCustomModel(""))}>
                  Test & use
                </Button>
              </>
            )}
          </div>
        )}
        {providersWithKeys.includes(aiSel.provider) && (
          <p className="mt-1.5 text-[11.5px] text-muted">
            Active: <b>{AI_PROVIDERS[aiSel.provider].label}</b> · <span className="num">{aiSel.model}</span>. A model is only switched to after it answers a test prompt.
          </p>
        )}
      </div>
    </div>
  );
}

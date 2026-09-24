"use client";

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import type {
  AiProvider,
  ApiKeyEntry,
  BankMeta,
  Contact,
  HistoryEvent,
  Prospect,
  Region,
  Settings,
  SheetSnapshot,
  Status,
  Template,
  WorkbookMeta,
} from "./types";
import type { ContactTable, Patches } from "./workbook";
import { DEFAULT_SETTINGS, DEFAULT_TEMPLATES } from "./defaults";

const idbStorage: StateStorage = {
  getItem: async (k) => (await idbGet<string>(k)) ?? null,
  setItem: (k, v) => idbSet(k, v),
  removeItem: (k) => idbDel(k),
};

// Large blobs live outside the JSON-persisted store.
export const blobs = {
  workbook: () => idbGet<ArrayBuffer>("blob:workbook"),
  setWorkbook: (b: ArrayBuffer) => idbSet("blob:workbook", b),
  fileHandle: () => idbGet<FileSystemFileHandle>("blob:handle"),
  setFileHandle: (h: FileSystemFileHandle | undefined) => (h ? idbSet("blob:handle", h) : idbDel("blob:handle")),
  snapshots: () => idbGet<SheetSnapshot[]>("blob:snapshots"),
  setSnapshots: (s: SheetSnapshot[]) => idbSet("blob:snapshots", s),
  resume: () => idbGet<{ name: string; type: string; data: ArrayBuffer }>("blob:resume"),
  setResume: (r: { name: string; type: string; data: ArrayBuffer } | undefined) =>
    r ? idbSet("blob:resume", r) : idbDel("blob:resume"),
};

export function bankKey(name: string, region: Region) {
  return `${name}|${region}`;
}

interface State {
  settings: Settings;
  contacts: Contact[];
  templates: Template[];
  banks: Record<string, BankMeta>;
  tables: ContactTable[];
  patches: Patches;
  workbook?: WorkbookMeta;
  prospects: Prospect[];
  scheduled: Record<string, string>;
  snapshots: SheetSnapshot[]; // not persisted via JSON (see partialize)
  resumeName?: string;

  setSettings: (fn: (s: Settings) => Settings) => void;
  importWorkbook: (args: {
    meta: WorkbookMeta;
    contacts: Contact[];
    tables: ContactTable[];
    snapshots: SheetSnapshot[];
  }) => { added: number; updated: number };
  setSnapshots: (s: SheetSnapshot[]) => void;
  updateContact: (id: string, patch: Partial<Contact>, event?: HistoryEvent) => void;
  updateContacts: (patches: { id: string; patch: Partial<Contact>; event?: HistoryEvent }[]) => void;
  addContacts: (c: Contact[]) => void;
  removeContacts: (ids: string[]) => void;
  setStatus: (ids: string[], status: Status, note?: string) => void;
  setCell: (sheet: string, addr: string, v: string) => void;
  upsertTemplate: (t: Template) => void;
  removeTemplate: (id: string) => void;
  upsertBank: (b: BankMeta) => void;
  setProspects: (p: Prospect[]) => void;
  markScheduled: (key: string, at: string) => void;
  setResumeName: (n?: string) => void;
  clearAll: () => void;
  replaceAll: (data: Partial<State>) => void;
}

const now = () => new Date().toISOString();

/** Apply a status transition, stamping the dates follow-up logic depends on. */
function transition(c: Contact, status: Status, note?: string): Contact {
  const at = now();
  const next: Contact = { ...c, status, history: [...c.history, { at, type: "status", note: note ?? status }] };
  if (status === "sent" && !c.sentAt) {
    next.sentAt = at;
    next.lastTouchAt = at;
  }
  if (status === "followed_up") {
    next.followUps = c.followUps + 1;
    next.lastTouchAt = at;
    next.sentAt ??= at;
  }
  if (status === "replied" || status === "call_scheduled") next.repliedAt ??= at;
  return next;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      contacts: [],
      templates: DEFAULT_TEMPLATES,
      banks: {},
      tables: [],
      patches: {},
      prospects: [],
      scheduled: {},
      snapshots: [],

      setSettings: (fn) => set({ settings: fn(get().settings) }),

      importWorkbook: ({ meta, contacts, tables, snapshots }) => {
        const existing = new Map(get().contacts.map((c) => [c.id, c]));
        // People added from the dashboard and already written into the file come back as sheet rows.
        const byRef = new Map(
          get()
            .contacts.filter((c) => c.ref && c.source !== "sheet")
            .map((c) => [`${c.ref!.sheet}:${c.ref!.row}`, c]),
        );
        let added = 0;
        let updated = 0;
        const merged: Contact[] = contacts.map((fresh) => {
          const refMatch = fresh.ref ? byRef.get(`${fresh.ref.sheet}:${fresh.ref.row}`) : undefined;
          const prev =
            existing.get(fresh.id) ??
            (refMatch && refMatch.name.toLowerCase() === fresh.name.toLowerCase() ? { ...refMatch, id: fresh.id, source: "sheet" as const } : undefined);
          existing.delete(fresh.id);
          if (refMatch && refMatch.name.toLowerCase() === fresh.name.toLowerCase()) existing.delete(refMatch.id);
          if (!prev) {
            added++;
            return fresh;
          }
          updated++;
          // Keep workflow state from the dashboard, refresh identity fields from the sheet.
          return {
            ...prev,
            name: fresh.name,
            firstName: fresh.firstName,
            lastName: fresh.lastName,
            bank: fresh.bank,
            position: fresh.position || prev.position,
            location: fresh.location || prev.location,
            linkedin: fresh.linkedin || prev.linkedin,
            comment: fresh.comment,
            email: fresh.email || prev.email,
            emailSource: fresh.email ? fresh.emailSource : prev.emailSource,
            sheetStatus: fresh.sheetStatus,
            ref: fresh.ref,
            status: prev.status === "new" ? fresh.status : prev.status,
          };
        });
        // Contacts added in the dashboard (prospects) survive a re-import.
        const kept = [...existing.values()].filter((c) => c.source !== "sheet");
        const banks = { ...get().banks };
        for (const c of merged) {
          const k = bankKey(c.bank, c.region);
          banks[k] ??= { key: k, name: c.bank, region: c.region, status: "active" };
        }
        blobs.setSnapshots(snapshots);
        set({ contacts: [...merged, ...kept], tables, snapshots, workbook: meta, banks, patches: {} });
        return { added, updated };
      },

      setSnapshots: (snapshots) => set({ snapshots }),

      updateContact: (id, patch, event) =>
        set({
          contacts: get().contacts.map((c) =>
            c.id === id ? { ...c, ...patch, history: event ? [...c.history, event] : c.history } : c,
          ),
        }),

      updateContacts: (list) => {
        const m = new Map(list.map((x) => [x.id, x]));
        set({
          contacts: get().contacts.map((c) => {
            const u = m.get(c.id);
            return u ? { ...c, ...u.patch, history: u.event ? [...c.history, u.event] : c.history } : c;
          }),
        });
      },

      addContacts: (list) => {
        const banks = { ...get().banks };
        for (const c of list) {
          const k = bankKey(c.bank, c.region);
          banks[k] ??= { key: k, name: c.bank, region: c.region, status: "active" };
        }
        set({ contacts: [...get().contacts, ...list], banks });
      },

      removeContacts: (ids) => {
        const s = new Set(ids);
        set({ contacts: get().contacts.filter((c) => !s.has(c.id)) });
      },

      setStatus: (ids, status, note) => {
        const s = new Set(ids);
        set({ contacts: get().contacts.map((c) => (s.has(c.id) ? transition(c, status, note) : c)) });
      },

      setCell: (sheet, addr, v) => {
        const patches = { ...get().patches, [sheet]: { ...(get().patches[sheet] ?? {}), [addr]: { v } } };
        set({ patches });
      },

      upsertTemplate: (t) => {
        const list = get().templates;
        set({ templates: list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t] });
      },
      removeTemplate: (id) => set({ templates: get().templates.filter((t) => t.id !== id) }),

      upsertBank: (b) => set({ banks: { ...get().banks, [b.key]: b } }),

      setProspects: (prospects) => set({ prospects }),

      markScheduled: (key, at) => set({ scheduled: { ...get().scheduled, [key]: at } }),

      setResumeName: (resumeName) => set({ resumeName }),

      clearAll: () => {
        blobs.setResume(undefined);
        blobs.setFileHandle(undefined);
        idbDel("blob:workbook");
        idbDel("blob:snapshots");
        set({
          contacts: [],
          banks: {},
          tables: [],
          patches: {},
          prospects: [],
          scheduled: {},
          snapshots: [],
          workbook: undefined,
          resumeName: undefined,
        });
      },

      replaceAll: (data) => set(data),
    }),
    {
      name: "banker-dashboard",
      version: 2,
      storage: createJSONStorage(() => idbStorage),
      migrate: (persisted, version) => migrateState(persisted as Record<string, unknown>, version) as unknown as State,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      partialize: ({ snapshots, ...rest }) => rest,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return {
          ...current,
          ...p,
          // New settings fields added in later versions get their defaults.
          settings: deepMerge(DEFAULT_SETTINGS, p.settings ?? {}) as Settings,
        };
      },
    },
  ),
);

function deepMerge(base: object, over: object): object {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) && v && typeof v === "object" ? deepMerge(b, v) : v;
  }
  return out;
}

export { transition };

/** v1 stored one key per service as flat strings; v2 keeps an ordered list per service plus an AI provider/model. */
function migrateState(p: Record<string, unknown>, version: number) {
  if (version < 2 && p?.settings) {
    const settings = p.settings as { keys?: Record<string, string>; vault?: unknown; ai?: unknown };
    const k = settings.keys ?? {};
    const at = new Date().toISOString();
    const entry = (value: string, extra: Partial<ApiKeyEntry> = {}): ApiKeyEntry[] =>
      value ? [{ id: `k_${Math.random().toString(36).slice(2, 9)}`, value, addedAt: at, note: "Carried over; re-test in Settings", ...extra }] : [];
    const aiProvider: AiProvider = k.ai?.startsWith("sk-ant-") ? "anthropic" : "gateway";
    settings.vault = {
      apollo: entry(k.apollo),
      hunter: entry(k.hunter),
      serper: entry(k.serper),
      ai: entry(k.ai, { provider: aiProvider }),
    };
    settings.ai = { provider: aiProvider, model: k.aiModel || "claude-sonnet-5" };
    for (const f of ["apollo", "hunter", "serper", "ai", "aiModel"]) delete k[f];
  }
  return p;
}

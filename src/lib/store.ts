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
import { syncGridEdits, type ContactTable, type Patches } from "./workbook";
import { splitLocationTeam } from "./locationTeam";
import { DEFAULT_QUERIES, DEFAULT_SETTINGS, DEFAULT_TEMPLATES, LEGACY_QUERIES_V1 } from "./defaults";
import type { TargetBank } from "./banks";

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
  /** Firms found on target-list tabs of the workbook. */
  targets: TargetBank[];
  /** Coverage page: banks the user hid, added by hand, and whether to include the starter IB list. */
  coverage: { hidden: string[]; added: TargetBank[]; includeStarter: boolean };
  lastGmailSync?: string;
  /** AI model+key pairs out of quota, skipped until the time given (see keys.ts#aiHeader). */
  aiCooldowns: Record<string, string>;

  setSettings: (fn: (s: Settings) => Settings) => void;
  importWorkbook: (args: {
    meta: WorkbookMeta;
    contacts: Contact[];
    tables: ContactTable[];
    snapshots: SheetSnapshot[];
    targets?: TargetBank[];
  }) => { added: number; updated: number };
  setSnapshots: (s: SheetSnapshot[]) => void;
  updateContact: (id: string, patch: Partial<Contact>, event?: HistoryEvent) => void;
  updateContacts: (patches: { id: string; patch: Partial<Contact>; event?: HistoryEvent }[]) => void;
  addContacts: (c: Contact[]) => void;
  removeContacts: (ids: string[]) => void;
  setStatus: (ids: string[], status: Status, note?: string) => void;
  setCell: (sheet: string, addr: string, v: string) => void;
  /** Several manual cell edits at once (same live contact sync as setCell). */
  applyCellEdits: (edits: Patches) => void;
  upsertTemplate: (t: Template) => void;
  removeTemplate: (id: string) => void;
  upsertBank: (b: BankMeta) => void;
  setProspects: (p: Prospect[]) => void;
  markScheduled: (key: string, at: string) => void;
  setResumeName: (n?: string) => void;
  setCoverage: (fn: (c: State["coverage"]) => State["coverage"]) => void;
  setLastGmailSync: (at: string) => void;
  noteAiCooldowns: (list: { provider: string; model: string; keyId?: string; until: string }[]) => void;
  clearAiCooldowns: (prefix?: string) => void;
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
      targets: [],
      coverage: { hidden: [], added: [], includeStarter: false },
      aiCooldowns: {},

      setSettings: (fn) => set({ settings: fn(get().settings) }),

      importWorkbook: ({ meta, contacts, tables, snapshots, targets }) => {
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
            team: fresh.team || prev.team,
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
        set({ contacts: [...merged, ...kept], tables, snapshots, workbook: meta, banks, patches: {}, targets: targets ?? get().targets });
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

      setCell: (sheet, addr, v) => get().applyCellEdits({ [sheet]: { [addr]: { v } } }),

      applyCellEdits: (edits) => {
        const before = get().patches;
        const patches = { ...before };
        for (const [sheet, cells] of Object.entries(edits)) patches[sheet] = { ...(before[sheet] ?? {}), ...cells };
        // Typing a person into a contact table makes them a contact immediately (no save/re-import needed).
        const synced = syncGridEdits(get().contacts, get().snapshots, before, patches);
        const banks = { ...get().banks };
        for (const c of synced.added) {
          const k = bankKey(c.bank, c.region);
          banks[k] ??= { key: k, name: c.bank, region: c.region, status: "active" };
        }
        set({ patches, contacts: synced.contacts, tables: get().snapshots.length ? synced.tables : get().tables, banks });
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

      setCoverage: (fn) => set({ coverage: fn(get().coverage) }),
      setLastGmailSync: (lastGmailSync) => set({ lastGmailSync }),
      noteAiCooldowns: (list) => {
        const now = Date.now();
        // Drop expired entries while we're here so the map doesn't grow forever.
        const next = Object.fromEntries(Object.entries(get().aiCooldowns).filter(([, until]) => Date.parse(until) > now));
        for (const x of list) if (x.keyId) next[`${x.provider}/${x.model}#${x.keyId}`] = x.until;
        set({ aiCooldowns: next });
      },
      clearAiCooldowns: (prefix) =>
        set({ aiCooldowns: prefix ? Object.fromEntries(Object.entries(get().aiCooldowns).filter(([k]) => !k.startsWith(prefix))) : {} }),

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
          targets: [],
          lastGmailSync: undefined,
        });
      },

      replaceAll: (data) => set(data),
    }),
    {
      name: "banker-dashboard",
      version: 4,
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
    // Guess the provider from the key's shape (v1 sent every non-Anthropic key to the AI Gateway, which broke Gemini keys).
    const aiProvider: AiProvider = k.ai?.startsWith("sk-ant-") ? "anthropic" : k.ai?.startsWith("AIza") ? "google" : k.ai?.startsWith("sk-proj-") ? "openai" : "gateway";
    settings.vault = {
      apollo: entry(k.apollo),
      hunter: entry(k.hunter),
      serper: entry(k.serper),
      brave: [],
      ai: entry(k.ai, { provider: aiProvider }),
    };
    settings.ai = { provider: aiProvider, model: aiProvider === "anthropic" || aiProvider === "gateway" ? k.aiModel || "claude-sonnet-5" : "" };
    for (const f of ["apollo", "hunter", "serper", "ai", "aiModel"]) delete k[f];
  }
  if (version < 3 && p?.settings) {
    // v2 default search queries were long enough to hit Google's 32-word limit; swap them if untouched.
    const prospect = (p.settings as { prospect?: { queries?: string[] } }).prospect;
    if (prospect && JSON.stringify(prospect.queries) === JSON.stringify(LEGACY_QUERIES_V1)) prospect.queries = [...DEFAULT_QUERIES];
  }
  if (version < 4 && Array.isArray(p?.contacts)) {
    // Location and team used to share one field ("SF/Tech", "NY · Technology"); split them.
    p.contacts = (p.contacts as Contact[]).map((c) => {
      if (c.team || !c.location) return c;
      const { location, team } = splitLocationTeam(c.location);
      // Same reading as a combined sheet column, so the next write-back sees no change.
      return { ...c, location, team: team || undefined };
    });
  }
  return p;
}

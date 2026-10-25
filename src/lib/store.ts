"use client";

import type { SentRecipient } from "./offSheet";
import { EMPTY_APPLY, type ApplyState } from "./apply";
import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from "idb-keyval";
import type {
  InfoSession,
  AiProvider,
  ApiKeyEntry,
  BankMeta,
  Contact,
  EmailHook,
  HistoryEvent,
  Prospect,
  Region,
  Settings,
  SheetSnapshot,
  Status,
  Template,
  WorkbookMeta,
} from "./types";
import { mergeReferral, referralDate } from "./checkboxes";
import { applyPatches, blankTablesPatches, contactPatches, followUpsFromSheet, statusFromSheet, hasDashboardWork, mergePatches, parseSnapshots, shiftTableRows, syncGridEdits, tableBody, type ContactTable, type Patches } from "./workbook";
import { contactId, latestIso } from "./util";
import { isPlace, splitLocationTeam } from "./locationTeam";
import { DEFAULT_HOOKS, LEGACY_TECH_HOOK_TEXT, TECH_HOOK_TEXT } from "./hooks";
import { OUTREACH_EXPERIMENTS } from "./outreach";
import { reconcileTitle, sameLevel } from "./titles";
import { detectRegion } from "./workbook";
import { DEFAULT_CRITERIA, DEFAULT_QUERIES, DEFAULT_SETTINGS, DEFAULT_TEMPLATES, LEGACY_CRITERIA_V1, LEGACY_QUERIES_V1, OUTREACH_TEMPLATE, THREE_PARAGRAPH_BASE } from "./defaults";
import type { TargetBank } from "./banks";
import type { CoverageSettings } from "./coverage";
import { EMPTY_OPS, type SheetOps } from "./sheetOps";
import { readOfficeMap, setOfficeMap } from "./offices";
import { signOffFor, templateSignOff } from "./emailFormat";
import { withSheetChat } from "./conversations";

const idbStorage: StateStorage = {
  getItem: async (k) => (await idbGet<string>(k)) ?? null,
  setItem: (k, v) => idbSet(k, v),
  removeItem: (k) => idbDel(k),
};

/** Writes nowhere: the store starts on this until Shell picks whose data to load (and stays on it in the demo). */
const memoryStorage: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/**
 * Accounts (owner, 2026-10-25): whose data this tab shows. "legacy" = the browser's data from before accounts (the
 * old un-prefixed keys, kept until the user moves it and removes it); "u:<user id>" = a signed-in user's cache of
 * their account; "demo" = sample data in memory, never saved. Every IndexedDB key is prefixed with it.
 */
export type StoreNamespace = "legacy" | "demo" | `u:${string}`;
let namespace: StoreNamespace = "demo";
export const LEGACY_STORE_KEY = "banker-dashboard";
export const storeKeyFor = (ns: StoreNamespace) => (ns === "legacy" ? LEGACY_STORE_KEY : `${LEGACY_STORE_KEY}:${ns}`);
/** The IndexedDB key for `k` in a namespace (the legacy namespace keeps the old names). */
export const localKey = (k: string, ns: StoreNamespace = namespace) => (ns === "legacy" ? k : `${ns}:${k}`);
export const currentNamespace = () => namespace;

export type BlobName = "workbook" | "snapshots" | "resume" | "logo" | `appresume:${string}`;
type BlobListener = (name: BlobName) => void;
const blobListeners = new Set<BlobListener>();
/** Fires after a big file changes here (lib/sync.ts uploads it to the account). */
export function onBlobChange(fn: BlobListener) {
  blobListeners.add(fn);
  return () => {
    blobListeners.delete(fn);
  };
}
const memBlobs = new Map<string, unknown>();
async function blobGet<T>(name: string): Promise<T | undefined> {
  if (namespace === "demo") return memBlobs.get(name) as T | undefined;
  return idbGet<T>(localKey(`blob:${name}`));
}
async function blobSet(name: string, v: unknown, notify = true) {
  if (namespace === "demo") {
    if (v === undefined) memBlobs.delete(name);
    else memBlobs.set(name, v);
  } else if (v === undefined) await idbDel(localKey(`blob:${name}`));
  else await idbSet(localKey(`blob:${name}`), v);
  if (notify) blobListeners.forEach((l) => l(name as BlobName));
}
type FileBlob = { name: string; type: string; data: ArrayBuffer };

// Large blobs live outside the JSON-persisted store.
export const blobs = {
  workbook: () => blobGet<ArrayBuffer>("workbook"),
  setWorkbook: (b: ArrayBuffer) => blobSet("workbook", b),
  /** The local file to save into: per browser (Chrome can't share it), never synced. */
  fileHandle: () => blobGet<FileSystemFileHandle>("handle"),
  setFileHandle: (h: FileSystemFileHandle | undefined) => blobSet("handle", h, false),
  snapshots: () => blobGet<SheetSnapshot[]>("snapshots"),
  setSnapshots: (s: SheetSnapshot[]) => blobSet("snapshots", s),
  resume: () => blobGet<FileBlob>("resume"),
  setResume: (r: FileBlob | undefined) => blobSet("resume", r),
  /** Signature logo image (settings.emailStyle.logo holds its name and size). */
  logo: () => blobGet<FileBlob>("logo"),
  setLogo: (r: FileBlob | undefined) => blobSet("logo", r),
  /** Extra resumes for job applications (state.apply.resumes holds their names); the main one is `resume`. */
  appResume: (id: string) => blobGet<FileBlob>(`appresume:${id}`),
  setAppResume: (id: string, r: FileBlob | undefined) => blobSet(`appresume:${id}`, r),
  /** For lib/sync.ts: read / write a file without announcing it (a download from the account isn't a local change). */
  raw: (name: BlobName) => blobGet<unknown>(name),
  putRaw: (name: BlobName, v: unknown) => blobSet(name, v, false),
};

export function bankKey(name: string, region: Region) {
  return `${name}|${region}`;
}

export interface OffSheetState {
  scannedAt?: string;
  /** Gmail message ids already read, so a scan only fetches new sent mail. */
  seen: string[];
  recipients: SentRecipient[];
  /** Addresses you said aren't bankers to track. */
  ignored: string[];
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
  /** When the current resume was uploaded (Gmail drafts made before this still carry the previous file). */
  resumeAddedAt?: string;
  /** Firms found on target-list tabs of the workbook. */
  targets: TargetBank[];
  /** Coverage page: banks the user hid, added by hand, and whether to include the starter IB list. */
  /** Coverage page: banks hidden / added by hand, the starter IB list toggle, and the recruiting plan (desks to cover). */
  coverage: CoverageSettings;
  /** Pending structural changes (new bank tabs, OVERVIEW rows) applied on save, alongside `patches`. */
  sheetOps: SheetOps;
  lastGmailSync?: string;
  /** AI model+key pairs out of quota, skipped until the time given (see keys.ts#aiHeader). */
  aiCooldowns: Record<string, string>;
  /** Grid undo history (this session only, not persisted). */
  gridUndo: GridState[];
  /** Info sessions (app/info-sessions): read from Google Calendar or added by hand, with who you met at each. */
  infoSessions: InfoSession[];
  /** Recipients of your sent mail (lib/offSheet.ts finds bankers emailed but not in the tracker), and who to ignore. */
  offSheet: OffSheetState;
  setOffSheet: (patch: Partial<OffSheetState>) => void;
  /** Job applications (app/applications): tracked jobs, your application info, writing samples, extra resumes. */
  apply: ApplyState;
  setApply: (fn: (a: ApplyState) => ApplyState) => void;
  /** Merge sessions read from the calendar (by id): calendar fields refresh, your fields (people, notes, attended…) stay. */
  upsertInfoSessions: (list: InfoSession[]) => void;
  updateInfoSession: (id: string, patch: Partial<InfoSession> | ((s: InfoSession) => Partial<InfoSession>)) => void;
  removeInfoSession: (id: string) => void;

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
  /** Returns the contacts the edit created (a name typed into a contact table). */
  setCell: (sheet: string, addr: string, v: string) => Contact[];
  /** Several manual cell edits at once (same live contact sync as setCell). */
  applyCellEdits: (edits: Patches) => Contact[];
  /** Excel-style delete (shift up) / insert (shift down) of rows inside a contact table. */
  shiftRows: (sheet: string, row: number, count: number, mode: "delete" | "insert") => { error?: string; removed: string[]; detached: string[] };
  /**
   * Delete a block of rows that may span several contact tables (e.g. a whole tab selected with Ctrl+A): each table's
   * part is shifted up on its own, bottom table first; banners, headers and rows outside tables stay.
   */
  deleteRows: (sheet: string, top: number, bottom: number) => { error?: string; removed: string[]; detached: string[]; rows: number };
  /**
   * Delete contacts. With `rows`, their spreadsheet rows go too (shifted up inside the table, like the grid's
   * Delete row); without, only the dashboard copy is removed (sheet people come back on the next re-import).
   */
  deleteContacts: (ids: string[], opts: { rows: boolean }) => { removed: number; rows: number };
  /**
   * Blank every contact table (all tabs, or the tabs given) and drop the people in them, keeping the tracker's
   * layout and formatting. `everything` also drops contacts that aren't in the spreadsheet. Undoable (Ctrl+Z).
   */
  resetTracker: (opts: { sheets?: string[]; everything: boolean }) => { removed: number; rows: number };
  /** Undo the last grid change (cell edits, clears, pastes, row deletes/inserts). */
  undoGrid: () => boolean;
  upsertTemplate: (t: Template) => void;
  removeTemplate: (id: string) => void;
  upsertBank: (b: BankMeta) => void;
  setProspects: (p: Prospect[]) => void;
  markScheduled: (key: string, at: string) => void;
  setResumeName: (n?: string, addedAt?: string) => void;
  setCoverage: (fn: (c: State["coverage"]) => State["coverage"]) => void;
  setLastGmailSync: (at: string) => void;
  noteAiCooldowns: (list: { provider: string; model: string; keyId?: string; until: string }[]) => void;
  clearAiCooldowns: (prefix?: string) => void;
  clearAll: () => void;
  replaceAll: (data: Partial<State>) => void;
}

const now = () => new Date().toISOString();

type GridState = Pick<State, "patches" | "contacts" | "tables" | "banks">;

const norm = (x?: string) => (x ?? "").trim().toLowerCase();
/** A re-imported row is the same person when the name, email or LinkedIn profile matches. */
function samePerson(a: Contact, b: Contact) {
  return (
    norm(a.name) === norm(b.name) ||
    (!!a.email && norm(a.email) === norm(b.email)) ||
    (!!a.linkedin && norm(a.linkedin).replace(/\/+$/, "") === norm(b.linkedin).replace(/\/+$/, ""))
  );
}

/** Shift rows inside one contact table and move/renumber/detach the contacts on that tab (no state change). */
function shiftCore(
  s: Pick<State, "patches" | "contacts" | "tables" | "snapshots">,
  sheet: string,
  row: number,
  count: number,
  mode: "delete" | "insert",
) {
  const snapshot = s.snapshots.find((x) => x.name === sheet);
  if (!snapshot) return { error: "This tab isn't in the loaded spreadsheet." };
  const res = shiftTableRows({ snapshot, sheetPatches: s.patches[sheet] ?? {}, tables: s.tables, row, count, mode });
  if ("error" in res) return { error: res.error };
  const removed: string[] = [];
  const detached: string[] = [];
  const contacts: Contact[] = [];
  for (const c of s.contacts) {
    if (c.ref?.sheet !== sheet) {
      contacts.push(c);
      continue;
    }
    const to = res.moveRow(c.ref.row);
    if (to === null) {
      // The row is gone. Keep people the dashboard has history for, as dashboard-only contacts.
      if (hasDashboardWork(c)) {
        detached.push(c.name);
        contacts.push({ ...c, ref: undefined, source: "manual", id: c.source === "sheet" ? `m_${c.id}` : c.id });
      } else removed.push(c.name);
      continue;
    }
    if (to === c.ref.row) contacts.push(c);
    // Sheet ids are "s:<tab>:<row>"; renumber so a re-import after saving still matches this person.
    else contacts.push({ ...c, ref: { ...c.ref, row: to }, id: c.id === contactId(sheet, c.ref.row) ? contactId(sheet, to) : c.id });
  }
  // Cells a moved contact writes itself (email, status…) come from the contact, not from the shifted copy.
  const sheetPatches = { ...res.patches };
  const derived = contactPatches(contacts.filter((c) => c.ref?.sheet === sheet), s.snapshots)[sheet] ?? {};
  for (const k of Object.keys(derived)) delete sheetPatches[k];
  const patches = { ...s.patches, [sheet]: sheetPatches };
  const tables = parseSnapshots(applyPatches(s.snapshots, patches)).tables;
  return { patches, contacts, tables, removed, detached };
}
const UNDO_LIMIT = 50;

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
    (set, get) => {
      const pushUndo = () => {
        const { patches, contacts, tables, banks, gridUndo } = get();
        set({ gridUndo: [...gridUndo.slice(-(UNDO_LIMIT - 1)), { patches, contacts, tables, banks }] });
      };
      return {
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
      sheetOps: EMPTY_OPS,
      aiCooldowns: {},
      infoSessions: [],
      offSheet: { seen: [], recipients: [], ignored: [] },
      setOffSheet: (patch) => set({ offSheet: { ...get().offSheet, ...patch } }),
      apply: EMPTY_APPLY,
      setApply: (fn) => set({ apply: fn(get().apply) }),
      upsertInfoSessions: (list) => {
        const byId = new Map(get().infoSessions.map((s) => [s.id, s]));
        for (const s of list) {
          const prev = byId.get(s.id);
          byId.set(
            s.id,
            prev
              ? { ...prev, title: s.title, firm: s.firm, host: s.host, group: s.group, titleNote: s.titleNote, start: s.start, end: s.end, allDay: s.allDay, location: s.location, link: s.link }
              : s,
          );
        }
        set({ infoSessions: [...byId.values()].sort((a, b) => b.start.localeCompare(a.start)) });
      },
      updateInfoSession: (id, patch) =>
        set({ infoSessions: get().infoSessions.map((s) => (s.id === id ? { ...s, ...(typeof patch === "function" ? patch(s) : patch) } : s)) }),
      removeInfoSession: (id) => set({ infoSessions: get().infoSessions.filter((s) => s.id !== id) }),
      gridUndo: [],

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
        // Conversation rows linked in this file; a row the dashboard picked earlier (not saved yet) stays theirs if still free.
        const convTaken = new Set(contacts.flatMap((c) => (c.convRef ? [`${c.convRef.sheet}:${c.convRef.row}`] : [])));
        const keepConv = (fresh: Contact, prev: Contact) =>
          fresh.convRef ?? (prev.convRef && !convTaken.has(`${prev.convRef.sheet}:${prev.convRef.row}`) ? prev.convRef : undefined);
        const merged: Contact[] = contacts.map((fresh) => {
          const refMatch = fresh.ref ? byRef.get(`${fresh.ref.sheet}:${fresh.ref.row}`) : undefined;
          // Same row id but a different person (another spreadsheet, or rows moved in Excel): start fresh instead of
          // handing them the previous person's status, dates and drafts.
          const byId = existing.get(fresh.id);
          const prev =
            (byId && samePerson(byId, fresh) ? byId : undefined) ??
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
            // An email the dashboard found (Apollo, Gmail…) survives until it's saved; one that came from the sheet follows
            // the sheet, so clearing a wrong address in Excel clears it here too.
            email: fresh.email || (prev.emailSource === "sheet" ? "" : prev.email),
            emailSource: fresh.email ? fresh.emailSource : prev.emailSource === "sheet" ? undefined : prev.emailSource,
            sheetStatus: fresh.sheetStatus,
            // The Referral? box: ticked / unticked in Excel since the last import wins, like Status.
            sheetReferral: fresh.sheetReferral,
            referral: mergeReferral(prev.sheetReferral, fresh.sheetReferral, prev.referral, referralDate(prev)),
            ref: fresh.ref,
            // A Status cell changed outside the dashboard (edited in Excel, or fixed from Gmail) wins; otherwise the
            // dashboard's own status stands.
            status: prev.status === "new" || (fresh.sheetStatus ?? "") !== (prev.sheetStatus ?? "") ? fresh.status : prev.status,
            followUps: (fresh.sheetStatus ?? "") !== (prev.sheetStatus ?? "") ? fresh.followUps : Math.max(prev.followUps, fresh.followUps),
            // Dates from the Contacted column fill in or correct the dashboard's (both come from Gmail).
            sentAt: fresh.sentAt ?? prev.sentAt,
            // ...but the last touch never moves back: a Contacted cell saved before a follow-up went out ("10/1/2026") used
            // to replace the follow-up's date on the next save's re-import, so follow-up #2 was timed from the first email.
            lastTouchAt: fresh.sentAt ? latestIso(fresh.lastTouchAt ?? fresh.sentAt, prev.lastTouchAt) : prev.lastTouchAt,
            lastEmailedAt: latestIso(fresh.lastEmailedAt, prev.lastEmailedAt),
            scheduledAt: fresh.sentAt || fresh.scheduledAt ? fresh.scheduledAt : prev.sentAt ? undefined : prev.scheduledAt,
            convRef: keepConv(fresh, prev),
            // Conversations logged in the dashboard stay; the one typed into the sheet by hand is re-read from it.
            chats: withSheetChat(prev.chats, fresh.chats?.find((x) => x.source === "spreadsheet")),
          };
        });
        // Contacts added in the dashboard (prospects) survive a re-import.
        // A pending row they were going to be written into must still be free in this file (it may be a different
        // spreadsheet); otherwise they stay as dashboard-only contacts instead of overwriting someone.
        const taken = new Set(contacts.flatMap((c) => (c.ref ? [`${c.ref.sheet}:${c.ref.row}`] : [])));
        const kept = [...existing.values()]
          .filter((c) => c.source !== "sheet")
          .map((c) => (c.ref && taken.has(`${c.ref.sheet}:${c.ref.row}`) ? { ...c, ref: undefined } : c))
          .map((c) => (c.convRef && convTaken.has(`${c.convRef.sheet}:${c.convRef.row}`) ? { ...c, convRef: undefined } : c));
        const banks = { ...get().banks };
        for (const c of merged) {
          const k = bankKey(c.bank, c.region);
          banks[k] ??= { key: k, name: c.bank, region: c.region, status: "active" };
        }
        blobs.setSnapshots(snapshots);
        set({ contacts: [...merged, ...kept], tables, snapshots, workbook: meta, banks, patches: {}, sheetOps: EMPTY_OPS, targets: targets ?? get().targets, gridUndo: [] });
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
        pushUndo();
        const before = get().patches;
        const patches = { ...before };
        for (const [sheet, cells] of Object.entries(edits)) patches[sheet] = { ...(before[sheet] ?? {}), ...cells };
        // Typing a person into a contact table makes them a contact immediately (no save/re-import needed).
        // Read the sheet the way the grid shows it (dashboard writes + manual edits), so edits to a row that only exists
        // as a pending write (someone added from the dashboard) still reach that contact.
        const derived = contactPatches(get().contacts, get().snapshots);
        const synced = syncGridEdits(get().contacts, get().snapshots, mergePatches(derived, before), mergePatches(derived, patches));
        const banks = { ...get().banks };
        for (const c of synced.added) {
          const k = bankKey(c.bank, c.region);
          banks[k] ??= { key: k, name: c.bank, region: c.region, status: "active" };
        }
        set({ patches, contacts: synced.contacts, tables: get().snapshots.length ? synced.tables : get().tables, banks });
        return synced.added;
      },

      shiftRows: (sheet, row, count, mode) => {
        const s = get();
        const res = shiftCore(s, sheet, row, count, mode);
        if ("error" in res) return { error: res.error, removed: [], detached: [] };
        pushUndo();
        set({ patches: res.patches, contacts: res.contacts, tables: res.tables });
        return { removed: res.removed, detached: res.detached };
      },

      deleteRows: (sheet, top, bottom) => {
        const s = get();
        const snap = s.snapshots.find((x) => x.name === sheet);
        if (!snap) return { error: "This tab isn't in the loaded spreadsheet.", removed: [], detached: [], rows: 0 };
        const mine = s.tables.filter((t) => t.sheet === sheet).sort((a, b) => b.headerRow - a.headerRow);
        const eff = applyPatches([snap], { [sheet]: s.patches[sheet] ?? {} })[0];
        const cell = (r: number, c: number) => eff.cells[`${r}:${c}`]?.v ?? "";
        let state = { patches: s.patches, contacts: s.contacts, tables: s.tables, snapshots: s.snapshots };
        const removed: string[] = [];
        const detached: string[] = [];
        let rows = 0;
        for (const t of mine) {
          const body = tableBody(t, mine, cell, eff.rows);
          const from = Math.max(top, body.from);
          const to = Math.min(bottom, body.limit === Infinity ? bottom : body.limit);
          if (from > to) continue;
          const res = shiftCore(state, sheet, from, to - from + 1, "delete");
          if ("error" in res) continue;
          state = { ...state, patches: res.patches, contacts: res.contacts, tables: res.tables };
          removed.push(...res.removed);
          detached.push(...res.detached);
          rows += to - from + 1;
        }
        if (!rows) return { error: "Only rows inside a contact table can be deleted (other rows can be cleared).", removed, detached, rows };
        pushUndo();
        set({ patches: state.patches, contacts: state.contacts, tables: state.tables });
        return { removed, detached, rows };
      },

      deleteContacts: (ids, { rows }) => {
        const drop = new Set(ids);
        const s = get();
        pushUndo();
        let state = { patches: s.patches, contacts: s.contacts, tables: s.tables, snapshots: s.snapshots };
        let rowCount = 0;
        if (rows) {
          // Bottom-up per tab, so rows still to delete keep their numbers.
          const targets = s.contacts
            .filter((c) => drop.has(c.id) && c.ref && s.snapshots.some((x) => x.name === c.ref!.sheet))
            .map((c) => ({ sheet: c.ref!.sheet, row: c.ref!.row, id: c.id }))
            .sort((a, b) => a.sheet.localeCompare(b.sheet) || b.row - a.row);
          for (const t of targets) {
            const cur = state.contacts.find((c) => c.id === t.id || c.id === `m_${t.id}`);
            if (!cur?.ref) continue;
            const res = shiftCore(state, cur.ref.sheet, cur.ref.row, 1, "delete");
            if ("error" in res) continue; // Not inside a table: the dashboard copy is still removed below.
            // The row is gone, so its old id now belongs to whoever moved up into it: stop matching on it. Contacts
            // the shift detached (dashboard work) carry an "m_" id instead; they're being deleted anyway.
            drop.delete(t.id);
            drop.add(`m_${t.id}`);
            state = { ...state, patches: res.patches, contacts: res.contacts, tables: res.tables };
            rowCount++;
          }
        }
        const contacts = state.contacts.filter((c) => !drop.has(c.id));
        set({ patches: state.patches, tables: state.tables, contacts });
        return { removed: s.contacts.filter((c) => ids.includes(c.id)).length, rows: rowCount };
      },

      resetTracker: ({ sheets, everything }) => {
        const s = get();
        pushUndo();
        const scope = sheets ? new Set(sheets) : undefined;
        const blank = blankTablesPatches(s.snapshots, s.tables, s.patches, sheets);
        const loaded = new Set(s.snapshots.map((x) => x.name));
        const contacts = s.contacts.filter((c) => {
          if (c.ref && (!scope || scope.has(c.ref.sheet))) return false;
          // "Everything": also people with no row in this spreadsheet (dashboard-only, or left over from another file).
          if (everything && (!c.ref || !loaded.has(c.ref.sheet))) return false;
          return true;
        });
        const tables = parseSnapshots(applyPatches(s.snapshots, blank.patches)).tables;
        set({ patches: blank.patches, contacts, tables });
        return { removed: s.contacts.length - contacts.length, rows: blank.rows };
      },

      undoGrid: () => {
        const stack = get().gridUndo;
        const prev = stack[stack.length - 1];
        if (!prev) return false;
        set({ ...prev, gridUndo: stack.slice(0, -1) });
        return true;
      },

      upsertTemplate: (t) => {
        const list = get().templates;
        set({ templates: list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t] });
      },
      removeTemplate: (id) => set({ templates: get().templates.filter((t) => t.id !== id) }),

      upsertBank: (b) => set({ banks: { ...get().banks, [b.key]: b } }),

      setProspects: (prospects) => set({ prospects }),

      markScheduled: (key, at) => set({ scheduled: { ...get().scheduled, [key]: at } }),

      setResumeName: (resumeName, resumeAddedAt) => set({ resumeName, resumeAddedAt }),

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
        blobs.setLogo(undefined);
        blobs.setFileHandle(undefined);
        blobSet("workbook", undefined);
        blobSet("snapshots", undefined);
        set({
          contacts: [],
          banks: {},
          tables: [],
          patches: {},
          sheetOps: EMPTY_OPS,
          prospects: [],
          scheduled: {},
          snapshots: [],
          workbook: undefined,
          resumeName: undefined,
          resumeAddedAt: undefined,
          targets: [],
          lastGmailSync: undefined,
        });
      },

      replaceAll: (data) => set(data),
      };
    },
    {
      name: LEGACY_STORE_KEY,
      version: 10,
      // Nothing is read or written until Shell picks a namespace (useNamespace): writing before that could overwrite a
      // browser's only copy of its data with an empty store.
      storage: createJSONStorage(() => memoryStorage),
      skipHydration: true,
      migrate: (persisted, version) => migrateState(persisted as Record<string, unknown>, version) as unknown as State,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      partialize: ({ snapshots, gridUndo, ...rest }) => rest,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return {
          ...current,
          ...p,
          // New settings fields added in later versions get their defaults.
          settings: deepMerge(DEFAULT_SETTINGS, p.settings ?? {}) as Settings,
          // So do application-profile fields added later.
          apply: { ...EMPTY_APPLY, ...p.apply, profile: { ...EMPTY_APPLY.profile, ...p.apply?.profile }, finder: { ...EMPTY_APPLY.finder, ...p.apply?.finder } },
        };
      },
    },
  ),
);

/** The store's starting state (empty, with its actions), for switching between users / the demo. */
const INITIAL = useStore.getState();
export const STORE_VERSION = 10;

/**
 * Show `ns`'s data: the store is emptied (without writing anywhere), pointed at that namespace's IndexedDB key, and
 * loaded from it. "demo" stays in memory; `seed` fills it.
 */
export async function switchNamespace(ns: StoreNamespace, seed?: Partial<State>) {
  useStore.persist.setOptions({ storage: createJSONStorage(() => memoryStorage) });
  namespace = ns;
  memBlobs.clear();
  useStore.setState(INITIAL, true);
  if (ns === "demo") {
    if (seed) useStore.setState(seed);
    return;
  }
  useStore.persist.setOptions({ name: storeKeyFor(ns), storage: createJSONStorage(() => idbStorage) });
  await useStore.persist.rehydrate();
}

/** The persisted part of the state right now (what goes to IndexedDB, and to the account via lib/sync.ts). */
export function persistedState(): Record<string, unknown> {
  const p = useStore.persist.getOptions().partialize;
  const all = (p ? p(useStore.getState()) : useStore.getState()) as unknown as Record<string, unknown>;
  // Data only: the actions (setLastGmailSync…) are in the state too, and a sync pull resets every key it lists that the
  // account lacks, which wiped them ("setLastGmailSync is not a function").
  return Object.fromEntries(Object.entries(all).filter(([, v]) => typeof v !== "function"));
}

/** Bring data saved by an older version (another browser's copy in the account) up to date, like a reload would. */
export function migratePersisted(p: Record<string, unknown>, version: number) {
  return version < STORE_VERSION ? (migrateState(p, version) as unknown as Record<string, unknown>) : p;
}

/** Raw saved JSON of a namespace (moving a browser's old data into an account). */
export async function readNamespace(ns: StoreNamespace) {
  const raw = await idbGet<string>(storeKeyFor(ns));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { state: Record<string, unknown>; version: number };
  } catch {
    return null;
  }
}

/** Copy a namespace's saved data + files to another (the old copy stays). The local-file handle isn't copied. */
export async function copyNamespace(from: StoreNamespace, to: StoreNamespace) {
  const raw = await idbGet<string>(storeKeyFor(from));
  if (raw) await idbSet(storeKeyFor(to), raw);
  const prefix = localKey("blob:", from);
  for (const k of (await idbKeys()) as unknown[]) {
    if (typeof k !== "string" || !k.startsWith(prefix) || k === localKey("blob:handle", from)) continue;
    await idbSet(localKey(`blob:${k.slice(prefix.length)}`, to), await idbGet(k));
  }
}

/** Remove a namespace's saved data + files from this browser (sign-out, "Remove this browser's old copy"). */
export async function dropNamespace(ns: StoreNamespace) {
  if (ns === "demo") return;
  await idbDel(storeKeyFor(ns));
  for (const k of (await idbKeys()) as unknown[]) {
    if (typeof k !== "string") continue;
    const mine = ns === "legacy" ? k.startsWith("blob:") || k === "infosessions:unsorted" : k.startsWith(`${ns}:`);
    if (mine) await idbDel(k);
  }
}

// The COVERAGE tab's office map follows the sheets: team guesses and "not offered" desks read it (lib/offices.ts).
// Pending edits count too (rows added to COVERAGE for a new application are in `patches` until save).
useStore.subscribe((s, prev) => {
  if (s.snapshots !== prev.snapshots || s.patches !== prev.patches) setOfficeMap(readOfficeMap(applyPatches(s.snapshots, s.patches)));
});

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
  if (version < 5 && Array.isArray(p?.contacts)) {
    p.contacts = (p.contacts as Contact[]).map((c) => {
      let next = c;
      // LA and Chicago became their own regions, and unknown cities stopped defaulting to SF.
      const r = detectRegion(c.location);
      if (r !== "Other" && r !== c.region) next = { ...next, region: r };
      else if (r === "Other" && c.region === "SF" && c.location && isPlace(c.location)) next = { ...next, region: "Other" };
      // People found online: trust the headline's current title over an AI guess from the snippet.
      if (c.source !== "sheet" && c.headline && !sameLevel(c.headline, c.position)) next = { ...next, position: reconcileTitle(c.headline, c.position) };
      return next;
    });
  }
  if (version < 6 && Array.isArray(p?.templates)) {
    const starter = DEFAULT_TEMPLATES.find((t) => t.id === "tpl_non_target")!;
    p.templates = (p.templates as Template[]).map((t) => {
      if (t.kind !== "initial" || !(t.id === starter.id || /non.?target/i.test(t.name))) return t;
      const fixed = { ...t, requires: starter.requires, lockBase: true };
      // Lost its school blank (mangled import or edit): back to the owner's wording.
      return /\{\{\s*their_school\s*\}\}/.test(t.body) ? fixed : { ...fixed, subject: starter.subject, body: starter.body };
    });
  }
  if (version < 7 && p?.settings) {
    const settings = p.settings as { hooks?: EmailHook[]; profile?: { pitch?: string } };
    if (!settings.hooks?.length) {
      const pitch = settings.profile?.pitch?.trim();
      settings.hooks = DEFAULT_HOOKS.map((h) => (h.id === "hook_tech" && pitch ? { ...h, text: pitch } : h));
    }
  }
  // Outreach rules (docs/outreach-rules.md, 10/2026): new defaults replace old ones the owner never edited.
  if (version < 8 && p?.settings) {
    const settings = p.settings as Settings;
    if (settings.emailStyle?.font === "garamond") settings.emailStyle = { ...settings.emailStyle, font: "sans" };
    const oldPitch = settings.profile?.pitch?.trim();
    settings.hooks = (settings.hooks ?? DEFAULT_HOOKS).map((h) =>
      h.id === "hook_tech" && (!h.text.trim() || h.text === LEGACY_TECH_HOOK_TEXT || h.text.trim() === oldPitch) ? { ...h, text: TECH_HOOK_TEXT } : h,
    );
    // The 3-paragraph base becomes the one in use; older bases stay (inactive) for history and results.
    const bases = settings.emailBases ?? [];
    if (!bases.some((b) => b.id === THREE_PARAGRAPH_BASE.id)) settings.emailBases = [THREE_PARAGRAPH_BASE, ...bases.map((b) => ({ ...b, active: false }))];
    if (settings.prospect?.criteria?.trim() === LEGACY_CRITERIA_V1.trim()) settings.prospect = { ...settings.prospect, criteria: DEFAULT_CRITERIA };
    const have = new Set((settings.experiments ?? []).map((e) => e.id));
    settings.experiments = [...(settings.experiments ?? []), ...OUTREACH_EXPERIMENTS.filter((e) => !have.has(e.id))];
  }
  if (version < 8 && Array.isArray(p?.templates) && !(p.templates as Template[]).some((t) => t.id === OUTREACH_TEMPLATE.id)) {
    p.templates = [OUTREACH_TEMPLATE, ...(p.templates as Template[])];
  }
  // Sheet statuses read wrong before 10/2026: a bare "Scheduled" (an email queued with Schedule send) counted as a call,
  // "Removed"/"Bounced" as not contacted, and "Followed up (2x)" as 0 follow-ups.
  if (version < 9 && Array.isArray(p?.contacts)) {
    p.contacts = (p.contacts as Contact[]).map((c) => {
      if (!c.sheetStatus) return c;
      const fromSheet = statusFromSheet(c.sheetStatus);
      const misread = (/^\s*scheduled\b/i.test(c.sheetStatus) && c.status === "call_scheduled") || (fromSheet === "ignored" && c.status === "new");
      const followUps = c.status === "followed_up" ? Math.max(c.followUps, followUpsFromSheet(c.sheetStatus)) : c.followUps;
      return misread || followUps !== c.followUps ? { ...c, status: misread ? fromSheet : c.status, followUps } : c;
    });
  }
  // Sign-off and signature are separate (10/2026): "Sincerely," + "{{my_first_name}}" on the next line, a blank line, then the signature block
  // (full name first). First emails sign "Sincerely,", follow-up #1 "Regards,", #2 "Kind regards,". Sent emails aren't touched.
  if (version < 10 && Array.isArray(p?.templates)) {
    p.templates = (p.templates as Template[]).map((t) => {
      const body = templateSignOff(t.body, t.kind === "follow_up" ? signOffFor(t.step ?? 1) : signOffFor());
      return body === t.body ? t : { ...t, body };
    });
  }
  if (version < 10 && p?.settings) {
    const settings = p.settings as Settings;
    settings.emailBases = settings.emailBases?.map((b) => {
      const close = templateSignOff(b.close, signOffFor());
      return close === b.close ? b : { ...b, close };
    });
  }
  return p;
}

"use client";

// Client state (Zustand). The open workspace lives in a WorkspaceClient (lib/workspace/client.ts): decisions
// come from the shared data plus its events, and the store mirrors the latest session for the views. This
// device keeps a local copy of each workspace (SPEC §16.3, G7.2); if storage is unavailable the app says so
// (G7.8) and still works.

import { create } from "zustand";
import type { Status } from "@/lib/types";
import { todayIST } from "@/lib/planner/dates";
import {
  computeResult,
  newSession,
  parseSessionFile,
  serialiseSession,
  type ChangeSpec,
  type CommitOutcome,
  type Feedback,
  type Session,
} from "./session";
import { safeGetItem, safeRemoveItem, safeSetItem, storageWorks } from "./storage";
import type { ParseResult } from "@/lib/ingest/parseWorkbook";
import { LAST_WORKSPACE_KEY, localCache } from "@/lib/workspace/cache";
import { WorkspaceClient, type LoadError, type SyncStatus, type Toast } from "@/lib/workspace/client";
import { ChangePayloadSchema, classifyChange, type BaseData, type ChangePayload } from "@/lib/workspace/schemas";
import { httpTransport } from "@/lib/workspace/transport";

export type Tab = "sheet" | "overview" | "applications" | "territories" | "policy" | "log" | "export";

export interface Filters {
  query: string;
  status: Status | "all";
  territory: string;
  city: string;
  flag: string;
}

export const NO_FILTERS: Filters = { query: "", status: "all", territory: "all", city: "all", flag: "all" };

/** What the previous upload decided, kept in memory for "Compare with previous upload" (SPEC §15.1). */
export interface PreviousSnapshot {
  files: string[];
  decisions: { appKey: string; appId: string; name: string; status: Status; label: string; pin: string | null }[];
}

export type Persistence = "unknown" | "saved" | "memory";

export interface SyncState {
  status: SyncStatus;
  message: string | null;
  pending: number;
}

interface StoreState {
  hydrated: boolean;
  persistence: Persistence;
  /** The open workspace's id, and its latest session. */
  workspaceId: string | null;
  session: Session | null;
  sync: SyncState;
  toasts: Toast[];
  loadError: LoadError | null;
  previous: PreviousSnapshot | null;
  compareOpen: boolean;
  /** The change shown in the "what changed" card, with its Undo button. */
  lastChangeId: string | null;
  /** The "where to start" suggestions were dismissed. */
  guidedDismissed: boolean;

  tab: Tab;
  drawerKey: string | null;
  /** A section of the drawer to open straight away. */
  drawerFocus: "fact" | null;
  filters: Filters;

  hydrate: () => void;
  /** Open a workspace by id and keep it in sync until `close`. */
  open: (id: string) => Promise<void>;
  close: () => void;
  retryLoad: () => void;
  /** Make a new workspace from an upload. Returns its id. */
  startFromParse: (parse: Extract<ParseResult, { ok: true }>, files: string[]) => string;
  /** Make a new workspace from a saved session file. Returns its id. */
  resume: (session: Session) => string;
  continueReview: () => void;
  commit: (spec: ChangeSpec) => CommitOutcome;
  undo: (id: string) => void;
  addFeedback: (appKey: string, appId: string, status: Status, reason: string) => void;
  dismissToast: (id: number) => void;
  /** Leave the workspace. It stays on the server and on this device. */
  reset: () => void;
  exportSessionText: () => string | null;

  setTab: (t: Tab) => void;
  openDrawer: (key: string | null, focus?: "fact") => void;
  setFilters: (f: Partial<Filters>) => void;
  setCompareOpen: (open: boolean) => void;
  dismissLastChange: () => void;
  dismissGuided: () => void;
}

const GUIDED_KEY = "fpe.guided.dismissed";
const IDLE_SYNC: SyncState = { status: "loading", message: null, pending: 0 };

function snapshotOf(session: Session): PreviousSnapshot {
  const result = computeResult(session);
  return {
    files: session.files,
    decisions: result.decisions.map((d) => ({ appKey: d.appKey, appId: d.appId, name: d.name, status: d.status, label: d.label, pin: d.pin })),
  };
}

function baseOf(s: Session): BaseData {
  return { files: s.files, parsed: s.parsed, base: s.base, policy: s.policy, signals: s.signals };
}

function newId(): string {
  return crypto.randomUUID();
}

export const useStore = create<StoreState>((set, get) => {
  let client: WorkspaceClient | null = null;

  /** Copy what the client knows into the store, for the views. */
  function mirror() {
    const c = client;
    if (!c) return;
    const persistence = get().persistence;
    set({
      workspaceId: c.id,
      session: c.session,
      sync: { status: c.status, message: c.statusMessage, pending: c.pendingCount },
      toasts: c.toasts,
      loadError: c.loadError,
      persistence: c.cacheFailed ? "memory" : persistence === "memory" ? "memory" : "saved",
    });
  }

  function attach(c: WorkspaceClient) {
    client?.stop();
    client = c;
    safeSetItem(LAST_WORKSPACE_KEY, c.id);
    mirror();
    c.start();
  }

  function make(id: string, onChange = mirror) {
    return { id, transport: httpTransport, cache: localCache, onChange };
  }

  return {
    hydrated: false,
    persistence: "unknown",
    workspaceId: null,
    session: null,
    sync: IDLE_SYNC,
    toasts: [],
    loadError: null,
    previous: null,
    compareOpen: false,
    lastChangeId: null,
    guidedDismissed: false,
    tab: "sheet",
    drawerKey: null,
    drawerFocus: null,
    filters: NO_FILTERS,

    hydrate() {
      if (get().hydrated) return;
      set({ hydrated: true, persistence: storageWorks() ? "saved" : "memory", guidedDismissed: safeGetItem(GUIDED_KEY) === "1" });
    },

    async open(id) {
      if (client?.id === id && client.session) {
        client.start();
        mirror();
        return;
      }
      client?.stop();
      const c = new WorkspaceClient(make(id));
      client = c;
      set({ workspaceId: id, session: null, loadError: null, sync: IDLE_SYNC, toasts: [], lastChangeId: null });
      await c.open();
      // A different workspace may have been opened while this one loaded.
      if (client !== c) return;
      safeSetItem(LAST_WORKSPACE_KEY, id);
      mirror();
      c.start();
    },

    close() {
      client?.stop();
    },

    retryLoad() {
      void client?.kick();
    },

    startFromParse(parse, files) {
      const old = get().session;
      const session = newSession({
        files,
        applications: parse.applications,
        territories: parse.territories,
        skippedExample: parse.skippedExample,
        report: parse.report,
        today: todayIST(),
      });
      // A second upload: a new workspace that links back to the last one, and keeps what that one decided for comparison.
      const parentId = get().workspaceId ?? safeGetItem(LAST_WORKSPACE_KEY);
      const previous = old ? snapshotOf(old) : null;
      const id = newId();
      const c = WorkspaceClient.fromUpload({ ...make(id), base: baseOf(session), name: files.join(", ").slice(0, 200) || "Upload", parentId: parentId && /^[0-9a-f-]{36}$/i.test(parentId) ? parentId : null });
      attach(c);
      set({ previous, compareOpen: false, lastChangeId: null, tab: "sheet", drawerKey: null, filters: NO_FILTERS });
      return id;
    },

    resume(session) {
      const seed: NonNullable<Parameters<typeof WorkspaceClient.fromUpload>[0]["seed"]> = [];
      session.entries.forEach((e) => {
        const payload: ChangePayload = {
          source: e.source,
          description: e.description.slice(0, 500),
          ...(e.facts?.length ? { facts: e.facts } : {}),
          ...(e.locks?.length ? { locks: e.locks } : {}),
          ...(e.overrides?.length ? { overrides: e.overrides } : {}),
          ...(e.set && Object.keys(e.set).length ? { set: e.set } : {}),
        };
        const ok = ChangePayloadSchema.safeParse(payload);
        if (!ok.success) return;
        seed.push({ type: classifyChange(ok.data), payload: ok.data });
        if (e.undone) seed.push({ type: "undo", payload: { targetSeq: 0 }, undoOfIndex: seed.length - 1 });
      });
      const id = newId();
      const parentId = get().workspaceId;
      const c = WorkspaceClient.fromUpload({
        ...make(id),
        base: baseOf(session),
        name: session.files.join(", ").slice(0, 200) || "Saved session",
        parentId: parentId && /^[0-9a-f-]{36}$/i.test(parentId) ? parentId : null,
        seed,
        feedback: session.feedback,
        reviewed: session.reviewed,
      });
      attach(c);
      set({ previous: null, compareOpen: false, lastChangeId: null, tab: "sheet", drawerKey: null, filters: NO_FILTERS });
      return id;
    },

    continueReview() {
      client?.continueReview();
    },

    commit(spec) {
      if (!client) return { ok: false, message: "No workspace is open." };
      const outcome = client.commit(spec);
      if (outcome.ok) set({ lastChangeId: outcome.entry.id });
      return outcome;
    },

    undo(id) {
      client?.undo(id);
      if (get().lastChangeId === id) set({ lastChangeId: null });
    },

    addFeedback(appKey, appId, status, reason) {
      const s = client?.session;
      if (!client || !s) return;
      const fb: Feedback = { id: `f${s.feedback.length + 1}`, time: new Date().toISOString(), appKey, appId, status, reason };
      client.addFeedback(fb);
    },

    dismissToast(id) {
      client?.dismissToast(id);
    },

    reset() {
      client?.stop();
      client = null;
      safeRemoveItem(LAST_WORKSPACE_KEY);
      set({ workspaceId: null, session: null, sync: IDLE_SYNC, toasts: [], loadError: null, previous: null, compareOpen: false, lastChangeId: null, tab: "sheet", drawerKey: null, filters: NO_FILTERS });
    },

    exportSessionText() {
      const s = client?.session ?? get().session;
      return s ? serialiseSession(s, new Date().toISOString()) : null;
    },

    setTab: (tab) => set({ tab }),
    openDrawer: (drawerKey, focus) => set({ drawerKey, drawerFocus: focus ?? null }),
    setFilters: (f) => set((st) => ({ filters: { ...st.filters, ...f } })),
    setCompareOpen: (compareOpen) => set({ compareOpen }),
    dismissLastChange: () => set({ lastChangeId: null }),
    dismissGuided() {
      safeSetItem(GUIDED_KEY, "1");
      set({ guidedDismissed: true });
    },
  };
});

export { parseSessionFile };

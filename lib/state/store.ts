"use client";

// Client state (Zustand). The session is saved to localStorage so a refresh or a new tab doesn't lose work
// (G7.2); if storage is unavailable it stays in memory and the app says so (G7.8). Nothing is shared with
// any server or any other judge (G7.1).

import { create } from "zustand";
import type { Status } from "@/lib/types";
import { todayIST } from "@/lib/planner/dates";
import {
  commitChange,
  computeResult,
  newSession,
  parseSessionFile,
  serialiseSession,
  undoEntry,
  type ChangeSpec,
  type CommitOutcome,
  type Feedback,
  type ParsedSession,
  type Session,
} from "./session";
import { STORAGE_KEY, safeGetItem, safeRemoveItem, safeSetItem, storageWorks } from "./storage";
import type { ParseResult } from "@/lib/ingest/parseWorkbook";

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

interface StoreState {
  hydrated: boolean;
  persistence: Persistence;
  session: Session | null;
  previous: PreviousSnapshot | null;
  compareOpen: boolean;

  tab: Tab;
  drawerKey: string | null;
  filters: Filters;

  hydrate: () => void;
  startFromParse: (parse: Extract<ParseResult, { ok: true }>, files: string[]) => void;
  resume: (session: Session) => void;
  continueReview: () => void;
  commit: (spec: ChangeSpec) => CommitOutcome;
  undo: (id: string) => void;
  addFeedback: (appKey: string, appId: string, status: Status, reason: string) => void;
  reset: () => void;
  exportSessionText: () => string | null;

  setTab: (t: Tab) => void;
  openDrawer: (key: string | null) => void;
  setFilters: (f: Partial<Filters>) => void;
  setCompareOpen: (open: boolean) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function snapshotOf(session: Session): PreviousSnapshot {
  const result = computeResult(session);
  return {
    files: session.files,
    decisions: result.decisions.map((d) => ({ appKey: d.appKey, appId: d.appId, name: d.name, status: d.status, label: d.label, pin: d.pin })),
  };
}

export const useStore = create<StoreState>((set, get) => {
  /** Save after changes, a moment later so rapid edits don't hammer storage (G7.3). */
  function scheduleSave() {
    if (typeof window === "undefined") return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { session, persistence } = get();
      if (persistence === "memory") return;
      if (!session) {
        safeRemoveItem(STORAGE_KEY);
        return;
      }
      const ok = safeSetItem(STORAGE_KEY, serialiseSession(session, new Date().toISOString()));
      if (!ok) set({ persistence: "memory" });
    }, 250);
  }

  const setSession = (session: Session | null, extra: Partial<StoreState> = {}) => {
    set({ session, ...extra });
    scheduleSave();
  };

  return {
    hydrated: false,
    persistence: "unknown",
    session: null,
    previous: null,
    compareOpen: false,
    tab: "sheet",
    drawerKey: null,
    filters: NO_FILTERS,

    hydrate() {
      if (get().hydrated) return;
      const works = storageWorks();
      let session: Session | null = null;
      if (works) {
        const text = safeGetItem(STORAGE_KEY);
        if (text) {
          const parsed = parseSessionFile(text);
          if (parsed.ok) session = parsed.session;
          else safeRemoveItem(STORAGE_KEY); // a damaged saved session is dropped rather than crashing the app
        }
      }
      set({ hydrated: true, persistence: works ? "saved" : "memory", session });
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
      // A second upload in the same session: keep what the first one decided, for comparison.
      const previous = old ? snapshotOf(old) : null;
      setSession(session, { previous, compareOpen: false, tab: "sheet", drawerKey: null, filters: NO_FILTERS });
    },

    resume(session) {
      setSession(session, { previous: null, compareOpen: false, tab: "sheet", drawerKey: null, filters: NO_FILTERS });
    },

    continueReview() {
      const s = get().session;
      if (s) setSession({ ...s, reviewed: true });
    },

    commit(spec) {
      const s = get().session;
      if (!s) return { ok: false, message: "No session is open." };
      const outcome = commitChange(s, spec, new Date().toISOString());
      if (outcome.ok) setSession(outcome.session);
      return outcome;
    },

    undo(id) {
      const s = get().session;
      if (s) setSession(undoEntry(s, id));
    },

    addFeedback(appKey, appId, status, reason) {
      const s = get().session;
      if (!s) return;
      const fb: Feedback = { id: `f${s.feedback.length + 1}`, time: new Date().toISOString(), appKey, appId, status, reason };
      setSession({ ...s, feedback: [...s.feedback, fb] });
    },

    reset() {
      if (saveTimer) clearTimeout(saveTimer);
      safeRemoveItem(STORAGE_KEY);
      set({ session: null, previous: null, compareOpen: false, tab: "sheet", drawerKey: null, filters: NO_FILTERS });
    },

    exportSessionText() {
      const s = get().session;
      return s ? serialiseSession(s, new Date().toISOString()) : null;
    },

    setTab: (tab) => set({ tab }),
    openDrawer: (drawerKey) => set({ drawerKey }),
    setFilters: (f) => set((st) => ({ filters: { ...st.filters, ...f } })),
    setCompareOpen: (compareOpen) => set({ compareOpen }),
  };
});

export type { ParsedSession };
export { parseSessionFile };

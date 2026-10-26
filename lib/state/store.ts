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
  effective,
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
import { answerTurn, NEW_CHAT, type ChatReply, type ChatState } from "@/lib/chat/engine";
import { aiClient } from "@/lib/llm/clientApi";
import { chunkSignals, hasText, readNotes } from "@/lib/llm/extractClient";
import { localSignalCache } from "@/lib/llm/signalCache";

export type Tab = "sheet" | "overview" | "applications" | "territories" | "map" | "policy" | "log" | "export";

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

export interface ChatMsg {
  id: number;
  role: "user" | "assistant";
  text: string;
  reply?: ChatReply;
}

/** The AI's reading of the applicants' notes (SPEC §8.1). */
export interface ReadingState {
  status: "idle" | "running" | "done" | "failed";
  message: string | null;
}

interface StoreState {
  hydrated: boolean;
  reading: ReadingState;
  chat: { messages: ChatMsg[]; state: ChatState; busy: boolean };
  /** The assistant panel (the round button at the bottom right) is open. */
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
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
  /** Ask the AI to read the notes it hasn't read yet. Changes go in the change log as "AI reading of notes". */
  retryReading: () => Promise<void>;
  /** Send a chat message: answered from the engine, with the AI only where the patterns don't reach. */
  askChat: (text: string) => Promise<void>;
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
const IDLE_READING: ReadingState = { status: "idle", message: null };
const NEW_CHAT_SLICE = { messages: [] as ChatMsg[], state: NEW_CHAT, busy: false };
let chatId = 0;

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
    reading: IDLE_READING,
    chat: NEW_CHAT_SLICE,
    chatOpen: false,
    setChatOpen: (chatOpen) => set({ chatOpen }),
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
      set({ workspaceId: id, session: null, loadError: null, sync: IDLE_SYNC, toasts: [], lastChangeId: null, reading: IDLE_READING, chat: NEW_CHAT_SLICE });
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
      // The workspace is held back until the AI has read the notes (at most 25 seconds), so everyone starts from the same reading.
      const c = WorkspaceClient.fromUpload({ ...make(id), base: baseOf(session), name: files.join(", ").slice(0, 200) || "Upload", parentId: parentId && /^[0-9a-f-]{36}$/i.test(parentId) ? parentId : null, holdSync: true });
      attach(c);
      set({ previous, compareOpen: false, lastChangeId: null, tab: "sheet", drawerKey: null, filters: NO_FILTERS, reading: { status: "running", message: null } });
      void (async () => {
        const r = await readNotes(session.parsed.applications, { cache: localSignalCache });
        c.setSignals(r.signals);
        if (client !== c) return;
        const state: ReadingState = r.total === 0 || r.complete
          ? { status: "done", message: null }
          : { status: "failed", message: r.unavailable ? null : `The AI read ${r.read} of ${r.total} in time.` };
        set({ reading: state });
      })();
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
          ...(e.signals && Object.keys(e.signals).length ? { signals: e.signals } : {}),
          ...(e.policy ? { policy: e.policy } : {}),
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

    async askChat(text) {
      const input = text.trim();
      const s = client?.session;
      if (!input || !s || get().chat.busy) return;
      const user: ChatMsg = { id: ++chatId, role: "user", text: input.slice(0, 2000) };
      set((st) => ({ chat: { ...st.chat, messages: [...st.chat.messages, user], busy: true } }));
      try {
        const { reply, state } = await answerTurn(input, s, get().chat.state, { commit: (spec) => get().commit(spec), now: new Date().toISOString(), ai: aiClient });
        const bot: ChatMsg = { id: ++chatId, role: "assistant", text: reply.text, reply };
        set((st) => ({ chat: { messages: [...st.chat.messages, bot], state, busy: false } }));
        // The answer links to the affected application; its decision opens when you choose it, so the panel isn't covered.
      } catch {
        const bot: ChatMsg = { id: ++chatId, role: "assistant", text: "Something went wrong answering that. Nothing was changed. Please try again." };
        set((st) => ({ chat: { ...st.chat, messages: [...st.chat.messages, bot], busy: false } }));
      }
    },

    async retryReading() {
      const c = client;
      const s = c?.session;
      if (!c || !s || get().reading.status === "running") return;
      const have = { ...s.signals, ...effective(s).signals };
      const todo = s.parsed.applications.filter((a) => hasText(a) && !have[a.key]?.ai);
      if (!todo.length) {
        set({ reading: { status: "done", message: null } });
        return;
      }
      set({ reading: { status: "running", message: null } });
      const r = await readNotes(todo, { cache: localSignalCache });
      if (client !== c) return;
      if (r.read === 0) {
        set({ reading: { status: "failed", message: "The AI assistant isn't available right now. Try again in a minute." } });
        return;
      }
      const groups = chunkSignals(r.signals);
      let problem: string | null = null;
      groups.forEach((g, i) => {
        const n = Object.keys(g).length;
        const out = c.commit({ source: "ai_notes", description: `AI reading of notes (${n} application${n === 1 ? "" : "s"}${groups.length > 1 ? `, part ${i + 1} of ${groups.length}` : ""})`, signals: g });
        if (!out.ok) problem = out.message;
      });
      set({ reading: problem ? { status: "failed", message: problem } : r.complete ? { status: "done", message: null } : { status: "failed", message: `The AI read ${r.read} of ${r.total} applications this time. You can try again for the rest.` } });
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
      set({ workspaceId: null, reading: IDLE_READING, chat: NEW_CHAT_SLICE, chatOpen: false, session: null, sync: IDLE_SYNC, toasts: [], loadError: null, previous: null, compareOpen: false, lastChangeId: null, tab: "sheet", drawerKey: null, filters: NO_FILTERS });
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

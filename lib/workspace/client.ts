// The workspace client (SPEC §16.3): everything one open workspace needs, with no React in it.
//
//   state = base data + events replayed in seq order  (confirmed events, then ones not yet sent)
//
// Changes are applied at once and sent in order. If the server can't be reached, the app carries on from the
// device's copy, says so, retries with backoff and re-sends what's unsent in order. Every few seconds it asks for
// events it hasn't seen and shows the other viewers' changes.

import type { Signals } from "@/lib/types";
import { commitChange, type ChangeSpec, type ChangeEntry, type CommitOutcome, type Feedback, type Session } from "@/lib/state/session";
import type { CacheData, CacheStore } from "./cache";
import { orderLog, replayEntries, sessionFrom, type LogEvent } from "./replay";
import {
  ChangePayloadSchema,
  classifyChange,
  POLL_MS,
  type BaseData,
  type ChangePayload,
  type CreateWorkspace,
  type NewEvent,
  type StoredEvent,
  type UndoPayload,
} from "./schemas";
import type { Res, Transport } from "./transport";

export type SyncStatus = "loading" | "synced" | "syncing" | "offline" | "missing" | "error";

export const OFFLINE_MESSAGE = "Not syncing. Changes are saved on this device only";

export interface Toast {
  id: number;
  kind: "other" | "problem";
  text: string;
}

export interface LoadError {
  kind: "not_found" | "unreachable";
  message: string;
}

export interface ClientOptions {
  id: string;
  transport: Transport;
  cache: CacheStore;
  clientId?: string;
  now?: () => string;
  /** Called after any change a view should redraw for. */
  onChange?: () => void;
}

const rand = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export class WorkspaceClient {
  readonly id: string;
  readonly clientId: string;
  name = "";
  parentId: string | null = null;
  base: BaseData | null = null;
  private confirmed = new Map<number, LogEvent>();
  private pending: LogEvent[] = [];
  private polledSeq = 0;
  private createdOnServer = false;
  private feedback: Feedback[] = [];
  private reviewed = false;

  session: Session | null = null;
  status: SyncStatus = "loading";
  statusMessage: string | null = null;
  loadError: LoadError | null = null;
  toasts: Toast[] = [];
  /** The device couldn't keep a copy (storage unavailable or full). */
  cacheFailed = false;

  private failures = 0;
  private toastId = 0;
  private running = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private initialised = false;
  /** A new upload waits for the AI's reading of its notes before it is sent, so everyone starts from the same signals. */
  private held = false;

  private transport: Transport;
  private cache: CacheStore;
  private now: () => string;
  private onChange: () => void;

  constructor(o: ClientOptions) {
    this.id = o.id;
    this.transport = o.transport;
    this.cache = o.cache;
    this.clientId = o.clientId ?? `c${rand()}`;
    this.now = o.now ?? (() => new Date().toISOString());
    this.onChange = o.onChange ?? (() => {});
  }

  // ---------- Starting ----------

  /** A new workspace from an upload. It exists on this device at once and is sent as soon as it can be. */
  static fromUpload(
    o: ClientOptions & {
      base: BaseData;
      name: string;
      parentId: string | null;
      /** Changes to start with (resuming a saved session file). An undo points at the seed it undoes by index. */
      seed?: { type: LogEvent["type"]; payload: ChangePayload | UndoPayload; undoOfIndex?: number }[];
      feedback?: Feedback[];
      reviewed?: boolean;
      /** Don't send the workspace until `releaseHold` or `setSignals` (the AI is reading the notes). */
      holdSync?: boolean;
    },
  ): WorkspaceClient {
    const c = new WorkspaceClient(o);
    c.held = o.holdSync ?? false;
    c.base = o.base;
    c.name = o.name;
    c.parentId = o.parentId;
    c.feedback = o.feedback ?? [];
    c.reviewed = o.reviewed ?? false;
    c.initialised = true;
    c.status = "syncing";
    for (const s of o.seed ?? []) {
      const undoOf = s.undoOfIndex !== undefined ? (c.pending[s.undoOfIndex]?.clientEventId ?? undefined) : undefined;
      c.pending.push(c.makePending(s.type, s.payload, undoOf));
    }
    c.rebuild(false);
    c.save();
    return c;
  }

  /** Open an existing workspace: from this device's copy if there is one, otherwise from the server. */
  async open(): Promise<void> {
    const cached = this.cache.load(this.id);
    if (cached) {
      this.base = cached.base;
      this.name = cached.name;
      this.parentId = cached.parentId;
      this.confirmed = new Map(cached.confirmed.map((e) => [e.seq as number, e]));
      this.pending = cached.pending;
      this.polledSeq = cached.polledSeq;
      this.createdOnServer = cached.createdOnServer;
      this.feedback = cached.feedback;
      this.reviewed = cached.reviewed;
      this.initialised = true;
      this.status = "syncing";
      this.rebuild(false);
      return;
    }
    await this.initialLoad();
  }

  private async initialLoad(): Promise<void> {
    const res = await this.transport.get(this.id, 0);
    if (!res.ok) {
      if (res.kind === "not_found") {
        this.loadError = { kind: "not_found", message: res.message };
        this.status = "missing";
      } else {
        this.loadError = { kind: "unreachable", message: "This workspace can't be loaded right now. Check your connection; we'll keep trying." };
        this.status = "offline";
        this.failures++;
      }
      this.onChange();
      return;
    }
    const { workspace, baseData, events } = res.data;
    if (!baseData) {
      this.loadError = { kind: "unreachable", message: "This workspace's data couldn't be read." };
      this.status = "error";
      this.onChange();
      return;
    }
    this.loadError = null;
    this.base = baseData;
    this.name = workspace.name;
    this.parentId = workspace.parentId;
    this.createdOnServer = true;
    this.initialised = true;
    this.failures = 0;
    this.merge(events, false);
    if (res.data.more) await this.poll();
    this.status = "synced";
    this.rebuild(false);
    this.save();
  }

  start(): void {
    this.stopped = false;
    void this.kick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ---------- Views ----------

  get pendingCount(): number {
    return this.pending.length;
  }

  get entries(): ChangeEntry[] {
    return this.session?.entries ?? [];
  }

  private rebuild(emit = true): void {
    if (!this.base) return;
    const log = orderLog([...this.confirmed.values()], this.pending);
    const entries = replayEntries(this.base, log);
    this.session = sessionFrom(this.base, entries, { feedback: this.feedback, reviewed: this.reviewed });
    if (emit) this.onChange();
  }

  /** Rebuild the view, keep the device's copy, then tell the views (in that order, so they see whether saving worked). */
  private settle(): void {
    this.rebuild(false);
    this.save();
    this.onChange();
  }

  private save(): void {
    if (!this.base) return;
    const data: CacheData = {
      version: 1,
      id: this.id,
      name: this.name,
      parentId: this.parentId,
      base: this.base,
      confirmed: [...this.confirmed.values()],
      pending: this.pending,
      polledSeq: this.polledSeq,
      createdOnServer: this.createdOnServer,
      feedback: this.feedback,
      reviewed: this.reviewed,
    };
    this.cacheFailed = !this.cache.save(this.id, data);
  }

  // ---------- Local actions ----------

  private makePending(type: LogEvent["type"], payload: ChangePayload | UndoPayload, undoOf?: string): LogEvent {
    return { seq: null, createdAt: this.now(), type, payload, clientId: this.clientId, clientEventId: `e${rand()}${this.pending.length}`, ...(undoOf ? { undoOf } : {}) };
  }

  /** Check a change against the rules, then make it. The decisions move at once; sending follows. */
  commit(spec: ChangeSpec): CommitOutcome {
    if (!this.session) return { ok: false, message: "No workspace is open." };
    const checked = commitChange(this.session, spec, this.now());
    if (!checked.ok) return checked;
    const payload: ChangePayload = {
      source: spec.source,
      description: spec.description,
      ...(spec.facts?.length ? { facts: spec.facts } : {}),
      ...(spec.locks?.length ? { locks: spec.locks } : {}),
      ...(spec.overrides?.length ? { overrides: spec.overrides } : {}),
      ...(spec.set && Object.keys(spec.set).length ? { set: spec.set } : {}),
      ...(spec.signals && Object.keys(spec.signals).length ? { signals: spec.signals } : {}),
      ...(spec.policy ? { policy: spec.policy } : {}),
      ...(spec.directKeys?.length ? { directKeys: spec.directKeys } : {}),
    };
    const valid = ChangePayloadSchema.safeParse(payload);
    if (!valid.success) return { ok: false, message: `That change isn't allowed: ${valid.error.issues[0].message}.` };
    const ev = this.makePending(classifyChange(valid.data), valid.data);
    this.pending.push(ev);
    this.settle();
    void this.kick();
    const entry = this.entries.find((e) => e.id === ev.clientEventId)!;
    return { ok: true, session: this.session!, diff: entry.diff, entry };
  }

  undo(entryId: string): void {
    const target = this.entries.find((e) => e.id === entryId);
    if (!target || target.undone) return;
    this.pending.push(this.makePending("undo", { targetSeq: 0 }, entryId));
    this.settle();
    void this.kick();
  }

  addFeedback(f: Feedback): void {
    this.feedback = [...this.feedback, f];
    this.settle();
  }

  continueReview(): void {
    this.reviewed = true;
    this.settle();
  }

  /** The AI's reading arrived: it becomes part of the workspace's starting data, and sending can begin. */
  setSignals(signals: Record<string, Signals>): void {
    if (this.base && Object.keys(signals).length) this.base = { ...this.base, signals: { ...this.base.signals, ...signals } };
    this.releaseHold();
  }

  /** Start sending (the reading finished, failed or timed out). */
  releaseHold(): void {
    const was = this.held;
    this.held = false;
    this.settle();
    if (was) void this.kick();
  }

  get isHeld(): boolean {
    return this.held;
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.onChange();
  }

  private toast(kind: Toast["kind"], text: string): void {
    this.toasts = [...this.toasts.slice(-4), { id: ++this.toastId, kind, text }];
  }

  // ---------- Syncing ----------

  /** Run a sync round now (or right after the current one). */
  async kick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = true;
    try {
      do {
        this.again = false;
        await this.round();
      } while (this.again && !this.stopped);
    } finally {
      this.running = false;
    }
    if (!this.stopped) this.schedule();
  }

  private schedule(): void {
    const delay = this.failures > 0 ? Math.min(30_000, 1000 * 2 ** Math.min(this.failures, 5)) : POLL_MS;
    this.timer = setTimeout(() => void this.kick(), delay);
  }

  /** One round: load if never loaded, create if not yet on the server, send unsent changes, then fetch others'. */
  async round(): Promise<void> {
    if (!this.initialised) {
      await this.initialLoad();
      return;
    }
    const sent = await this.flush();
    if (!sent) return;
    await this.poll();
  }

  private offline(res: Extract<Res<unknown>, { ok: false }>): void {
    this.failures++;
    this.status = "offline";
    this.statusMessage = OFFLINE_MESSAGE;
    void res;
    this.onChange();
  }

  private setSynced(): void {
    this.failures = 0;
    this.statusMessage = null;
    this.status = this.pending.length ? "syncing" : "synced";
    this.onChange();
  }

  /** Create the workspace if needed, then send unsent changes in order. Returns false if sending has to wait. */
  async flush(): Promise<boolean> {
    if (!this.base || this.held) return false;
    if (!this.createdOnServer) {
      const body: CreateWorkspace & { id: string } = {
        id: this.id,
        name: this.name,
        brandProfile: this.base.policy.id,
        sourceFilename: this.base.files[0] ?? null,
        rowCounts: { applications: this.base.parsed.applications.length, territories: this.base.parsed.territories.length },
        parentId: this.parentId,
        baseData: this.base,
      };
      const res = await this.transport.create(body);
      if (!res.ok) {
        if (res.kind === "network") {
          this.offline(res);
          return false;
        }
        // The server refused the data itself (for example, too large): it stays on this device.
        this.status = "error";
        this.statusMessage = `This workspace can't be shared: ${res.message} It is saved on this device only.`;
        this.failures = 0;
        this.onChange();
        return false;
      }
      this.createdOnServer = true;
      this.save();
    }

    while (this.pending.length) {
      const ev = this.pending[0];
      let out: NewEvent;
      if (ev.type === "undo") {
        const targetId = ev.undoOf;
        const target = targetId ? [...this.confirmed.values()].find((c) => (c.clientEventId ?? `s${c.seq}`) === targetId) : undefined;
        if (!target || target.seq === null) {
          // The change it undoes was never saved (the server refused it), so there is nothing to undo.
          this.pending.shift();
          continue;
        }
        out = { type: "undo", payload: { targetSeq: target.seq }, clientId: this.clientId, clientEventId: ev.clientEventId as string };
      } else {
        out = { type: ev.type, payload: ev.payload as ChangePayload, clientId: this.clientId, clientEventId: ev.clientEventId as string } as NewEvent;
      }
      const res = await this.transport.post(this.id, out);
      if (!res.ok) {
        if (res.kind === "network") {
          this.offline(res);
          return false;
        }
        if (res.kind === "not_found") {
          // The server lost the workspace (or never had it): send the data again, then the changes.
          this.createdOnServer = false;
          return this.flush();
        }
        // Refused for what it says: drop it, tell the user, and carry on with the rest.
        this.pending.shift();
        this.toast("problem", `A change couldn't be saved: ${res.message}`);
        this.settle();
        continue;
      }
      this.pending.shift();
      this.confirmed.set(res.data.seq, { ...ev, payload: out.payload, seq: res.data.seq, createdAt: res.data.createdAt });
      this.settle();
    }
    this.setSynced();
    return true;
  }

  /** Merge events from the server. Ours that are already confirmed are skipped; ours still pending are confirmed. */
  private merge(events: StoredEvent[], announce: boolean): { foreign: LogEvent[] } {
    const foreign: LogEvent[] = [];
    for (const e of events) {
      this.polledSeq = Math.max(this.polledSeq, e.seq);
      if (this.confirmed.has(e.seq)) continue;
      const ev: LogEvent = { seq: e.seq, createdAt: e.createdAt, type: e.type, payload: e.payload, clientId: e.clientId, clientEventId: e.clientEventId };
      const mine = e.clientId === this.clientId ? this.pending.findIndex((p) => p.clientEventId === e.clientEventId) : -1;
      if (mine >= 0) {
        // Our own change came back before the reply did.
        ev.undoOf = this.pending[mine].undoOf;
        this.pending.splice(mine, 1);
      } else if (e.clientId !== this.clientId) {
        foreign.push(ev);
      }
      this.confirmed.set(e.seq, ev);
    }
    void announce;
    return { foreign };
  }

  async poll(): Promise<void> {
    for (let page = 0; page < 20; page++) {
      const res = await this.transport.get(this.id, this.polledSeq, false);
      if (!res.ok) {
        if (res.kind === "network") this.offline(res);
        else if (res.kind === "not_found") {
          this.status = "missing";
          this.statusMessage = "This workspace is no longer on the server. Your copy is saved on this device.";
          this.onChange();
        }
        return;
      }
      const { foreign } = this.merge(res.data.events, true);
      if (res.data.events.length) {
        this.rebuild(false);
        for (const ev of foreign) this.toast("other", this.describeForeign(ev));
        this.settle();
      }
      this.setSynced();
      if (!res.data.more) return;
    }
  }

  private describeForeign(ev: LogEvent): string {
    const entries = this.entries;
    if (ev.type === "undo") {
      const target = this.confirmed.get((ev.payload as UndoPayload).targetSeq);
      const entry = target ? entries.find((e) => e.id === (target.clientEventId ?? `s${target.seq}`)) : undefined;
      return `Updated by another viewer: undid "${entry?.description ?? "an earlier change"}".`;
    }
    const entry = entries.find((e) => e.id === (ev.clientEventId ?? `s${ev.seq}`));
    const what = entry?.description ?? (ev.payload as ChangePayload).description;
    return `Updated by another viewer: ${what}. ${entry?.diff.text ?? ""}`.trim();
  }
}

// Storage behind the workspace routes. One interface, two implementations: Supabase (production) and an
// in-memory one (tests, and local development without a database key). Server-side only.

import type { BaseData, CreateWorkspace, NewEvent, StoredEvent, WorkspaceSummary } from "@/lib/workspace/schemas";
import { MAX_EVENTS_PER_WORKSPACE } from "@/lib/workspace/schemas";

export type AppendResult = { ok: true; seq: number; createdAt: string; duplicate: boolean } | { ok: false; reason: "not_found" | "full" };

export interface WorkspaceRepo {
  createWorkspace(input: CreateWorkspace & { id: string }): Promise<{ id: string; createdAt: string; existed: boolean }>;
  listRecent(limit: number): Promise<WorkspaceSummary[]>;
  getWorkspace(id: string, withBase: boolean): Promise<{ summary: WorkspaceSummary; baseData?: BaseData } | null>;
  listEvents(id: string, since: number, limit: number): Promise<{ events: StoredEvent[]; more: boolean }>;
  getEvent(id: string, seq: number): Promise<StoredEvent | null>;
  appendEvent(id: string, ev: NewEvent): Promise<AppendResult>;
  ping(): Promise<void>;
}

interface MemWorkspace {
  summary: WorkspaceSummary;
  baseData: BaseData;
  events: StoredEvent[];
  nextSeq: number;
}

/** In-memory repository. `failing` simulates the database being down (G10.3). */
export class MemoryRepo implements WorkspaceRepo {
  readonly workspaces = new Map<string, MemWorkspace>();
  failing = false;
  /** Every write, in order: lets tests prove an existing workspace is never modified (G10.6). */
  writes: string[] = [];

  private check() {
    if (this.failing) throw new Error("database unavailable");
  }

  async createWorkspace(input: CreateWorkspace & { id: string }) {
    this.check();
    const existing = this.workspaces.get(input.id);
    if (existing) return { id: input.id, createdAt: existing.summary.createdAt, existed: true };
    const createdAt = new Date().toISOString();
    this.writes.push(`create ${input.id}`);
    this.workspaces.set(input.id, {
      summary: {
        id: input.id,
        name: input.name,
        createdAt,
        brandProfile: input.brandProfile,
        sourceFilename: input.sourceFilename ?? null,
        rowCounts: input.rowCounts,
        parentId: input.parentId ?? null,
      },
      baseData: structuredClone(input.baseData),
      events: [],
      nextSeq: 1,
    });
    return { id: input.id, createdAt, existed: false };
  }

  async listRecent(limit: number) {
    this.check();
    return [...this.workspaces.values()]
      .map((w) => w.summary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async getWorkspace(id: string, withBase: boolean) {
    this.check();
    const w = this.workspaces.get(id);
    if (!w) return null;
    return { summary: w.summary, ...(withBase ? { baseData: structuredClone(w.baseData) } : {}) };
  }

  async listEvents(id: string, since: number, limit: number) {
    this.check();
    const w = this.workspaces.get(id);
    if (!w) return { events: [], more: false };
    const after = w.events.filter((e) => e.seq > since);
    return { events: after.slice(0, limit), more: after.length > limit };
  }

  async getEvent(id: string, seq: number) {
    this.check();
    return this.workspaces.get(id)?.events.find((e) => e.seq === seq) ?? null;
  }

  async appendEvent(id: string, ev: NewEvent): Promise<AppendResult> {
    this.check();
    const w = this.workspaces.get(id);
    if (!w) return { ok: false, reason: "not_found" };
    const dup = w.events.find((e) => e.clientId === ev.clientId && e.clientEventId === ev.clientEventId);
    if (dup) return { ok: true, seq: dup.seq, createdAt: dup.createdAt, duplicate: true };
    if (w.nextSeq > MAX_EVENTS_PER_WORKSPACE) return { ok: false, reason: "full" };
    const seq = w.nextSeq++;
    const createdAt = new Date().toISOString();
    this.writes.push(`event ${id} ${seq}`);
    w.events.push({ seq, createdAt, type: ev.type, payload: structuredClone(ev.payload), clientId: ev.clientId, clientEventId: ev.clientEventId });
    return { ok: true, seq, createdAt, duplicate: false };
  }

  async ping() {
    this.check();
  }
}

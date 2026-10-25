// How the client talks to the workspace API. An interface, so the sync logic can be tested with a fake network
// (G10.3). The real one is plain fetch to our own server routes: the browser never talks to Supabase.

import type { BaseData, CreateWorkspace, NewEvent, StoredEvent, WorkspaceSummary } from "./schemas";

export type Res<T> =
  | { ok: true; data: T }
  /** network: unreachable, 5xx or rate-limited (try again later). rejected: the server refused the content. */
  | { ok: false; kind: "network" | "rejected" | "not_found" | "limit"; message: string; notConfigured?: boolean };

export interface WorkspaceGet {
  workspace: WorkspaceSummary;
  baseData: BaseData | null;
  events: StoredEvent[];
  more: boolean;
}

export interface Transport {
  create(body: CreateWorkspace & { id: string }): Promise<Res<{ id: string; existed: boolean }>>;
  /** `withBase: false` asks for new events only (a poll), even when `since` is 0. */
  get(id: string, since: number, withBase?: boolean): Promise<Res<WorkspaceGet>>;
  post(id: string, ev: NewEvent): Promise<Res<{ seq: number; createdAt: string; duplicate: boolean }>>;
  list(): Promise<Res<{ workspaces: WorkspaceSummary[] }>>;
}

const TIMEOUT_MS = 10_000;

async function call<T>(url: string, init?: RequestInit): Promise<Res<T>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & T;
    if (res.ok) return { ok: true, data: body as T };
    const message = body.error ?? `The server answered ${res.status}.`;
    if (res.status === 404) return { ok: false, kind: "not_found", message };
    if (res.status === 409) return { ok: false, kind: "limit", message };
    if (res.status === 400 || res.status === 413) return { ok: false, kind: "rejected", message };
    return { ok: false, kind: "network", message, notConfigured: body.code === "not_configured" };
  } catch {
    return { ok: false, kind: "network", message: "The server can't be reached." };
  } finally {
    clearTimeout(timer);
  }
}

export const httpTransport: Transport = {
  create: (body) => call("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  get: (id, since, withBase = true) => call(`/api/workspaces/${encodeURIComponent(id)}?since=${since}${withBase ? "" : "&base=0"}`),
  post: (id, ev) => call(`/api/workspaces/${encodeURIComponent(id)}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ev) }),
  list: () => call("/api/workspaces"),
};

import "server-only";

// Supabase Postgres, reached only from server routes with the service role key (SPEC §16.1). RLS is on with no
// policies, so nothing else can read these tables.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BaseData, CreateWorkspace, NewEvent, StoredEvent, WorkspaceSummary } from "@/lib/workspace/schemas";
import type { AppendResult, WorkspaceRepo } from "./repo";

interface WorkspaceRow {
  id: string;
  created_at: string;
  name: string;
  brand_profile: string;
  source_filename: string | null;
  row_counts: { applications: number; territories: number };
  parent_id: string | null;
}
interface EventRow {
  seq: number;
  created_at: string;
  type: StoredEvent["type"];
  payload: StoredEvent["payload"];
  client_id: string | null;
  client_event_id: string | null;
}

const SUMMARY_COLUMNS = "id, created_at, name, brand_profile, source_filename, row_counts, parent_id";
const EVENT_COLUMNS = "seq, created_at, type, payload, client_id, client_event_id";

const summaryOf = (r: WorkspaceRow): WorkspaceSummary => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  brandProfile: r.brand_profile,
  sourceFilename: r.source_filename,
  rowCounts: r.row_counts,
  parentId: r.parent_id,
});
const eventOf = (r: EventRow): StoredEvent => ({
  seq: r.seq,
  createdAt: r.created_at,
  type: r.type,
  payload: r.payload,
  clientId: r.client_id,
  clientEventId: r.client_event_id,
});

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

export class SupabaseRepo implements WorkspaceRepo {
  private db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async createWorkspace(input: CreateWorkspace & { id: string }): Promise<{ id: string; createdAt: string; existed: boolean }> {
    const { data, error } = await this.db
      .from("workspaces")
      .insert({
        id: input.id,
        name: input.name,
        brand_profile: input.brandProfile,
        base_data: input.baseData,
        source_filename: input.sourceFilename ?? null,
        row_counts: input.rowCounts,
        parent_id: input.parentId ?? null,
      })
      .select("id, created_at")
      .single();
    if (error) {
      if (error.code === "23505") {
        // Already there (a retried create). Never modified.
        const existing = await this.db.from("workspaces").select("id, created_at").eq("id", input.id).single();
        if (existing.error) fail("create workspace", existing.error);
        return { id: input.id, createdAt: existing.data.created_at as string, existed: true };
      }
      if (error.code === "23503") {
        // The parent workspace doesn't exist: store the link as empty rather than refuse the upload.
        return this.createWorkspace({ ...input, parentId: null });
      }
      fail("create workspace", error);
    }
    return { id: data.id as string, createdAt: data.created_at as string, existed: false };
  }

  async listRecent(limit: number) {
    const { data, error } = await this.db.from("workspaces").select(SUMMARY_COLUMNS).order("created_at", { ascending: false }).limit(limit);
    if (error) fail("list workspaces", error);
    return (data as WorkspaceRow[]).map(summaryOf);
  }

  async getWorkspace(id: string, withBase: boolean) {
    const { data, error } = await this.db
      .from("workspaces")
      .select(withBase ? `${SUMMARY_COLUMNS}, base_data` : SUMMARY_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) fail("get workspace", error);
    if (!data) return null;
    const row = data as unknown as WorkspaceRow & { base_data?: BaseData };
    return { summary: summaryOf(row), ...(withBase ? { baseData: row.base_data } : {}) };
  }

  async listEvents(id: string, since: number, limit: number) {
    const { data, error } = await this.db
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("workspace_id", id)
      .gt("seq", since)
      .order("seq", { ascending: true })
      .limit(limit + 1);
    if (error) fail("list events", error);
    const rows = data as EventRow[];
    return { events: rows.slice(0, limit).map(eventOf), more: rows.length > limit };
  }

  async getEvent(id: string, seq: number) {
    const { data, error } = await this.db.from("events").select(EVENT_COLUMNS).eq("workspace_id", id).eq("seq", seq).maybeSingle();
    if (error) fail("get event", error);
    return data ? eventOf(data as EventRow) : null;
  }

  async appendEvent(id: string, ev: NewEvent, retried = false): Promise<AppendResult> {
    const { data, error } = await this.db.rpc("append_event", {
      p_workspace: id,
      p_type: ev.type,
      p_payload: ev.payload,
      p_client_id: ev.clientId,
      p_client_event_id: ev.clientEventId,
    });
    if (error) {
      if (error.code === "P0002") return { ok: false, reason: "not_found" };
      if (error.code === "P0001") return { ok: false, reason: "full" };
      // Two identical retries at the same moment: the second finds the first and reports a duplicate.
      if (error.code === "23505" && !retried) return this.appendEvent(id, ev, true);
      fail("append event", error);
    }
    const row = (data as { seq: number; created_at: string; duplicate: boolean }[])[0];
    return { ok: true, seq: row.seq, createdAt: row.created_at, duplicate: row.duplicate };
  }

  async ping() {
    const { error } = await this.db.from("workspaces").select("id").limit(1);
    if (error) fail("ping", error);
  }
}

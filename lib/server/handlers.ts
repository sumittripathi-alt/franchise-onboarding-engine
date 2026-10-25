// The workspace API as plain functions: input in, status and body out. The route files only read the
// request and pick the repository, so everything that matters is tested without a server (G10.1 to G10.6).

import { z } from "zod";
import type { WorkspaceRepo } from "./repo";
import {
  classifyChange,
  CreateWorkspaceSchema,
  MAX_BASE_BYTES,
  MAX_EVENT_BYTES,
  NewEventSchema,
  RECENT_LIMIT,
  UuidSchema,
  type ChangePayload,
  type NewEvent,
} from "@/lib/workspace/schemas";

export interface Reply {
  status: number;
  body: unknown;
}

const err = (status: number, message: string, extra: Record<string, unknown> = {}): Reply => ({ status, body: { error: message, ...extra } });

function describeIssues(error: z.ZodError): string {
  const i = error.issues[0];
  const path = i.path.length ? `${i.path.join(".")}: ` : "";
  const more = error.issues.length > 1 ? ` (and ${error.issues.length - 1} more)` : "";
  return `${path}${i.message}${more}`;
}

function parseJson(text: string, limit: number, what: string): { ok: true; value: unknown } | { ok: false; reply: Reply } {
  if (new TextEncoder().encode(text).length > limit) {
    return { ok: false, reply: err(413, `${what} is too large. The limit is ${limit >= 1024 * 1024 ? `${limit / (1024 * 1024)} MB` : `${limit / 1024} KB`}.`) };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reply: err(400, `${what} is not valid JSON.`) };
  }
}

export async function createWorkspace(repo: WorkspaceRepo, bodyText: string): Promise<Reply> {
  const json = parseJson(bodyText, MAX_BASE_BYTES, "The uploaded data");
  if (!json.ok) return json.reply;
  const parsed = CreateWorkspaceSchema.safeParse(json.value);
  if (!parsed.success) return err(400, `The uploaded data isn't valid. ${describeIssues(parsed.error)}`);
  const id = parsed.data.id ?? crypto.randomUUID();
  const out = await repo.createWorkspace({ ...parsed.data, id });
  // An id that already exists is left exactly as it was (G10.6): the client is told, and nothing is written.
  return { status: out.existed ? 200 : 201, body: { id: out.id, createdAt: out.createdAt, existed: out.existed } };
}

export async function listWorkspaces(repo: WorkspaceRepo): Promise<Reply> {
  return { status: 200, body: { workspaces: await repo.listRecent(RECENT_LIMIT) } };
}

const SinceSchema = z.coerce.number().int().min(0).max(1_000_000);
const EVENT_PAGE = 1000;

/** `since=0` (the default) returns the workspace's data too; a poll passes `base=0` to get only new events. */
export async function getWorkspace(repo: WorkspaceRepo, id: string, sinceParam: string | null, baseParam: string | null = null): Promise<Reply> {
  if (!UuidSchema.safeParse(id).success) return err(400, "That isn't a valid workspace link.");
  const since = SinceSchema.safeParse(sinceParam ?? 0);
  if (!since.success) return err(400, "since must be a whole number, 0 or more.");
  const ws = await repo.getWorkspace(id, since.data === 0 && baseParam !== "0");
  if (!ws) return err(404, "This workspace doesn't exist. Check the link, or start a new one.");
  const { events, more } = await repo.listEvents(id, since.data, EVENT_PAGE);
  return { status: 200, body: { workspace: ws.summary, baseData: ws.baseData ?? null, events, more } };
}

export async function appendEvent(repo: WorkspaceRepo, id: string, bodyText: string): Promise<Reply> {
  if (!UuidSchema.safeParse(id).success) return err(400, "That isn't a valid workspace link.");
  const json = parseJson(bodyText, MAX_EVENT_BYTES, "That change");
  if (!json.ok) return json.reply;
  const parsed = NewEventSchema.safeParse(json.value);
  if (!parsed.success) return err(400, `That change isn't valid. ${describeIssues(parsed.error)}`);
  const ev = parsed.data as NewEvent;

  if (ev.type === "undo") {
    // Only a real change can be undone, never another undo.
    const target = await repo.getEvent(id, ev.payload.targetSeq);
    if (!target) return err(400, `That change isn't valid. There is no event ${ev.payload.targetSeq} in this workspace to undo.`);
    if (target.type === "undo") return err(400, "That change isn't valid. An undo can't be undone; make the change again instead.");
  } else if (classifyChange(ev.payload as ChangePayload) !== ev.type) {
    return err(400, `That change isn't valid. It is labelled "${ev.type}" but it contains a "${classifyChange(ev.payload as ChangePayload)}" change.`);
  }

  const out = await repo.appendEvent(id, ev);
  if (!out.ok) {
    return out.reason === "not_found"
      ? err(404, "This workspace doesn't exist. Check the link, or start a new one.")
      : err(409, "This workspace has reached its limit of 5,000 changes. Start a new workspace to keep going.");
  }
  return { status: out.duplicate ? 200 : 201, body: { seq: out.seq, createdAt: out.createdAt, duplicate: out.duplicate } };
}

export async function health(repo: WorkspaceRepo | null, configured: boolean): Promise<Record<string, unknown>> {
  let reachable = false;
  if (repo) {
    try {
      await Promise.race([repo.ping(), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 3000))]);
      reachable = true;
    } catch {
      reachable = false;
    }
  }
  return { ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY), dbConfigured: configured, dbReachable: reachable };
}

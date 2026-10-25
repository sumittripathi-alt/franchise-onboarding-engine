import "server-only";

import { MemoryRepo, type WorkspaceRepo } from "./repo";
import { SupabaseRepo } from "./supabaseRepo";

let cached: WorkspaceRepo | null | undefined;
let memory: MemoryRepo | undefined;

/** True when the server has what it needs to reach the database. */
export function dbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * The repository the routes use. Production uses Supabase. For local development without a database key,
 * FPE_MEMORY_DB=1 uses an in-memory store (never in production). With neither, there is no repository and
 * the routes answer 503, and the app keeps working on the device.
 */
export function getRepo(): WorkspaceRepo | null {
  if (cached !== undefined) return cached;
  if (dbConfigured()) cached = new SupabaseRepo(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
  else if (process.env.FPE_MEMORY_DB === "1" && process.env.NODE_ENV !== "production") cached = memory ??= new MemoryRepo();
  else cached = null;
  return cached;
}

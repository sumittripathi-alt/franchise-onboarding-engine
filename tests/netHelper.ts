// A fake network wired straight to the route handlers, for client-side tests.
import { appendEvent, createWorkspace, getWorkspace } from "@/lib/server/handlers";
import type { MemoryRepo } from "@/lib/server/repo";
import type { Res, Transport } from "@/lib/workspace/transport";

export function networkFor(repo: MemoryRepo): Transport {
  const call = async <T,>(f: () => Promise<{ status: number; body: unknown }>): Promise<Res<T>> => {
    try {
      const r = await f();
      if (r.status < 300) return { ok: true, data: r.body as T };
      const message = (r.body as { error?: string }).error ?? "";
      return { ok: false, kind: r.status === 404 ? "not_found" : r.status === 400 || r.status === 413 ? "rejected" : "network", message };
    } catch {
      return { ok: false, kind: "network", message: "down" };
    }
  };
  return {
    create: (b) => call(() => createWorkspace(repo, JSON.stringify(b))),
    get: (id, since, withBase = true) => call(() => getWorkspace(repo, id, String(since), withBase ? null : "0")),
    post: (id, e) => call(() => appendEvent(repo, id, JSON.stringify(e))),
    list: async () => ({ ok: true, data: { workspaces: [] } }),
  };
}

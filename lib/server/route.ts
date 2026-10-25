import "server-only";

// Shared by the route files: pick the repository, apply the rate limit, turn a handler's reply into a Response,
// and turn a database failure into a calm 503 (the app then keeps working on the device).

import { connection } from "next/server";
import { checkRate, clientIp, type Bucket } from "./rateLimit";
import { getRepo } from "./getRepo";
import type { Reply } from "./handlers";
import type { WorkspaceRepo } from "./repo";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(reply: Reply, headers: Record<string, string> = {}): Response {
  return Response.json(reply.body, { status: reply.status, headers: { ...NO_STORE, ...headers } });
}

export async function withRepo(req: Request, bucket: Bucket, run: (repo: WorkspaceRepo) => Promise<Reply>): Promise<Response> {
  await connection();
  const wait = checkRate(clientIp(req.headers), bucket);
  if (wait) return json({ status: 429, body: { error: `Too many requests. Try again in ${wait} seconds.` } }, { "Retry-After": String(wait) });
  const repo = getRepo();
  if (!repo) return json({ status: 503, body: { error: "Shared workspaces aren't set up on this server.", code: "not_configured" } });
  try {
    return json(await run(repo));
  } catch {
    // The reason stays in the server logs; the client only learns that it can't reach the database.
    return json({ status: 503, body: { error: "The database can't be reached right now.", code: "unreachable" } });
  }
}

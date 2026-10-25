import { appendEvent } from "@/lib/server/handlers";
import { withRepo } from "@/lib/server/route";

export async function POST(req: Request, ctx: RouteContext<"/api/workspaces/[id]/events">) {
  const { id } = await ctx.params;
  return withRepo(req, "write", async (repo) => appendEvent(repo, id, await req.text()));
}

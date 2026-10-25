import { getWorkspace } from "@/lib/server/handlers";
import { withRepo } from "@/lib/server/route";

export async function GET(req: Request, ctx: RouteContext<"/api/workspaces/[id]">) {
  const { id } = await ctx.params;
  const params = new URL(req.url).searchParams;
  return withRepo(req, "read", (repo) => getWorkspace(repo, id, params.get("since"), params.get("base")));
}

import { createWorkspace, listWorkspaces } from "@/lib/server/handlers";
import { withRepo } from "@/lib/server/route";

export async function GET(req: Request) {
  return withRepo(req, "read", (repo) => listWorkspaces(repo));
}

export async function POST(req: Request) {
  return withRepo(req, "create", async (repo) => createWorkspace(repo, await req.text()));
}

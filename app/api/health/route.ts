import { connection } from "next/server";
import { health } from "@/lib/server/handlers";
import { dbConfigured, getRepo } from "@/lib/server/getRepo";

// Uptime check (G7.5). Reports whether the AI key and the database are configured and reachable, never any key.
export async function GET() {
  await connection();
  return Response.json(await health(getRepo(), dbConfigured()), { headers: { "Cache-Control": "no-store" } });
}

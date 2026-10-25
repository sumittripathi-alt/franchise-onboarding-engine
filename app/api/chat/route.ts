import { chat } from "@/lib/llm/handlers";
import { withAi } from "@/lib/server/aiRoute";

export const maxDuration = 40;

export async function POST(req: Request) {
  return withAi(req, (gemini, body) => chat(gemini, body));
}

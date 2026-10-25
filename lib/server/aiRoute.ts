import "server-only";

// Shared by the AI route files: rate limit, read the body (capped), call the pure handler with the real model
// (or none), and answer. A missing key or a model failure is a calm 503/502 the client turns into a fallback.

import { connection } from "next/server";
import { getGemini } from "@/lib/llm/gemini";
import type { GeminiClient } from "@/lib/llm/client";
import { checkRate, clientIp } from "./rateLimit";
import { json } from "./route";
import type { Reply } from "./handlers";

const MAX_BODY = 64 * 1024;

export async function withAi(req: Request, run: (gemini: GeminiClient | null, body: string) => Promise<Reply>): Promise<Response> {
  await connection();
  const wait = checkRate(clientIp(req.headers), "ai");
  if (wait) return json({ status: 429, body: { error: `Too many requests. Try again in ${wait} seconds.` } }, { "Retry-After": String(wait) });
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ status: 413, body: { error: "That request is too large." } });
  try {
    return json(await run(getGemini(), text));
  } catch {
    return json({ status: 502, body: { error: "The AI service failed.", code: "ai_failed" } });
  }
}

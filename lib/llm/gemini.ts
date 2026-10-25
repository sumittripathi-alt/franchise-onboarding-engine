import "server-only";

// Gemini over plain REST (SPEC §8): 15-second timeout, one retry, temperature 0, structured output or forced
// function calling. The key stays on the server. Failures are logged with no applicant data and no key.

import { GeminiError, type GeminiClient, type GenRequest, type GenResult } from "./client";

const TIMEOUT_MS = 15_000;
const DEFAULT_MODEL = "gemini-flash-latest";

export function aiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function getGemini(): GeminiClient | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new RestGemini(key, process.env.GEMINI_MODEL || DEFAULT_MODEL);
}

interface Part {
  text?: string;
  functionCall?: { name: string; args?: unknown };
}

class RestGemini implements GeminiClient {
  constructor(
    private key: string,
    readonly model: string,
  ) {}

  async generate(req: GenRequest): Promise<GenResult> {
    let last: GeminiError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.once(req);
      } catch (e) {
        last = e instanceof GeminiError ? e : new GeminiError("The AI service failed.", true);
        if (!last.retryable) break;
      }
    }
    console.warn(`[gemini] failed: ${last?.message}`); // no key, no applicant text
    throw last ?? new GeminiError("The AI service failed.", false);
  }

  private async once(req: GenRequest): Promise<GenResult> {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.contents.map((c) => ({ role: c.role, parts: [{ text: c.text }] })),
      generationConfig: {
        temperature: 0,
        maxOutputTokens: req.maxOutputTokens ?? 2048,
        thinkingConfig: { thinkingLevel: "low" },
        ...(req.schema ? { responseMimeType: "application/json", responseJsonSchema: req.schema } : {}),
      },
    };
    if (req.tools) {
      body.tools = [{ functionDeclarations: req.tools }];
      body.toolConfig = { functionCallingConfig: { mode: "ANY" } };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.key },
        body: JSON.stringify(body),
        signal: ctl.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new GeminiError(`HTTP ${res.status}`, res.status === 429 || res.status >= 500);
      const data = (await res.json()) as { candidates?: { content?: { parts?: Part[] } }[] };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const call = parts.find((p) => p.functionCall)?.functionCall;
      const text = parts.map((p) => p.text ?? "").join("") || null;
      return { text, call: call ? { name: call.name, args: call.args ?? {} } : null };
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      throw new GeminiError(e instanceof Error && e.name === "AbortError" ? "timeout" : "network", true);
    } finally {
      clearTimeout(timer);
    }
  }
}

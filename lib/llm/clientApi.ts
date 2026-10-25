// The browser's side of the AI routes. Every call can fail, time out or be switched off, and every caller has a
// fallback: nothing here ever throws, and nothing is retried silently in a way that could change a decision.

import type { Signals } from "@/lib/types";
import type { ToolCall } from "./tools";

async function post<T>(path: string, body: unknown, ms: number, signal?: AbortSignal): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  signal?.addEventListener("abort", () => ctl.abort(), { once: true });
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal, cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (res.ok) return { ok: true, data };
    return { ok: false, status: res.status, message: data.error ?? `The server answered ${res.status}.` };
  } catch {
    return { ok: false, status: 0, message: "The AI service can't be reached." };
  } finally {
    clearTimeout(timer);
  }
}

export type RouteResult = { kind: "call"; call: ToolCall } | { kind: "declined" } | { kind: "unavailable" };
export type PhraseResult = { kind: "ok"; answer: string; model: string } | { kind: "ungrounded" } | { kind: "unavailable" };

export interface AiClient {
  route(message: string, history: { role: "user" | "model"; text: string }[], lastApp: string | null): Promise<RouteResult>;
  phrase(question: string, facts: string, brand: string): Promise<PhraseResult>;
}

export const aiClient: AiClient = {
  async route(message, history, lastApp) {
    const r = await post<{ call?: ToolCall; declined?: boolean }>("/api/chat", { mode: "route", message, history, ...(lastApp ? { lastApp } : {}) }, 12_000);
    if (!r.ok) return { kind: "unavailable" };
    if (r.data.declined) return { kind: "declined" };
    return r.data.call ? { kind: "call", call: r.data.call } : { kind: "unavailable" };
  },
  async phrase(question, facts, brand) {
    const r = await post<{ answer?: string | null; model?: string; ungrounded?: string[] }>("/api/chat", { mode: "phrase", question, facts, brand }, 12_000);
    if (!r.ok) return { kind: "unavailable" };
    if (!r.data.answer) return { kind: "ungrounded" };
    return { kind: "ok", answer: r.data.answer, model: r.data.model ?? "" };
  },
};

export interface ExtractItem {
  id: string;
  business: string;
  notes: string;
}

export interface ExtractBatch {
  ok: boolean;
  results: Record<string, Signals>;
  model: string | null;
}

export async function extractBatch(items: ExtractItem[], signal?: AbortSignal): Promise<ExtractBatch> {
  const r = await post<{ results: Record<string, Signals>; model: string }>("/api/extract", { items }, 24_000, signal);
  return r.ok ? { ok: true, results: r.data.results, model: r.data.model } : { ok: false, results: {}, model: null };
}

export interface DraftRequest {
  appId: string;
  firstName: string;
  language: "Kannada" | "Hindi" | "English";
  status: string;
  label: string;
  headline: string;
  steps: string[];
  questions: string[];
}

export type DraftResult = { kind: "ok"; message: string; backTranslation: string; model: string } | { kind: "rejected"; reason: string } | { kind: "unavailable" };

export async function draftMessageAi(req: DraftRequest): Promise<DraftResult> {
  const r = await post<{ message?: string | null; back_translation?: string; model?: string; rejected?: string }>("/api/message", req, 20_000);
  if (!r.ok) return { kind: "unavailable" };
  if (!r.data.message) return { kind: "rejected", reason: r.data.rejected ?? "unusable" };
  return { kind: "ok", message: r.data.message, backTranslation: r.data.back_translation ?? "", model: r.data.model ?? "" };
}

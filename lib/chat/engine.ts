// One chat turn (SPEC §8.2, §15.6): fast path first; the AI only for what the patterns don't understand; the
// engine's own template as the fallback at every step. Pure apart from the injected `commit` and `ai`.

import { isGrounded, looksLikeInjection, MAX_CHAT_CHARS } from "@/lib/llm/guard";
import type { AiClient } from "@/lib/llm/clientApi";
import type { ChangeSpec, CommitOutcome, Session } from "@/lib/state/session";
import type { DiffSummary } from "@/lib/chat/diff";
import { buildChatCtx, confirmPending, runTool, type ToolRun } from "./exec";
import { EXAMPLE_QUESTIONS, routeFast } from "./router";

export interface ChatState {
  /** The last application discussed, as its ID, for follow-ups ("and her training?"). */
  lastApp: string | null;
  /** A human override waiting for "confirm". */
  pending: ChangeSpec | null;
  history: { role: "user" | "model"; text: string }[];
}

export const NEW_CHAT: ChatState = { lastApp: null, pending: null, history: [] };

export interface ChatReply {
  text: string;
  /** More from the engine, behind "Show details". */
  details: string | null;
  chips: string[];
  brand: string;
  diff: DiffSummary | null;
  /** The change-log entry a change created, so the card can offer Undo. */
  entryId: string | null;
  simulated: boolean;
  appKey: string | null;
  /** Where the words came from: patterns and templates, the AI polishing the engine's facts, or the template after the AI failed. */
  via: "rules" | "ai" | "template";
  kind: ToolRun["kind"] | "declined" | "fallback";
  examples: string[];
  notice: string | null;
}

export interface TurnDeps {
  commit: (spec: ChangeSpec) => CommitOutcome;
  now: string;
  ai: AiClient | null;
}

const DECLINE = "I can only help with these applications and territories: why a decision was made, comparisons, new facts, what-ifs and what the team should do today. I can't change the rules or approve anyone from here.";
const BUSY = "The AI assistant is busy right now, so I can only answer the common questions. Here's what I can do:";

function fromRun(run: ToolRun, brand: string, via: ChatReply["via"], text: string, notice: string | null = null): ChatReply {
  return {
    text,
    details: run.long && run.long.trim() !== text.trim() ? run.long : null,
    chips: run.chips,
    brand,
    diff: run.diff,
    entryId: run.entryId,
    simulated: run.kind === "simulation",
    appKey: run.appKey,
    via,
    kind: run.kind,
    examples: [],
    notice,
  };
}

const plain = (text: string, brand: string, kind: ChatReply["kind"], examples: string[] = []): ChatReply => ({
  text, details: null, chips: [], brand, diff: null, entryId: null, simulated: false, appKey: null, via: "rules", kind, examples, notice: null,
});

export async function answerTurn(input: string, session: Session, state: ChatState, deps: TurnDeps): Promise<{ reply: ChatReply; state: ChatState }> {
  const ctx = buildChatCtx(session);
  const clipped = input.length > MAX_CHAT_CHARS;
  const message = input.slice(0, MAX_CHAT_CHARS);
  const notice = clipped ? `Your message was longer than ${MAX_CHAT_CHARS} characters, so I only read the first ${MAX_CHAT_CHARS}.` : null;
  const history = [...state.history, { role: "user" as const, text: message }].slice(-12);
  const next: ChatState = { ...state, history, pending: state.pending };
  const finish = (reply: ChatReply, run?: ToolRun) => {
    const lastApp = run?.appKey ? (ctx.dir.apps.find((a) => a.key === run.appKey)?.id ?? next.lastApp) : next.lastApp;
    return { reply: { ...reply, notice: reply.notice ?? notice }, state: { lastApp, pending: run?.pending ?? null, history: [...history, { role: "model" as const, text: reply.text }].slice(-12) } };
  };

  const fast = routeFast(message, ctx.dir, state.lastApp);
  if (fast.kind === "declined") return finish(plain(DECLINE, ctx.brand, "declined"));
  if (fast.kind === "clarify") return finish(plain(fast.text, ctx.brand, "clarify"));
  if (fast.kind === "confirm") {
    if (!state.pending) return finish(plain("There is nothing waiting for confirmation.", ctx.brand, "clarify"));
    const run = confirmPending(ctx, state.pending, { commit: deps.commit, now: deps.now });
    return finish(fromRun(run, ctx.brand, "rules", run.short), run);
  }
  if (fast.kind === "call") {
    const run = runTool(ctx, fast.call, { commit: deps.commit, now: deps.now, message });
    return finish(fromRun(run, ctx.brand, "rules", run.short), run);
  }

  // Not a pattern we know. Ask the AI to route it, if it's there.
  if (!deps.ai || looksLikeInjection(message)) {
    return finish(looksLikeInjection(message) ? plain(DECLINE, ctx.brand, "declined") : plain(BUSY, ctx.brand, "fallback", EXAMPLE_QUESTIONS));
  }
  const routed = await deps.ai.route(message, state.history.slice(-12), state.lastApp);
  if (routed.kind === "declined") return finish(plain(DECLINE, ctx.brand, "declined"));
  if (routed.kind === "unavailable") return finish(plain(BUSY, ctx.brand, "fallback", EXAMPLE_QUESTIONS));

  const run = runTool(ctx, routed.call, { commit: deps.commit, now: deps.now, message });
  if (!run.facts || (run.kind !== "answer" && run.kind !== "commit" && run.kind !== "simulation")) return finish(fromRun(run, ctx.brand, "rules", run.short), run);

  // The AI puts the engine's facts into friendlier words; if anything in its answer isn't in the facts, the template is used.
  const phrased = await deps.ai.phrase(message, run.facts, ctx.brand);
  if (phrased.kind === "ok" && isGrounded(phrased.answer, `${run.facts}\n${message}`)) return finish(fromRun(run, ctx.brand, "ai", phrased.answer), run);
  return finish(fromRun(run, ctx.brand, "template", run.short), run);
}

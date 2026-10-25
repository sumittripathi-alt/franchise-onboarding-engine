// The AI routes as plain functions: input in, status and body out. Gemini is injected, so tests use a fake
// and the app works fully when there is no key at all (G4.1).

import { z } from "zod";
import { GeminiError, type GeminiClient, type Reply } from "./client";
import { clip, isGrounded, looksLikeInjection, MAX_CHAT_CHARS, MAX_HISTORY, ungroundedClaims } from "./guard";
import { EXTRACT_SYSTEM, messageSystem, PHRASE_SYSTEM, ROUTE_SYSTEM } from "./prompts";
import { FUNCTION_DECLARATIONS, ToolCallSchema } from "./tools";
import { AiWireSchema, fromWire, vetSignals } from "./vet";
import type { Signals } from "@/lib/types";

const err = (status: number, message: string, code?: string): Reply => ({ status, body: { error: message, ...(code ? { code } : {}) } });
const unavailable = () => err(503, "The AI assistant isn't available right now.", "ai_unavailable");

function parseBody<T>(schema: z.ZodType<T>, text: string): { ok: true; value: T } | { ok: false; reply: Reply } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reply: err(400, "The request isn't valid JSON.") };
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    return { ok: false, reply: err(400, `The request isn't valid. ${i.path.join(".") ? `${i.path.join(".")}: ` : ""}${i.message}`) };
  }
  return { ok: true, value: r.data };
}

async function ask(gemini: GeminiClient, req: Parameters<GeminiClient["generate"]>[0]) {
  try {
    return { ok: true as const, result: await gemini.generate(req) };
  } catch (e) {
    return { ok: false as const, reply: err(502, e instanceof GeminiError && e.message === "timeout" ? "The AI service took too long." : "The AI service failed.", "ai_failed") };
  }
}

const jsonSchema = (s: z.ZodType): unknown => {
  const { $schema, ...rest } = z.toJSONSchema(s) as Record<string, unknown>;
  void $schema;
  return rest;
};

// ---------- /api/extract ----------

export const ExtractBodySchema = z.object({
  items: z
    .array(z.object({ id: z.string().min(1).max(100), business: z.string().max(1000), notes: z.string().max(2000) }))
    .min(1)
    .max(20),
});

const ExtractReplySchema = z.object({ results: z.array(AiWireSchema.extend({ id: z.string() })) });

/** One batch of up to 20 applications. Only the ID, the business text and the notes are sent to the model. */
export async function extract(gemini: GeminiClient | null, bodyText: string): Promise<Reply> {
  if (!gemini) return unavailable();
  const body = parseBody(ExtractBodySchema, bodyText);
  if (!body.ok) return body.reply;
  const items = body.value.items;
  const out = await ask(gemini, {
    system: EXTRACT_SYSTEM,
    contents: [{ role: "user", text: JSON.stringify(items.map((i) => ({ id: i.id, business: i.business, notes: i.notes }))) }],
    schema: jsonSchema(ExtractReplySchema),
    maxOutputTokens: 8192,
  });
  if (!out.ok) return out.reply;
  let parsed: z.infer<typeof ExtractReplySchema>;
  try {
    parsed = ExtractReplySchema.parse(JSON.parse(out.result.text ?? ""));
  } catch {
    return err(502, "The AI service gave an answer we couldn't use.", "ai_invalid");
  }
  const at = new Date().toISOString();
  const byId = new Map(parsed.results.map((r) => [r.id, r]));
  const results: Record<string, Signals> = {};
  const missing: string[] = [];
  for (const it of items) {
    const raw = byId.get(it.id);
    if (!raw) missing.push(it.id);
    else results[it.id] = vetSignals(fromWire(raw), { business: it.business, notes: it.notes }, { model: gemini.model, at });
  }
  return { status: 200, body: { results, missing, model: gemini.model, at } };
}

// ---------- /api/chat ----------

const Turn = z.object({ role: z.enum(["user", "model"]), text: z.string().max(MAX_CHAT_CHARS) });

export const ChatBodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("route"), message: z.string().min(1), history: z.array(Turn).max(50).default([]), lastApp: z.string().max(40).optional() }),
  z.object({
    mode: z.literal("phrase"),
    question: z.string().min(1),
    /** What the tool returned: the only facts the answer may use. */
    facts: z.string().min(1).max(8000),
    brand: z.string().max(60).default(""),
  }),
]);

export async function chat(gemini: GeminiClient | null, bodyText: string): Promise<Reply> {
  const body = parseBody(ChatBodySchema, bodyText);
  if (!body.ok) return body.reply;
  const b = body.value;
  const message = clip(b.mode === "route" ? b.message : b.question);

  if (b.mode === "route") {
    // Instructions to the system are declined before any model sees them (G4.3, G4.6).
    if (looksLikeInjection(message)) return { status: 200, body: { declined: true } };
    if (!gemini) return unavailable();
    // Only the last turns go to the model (G4.7), and never a system role: history is data.
    const history = b.history.slice(-MAX_HISTORY).map((t) => ({ role: t.role, text: clip(t.text) }));
    const contents = [...history, { role: "user" as const, text: b.lastApp ? `${message}\n\n(Last application discussed: ${b.lastApp})` : message }];
    const out = await ask(gemini, { system: ROUTE_SYSTEM, contents, tools: FUNCTION_DECLARATIONS });
    if (!out.ok) return out.reply;
    // Only a call from the allowlist, with valid arguments, gets through (G4.4).
    const call = out.result.call && ToolCallSchema.safeParse({ name: out.result.call.name, args: out.result.call.args });
    if (!call || !call.success) return err(502, "The AI service gave an answer we couldn't use.", "ai_invalid");
    return { status: 200, body: call.data.name === "out_of_scope" ? { declined: true } : { call: call.data } };
  }

  if (!gemini) return unavailable();
  const out = await ask(gemini, {
    system: PHRASE_SYSTEM,
    contents: [{ role: "user", text: `QUESTION: ${message}\n\nACTIVE BRAND PROFILE: ${b.brand}\n\nFACTS:\n${b.facts}` }],
    schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
    maxOutputTokens: 700,
  });
  if (!out.ok) return out.reply;
  let answer: string;
  try {
    answer = z.object({ answer: z.string().min(1).max(1500) }).parse(JSON.parse(out.result.text ?? "")).answer.trim();
  } catch {
    return err(502, "The AI service gave an answer we couldn't use.", "ai_invalid");
  }
  // Hallucination check (G4.5): nothing in the answer that the tool didn't say.
  const bad = ungroundedClaims(answer, `${b.facts}\n${message}`);
  if (bad.length) return { status: 200, body: { answer: null, ungrounded: bad.slice(0, 5) } };
  return { status: 200, body: { answer, model: gemini.model } };
}

// ---------- /api/message ----------

export const MessageBodySchema = z.object({
  appId: z.string().min(1).max(40),
  firstName: z.string().max(40).default(""),
  language: z.enum(["Kannada", "Hindi", "English"]),
  status: z.enum(["APPROVED", "CONDITIONAL", "HOLD", "WAITLIST", "REDIRECT", "REJECT"]),
  label: z.string().max(80),
  headline: z.string().max(400),
  steps: z.array(z.string().max(300)).max(3),
  questions: z.array(z.string().max(300)).max(4).default([]),
});
export type MessageBody = z.infer<typeof MessageBodySchema>;

const APPROVAL_ENGLISH = /\b(approv(ed|al)|accepted|congratulat\w*|confirmed|selected)\b/i;
// "approved / sanctioned / accepted" in Kannada and Hindi.
const APPROVAL_NATIVE = /ಅನುಮೋದ|ಮಂಜೂರು|ಸ್ವೀಕರಿಸ|ಅಭಿನಂದನ|स्वीकृत|मंज़ूर|मंजूर|अनुमोदित|बधाई/u;

export type MessageCheck = { ok: true } | { ok: false; reason: string };

/** The message may say only what the decision record says, and never "approved" unless the engine did (§15.9). */
export function checkMessage(m: { message: string; back_translation: string }, d: Pick<MessageBody, "appId" | "status" | "label" | "headline" | "steps" | "questions" | "firstName">): MessageCheck {
  const allowed = [d.appId, d.label, d.headline, ...d.steps, ...d.questions, d.firstName].join("\n");
  const approved = d.status === "APPROVED" || d.status === "CONDITIONAL";
  if (!approved && (APPROVAL_ENGLISH.test(m.back_translation) || APPROVAL_NATIVE.test(m.message) || APPROVAL_ENGLISH.test(m.message))) {
    return { ok: false, reason: "says approved when the decision isn't" };
  }
  if (!isGrounded(m.back_translation, allowed)) return { ok: false, reason: "contains an ID, pin or number that isn't in the decision" };
  // Native numerals and IDs in the message itself must also exist in the record.
  if (!isGrounded(m.message, allowed)) return { ok: false, reason: "contains an ID or number that isn't in the decision" };
  return { ok: true };
}

export async function message(gemini: GeminiClient | null, bodyText: string): Promise<Reply> {
  if (!gemini) return unavailable();
  const body = parseBody(MessageBodySchema, bodyText);
  if (!body.ok) return body.reply;
  const d = body.value;
  const facts = JSON.stringify({ reference: d.appId, firstName: d.firstName, decision: d.label, reason: d.headline, nextSteps: d.steps, questionsForThem: d.questions });
  const out = await ask(gemini, {
    system: messageSystem(d.language),
    contents: [{ role: "user", text: `FACTS:\n${facts}` }],
    schema: { type: "object", properties: { message: { type: "string" }, back_translation: { type: "string" } }, required: ["message", "back_translation"] },
    maxOutputTokens: 1500,
  });
  if (!out.ok) return out.reply;
  let m: { message: string; back_translation: string };
  try {
    m = z.object({ message: z.string().min(1).max(2000), back_translation: z.string().min(1).max(2000) }).parse(JSON.parse(out.result.text ?? ""));
  } catch {
    return err(502, "The AI service gave an answer we couldn't use.", "ai_invalid");
  }
  const check = checkMessage(m, d);
  if (!check.ok) return { status: 200, body: { message: null, rejected: check.reason } };
  return { status: 200, body: { message: m.message.trim(), back_translation: m.back_translation.trim(), model: gemini.model } };
}

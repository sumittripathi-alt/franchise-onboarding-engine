// Shared workspaces (SPEC §16): what is stored and what may be sent. Used by the server routes and by the
// client, so both sides agree on every payload. Nothing here is secret.

import { z } from "zod";
import { CITY_NAMES, FLOORS, LANGUAGES, PRIORITIES, SPACE_AVAILABLE } from "@/lib/policy/allowedValues";
import { parseCity, parseFloor, parseLakh, parseLanguage, parseNumber, parsePin, parseSpaceAvailable } from "@/lib/ingest/normalise";
import { SignalsSchema } from "@/lib/ingest/schemas";
import { fieldFor, validateAgainstDefaults } from "@/lib/policy/edits";
import { BrandProfileSchema, FactPatchSchema, HumanOverrideSchema, LockSchema, SessionSchema, SettingsSchema } from "@/lib/state/sessionSchema";

export const MAX_BASE_BYTES = 2 * 1024 * 1024;
export const MAX_EVENT_BYTES = 10 * 1024;
export const MAX_EVENTS_PER_WORKSPACE = 5000;
export const RECENT_LIMIT = 20;
export const POLL_MS = 4000;

export const EVENT_TYPES = ["fact", "territory_fact", "withdraw", "override", "lock", "policy_change", "brand_switch", "today_change", "undo"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "must be letters, digits, - or _ (up to 64)");
export const UuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "is not a valid workspace id");

// ---------- Base data ----------

/** The uploaded data and the settings it started with. Events are replayed on top. */
export const BaseDataSchema = SessionSchema.pick({ files: true, parsed: true, base: true, policy: true, signals: true });
export type BaseData = z.infer<typeof BaseDataSchema>;

export const CreateWorkspaceSchema = z.object({
  /** Chosen by the client so a workspace can be made while offline and sent later. Never replaces an existing one. */
  id: UuidSchema.optional(),
  name: z.string().trim().min(1).max(200),
  brandProfile: BrandProfileSchema.shape.id,
  sourceFilename: z.string().max(300).nullable().optional(),
  rowCounts: z.object({ applications: z.number().int().min(0), territories: z.number().int().min(0) }),
  parentId: UuidSchema.nullable().optional(),
  baseData: BaseDataSchema,
});
export type CreateWorkspace = z.infer<typeof CreateWorkspaceSchema>;

// ---------- Events ----------

/** A fact value must survive the same normalisers as the upload, to something the engine allows. */
export function checkFactValue(f: z.infer<typeof FactPatchSchema>): string | null {
  if (f.target === "territory") {
    if (f.field === "openSlots") return Number.isInteger(f.value) && f.value >= 0 && f.value <= 50 ? null : "open slots must be a whole number from 0 to 50";
    return (PRIORITIES as readonly string[]).includes(f.value) ? null : `priority must be one of ${PRIORITIES.join(", ")}`;
  }
  if (f.field === "withdrawn") return null;
  const v = f.value;
  const num = (lo: number, hi: number, label: string) => {
    const n = parseNumber(v).value;
    return n !== null && n >= lo && n <= hi ? null : `${label} must be a number from ${lo} to ${hi}`;
  };
  switch (f.field) {
    case "spaceAvailable":
      return parseSpaceAvailable(v).value ? null : `space available must be one of ${SPACE_AVAILABLE.join(", ")}`;
    case "floor":
      return parseFloor(v).value ? null : `floor must be one of ${FLOORS.join(", ")}`;
    case "language":
      return parseLanguage(v).value ? null : `language must be one of ${LANGUAGES.join(", ")}`;
    case "city":
      return parseCity(v).value ? null : `city must be one of ${CITY_NAMES.join(", ")}`;
    case "pin":
      return parsePin(v).value ? null : "pin must be 6 digits";
    case "spaceSqft":
      return num(0, 100000, "space size");
    case "experienceYears":
      return num(0, 80, "experience");
    case "targetLaunchMonths":
      return num(0, 120, "target launch");
    case "investmentLakh": {
      const n = parseLakh(v).value;
      return n !== null && n >= 0 && n <= 10000 ? null : "investment must be a number of lakh from 0 to 10000";
    }
    case "notes":
      return typeof v === "string" && v.length > 0 && v.length <= 500 ? null : "notes must be 1 to 500 characters";
  }
}

export const ChangePayloadSchema = z
  .object({
    source: z.enum(["chat", "policy", "brand", "ai_notes", "manual", "lock", "override", "settings"]),
    description: z.string().trim().min(1).max(500),
    facts: z.array(FactPatchSchema).min(1).max(50).optional(),
    locks: z.array(LockSchema).min(1).max(50).optional(),
    overrides: z.array(HumanOverrideSchema).min(1).max(50).optional(),
    set: SettingsSchema.partial().strict().optional(),
    signals: z.record(z.string().max(100), SignalsSchema).refine((r) => Object.keys(r).length >= 1 && Object.keys(r).length <= 40, "1 to 40 applications").optional(),
    policy: z
      .union([
        z.object({ profileId: z.enum(["eyewear", "delivery", "partner_point"]), edits: z.array(z.object({ path: z.string().max(60), value: z.number().finite() }).strict()).min(1).max(16) }).strict(),
        z.object({ profileId: z.enum(["eyewear", "delivery", "partner_point"]), reset: z.literal(true) }).strict(),
      ])
      .optional(),
    directKeys: z.array(z.string().max(100)).max(50).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (!p.facts && !p.locks && !p.overrides && !p.signals && !p.policy && !(p.set && Object.keys(p.set).length)) {
      ctx.addIssue({ code: "custom", message: "a change must contain facts, locks, overrides, signals, assumptions or settings" });
    }
    if (p.policy && "edits" in p.policy) {
      for (const e of p.policy.edits) if (!fieldFor(e.path)) ctx.addIssue({ code: "custom", path: ["policy"], message: `"${e.path}" isn't a setting that can be changed` });
      const problem = validateAgainstDefaults(p.policy.profileId, p.policy.edits);
      if (problem) ctx.addIssue({ code: "custom", path: ["policy"], message: problem });
    }
    for (const f of p.facts ?? []) {
      const problem = checkFactValue(f);
      if (problem) ctx.addIssue({ code: "custom", path: ["facts"], message: problem });
    }
  });
export type ChangePayload = z.infer<typeof ChangePayloadSchema>;

export const UndoPayloadSchema = z.object({ targetSeq: z.number().int().min(1) }).strict();
export type UndoPayload = z.infer<typeof UndoPayloadSchema>;

/** The event type a change payload belongs to. The server checks that the sender's claim matches. */
export function classifyChange(p: ChangePayload): Exclude<EventType, "undo"> {
  if (p.facts?.some((f) => f.field === "withdrawn")) return "withdraw";
  if (p.facts?.some((f) => f.target === "application")) return "fact";
  if (p.facts) return "territory_fact";
  if (p.policy) return "policy_change";
  if (p.signals) return "fact";
  if (p.overrides) return "override";
  if (p.locks) return "lock";
  if (p.set?.profileId !== undefined) return "brand_switch";
  if (p.set?.today !== undefined) return "today_change";
  return "policy_change";
}

export const NewEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("undo"), payload: UndoPayloadSchema, clientId: id, clientEventId: id }),
  ...(["fact", "territory_fact", "withdraw", "override", "lock", "policy_change", "brand_switch", "today_change"] as const).map((t) =>
    z.object({ type: z.literal(t), payload: ChangePayloadSchema, clientId: id, clientEventId: id }),
  ),
] as unknown as [z.ZodObject, z.ZodObject]);
export type NewEvent =
  | { type: "undo"; payload: UndoPayload; clientId: string; clientEventId: string }
  | { type: Exclude<EventType, "undo">; payload: ChangePayload; clientId: string; clientEventId: string };

/** An event as stored and as returned to clients. */
export interface StoredEvent {
  seq: number;
  createdAt: string;
  type: EventType;
  payload: ChangePayload | UndoPayload;
  clientId: string | null;
  clientEventId: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  createdAt: string;
  brandProfile: string;
  sourceFilename: string | null;
  rowCounts: { applications: number; territories: number };
  parentId: string | null;
}

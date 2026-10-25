// Zod schemas for the saved session file (G7.9). Everything read back from disk or storage is validated.

import { z } from "zod";
import { ApplicationSchema, SignalsSchema, TerritorySchema } from "@/lib/ingest/schemas";
import type { BrandProfile } from "@/lib/policy/types";

export const SESSION_KIND = "franchise-onboarding-session";
export const SESSION_VERSION = 1;

const tierValues = z.object({ "Tier 1": z.number(), "Tier 2": z.number(), "Tier 3": z.number() });
const trackValues = z.object({ "Fast-track": z.number(), Standard: z.number(), Extended: z.number() });
const spaceRule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok") }),
  z.object({ kind: z.literal("condition"), days: z.number(), text: z.string() }),
  z.object({ kind: z.literal("reject"), text: z.string() }),
]);

export const BrandProfileSchema = z.object({
  id: z.enum(["eyewear", "delivery", "partner_point"]),
  label: z.string(),
  styleHint: z.string(),
  description: z.string(),
  minInvestmentLakh: tierValues,
  hardFloorPct: z.number(),
  space: z.object({ minSqft: z.number(), idealMinSqft: z.number(), idealMaxSqft: z.number() }),
  floorRules: z.object({ Ground: spaceRule, Upper: spaceRule, "Mall unit": spaceRule }),
  noSpaceRule: spaceRule,
  experienceKeywords: z.array(z.string()),
  cannibalisationRadiusKm: tierValues,
  monthlyRevenueLakh: tierValues,
  partnerMargin: z.number(),
  paybackWarningMonths: z.number(),
  leadTimes: z.object({ fitOutDays: z.number(), licencesDays: z.number(), hiringDays: z.number() }),
  specialHiring: z.string().nullable(),
  baseTrainingDays: z.number(),
  trainingTrackAdjustDays: trackValues,
  shadowDays: trackValues,
  trainingFormat: z.string(),
  trainingModules: z.array(z.string()),
  teamInduction: z.object({ days: z.number(), who: z.string(), topics: z.array(z.string()) }).nullable(),
  defaultTargetLaunchMonths: z.number(),
  preOnboarding: z.object({ topN: z.number(), step: z.string() }),
  waitlistReviewDays: z.number(),
  conditionDays: z.object({ confirmDetails: z.number(), proofOfFunds: z.number(), storeManager: z.number(), expansionSignOff: z.number() }),
  rationale: z.record(z.string(), z.string()),
}) satisfies z.ZodType<Omit<BrandProfile, "rationale"> & { rationale: Record<string, string | undefined> }>;

const status = z.enum(["APPROVED", "CONDITIONAL", "HOLD", "WAITLIST", "REDIRECT", "REJECT"]);

export const FactPatchSchema = z.union([
  z.object({
    target: z.literal("application"),
    key: z.string(),
    field: z.enum(["spaceAvailable", "spaceSqft", "floor", "investmentLakh", "experienceYears", "targetLaunchMonths", "language", "city", "pin", "notes"]),
    value: z.union([z.string(), z.number(), z.null()]),
  }),
  z.object({ target: z.literal("application"), key: z.string(), field: z.literal("withdrawn"), value: z.literal(true) }),
  z.object({ target: z.literal("territory"), key: z.string(), field: z.literal("openSlots"), value: z.number() }),
  z.object({ target: z.literal("territory"), key: z.string(), field: z.literal("priority"), value: z.enum(["High", "Medium", "Low"]) }),
]);

export const LockSchema = z.object({ appKey: z.string(), status, pin: z.string(), territoryKey: z.string(), date: z.string() });

export const HumanOverrideSchema = z.object({
  appKey: z.string(),
  status: z.enum(["APPROVED", "CONDITIONAL", "HOLD", "WAITLIST", "REJECT"]),
  reason: z.string(),
  time: z.string(),
  confirmedBumps: z.array(z.string()).optional(),
});

const parseReport = z.object({
  files: z.array(z.string()),
  applicationsSheet: z.string(),
  territoriesSheet: z.string(),
  applicationRowsRead: z.number(),
  territoryRowsRead: z.number(),
  emptyRowsIgnored: z.number(),
  exampleRows: z.array(z.object({ sheet: z.enum(["Applications", "Territories"]), row: z.number(), skipped: z.boolean() })),
  extraColumns: z.array(z.object({ sheet: z.string(), columns: z.array(z.string()) })),
  warnings: z.array(z.string()),
  skippedExampleTerritory: z
    .object({ row: z.number(), id: z.string(), pins: z.array(z.string()), covers: z.array(z.object({ applicationId: z.string(), pin: z.string() })) })
    .nullable(),
});

export const SettingsSchema = z.object({
  profileId: z.enum(["eyewear", "delivery", "partner_point"]),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  includeExample: z.boolean(),
});

const diffSummary = z.object({
  changes: z.array(
    z.object({
      appKey: z.string(), appId: z.string(), name: z.string(),
      from: status.nullable(), to: status.nullable(), fromLabel: z.string().nullable(), toLabel: z.string().nullable(),
      pinFrom: z.string().nullable(), pinTo: z.string().nullable(), reason: z.string(), direct: z.boolean(),
      kind: z.enum(["status", "pin", "added", "removed"]),
    }),
  ),
  slots: z.array(z.object({ territoryId: z.string(), slotsFrom: z.number(), slotsTo: z.number(), reservedFrom: z.number(), reservedTo: z.number() })),
  text: z.string(),
});

export const ChangeEntrySchema = z.object({
  id: z.string(),
  time: z.string(),
  source: z.enum(["chat", "policy", "brand", "ai_notes", "manual", "lock", "override", "settings"]),
  description: z.string(),
  undone: z.boolean(),
  facts: z.array(FactPatchSchema).optional(),
  locks: z.array(LockSchema).optional(),
  overrides: z.array(HumanOverrideSchema).optional(),
  set: SettingsSchema.partial().optional(),
  diff: diffSummary,
});

export const FeedbackSchema = z.object({
  id: z.string(),
  time: z.string(),
  appKey: z.string(),
  appId: z.string(),
  status,
  reason: z.string(),
});

export const SessionSchema = z.object({
  files: z.array(z.string()),
  parsed: z.object({
    applications: z.array(ApplicationSchema),
    territories: z.array(TerritorySchema),
    skippedExample: z.object({ application: ApplicationSchema.nullable(), territory: TerritorySchema.nullable() }),
    report: parseReport,
  }),
  /** Settings when the file was uploaded. Later changes are entries in the change log. */
  base: SettingsSchema,
  /** The brand profile in force at upload, with any edits. */
  policy: BrandProfileSchema,
  entries: z.array(ChangeEntrySchema),
  feedback: z.array(FeedbackSchema),
  /** The user has seen the data-quality report and continued. */
  reviewed: z.boolean(),
  /** Free-text signals from the AI reader, cached once per upload (Phase 6). Absent means heuristics only. */
  signals: z.record(z.string(), SignalsSchema).optional(),
});

export const SessionFileSchema = z.object({
  kind: z.literal(SESSION_KIND),
  version: z.literal(SESSION_VERSION),
  savedAt: z.string(),
  session: SessionSchema,
});

export type SessionFileData = z.infer<typeof SessionFileSchema>;

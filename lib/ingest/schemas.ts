// Zod schemas: every parsed row, LLM output and API payload is validated (SPEC §1).

import { z } from "zod";
import {
  CITY_NAMES,
  FLOORS,
  LANGUAGES,
  PRIORITIES,
  SPACE_AVAILABLE,
  TIERS,
} from "@/lib/policy/allowedValues";

const rawCell = z.union([z.string(), z.number()]).nullable();

const parsed = <T extends z.ZodTypeAny>(value: T) => z.object({ value: value.nullable(), raw: rawCell });

export const ApplicationSchema = z.object({
  key: z.string().min(1),
  id: z.string(),
  row: z.number().int().positive(),
  name: z.string(),
  city: parsed(z.enum(CITY_NAMES)),
  state: parsed(z.string()),
  pin: parsed(z.string().regex(/^\d{6}$/)),
  investmentLakh: parsed(z.number().finite()),
  experienceYears: parsed(z.number().finite()),
  business: z.string(),
  spaceAvailable: parsed(z.enum(SPACE_AVAILABLE)),
  spaceSqft: parsed(z.number().finite()),
  floor: parsed(z.enum(FLOORS)),
  targetLaunchMonths: parsed(z.number().finite()),
  language: parsed(z.enum(LANGUAGES)),
  notes: z.string(),
});

export const TerritorySchema = z.object({
  key: z.string().min(1),
  id: z.string(),
  row: z.number().int().positive(),
  city: parsed(z.enum(CITY_NAMES)),
  state: parsed(z.string()),
  pins: z.array(z.string().regex(/^\d{6}$/)),
  invalidPins: z.array(z.string()),
  pinsRaw: z.string(),
  tier: parsed(z.enum(TIERS)),
  openSlots: parsed(z.number().finite()),
  priority: parsed(z.enum(PRIORITIES)),
});

export const SignalsSchema = z.object({
  relevant_sector: z.string().nullable(),
  years_running_shop_mentioned: z.number().nullable(),
  notes_floor_claim: z.enum(["Ground", "Upper", "Mall unit"]).nullable(),
  notes_space_claim: z.enum(["has_space", "searching"]).nullable(),
  festival_deadline: z.string().nullable(),
  absentee_owner: z.boolean(),
  competitor_conflict: z.boolean(),
  funding_dependency: z.boolean(),
  injection_attempt: z.boolean(),
  other_flags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  evidence: z
    .object({
      relevant_sector: z.string(),
      years_running_shop_mentioned: z.string(),
      notes_floor_claim: z.string(),
      notes_space_claim: z.string(),
      festival_deadline: z.string(),
      absentee_owner: z.string(),
      competitor_conflict: z.string(),
      funding_dependency: z.string(),
      injection_attempt: z.string(),
    })
    .partial(),
});

// Shared domain types. Zod schemas for parsing live in lib/ingest/schemas.ts (Phase 2);
// these interfaces describe the normalised data the engine works on.

import type {
  CityName,
  Floor,
  Language,
  Priority,
  SpaceAvailable,
  Tier,
} from "@/lib/policy/allowedValues";

/** A parsed value that keeps what the user actually typed (G1.7). */
export interface Parsed<T> {
  value: T | null;
  raw: string | number | null;
}

export interface Application {
  /** Unique internal key: the ID when unique, otherwise `${id}@row${row}` (duplicates, A05) or `row${row}` (blank ID). */
  key: string;
  id: string;
  /** Original Excel row number, cited in every issue message (G1.12). */
  row: number;
  name: string;
  city: Parsed<CityName>;
  state: Parsed<string>;
  pin: Parsed<string>;
  investmentLakh: Parsed<number>;
  experienceYears: Parsed<number>;
  business: string;
  spaceAvailable: Parsed<SpaceAvailable>;
  spaceSqft: Parsed<number>;
  floor: Parsed<Floor>;
  targetLaunchMonths: Parsed<number>;
  language: Parsed<Language>;
  notes: string;
}

export interface Territory {
  /** Unique internal key, as for Application. */
  key: string;
  id: string;
  row: number;
  city: Parsed<CityName>;
  state: Parsed<string>;
  pins: string[];
  /** Tokens in "Pin codes covered" that are not 6-digit pins. */
  invalidPins: string[];
  pinsRaw: string;
  tier: Parsed<Tier>;
  openSlots: Parsed<number>;
  priority: Parsed<Priority>;
}

// ---------- Free-text signals (SPEC §8.1) ----------

/** Signals pulled from "Current / past business" and "Notes", by Gemini or by the heuristic fallback. */
export interface Signals {
  relevant_sector: string | null;
  years_running_shop_mentioned: number | null;
  notes_floor_claim: "Ground" | "Upper" | "Mall unit" | null;
  notes_space_claim: "has_space" | "searching" | null;
  festival_deadline: string | null;
  absentee_owner: boolean;
  competitor_conflict: boolean;
  funding_dependency: boolean;
  injection_attempt: boolean;
  other_flags: string[];
  confidence: number;
}

// ---------- Data checks (SPEC §4) ----------

export type IssueSeverity = "blocking" | "condition" | "info";

export type ApplicationCheckCode =
  | "A01" | "A02" | "A03" | "A04" | "A05" | "A06" | "A07" | "A08" | "A09"
  | "A10" | "A11" | "A12" | "A13" | "A14" | "A15" | "A16" | "A17" | "A18";

export type TerritoryCheckCode = "T01" | "T02" | "T03" | "T04" | "T05" | "T06" | "T07";

export interface Issue {
  code: ApplicationCheckCode | TerritoryCheckCode;
  severity: IssueSeverity;
  /** Application or Territory ID the issue belongs to. */
  subjectId: string;
  row: number;
  field?: string;
  message: string;
  /** Question to ask the partner, where one makes sense. */
  question?: string;
}

// ---------- Decisions (SPEC §6) ----------

export const STATUSES = ["APPROVED", "CONDITIONAL", "HOLD", "WAITLIST", "REDIRECT", "REJECT"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_META: Record<Status, { label: string; wayOut: string }> = {
  APPROVED: { label: "Approved", wayOut: "Complete onboarding milestones" },
  CONDITIONAL: { label: "Conditional", wayOut: "Meet each condition, or the slot is released" },
  HOLD: { label: "Hold", wayOut: "Answer the listed clarifying questions" },
  WAITLIST: { label: "Waitlist", wayOut: "Wait for a slot to free up" },
  REDIRECT: { label: "Redirect", wayOut: "Accept the offered pin" },
  REJECT: { label: "Reject", wayOut: "See what would need to change to reapply" },
};

export type ReasonCode =
  | "CLEAN_WIN"
  | "WON_SLOT_WITH_CONDITIONS"
  | "BLOCKING_DATA_ISSUE"
  | "BELOW_HARD_FLOOR"
  | "PROFILE_REJECT_SPACE"
  | "PROFILE_REJECT_FLOOR"
  | "PIN_HAS_EXISTING_STORE"
  | "PIN_NOT_IN_TERRITORY"
  | "OUTSIDE_PLAN"
  | "LOST_PIN_CONTEST"
  | "NO_SLOT"
  | "REDIRECT_OFFERED"
  | "NO_SLOT_IN_CITY"
  | "DUPLICATE_PERSON"
  | "CANNIBALISATION_RISK"
  | "LOCATION_UNCERTAIN"
  | "PAYBACK_WARNING"
  | "TARGET_NOT_FEASIBLE"
  | "WITHDRAWN";

export type Band = 1 | 2 | 3;

export interface Bands {
  space: Band;
  capital: Band;
  experience: Band;
}

export interface Condition {
  id: string;
  text: string;
  deadline: string; // ISO date
  ifMissed: string;
  source: ReasonCode | ApplicationCheckCode;
}

export interface Competitor {
  appId: string;
  relation: "pin" | "slot";
  firstDifferingFactor: string;
  won: boolean;
}

export interface HistoryEntry {
  version: number;
  time: string;
  source: "upload" | "chat" | "policy" | "brand" | "ai_notes";
  from: Status | null;
  to: Status;
  note: string;
}

export interface DecisionRecord {
  appId: string;
  status: Status;
  reasonCodes: ReasonCode[];
  explanation: string;
  counterfactual: string;
  conditions: Condition[];
  territoryId: string | null;
  pin: string | null;
  competitors: Competitor[];
  bands: Bands | null;
  flags: string[];
  waitlistRank?: number;
  wouldRankIfClarified?: number;
  questions: string[];
  nextSteps: string[];
  version: number;
  history: HistoryEntry[];
}

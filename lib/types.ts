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

export type EvidenceKey =
  | "relevant_sector"
  | "years_running_shop_mentioned"
  | "notes_floor_claim"
  | "notes_space_claim"
  | "festival_deadline"
  | "absentee_owner"
  | "competitor_conflict"
  | "funding_dependency"
  | "injection_attempt";

/**
 * Exact quote from the applicant's business or notes text behind each signal (SPEC §15.3).
 * Heuristics use their matched text; Gemini must supply one for any signal that can create a hold or condition.
 */
export type SignalEvidence = Partial<Record<EvidenceKey, string>>;

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
  evidence: SignalEvidence;
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
  /** Exact quote from the applicant's text, for issues raised from notes (SPEC §15.3). */
  evidence?: string;
}

// ---------- Decisions (SPEC §6) ----------

export const STATUSES = ["APPROVED", "CONDITIONAL", "HOLD", "WAITLIST", "REDIRECT", "REJECT"] as const;
export type Status = (typeof STATUSES)[number];

/** Users always see the label (SPEC §6.1); codes appear only in reason chips and exports. */
export const STATUS_META: Record<Status, { label: string; wayOut: string }> = {
  APPROVED: { label: "Approved", wayOut: "Complete onboarding milestones" },
  CONDITIONAL: { label: "Approved with conditions", wayOut: "Meet each condition, or the slot is released" },
  HOLD: { label: "On hold", wayOut: "Answer the listed clarifying questions" },
  WAITLIST: { label: "Waitlisted", wayOut: "Wait for a slot to free up" },
  REDIRECT: { label: "Offered another location", wayOut: "Accept the offered pin" },
  REJECT: { label: "Not approved", wayOut: "See what would need to change to reapply" },
};

export const RESERVED_STATUSES: readonly Status[] = ["APPROVED", "CONDITIONAL", "REDIRECT"];

export type ReasonCode =
  // Outcomes
  | "CLEAN_WIN"
  | "WON_SLOT_WITH_CONDITIONS"
  | "BLOCKING_DATA_ISSUE"
  | "BELOW_HARD_FLOOR"
  | "PROFILE_REJECT_SPACE"
  | "PROFILE_REJECT_FLOOR"
  | "PIN_HAS_EXISTING_STORE"
  | "PIN_NOT_IN_TERRITORY"
  | "LOST_PIN_CONTEST"
  | "REDIRECT_OFFERED"
  | "NO_SLOT"
  | "NO_SLOT_IN_CITY"
  | "OUTSIDE_PLAN"
  | "DUPLICATE_PERSON"
  | "SLOT_COMMITTED"
  // Conditions
  | "SPACE_NOT_IDENTIFIED"
  | "FLOOR_NOT_SUITABLE"
  | "FLOOR_UNCONFIRMED"
  | "SIZE_UNCONFIRMED"
  | "SIZE_BELOW_MIN"
  | "PROOF_OF_FUNDS"
  | "STORE_MANAGER"
  | "EXPANSION_SIGNOFF"
  // Flags
  | "CANNIBALISATION_RISK"
  | "LOCATION_UNCERTAIN"
  | "PAYBACK_WARNING"
  | "TARGET_NOT_FEASIBLE"
  | "TIGHT_TIMELINE"
  | "NOTES_TARGET_DISAGREE"
  | "RENT_BURDEN_RISK"
  | "PROVISIONAL"
  | "HUMAN_OVERRIDE"
  | "LOCKED"
  | "INTEGRITY_CONCERN"
  | "EXPERIENCE_UNDER_REPORTED";

export type Band = 1 | 2 | 3;

export interface Bands {
  space: Band;
  capital: Band;
  experience: Band;
}

export interface Condition {
  id: string;
  text: string;
  /** Third-person phrase for the one-line why, e.g. "moves to a ground-floor space". */
  short: string;
  /** Who acts on it: the partner, or the brand's own team (sign-off, informing an existing partner). */
  owner: "partner" | "team";
  /** ISO date (YYYY-MM-DD). */
  deadline: string;
  ifMissed: string;
  source: ReasonCode;
}

export interface Flag {
  code: ReasonCode;
  text: string;
}

export interface Competitor {
  appId: string;
  appKey: string;
  relation: "pin" | "slot" | "offer";
  won: boolean;
  /** Plain-English first differing factor, from the winner's point of view. */
  firstDifferingFactor: string;
  /** Which factor it was: space, capital, experience, distance, launch, id, spaceType, territoryPriority. */
  factor: string;
}

export interface HistoryEntry {
  version: number;
  time: string;
  source: "upload" | "chat" | "policy" | "brand" | "ai_notes" | "override" | "lock";
  from: Status | null;
  to: Status;
  note: string;
}

export interface CannibalisationInfo {
  /** 2 = inside an inner radius, 3 = clear, "uncertain" = location data too weak to judge. */
  zone: 2 | 3 | "uncertain";
  radiusKm: number;
  nearestStore: { id: string; pin: string; km: number } | null;
  nearbyReserved: { appId: string; pin: string; km: number }[];
  note: string;
}

export interface PaybackInfo {
  months: number;
  basisLakh: number;
  monthlyRevenueLakh: number;
  margin: number;
  warning: boolean;
}

export interface LaunchInfo {
  /** ISO dates. */
  earliest: string;
  target: string | null;
  festival: { name: string; date: string } | null;
  /** The date used to test feasibility: the earlier of target and festival (SPEC §15.7). */
  testDate: string | null;
  feasible: boolean;
  /** Days the earliest launch falls after the test date (≤ 0 = feasible). */
  gapDays: number;
}

export interface LocationOffer {
  pin: string;
  territoryId: string;
  expires: string;
  /** Why the applicant's own space can't be used, when they have one. */
  spaceNote: string | null;
  distanceKm: number | null;
}

export interface DecisionRecord {
  appKey: string;
  appId: string;
  name: string;
  row: number;
  city: string | null;
  status: Status;
  label: string;
  reasonCodes: ReasonCode[];
  /** The one-line "why". */
  headline: string;
  explanation: string;
  /** "What would change this decision." */
  counterfactual: string;
  /** What the partner does next (G9.12). Never empty; the first is the headline step. */
  partnerSteps: string[];
  /** What the expansion team does next. Never empty. */
  teamSteps: string[];
  partnerNextStep: string;
  teamNextStep: string;
  /** Suggestions that don't change the status, e.g. a lower-tier city the investment would fit. */
  suggestions: string[];
  questions: string[];
  conditions: Condition[];
  flags: Flag[];
  /** The applicant's own pin and the territory it maps to. */
  homePin: string | null;
  territoryId: string | null;
  /** Pin held (APPROVED/CONDITIONAL) or offered (REDIRECT); null otherwise. */
  pin: string | null;
  /** Territory whose slot is held or offered. */
  slotTerritoryId: string | null;
  offer: LocationOffer | null;
  competitors: Competitor[];
  bands: Bands | null;
  /** One waitlist per city with a single rank; shows the territory the applicant wanted. */
  waitlist: { city: string; rank: number; wantedTerritoryId: string | null } | null;
  waitlistRank: number | null;
  /** For HOLD: where it would stand once clarified. */
  ifClarified: { territoryId: string; rank: number; winsPin: boolean; pin: string } | null;
  provisional: { byAppId: string; until: string } | null;
  cannibalisation: CannibalisationInfo | null;
  payback: PaybackInfo | null;
  launch: LaunchInfo | null;
  evidence: { code: string; quote: string }[];
  locked: { date: string } | null;
  override: { status: Status; reason: string; time: string } | null;
  version: number;
  history: HistoryEntry[];
}

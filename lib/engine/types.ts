import type { ExistingStore } from "@/data/existingStores";
import type { ResolvedTerritory } from "@/lib/ingest/validate";
import type { Policy } from "@/lib/policy/types";
import type { Application, DecisionRecord, Issue, Signals, Status, Territory } from "@/lib/types";

/** A fact stated in chat (or a what-if), applied on top of the parsed data before the engine runs. */
export type FactPatch =
  | {
      target: "application";
      key: string;
      field:
        | "spaceAvailable"
        | "spaceSqft"
        | "floor"
        | "investmentLakh"
        | "experienceYears"
        | "targetLaunchMonths"
        | "language"
        | "city"
        | "pin"
        | "notes";
      value: string | number | null;
    }
  | { target: "application"; key: string; field: "withdrawn"; value: true }
  | { target: "territory"; key: string; field: "openSlots"; value: number }
  | { target: "territory"; key: string; field: "priority"; value: "High" | "Medium" | "Low" };

/** "Mark as sent to partner" (SPEC §15.4). Only Approved / Approved-with-conditions decisions are protected. */
export interface Lock {
  appKey: string;
  status: Status;
  pin: string;
  territoryKey: string;
  /** ISO date the decision was sent. */
  date: string;
}

/** A human override (SPEC §15.4). */
export interface HumanOverride {
  appKey: string;
  status: Exclude<Status, "REDIRECT">;
  reason: string;
  time: string;
  /** Applicants the user confirmed may be bumped to make room. */
  confirmedBumps?: string[];
}

export interface EngineInput {
  applications: Application[];
  territories: Territory[];
  /** Free-text signals by application key. Missing entries fall back to heuristics. */
  signals?: Record<string, Signals>;
  policy: Policy;
  facts?: FactPatch[];
  locks?: Lock[];
  overrides?: HumanOverride[];
  /** ISO date. */
  today: string;
  existingStores?: readonly ExistingStore[];
}

export interface TerritoryState {
  key: string;
  id: string;
  city: string | null;
  tier: string | null;
  priority: string;
  slots: number;
  pins: string[];
  excludedPins: ResolvedTerritory["excludedPins"];
  blocked: boolean;
  /** Applicants holding or offered a slot here. */
  reserved: { appKey: string; appId: string; pin: string; status: Status }[];
  /** Slot-contest losers, in rank order. */
  waitlist: string[];
  /** Territory pins with no reservation and no eligible applicant ("recruit here"). */
  whiteSpacePins: string[];
  /** When locked partners exceed the slots now set. */
  overCommitted: boolean;
}

export interface PendingOverride {
  appKey: string;
  status: Status;
  /** Applicants who would lose their slot; the user must confirm them. */
  wouldBump: string[];
  message: string;
}

export interface RejectedOverride {
  appKey: string;
  status: Status;
  message: string;
}

export interface EngineResult {
  today: string;
  profileId: string;
  decisions: DecisionRecord[];
  territories: TerritoryState[];
  issues: Issue[];
  /** Applications removed by a withdrawal fact. */
  withdrawn: string[];
  pendingOverrides: PendingOverride[];
  rejectedOverrides: RejectedOverride[];
  warnings: string[];
  invariantViolations: string[];
}

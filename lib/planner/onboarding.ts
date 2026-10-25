// Onboarding critical path (SPEC §7.1). Phase 3 needs only the earliest feasible launch for ranking;
// the full milestone plan builds on these same durations in Phase 4.

import type { BrandProfile } from "@/lib/policy/types";
import { addDays } from "./dates";

/** Fixed step durations (days) that are not brand-specific. Shown as assumptions with the plan. */
export const STEP_DAYS = {
  letterOfIntent: 7,
  leasePaperwork: 14,
  stockAndPos: 7,
  mockAudit: 3,
  extendedTrainingExtra: 7,
} as const;

export interface PathInput {
  /** No space yet, or the space can't be used (location offer). */
  needsSpaceSearch: boolean;
  /** Rented space or a new space needs a lease; owned space doesn't. */
  needsLease: boolean;
  extendedTraining: boolean;
}

/**
 * Letter of intent → space search → lease → [licences ‖ fit-out ‖ hiring → training] → stock & POS → mock audit → launch.
 */
export function criticalPathDays(profile: BrandProfile, p: PathInput): number {
  const search = p.needsSpaceSearch && profile.noSpaceRule.kind === "condition" ? profile.noSpaceRule.days : 0;
  const lease = p.needsLease || p.needsSpaceSearch ? STEP_DAYS.leasePaperwork : 0;
  const training = profile.baseTrainingDays + (p.extendedTraining ? STEP_DAYS.extendedTrainingExtra : 0);
  const build = Math.max(
    profile.leadTimes.licencesDays,
    profile.leadTimes.fitOutDays,
    profile.leadTimes.hiringDays + training,
  );
  return STEP_DAYS.letterOfIntent + search + lease + build + STEP_DAYS.stockAndPos + STEP_DAYS.mockAudit;
}

export function earliestLaunch(today: string, profile: BrandProfile, p: PathInput): string {
  return addDays(today, criticalPathDays(profile, p));
}

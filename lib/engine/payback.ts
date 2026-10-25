// Payback estimate (SPEC §5): investment ÷ (monthly revenue × margin).
// The basis is the brand's standard investment for the tier, not the applicant's capacity: capacity
// above the standard isn't spent on the store, so using it would penalise better-funded partners.

import type { Tier } from "@/lib/policy/allowedValues";
import type { BrandProfile } from "@/lib/policy/types";
import { paybackMonths } from "@/lib/policy/brandProfiles";
import type { PaybackInfo } from "@/lib/types";

export function estimatePayback(tier: Tier, profile: BrandProfile): PaybackInfo {
  const basisLakh = profile.minInvestmentLakh[tier];
  const monthlyRevenueLakh = profile.monthlyRevenueLakh[tier];
  const months = Math.round(paybackMonths(basisLakh, monthlyRevenueLakh, profile.partnerMargin) * 10) / 10;
  return {
    months,
    basisLakh,
    monthlyRevenueLakh,
    margin: profile.partnerMargin,
    warning: months > profile.paybackWarningMonths,
  };
}

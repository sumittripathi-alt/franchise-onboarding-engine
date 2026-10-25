import type { Tier } from "./allowedValues";

export type BrandProfileId = "eyewear" | "delivery" | "partner_point";

export type TierValues = Record<Tier, number>;

/** How a space situation (a floor type, or no space yet) is treated by a profile. */
export type SpaceRule =
  | { kind: "ok" }
  | { kind: "condition"; days: number; text: string }
  | { kind: "reject"; text: string };

export interface LeadTimes {
  fitOutDays: number;
  licencesDays: number;
  hiringDays: number;
}

export interface BrandProfile {
  id: BrandProfileId;
  label: string;
  /** e.g. "Lenskart-style" — shown next to the label as an illustration only. */
  styleHint: string;
  description: string;

  /** Minimum investment in ₹ lakh per city tier. */
  minInvestmentLakh: TierValues;
  /** Below this fraction of the tier minimum the application is rejected. */
  hardFloorPct: number;

  space: { minSqft: number; idealMinSqft: number; idealMaxSqft: number };
  floorRules: { Ground: SpaceRule; Upper: SpaceRule; "Mall unit": SpaceRule };
  noSpaceRule: SpaceRule;

  experienceKeywords: string[];

  /** Zone 2 cannibalisation radius in km per tier. */
  cannibalisationRadiusKm: TierValues;

  monthlyRevenueLakh: TierValues;
  partnerMargin: number;
  paybackWarningMonths: number;

  leadTimes: LeadTimes;
  specialHiring: string | null;

  baseTrainingDays: number;
  trainingFormat: string;
  trainingModules: string[];

  /** Used when target launch is blank or invalid (check A13). */
  defaultTargetLaunchMonths: number;

  /** One-line rationale per assumption, shown in the Policy panel. */
  rationale: Partial<Record<PolicyKey, string>>;
}

export type PolicyKey = Exclude<
  keyof BrandProfile,
  "id" | "label" | "styleHint" | "description" | "rationale"
>;

/** The active policy: a profile plus any numbers the user edited in the Policy panel. */
export interface Policy {
  profileId: BrandProfileId;
  profile: BrandProfile;
}

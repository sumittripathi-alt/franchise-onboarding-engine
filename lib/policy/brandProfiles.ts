import type { BrandProfile, BrandProfileId, Policy } from "./types";

// Every number here is an assumption (SPEC §5). The Policy panel shows each with its rationale.
// The brand-wide "one store per pin code" rule is not a profile setting: it applies in every profile.

const eyewear: BrandProfile = {
  id: "eyewear",
  label: "Eyewear store",
  styleHint: "Lenskart-style",
  description: "Walk-in optical retail with an in-store eye test.",
  minInvestmentLakh: { "Tier 1": 30, "Tier 2": 20, "Tier 3": 15 },
  hardFloorPct: 0.7,
  space: { minSqft: 400, idealMinSqft: 500, idealMaxSqft: 1000 },
  floorRules: {
    Ground: { kind: "ok" },
    "Mall unit": { kind: "ok" },
    Upper: { kind: "condition", days: 45, text: "Move to a ground-floor space within 45 days" },
  },
  noSpaceRule: { kind: "condition", days: 45, text: "Find a suitable space within 45 days" },
  experienceKeywords: ["retail", "optical", "footwear", "apparel", "mobile shop"],
  cannibalisationRadiusKm: { "Tier 1": 1.5, "Tier 2": 2.5, "Tier 3": 4 },
  monthlyRevenueLakh: { "Tier 1": 8, "Tier 2": 6, "Tier 3": 4.5 },
  partnerMargin: 0.2,
  paybackWarningMonths: 36,
  leadTimes: { fitOutDays: 45, licencesDays: 30, hiringDays: 30 },
  specialHiring: "Certified optometrist",
  baseTrainingDays: 21,
  trainingFormat: "Classroom + in-store",
  trainingModules: [
    "Product and lens basics",
    "Eye-test workflow with the optometrist",
    "Point of sale",
    "Customer service",
    "Visual merchandising",
    "Inventory",
  ],
  defaultTargetLaunchMonths: 4,
  conditionDays: { confirmDetails: 7, proofOfFunds: 14, storeManager: 30, expansionSignOff: 7 },
  rationale: {
    minInvestmentLakh:
      "Fit-out, eye-test equipment and opening stock; calibrated so the template's own example (₹25 lakh, Tier 2 Mysuru) passes comfortably.",
    hardFloorPct: "Below 70% of the minimum, a partner cannot fund fit-out even with a loan.",
    space: "Needs room for a testing room, display and try-on area.",
    floorRules: "Walk-in footfall drops sharply above ground level.",
    noSpaceRule: "Good partners can still secure a slot while they find space.",
    cannibalisationRadiusKm: "Typical walk-in catchment by city density.",
    monthlyRevenueLakh: "Indicative store revenue by tier, used only for the payback estimate.",
    partnerMargin: "Indicative partner share after brand cost of goods.",
    paybackWarningMonths: "Beyond 3 years, partner fatigue and churn risk rise.",
    leadTimes: "Typical Karnataka timelines for fit-out, licences and hiring.",
    specialHiring: "An eye test needs a certified optometrist on site.",
    baseTrainingDays: "Product, eye-test workflow and POS before launch.",
    defaultTargetLaunchMonths: "Used when the applicant gives no valid target.",
    conditionDays: "A week to confirm details or get sign-off, two weeks for proof of funds, a month to name a store manager.",
  },
};

const delivery: BrandProfile = {
  id: "delivery",
  label: "Delivery centre",
  styleHint: "Delhivery-style",
  description: "Last-mile parcel hub with riders and vans.",
  minInvestmentLakh: { "Tier 1": 15, "Tier 2": 12, "Tier 3": 10 },
  hardFloorPct: 0.7,
  space: { minSqft: 600, idealMinSqft: 800, idealMaxSqft: 2000 },
  floorRules: {
    Ground: { kind: "ok" },
    "Mall unit": {
      kind: "condition",
      days: 30,
      text: "Relocate to a ground-floor space with van access within 30 days",
    },
    Upper: { kind: "condition", days: 30, text: "Move to a ground-floor space within 30 days" },
  },
  noSpaceRule: { kind: "condition", days: 30, text: "Find a suitable space within 30 days" },
  experienceKeywords: ["courier", "logistics", "transport", "fleet", "warehouse"],
  cannibalisationRadiusKm: { "Tier 1": 3, "Tier 2": 5, "Tier 3": 8 },
  monthlyRevenueLakh: { "Tier 1": 5, "Tier 2": 4, "Tier 3": 3 },
  partnerMargin: 0.15,
  paybackWarningMonths: 30,
  leadTimes: { fitOutDays: 21, licencesDays: 21, hiringDays: 15 },
  specialHiring: "Riders + supervisor",
  baseTrainingDays: 10,
  trainingFormat: "Classroom + on-floor",
  trainingModules: [
    "Inbound and sorting",
    "Last-mile dispatch and routing",
    "Cash on delivery and reconciliation",
    "Returns handling",
    "Rider safety and compliance",
    "Hub software",
  ],
  defaultTargetLaunchMonths: 3,
  conditionDays: { confirmDetails: 7, proofOfFunds: 14, storeManager: 30, expansionSignOff: 7 },
  rationale: {
    minInvestmentLakh: "Racking, sorting area, deposits and working capital.",
    hardFloorPct: "Below 70% of the minimum, the hub cannot cover working capital.",
    space: "Sorting and loading need a larger floor plate.",
    floorRules: "Vans need direct ground-level access; malls rarely allow it.",
    noSpaceRule: "Hubs are simpler to find, so the deadline is shorter.",
    cannibalisationRadiusKm: "Delivery zones are larger than walk-in catchments.",
    monthlyRevenueLakh: "Indicative per-hub revenue, used only for the payback estimate.",
    partnerMargin: "Indicative partner share per parcel.",
    paybackWarningMonths: "Lower capital, so a shorter acceptable payback.",
    leadTimes: "Lighter fit-out than retail.",
    specialHiring: "Riders and a shift supervisor are needed from day one.",
    baseTrainingDays: "Operations-focused training.",
    defaultTargetLaunchMonths: "Used when the applicant gives no valid target.",
    conditionDays: "A week to confirm details or get sign-off, two weeks for proof of funds, a month to name a store manager.",
  },
};

const partnerPoint: BrandProfile = {
  id: "partner_point",
  label: "Partner point",
  styleHint: 'Amazon "I Have Space"-style',
  description: "An existing local shop that also handles parcel pickup and drop-off.",
  minInvestmentLakh: { "Tier 1": 1, "Tier 2": 1, "Tier 3": 1 },
  hardFloorPct: 0.5,
  space: { minSqft: 100, idealMinSqft: 150, idealMaxSqft: 400 },
  floorRules: {
    Ground: { kind: "ok" },
    "Mall unit": { kind: "ok" },
    Upper: { kind: "reject", text: "Customers walk in to collect parcels, so the shop must be at ground level" },
  },
  noSpaceRule: { kind: "reject", text: "This model needs an existing, running shop" },
  experienceKeywords: ["kirana", "pharmacy", "mobile shop", "shop", "store"],
  cannibalisationRadiusKm: { "Tier 1": 1, "Tier 2": 1.5, "Tier 3": 2 },
  monthlyRevenueLakh: { "Tier 1": 0.6, "Tier 2": 0.5, "Tier 3": 0.4 },
  partnerMargin: 0.6,
  paybackWarningMonths: 12,
  leadTimes: { fitOutDays: 3, licencesDays: 7, hiringDays: 0 },
  specialHiring: null,
  baseTrainingDays: 2,
  trainingFormat: "App-based",
  trainingModules: ["Partner app", "Parcel handover and returns", "Customer service"],
  defaultTargetLaunchMonths: 1,
  conditionDays: { confirmDetails: 7, proofOfFunds: 14, storeManager: 30, expansionSignOff: 7 },
  rationale: {
    minInvestmentLakh: "Only a shelf, scanner and signage are needed.",
    hardFloorPct: "Very low entry cost, so a looser floor.",
    space: "A corner of an existing shop is enough.",
    floorRules: "Customers walk in to collect parcels.",
    noSpaceRule: "The model is built on an existing running shop.",
    cannibalisationRadiusKm: "Pickup points serve a few streets each.",
    monthlyRevenueLakh: "Commission income, used only for the payback estimate.",
    partnerMargin: "Commission-based, so the partner keeps most of it.",
    paybackWarningMonths: "Tiny investment, so payback should be quick.",
    leadTimes: "No fit-out or hiring to speak of.",
    baseTrainingDays: "Self-serve app training.",
    defaultTargetLaunchMonths: "Used when the applicant gives no valid target.",
    conditionDays: "A week to confirm details or get sign-off, two weeks for proof of funds, a month to name a store manager.",
  },
};

export const BRAND_PROFILES: Record<BrandProfileId, BrandProfile> = {
  eyewear,
  delivery,
  partner_point: partnerPoint,
};

export const DEFAULT_PROFILE_ID: BrandProfileId = "eyewear";

export function defaultPolicy(profileId: BrandProfileId = DEFAULT_PROFILE_ID): Policy {
  return { profileId, profile: structuredClone(BRAND_PROFILES[profileId]) };
}

/** Payback in months = investment ÷ (monthly revenue × margin). */
export function paybackMonths(investmentLakh: number, monthlyRevenueLakh: number, margin: number): number {
  return investmentLakh / (monthlyRevenueLakh * margin);
}

/** A location offer is a soft hold for this many days (SPEC §6.1). */
export const OFFER_HOLD_DAYS = 7;
/** A provisional win stays provisional for this many days (SPEC §15.4). */
export const PROVISIONAL_DAYS = 7;

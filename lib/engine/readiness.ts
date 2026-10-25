// Readiness assessment (SPEC §6.3), hard gates (§6.2 step 3) and timeline feasibility (§7.1, §15.7).

import { CITIES, type Tier } from "@/lib/policy/allowedValues";
import type { BrandProfile } from "@/lib/policy/types";
import { describesRunningShop } from "@/lib/ingest/heuristics";
import { personKey } from "@/lib/ingest/normalise";
import { festivalDate } from "@/lib/planner/calendar";
import { addMonths, daysBetween, formatDate } from "@/lib/planner/dates";
import { earliestLaunch } from "@/lib/planner/onboarding";
import type { Application, Band, Bands, Flag, Issue, LaunchInfo, ReasonCode, Signals } from "@/lib/types";

export type SpaceType = "none" | "Rented" | "Owned";
export type TrainingTrack = "Fast-track" | "Standard" | "Extended";

/** A condition before deadlines' knock-on effects are known. */
export interface ConditionDraft {
  source: ReasonCode;
  /** Imperative, e.g. "Move to a ground-floor space within 45 days". */
  text: string;
  /** Third person, for the one-line why, e.g. "moves to a ground-floor space". */
  short: string;
  days: number;
  owner: "partner" | "team";
}

/** "Move to a ground-floor space within 45 days" → "moves to a ground-floor space". */
export function thirdPerson(text: string): string {
  const t = text.replace(/\s+within \d+ days$/, "");
  const [verb, ...rest] = t.split(" ");
  const v = verb.toLowerCase();
  const s = /(s|sh|ch|x)$/.test(v) ? `${v}es` : /[^aeiou]y$/.test(v) ? `${v.slice(0, -1)}ies` : `${v}s`;
  return [s, ...rest].join(" ");
}

const partner = (source: ReasonCode, text: string, days: number, short = thirdPerson(text)): ConditionDraft => ({
  source,
  text,
  short,
  days,
  owner: "partner",
});

/** Max gap (days) between the earliest launch and the target before a target counts as not feasible. */
export const TIGHT_TIMELINE_DAYS = 14;

export interface Gate {
  code: "BELOW_HARD_FLOOR" | "PROFILE_REJECT_SPACE" | "PROFILE_REJECT_FLOOR";
  text: string;
  /** What would need to change to reapply. */
  fix: string;
}

export interface Assessment {
  app: Application;
  key: string;
  id: string;
  person: string;
  tier: Tier | null;
  signals: Signals;
  issues: Issue[];
  blocking: Issue[];
  gate: Gate | null;
  /** Null when the data needed for a band is missing (the application is then On hold). */
  bands: Bands | null;
  spaceType: SpaceType;
  /** Plain-English description of the space position, e.g. "a rented ground-floor space of 550 sq ft". */
  spaceText: string;
  experienceText: string;
  investment: number | null;
  minInvestment: number | null;
  /** Conditions attached to the applicant's own space and situation. */
  conditions: ConditionDraft[];
  /** Conditions that still apply if they move to an offered location (funds, store manager). */
  portableConditions: ConditionDraft[];
  flags: Flag[];
  track: TrainingTrack;
  launch: LaunchInfo;
  /** Earliest launch if they must find a new space (location offers). */
  launchIfNewSpace: string;
  /** Suggestions that don't change the status (e.g. a lower-tier city the investment fits). */
  suggestions: string[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const lakh = (x: number) => `₹${Number.isInteger(x) ? x : x.toFixed(1)} lakh`;

export function capitalThresholds(profile: BrandProfile, tier: Tier) {
  const min = profile.minInvestmentLakh[tier];
  return { min, floor: round2(min * profile.hardFloorPct), band3: round2(min * 1.2) };
}

function evaluateSpace(app: Application, profile: BrandProfile) {
  const conditions: ConditionDraft[] = [];
  const flags: Flag[] = [];
  let gate: Gate | null = null;
  const sa = app.spaceAvailable.value;
  const type: SpaceType = sa === "Owned" ? "Owned" : sa === "Rented" ? "Rented" : "none";

  if (type === "none") {
    const rule = profile.noSpaceRule;
    if (rule.kind === "reject") {
      gate = {
        code: "PROFILE_REJECT_SPACE",
        text: `${rule.text}, and no space has been identified yet`,
        fix: "Reapply once you have a running shop with a ground-floor space",
      };
    } else if (rule.kind === "condition") {
      conditions.push(partner("SPACE_NOT_IDENTIFIED", rule.text, rule.days, "finds a space"));
    }
    return { band: 1 as Band, type, text: "no space yet", conditions, flags, gate };
  }

  let band: Band = 3;
  let floorWord: string;
  const floor = app.floor.value;
  if (floor === "Ground" || floor === "Upper" || floor === "Mall unit") {
    floorWord = floor === "Ground" ? "ground-floor space" : floor === "Upper" ? "upper-floor space" : "mall unit";
    const rule = profile.floorRules[floor];
    if (rule.kind === "reject") {
      gate = {
        code: "PROFILE_REJECT_FLOOR",
        text: rule.text,
        fix: "Reapply with a ground-floor space",
      };
    } else if (rule.kind === "condition") {
      band = 2;
      conditions.push(partner("FLOOR_NOT_SUITABLE", rule.text, rule.days));
    }
  } else {
    band = 2;
    floorWord = "space on an unconfirmed floor";
    conditions.push(
      partner("FLOOR_UNCONFIRMED", "Confirm which floor the space is on", profile.conditionDays.confirmDetails, "confirms which floor the space is on"),
    );
  }

  const size = app.spaceSqft.value;
  const min = profile.space.minSqft;
  let sizeText: string;
  if (size === null) {
    band = 2;
    sizeText = "of unconfirmed size";
    conditions.push(partner("SIZE_UNCONFIRMED", `Confirm the space is at least ${min} sq ft`, profile.conditionDays.confirmDetails));
  } else if (size < min) {
    band = 2;
    sizeText = `of ${size} sq ft, below the ${min} sq ft minimum`;
    conditions.push(
      partner(
        "SIZE_BELOW_MIN",
        `Find a space of at least ${min} sq ft; the current one is ${size} sq ft`,
        profile.noSpaceRule.kind === "condition" ? profile.noSpaceRule.days : 30,
        `finds a space of at least ${min} sq ft`,
      ),
    );
  } else {
    sizeText = `of ${size} sq ft`;
    if (size > 3 * profile.space.idealMaxSqft) {
      flags.push({
        code: "RENT_BURDEN_RISK",
        text: `Rent burden risk: ${size} sq ft is more than 3× the ideal maximum of ${profile.space.idealMaxSqft} sq ft.`,
      });
    }
  }
  const text = `${type === "Owned" ? "an owned" : "a rented"} ${floorWord} ${sizeText}`;
  return { band, type, text, conditions, flags, gate };
}

function isRelevant(app: Application, signals: Signals, profile: BrandProfile): string | null {
  const text = `${app.business} ${app.notes}`.toLowerCase();
  // The keyword that appears first in the text is usually the most specific ("Footwear retail" → footwear).
  const hits = profile.experienceKeywords
    .map((k) => ({ k, at: text.search(new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}`, "i")) }))
    .filter((h) => h.at >= 0)
    .sort((x, y) => x.at - y.at);
  if (hits.length) return hits[0].k;
  const sector = signals.relevant_sector?.toLowerCase();
  return sector && profile.experienceKeywords.includes(sector) ? sector : null;
}

function targetMonths(app: Application, profile: BrandProfile): number {
  const t = app.targetLaunchMonths.value;
  return t !== null && t > 0 && t <= 24 ? t : profile.defaultTargetLaunchMonths;
}

export function assess(
  app: Application,
  signals: Signals,
  issues: Issue[],
  profile: BrandProfile,
  today: string,
): Assessment {
  const city = app.city.value;
  const tier = city ? CITIES[city].tier : null;
  const flags: Flag[] = [];
  const conditions: ConditionDraft[] = [];
  const portable: ConditionDraft[] = [];
  const suggestions: string[] = [];
  const blocking = issues.filter((i) => i.severity === "blocking");

  // Space.
  const space = evaluateSpace(app, profile);
  conditions.push(...space.conditions);
  flags.push(...space.flags);
  let gate = space.gate;

  // Capital.
  const inv = app.investmentLakh.value;
  let capital: Band | null = null;
  let minInvestment: number | null = null;
  if (tier && inv !== null && inv > 0) {
    const th = capitalThresholds(profile, tier);
    minInvestment = th.min;
    if (inv < th.floor) {
      gate = {
        code: "BELOW_HARD_FLOOR",
        text: `${lakh(inv)} is below the ${lakh(th.min)} minimum for ${city} (${tier})`,
        fix: `Reapply with at least ${lakh(th.min)}, the ${tier} minimum for ${city}`,
      };
      const lower = lowerTierFit(profile, tier, inv);
      if (lower) suggestions.push(lower);
    }
    capital = inv >= th.band3 ? 3 : inv >= th.min ? 2 : 1;
  }
  // A shortfall says how the gap is filled; never ask for proof of more than was declared without that.
  if (capital === 1 && tier && inv !== null) {
    const gap = round2(capitalThresholds(profile, tier).min - inv);
    const c = partner(
      "PROOF_OF_FUNDS",
      `Arrange the remaining ${lakh(gap)} (loan or co-investor) and share proof`,
      profile.conditionDays.proofOfFunds,
      `arranges the remaining ${lakh(gap)}`,
    );
    conditions.push(c);
    portable.push(c);
  } else if (signals.funding_dependency) {
    const c = partner("PROOF_OF_FUNDS", "Share proof of funds or a loan sanction letter", profile.conditionDays.proofOfFunds, "shares proof of funds");
    conditions.push(c);
    portable.push(c);
  }

  // Experience.
  const declared = app.experienceYears.value ?? 0;
  const textDescribesShop = describesRunningShop(`${app.business}. ${app.notes}`);
  const signalYears = signals.years_running_shop_mentioned ?? 0;
  const underReported = declared === 0 && (signalYears > 0 || textDescribesShop);
  const years = underReported && signalYears > 0 ? signalYears : Math.max(0, declared);
  if (underReported) {
    flags.push({
      code: "EXPERIENCE_UNDER_REPORTED",
      text: `Experience under-reported: the form says 0 years, but the text describes running a shop${signalYears ? ` for ${signalYears} years` : ""}.`,
    });
  }
  const relevant = isRelevant(app, signals, profile);
  const experience: Band = years >= 3 && relevant ? 3 : years > 0 || textDescribesShop ? 2 : 1;
  const yrs = `${years} year${years === 1 ? "" : "s"}`;
  const experienceText =
    experience === 3
      ? `${yrs} of relevant ${relevant} experience`
      : experience === 2
        ? relevant
          ? `${yrs} of ${relevant} experience`
          : `${yrs} of general business experience`
        : "no business experience";
  const track: TrainingTrack = experience === 3 ? "Fast-track" : experience === 2 ? "Standard" : "Extended";

  if (signals.absentee_owner) {
    const c = partner(
      "STORE_MANAGER",
      "Name the store manager who will run the store; they must also complete training",
      profile.conditionDays.storeManager,
      "names a store manager",
    );
    conditions.push(c);
    portable.push(c);
  }
  if (signals.injection_attempt) {
    const quote = signals.evidence?.injection_attempt;
    flags.push({
      code: "INTEGRITY_CONCERN",
      text: `The notes contained instructions to the system${quote ? ` ("${quote}")` : ""}. They were ignored, and the application was assessed normally.`,
    });
  }

  // Timeline.
  const needsLease = space.type === "Rented";
  const extended = experience === 1;
  const earliest = earliestLaunch(today, profile, { needsSpaceSearch: space.type === "none", needsLease, extendedTraining: extended });
  const target = addMonths(today, targetMonths(app, profile));
  const fest = festivalDate(signals.festival_deadline, today);
  const testDate = fest && fest.date < target ? fest.date : target;
  const gapDays = daysBetween(testDate, earliest);
  const feasible = gapDays <= 0;
  if (fest && target > fest.date) {
    flags.push({
      code: "NOTES_TARGET_DISAGREE",
      text: `Notes and target launch disagree: the notes say before ${fest.name} (${formatDate(fest.date)}, verify), but the target launch is ${formatDate(target)}. The earlier date was used.`,
    });
  }
  const what = fest && testDate === fest.date ? `opening before ${fest.name} (${formatDate(fest.date)})` : `opening by ${formatDate(target)}`;
  if (gapDays > TIGHT_TIMELINE_DAYS) {
    flags.push({
      code: "TARGET_NOT_FEASIBLE",
      text: `Target not feasible: ${what} isn't possible; the earliest realistic date is ${formatDate(earliest)}.${space.type === "none" ? " A soft launch is possible once the space is fitted out." : ""}`,
    });
  } else if (gapDays > 0) {
    flags.push({
      code: "TIGHT_TIMELINE",
      text: `Tight timeline: ${what} is ${gapDays} day${gapDays === 1 ? "" : "s"} earlier than the earliest realistic date (${formatDate(earliest)}). Possible if every step runs to plan.`,
    });
  }

  const bands: Bands | null =
    capital === null ? null : { space: space.band, capital, experience };

  return {
    app,
    key: app.key,
    id: app.id,
    person: personKey(app.name),
    tier,
    signals,
    issues,
    blocking,
    gate,
    bands,
    spaceType: space.type,
    spaceText: space.text,
    experienceText,
    investment: inv,
    minInvestment,
    conditions,
    portableConditions: portable,
    flags,
    track,
    launch: { earliest, target, festival: fest ? { name: fest.name, date: fest.date } : null, testDate, feasible, gapDays },
    launchIfNewSpace: earliestLaunch(today, profile, { needsSpaceSearch: true, needsLease: true, extendedTraining: extended }),
    suggestions,
  };
}

const TIER_ORDER: Tier[] = ["Tier 1", "Tier 2", "Tier 3"];

/** "Your ₹15 lakh meets the Tier 3 minimum. Would you consider Tumakuru or Davanagere?" (a suggestion only). */
function lowerTierFit(profile: BrandProfile, tier: Tier, inv: number): string | null {
  for (const t of TIER_ORDER.slice(TIER_ORDER.indexOf(tier) + 1)) {
    if (inv >= profile.minInvestmentLakh[t]) {
      const cities = Object.values(CITIES).filter((c) => c.tier === t).map((c) => c.name);
      const list = cities.length > 1 ? `${cities.slice(0, -1).join(", ")} or ${cities[cities.length - 1]}` : cities[0];
      return `Your ${lakh(inv)} meets the ${t} minimum. Would you consider ${list}?`;
    }
  }
  return null;
}

// Personalised training plan (SPEC §7.2): track by experience band, language, a Kannada module where
// needed, shadowing at an existing store outside the new store's catchment, how the hired team is
// prepared, cohorts that share a real start date, and a readiness check before launch.

import type { ExistingStore } from "@/data/existingStores";
import { haversineKm, type LatLng } from "@/lib/geo/distance";
import { PIN_DATA_META, getPin, pinLatLng } from "@/lib/geo/pins";
import type { Language } from "@/lib/policy/allowedValues";
import type { BrandProfile } from "@/lib/policy/types";
import { daysBetween, formatDate } from "./dates";

export type TrainingTrack = "Fast-track" | "Standard" | "Extended";

export const KANNADA_MODULE = "Local customer basics in Kannada";
const EXTENDED_MODULES = ["Basic store operations", "Finance basics: cash, GST and margins"];

/** Cohort members' planned training starts must be within this many days of each other. */
export const COHORT_WINDOW_DAYS = 10;

export function trainingDays(profile: BrandProfile, track: TrainingTrack): number {
  return Math.max(1, profile.baseTrainingDays + profile.trainingTrackAdjustDays[track]);
}

export interface ShadowPlacement {
  storeId: string;
  storeCity: string;
  pin: string;
  /** Distance from the new store's location, or null if a location is unknown. */
  km: number | null;
  days: number;
  /** Why this store, e.g. "next nearest existing store. Not ST-06: it's within the new store's catchment". */
  note: string;
  /** Nearer stores that were skipped because they are inside the new store's catchment. */
  skipped: string[];
}

export interface TrainingModule {
  name: string;
  note: string | null;
}

/** "How your team will be prepared" (hired staff, not the partner). */
export interface TeamPreparation {
  heading: "How your team will be prepared";
  who: string;
  topics: string[];
  days: number;
  start: string;
  end: string;
  /** Hiring ends before the induction starts. */
  hiringEnds: string;
  text: string;
}

export interface TrainingPlan {
  track: TrainingTrack;
  trackReason: string;
  days: number;
  format: string;
  /** Language of materials and trainer. */
  language: Language;
  modules: TrainingModule[];
  /** "Recommend hiring at least one Kannada-speaking staff member", when relevant. */
  staffingNote: string | null;
  shadow: ShadowPlacement | null;
  /** Trains the named store manager too (absentee owner, A17). */
  storeManagerAttends: boolean;
  teamPreparation: TeamPreparation | null;
  readinessCheck: { item: string; due: string }[];
  start: string;
  end: string;
  /** Days training could start later without moving the opening date. */
  slackDays: number;
  /** Set when training was moved later to share a cohort's start date. */
  shifted: { from: string; to: string; text: string } | null;
  /** Filled when cohorts are built. */
  cohortId: string | null;
  /** One line for the decision sheet: "how they'll be prepared". */
  summary: string;
}

/** City centres from the pincode dataset, for locating pins with unknown coordinates. */
function cityCentre(city: string | null): LatLng | null {
  const c = city ? (PIN_DATA_META as unknown as { cities: Record<string, { centre: [number, number] }> }).cities[city] : undefined;
  return c ? { lat: c.centre[0], lng: c.centre[1] } : null;
}

/**
 * The store the partner will shadow: the nearest existing store that is NOT inside the new store's
 * catchment (the store the partner will compete with). Coordinates of any confidence are used here, because
 * this only chooses a store to visit: a wrong guess means visiting a slightly different store, not a wrong decision.
 * Tier 3 cities have no stores, so the nearest store is in another city.
 */
export function shadowStore(
  pin: string | null,
  city: string | null,
  stores: readonly ExistingStore[],
  days: number,
  catchmentKm = 0,
): ShadowPlacement | null {
  const here = (pin ? pinLatLng(pin) : null) ?? cityCentre(city);
  if (!here || stores.length === 0) return null;
  const ranked = stores
    .flatMap((s) => {
      const at = pinLatLng(s.pin);
      return at ? [{ s, km: haversineKm(here, at) }] : [];
    })
    .sort((a, b) => a.km - b.km || (a.s.id < b.s.id ? -1 : 1));
  if (ranked.length === 0) return null;

  const outside = ranked.find((r) => r.km > catchmentKm);
  const chosen = outside ?? ranked[0];
  const skipped = outside ? ranked.filter((r) => r.km <= catchmentKm).map((r) => r.s.id) : [];
  const approx = !pin || !pinLatLng(pin) || getPin(pin)?.confidence === "low" || getPin(pin)?.confidence === "none";

  const parts: string[] = [];
  if (chosen.s.city !== city) {
    parts.push(`${city ?? "This city"} has no existing stores yet; the nearest is in ${chosen.s.city}`);
  } else {
    parts.push(skipped.length ? "next nearest existing store" : "nearest existing store");
  }
  if (approx) parts.push("distance approximate: the pin's location is uncertain");
  let note = parts.length > 1 ? `${parts[0]} (${parts.slice(1).join("; ")})` : parts[0];
  if (skipped.length) {
    note += `. Not ${skipped.join(" or ")}: ${skipped.length === 1 ? "it's" : "they're"} within the new store's catchment`;
  } else if (!outside) {
    note += ". Every existing store is within the new store's catchment, so this is the nearest";
  }
  return {
    storeId: chosen.s.id,
    storeCity: chosen.s.city,
    pin: chosen.s.pin,
    km: Math.round(chosen.km * 10) / 10,
    days,
    note,
    skipped,
  };
}

/** The one-line "how they'll be prepared", rebuilt whenever the plan's dates change. */
export function trainingSummary(
  t: Pick<TrainingPlan, "track" | "language" | "days" | "start" | "shadow" | "storeManagerAttends" | "teamPreparation" | "modules">,
): string {
  const needsKannada = t.modules.some((m) => m.name === KANNADA_MODULE);
  return (
    `${t.track} training in ${t.language}, ${t.days} days from ${formatDate(t.start)}` +
    (t.shadow ? `; shadowing ${t.shadow.days} day${t.shadow.days === 1 ? "" : "s"} at ${t.shadow.storeId} (${t.shadow.storeCity})` : "") +
    (needsKannada ? "; plus Kannada customer basics" : "") +
    (t.storeManagerAttends ? "; the store manager trains too" : "") +
    (t.teamPreparation ? `; team induction ${formatDate(t.teamPreparation.start)}` : "")
  );
}

export function buildTrainingPlan(args: {
  profile: BrandProfile;
  track: TrainingTrack;
  experienceText: string;
  language: Language | null;
  storeManager: boolean;
  pin: string | null;
  city: string | null;
  stores: readonly ExistingStore[];
  /** The new store's cannibalisation inner radius: stores inside it are never the shadow store. */
  catchmentKm: number;
  /** Training block dates from the onboarding plan. */
  start: string;
  end: string;
  /** Latest date training may end without moving the opening (the mock audit start). */
  auditStart: string;
  /** Mock audit end date (readiness check). */
  auditEnd: string;
  induction: { start: string; end: string } | null;
  hiringEnd: string;
}): TrainingPlan {
  const { profile, track } = args;
  const language: Language = args.language ?? "English";
  const modules: TrainingModule[] = profile.trainingModules.map((name, i) => ({
    name,
    note: track === "Fast-track" && i === 0 ? "Can be tested out by an experienced operator" : null,
  }));
  if (track === "Extended") for (const name of EXTENDED_MODULES) modules.push({ name, note: "Extended track" });
  // All stores are in Karnataka: Hindi or English speakers learn local customer basics.
  const needsKannada = language !== "Kannada";
  if (needsKannada) modules.push({ name: KANNADA_MODULE, note: `Preferred language is ${language}` });

  const shadowDays = profile.shadowDays[track];
  const shadow = shadowStore(args.pin, args.city, args.stores, shadowDays, args.catchmentKm);
  const days = daysBetween(args.start, args.end);
  const trackReason =
    track === "Fast-track"
      ? `experienced operator, ${args.experienceText}`
      : track === "Standard"
        ? `some business experience, ${args.experienceText}`
        : "no business experience yet, so it adds store operations and finance";

  const readinessCheck = [
    { item: "Product and process quiz", due: args.end },
    { item: "Mock audit", due: args.auditEnd },
    { item: "Trainer sign-off", due: args.auditEnd },
  ];

  const ind = profile.teamInduction;
  const teamPreparation: TeamPreparation | null =
    ind && args.induction
      ? {
          heading: "How your team will be prepared",
          who: ind.who,
          topics: ind.topics,
          days: ind.days,
          start: args.induction.start,
          end: args.induction.end,
          hiringEnds: args.hiringEnd,
          text: `${ind.who} are inducted for ${ind.days} days (${formatDate(args.induction.start)} to ${formatDate(args.induction.end)}), after hiring ends on ${formatDate(args.hiringEnd)} and the store is fitted out, in the last days before the mock audit. Topics: ${ind.topics.join("; ")}.`,
        }
      : null;

  const plan: TrainingPlan = {
    track,
    trackReason,
    days,
    format: profile.trainingFormat,
    language,
    modules,
    staffingNote: needsKannada ? "Recommend hiring at least one Kannada-speaking staff member." : null,
    shadow,
    storeManagerAttends: args.storeManager,
    teamPreparation,
    readinessCheck,
    start: args.start,
    end: args.end,
    slackDays: Math.max(0, daysBetween(args.end, args.auditStart)),
    shifted: null,
    cohortId: null,
    summary: "",
  };
  plan.summary = trainingSummary(plan);
  return plan;
}

// ---------- Cohorts ----------

export interface Cohort {
  id: string;
  label: string;
  city: string;
  language: Language;
  /** The shared start date: every member's training starts on this day. */
  start: string;
  members: { appId: string; appKey: string; plannedStart: string; start: string; shiftedDays: number; launch: string }[];
}

export interface CohortCandidate {
  appId: string;
  appKey: string;
  city: string;
  language: Language;
  /** Earliest the partner's training can start (hiring done). */
  earliestStart: string;
  /** Latest start that doesn't move the opening date. */
  latestStart: string;
  launch: string;
}

/**
 * Group partners by language and city whose planned training starts are within `windowDays` of each other
 * (SPEC §7.2). A cohort has one shared start date. A partner with slack is moved later to that date, but only
 * if their opening date doesn't move. The date chosen is the one that fits the most partners (earliest on a tie).
 * Groups of one aren't cohorts.
 */
export function buildCohorts(candidates: CohortCandidate[], windowDays = COHORT_WINDOW_DAYS): Cohort[] {
  const groups = new Map<string, CohortCandidate[]>();
  for (const c of candidates) groups.set(`${c.language}|${c.city}`, [...(groups.get(`${c.language}|${c.city}`) ?? []), c]);
  const cohorts: Cohort[] = [];
  for (const key of [...groups.keys()].sort()) {
    const [language, city] = key.split("|") as [Language, string];
    let pool = [...groups.get(key)!].sort((a, b) =>
      a.earliestStart < b.earliestStart ? -1 : a.earliestStart > b.earliestStart ? 1 : a.appId < b.appId ? -1 : 1,
    );
    let n = 0;
    for (;;) {
      let best: { date: string; members: CohortCandidate[] } | null = null;
      for (const anchor of pool) {
        const date = anchor.earliestStart;
        const members = pool.filter((p) => p.earliestStart <= date && daysBetween(p.earliestStart, date) <= windowDays && date <= p.latestStart);
        if (members.length >= 2 && (!best || members.length > best.members.length || (members.length === best.members.length && date < best.date))) {
          best = { date, members };
        }
      }
      if (!best) break;
      n++;
      const date = best.date;
      const ids = best.members.map((m) => m.appId).sort();
      cohorts.push({
        id: `${language}-${city}-${n}`,
        label: `${language} cohort, ${city}, starts ${formatDate(date)}: ${ids.join(", ")}`,
        city,
        language,
        start: date,
        members: [...best.members]
          .sort((a, b) => (a.appId < b.appId ? -1 : 1))
          .map((m) => ({
            appId: m.appId,
            appKey: m.appKey,
            plannedStart: m.earliestStart,
            start: date,
            shiftedDays: daysBetween(m.earliestStart, date),
            launch: m.launch,
          })),
      });
      const taken = new Set(best.members.map((m) => m.appKey));
      pool = pool.filter((p) => !taken.has(p.appKey));
    }
  }
  return cohorts;
}

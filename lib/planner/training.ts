// Personalised training plan (SPEC §7.2): track by experience band, language, a Kannada module where
// needed, shadowing at the nearest existing store, cohorts, and a readiness check before launch.

import type { ExistingStore } from "@/data/existingStores";
import { haversineKm, type LatLng } from "@/lib/geo/distance";
import { PIN_DATA_META, getPin, pinLatLng } from "@/lib/geo/pins";
import type { Language } from "@/lib/policy/allowedValues";
import type { BrandProfile } from "@/lib/policy/types";
import { daysBetween, formatDate } from "./dates";

export type TrainingTrack = "Fast-track" | "Standard" | "Extended";

export const KANNADA_MODULE = "Local customer basics in Kannada";
const EXTENDED_MODULES = ["Basic store operations", "Finance basics: cash, GST and margins"];

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
  /** Why this store, e.g. "nearest existing store" or "Tumakuru has no stores yet; nearest store is in Bengaluru". */
  note: string;
}

export interface TrainingModule {
  name: string;
  note: string | null;
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
  readinessCheck: { item: string; due: string }[];
  start: string;
  end: string;
  /** Filled by buildCohorts. */
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
 * The nearest existing store to the new location. Uses the pin's coordinates (any confidence, since this
 * only chooses a store to visit); if the pin has none, the city centre. Tier 3 cities have no stores, so
 * the nearest store is in another city.
 */
export function shadowStore(
  pin: string | null,
  city: string | null,
  stores: readonly ExistingStore[],
  days: number,
): ShadowPlacement | null {
  const here = (pin ? pinLatLng(pin) : null) ?? cityCentre(city);
  if (!here || stores.length === 0) return null;
  let best: { s: ExistingStore; km: number } | null = null;
  for (const s of stores) {
    const at = pinLatLng(s.pin);
    if (!at) continue;
    const km = haversineKm(here, at);
    if (!best || km < best.km || (km === best.km && s.id < best.s.id)) best = { s, km };
  }
  if (!best) return null;
  const sameCity = best.s.city === city;
  const approx = !pin || !pinLatLng(pin) || getPin(pin)?.confidence === "low" || getPin(pin)?.confidence === "none";
  return {
    storeId: best.s.id,
    storeCity: best.s.city,
    pin: best.s.pin,
    km: Math.round(best.km * 10) / 10,
    days,
    note: sameCity
      ? `nearest existing store${approx ? " (distance approximate: the pin's location is uncertain)" : ""}`
      : `${city ?? "This city"} has no existing stores yet; the nearest is in ${best.s.city}`,
  };
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
  /** Training block dates from the onboarding plan. */
  start: string;
  end: string;
  /** Mock audit end date (readiness check). */
  auditEnd: string;
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
  const shadow = shadowStore(args.pin, args.city, args.stores, shadowDays);
  const days = daysBetween(args.start, args.end);
  const trackReason =
    track === "Fast-track"
      ? `experienced operator (${args.experienceText})`
      : track === "Standard"
        ? `some business experience (${args.experienceText})`
        : "no business experience yet, so it adds store operations and finance";

  const readinessCheck = [
    { item: "Product and process quiz", due: args.end },
    { item: "Mock audit", due: args.auditEnd },
    { item: "Trainer sign-off", due: args.auditEnd },
  ];

  const summary =
    `${track} training in ${language}, ${days} days from ${formatDate(args.start)}` +
    (shadow ? `; shadowing ${shadowDays} day${shadowDays === 1 ? "" : "s"} at ${shadow.storeId} (${shadow.storeCity})` : "") +
    (needsKannada ? "; plus Kannada customer basics" : "") +
    (args.storeManager ? "; the store manager trains too" : "");

  return {
    track,
    trackReason,
    days,
    format: profile.trainingFormat,
    language,
    modules,
    staffingNote: needsKannada ? "Recommend hiring at least one Kannada-speaking staff member." : null,
    shadow,
    storeManagerAttends: args.storeManager,
    readinessCheck,
    start: args.start,
    end: args.end,
    cohortId: null,
    summary,
  };
}

export interface Cohort {
  id: string;
  label: string;
  city: string;
  language: Language;
  /** The trainer's first batch starts when the earliest member's training starts. */
  start: string;
  members: { appId: string; appKey: string; trainingStart: string; launch: string }[];
}

/**
 * Group partners by language and city whose launch dates fall within 30 days of the group's first launch
 * (SPEC §7.2). Groups of one aren't cohorts.
 */
export function buildCohorts(
  partners: { appId: string; appKey: string; city: string; language: Language; trainingStart: string; launch: string }[],
  windowDays = 30,
): Cohort[] {
  const groups = new Map<string, typeof partners>();
  for (const p of partners) {
    const k = `${p.language}|${p.city}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const cohorts: Cohort[] = [];
  for (const k of [...groups.keys()].sort()) {
    const list = [...groups.get(k)!].sort((a, b) => (a.launch < b.launch ? -1 : a.launch > b.launch ? 1 : a.appId < b.appId ? -1 : 1));
    let batch: typeof list = [];
    const flush = () => {
      if (batch.length >= 2) {
        const [language, city] = k.split("|") as [Language, string];
        const start = batch.map((b) => b.trainingStart).sort()[0];
        const id = `${language}-${city}-${cohorts.filter((c) => c.city === city && c.language === language).length + 1}`;
        cohorts.push({
          id,
          label: `${language} cohort, ${city}, starts ${formatDate(start)}: ${batch.map((b) => b.appId).sort().join(", ")}`,
          city,
          language,
          start,
          members: batch.map(({ appId, appKey, trainingStart, launch }) => ({ appId, appKey, trainingStart, launch })),
        });
      }
      batch = [];
    };
    for (const p of list) {
      if (batch.length && daysBetween(batch[0].launch, p.launch) > windowDays) flush();
      batch.push(p);
    }
    flush();
  }
  return cohorts;
}

// Editable assumptions (SPEC §14, Phase 8). A short list of the business numbers a team may want to change,
// each with a sensible range. Edits are never applied blindly: every value is checked against its range and the
// whole profile is checked for consistency, here and again on the server. Pure functions; no React.

import type { DiffSummary } from "@/lib/chat/diff";
import { BRAND_PROFILES } from "./brandProfiles";
import type { BrandProfile, BrandProfileId } from "./types";

export interface PolicyEdit {
  /** A path into the profile, e.g. "minInvestmentLakh.Tier 1" or "conditionDays.proofOfFunds". */
  path: string;
  value: number;
}

export interface EditableField {
  path: string;
  group: "Money" | "Distance" | "Deadlines" | "Waitlist and training";
  label: string;
  unit: string;
  min: number;
  max: number;
  integer: boolean;
  /** Shown to the user as value × scale (a fraction shown as a percentage). */
  scale: number;
  step: number;
}

const f = (path: string, group: EditableField["group"], label: string, unit: string, min: number, max: number, integer = false, scale = 1, step = integer ? 1 : 0.5): EditableField => ({ path, group, label, unit, min, max, integer, scale, step });

export const EDITABLE: EditableField[] = [
  f("minInvestmentLakh.Tier 1", "Money", "Minimum investment, Tier 1 cities", "₹ lakh", 1, 500),
  f("minInvestmentLakh.Tier 2", "Money", "Minimum investment, Tier 2 cities", "₹ lakh", 1, 500),
  f("minInvestmentLakh.Tier 3", "Money", "Minimum investment, Tier 3 cities", "₹ lakh", 1, 500),
  f("hardFloorPct", "Money", "Hard floor: below this share of the minimum, not approved", "% of the minimum", 0.3, 0.95, false, 100, 5),
  f("paybackWarningMonths", "Money", "Payback warning threshold", "months", 6, 120, true),
  f("cannibalisationRadiusKm.Tier 1", "Distance", "Distance from an existing store, Tier 1", "km", 0.1, 20, false, 1, 0.1),
  f("cannibalisationRadiusKm.Tier 2", "Distance", "Distance from an existing store, Tier 2", "km", 0.1, 20, false, 1, 0.1),
  f("cannibalisationRadiusKm.Tier 3", "Distance", "Distance from an existing store, Tier 3", "km", 0.1, 20, false, 1, 0.1),
  f("space.minSqft", "Distance", "Minimum space", "sq ft", 100, 5000, true),
  f("conditionDays.confirmDetails", "Deadlines", "Days to confirm details", "days", 1, 60, true),
  f("conditionDays.proofOfFunds", "Deadlines", "Days to show proof of funds", "days", 1, 90, true),
  f("conditionDays.storeManager", "Deadlines", "Days to name a store manager", "days", 1, 120, true),
  f("conditionDays.expansionSignOff", "Deadlines", "Days for internal sign-off", "days", 1, 60, true),
  f("waitlistReviewDays", "Waitlist and training", "Days between waitlist reviews", "days", 1, 90, true),
  f("preOnboarding.topN", "Waitlist and training", "Waitlisted per city who start pre-onboarding early", "people", 0, 10, true),
  f("baseTrainingDays", "Waitlist and training", "Base training days", "days", 3, 90, true),
];

const byPath = new Map(EDITABLE.map((e) => [e.path, e]));

export const EDITABLE_PATHS = EDITABLE.map((e) => e.path);

export function fieldFor(path: string): EditableField | undefined {
  return byPath.get(path);
}

export function readValue(profile: BrandProfile, path: string): number {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], profile) as number;
}

function writeValue(profile: BrandProfile, path: string, value: number) {
  const keys = path.split(".");
  const last = keys.pop() as string;
  const target = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, profile as unknown as Record<string, unknown>);
  target[last] = value;
}

/** Why a single value can't be used, in words a person can act on; null if it can. */
export function validateEdit(path: string, value: unknown): string | null {
  const fld = byPath.get(path);
  if (!fld) return "That isn't a setting that can be changed.";
  if (typeof value !== "number" || !Number.isFinite(value)) return `${fld.label} needs a number.`;
  const show = (n: number) => `${Math.round(n * fld.scale * 100) / 100}`;
  if (fld.integer && !Number.isInteger(value)) return `${fld.label} must be a whole number.`;
  if (value < fld.min || value > fld.max) return `${fld.label} must be between ${show(fld.min)} and ${show(fld.max)} ${fld.unit}.`;
  return null;
}

/** Rules that span several settings. */
export function checkProfile(p: BrandProfile): string | null {
  if (p.space.minSqft > p.space.idealMinSqft) return `The minimum space (${p.space.minSqft} sq ft) can't be more than the ideal minimum (${p.space.idealMinSqft} sq ft).`;
  const m = p.minInvestmentLakh;
  if (m["Tier 1"] < m["Tier 2"] || m["Tier 2"] < m["Tier 3"]) return "Minimum investment can't be lower in a bigger city than in a smaller one (Tier 1 at least Tier 2, Tier 2 at least Tier 3).";
  const r = p.cannibalisationRadiusKm;
  if (r["Tier 1"] > r["Tier 2"] || r["Tier 2"] > r["Tier 3"]) return "The distance from an existing store can't be larger in a denser city (Tier 1 at most Tier 2, Tier 2 at most Tier 3).";
  return null;
}

/**
 * A profile with edits applied. Later edits to the same setting win. An invalid value is skipped, never applied. If
 * the edits together would make the profile inconsistent (two people changing related numbers at once), they are
 * applied one by one and any that would break it are skipped, so the profile always stays consistent.
 */
export function applyEdits(profile: BrandProfile, edits: PolicyEdit[] | undefined): BrandProfile {
  if (!edits?.length) return profile;
  const valid = edits.filter((e) => !validateEdit(e.path, e.value));
  const all = structuredClone(profile);
  for (const e of valid) writeValue(all, e.path, e.value);
  if (!checkProfile(all)) return all;
  let cur = structuredClone(profile);
  for (const e of valid) {
    const trial = structuredClone(cur);
    writeValue(trial, e.path, e.value);
    if (!checkProfile(trial)) cur = trial;
  }
  return cur;
}

/** Check a batch of edits against a profile: the first problem, or null. */
export function validateEdits(profile: BrandProfile, edits: PolicyEdit[]): string | null {
  for (const e of edits) {
    const p = validateEdit(e.path, e.value);
    if (p) return p;
  }
  const next = structuredClone(profile);
  for (const e of edits) writeValue(next, e.path, e.value);
  return checkProfile(next);
}

/** Edits to the default profile only (used by the server, which doesn't know what came before). */
export function validateAgainstDefaults(profileId: BrandProfileId, edits: PolicyEdit[]): string | null {
  return validateEdits(BRAND_PROFILES[profileId], edits);
}

/** "Minimum investment, Tier 1 cities from 30 to 40 ₹ lakh" */
export function describeEdit(profile: BrandProfile, e: PolicyEdit): string {
  const fld = byPath.get(e.path);
  if (!fld) return e.path;
  const show = (n: number) => `${Math.round(n * fld.scale * 100) / 100}`;
  return `${fld.label.charAt(0).toLowerCase()}${fld.label.slice(1)} from ${show(readValue(profile, e.path))} to ${show(e.value)} ${fld.unit}`;
}

/** The sentence shown after a change: "Changing X changed N decisions: …". */
export function policyChangeSentence(what: string, diff: DiffSummary): string {
  const n = diff.changes.length;
  if (n === 0) return `Changing ${what} changed no decisions.`;
  const detail = diff.text.includes(":") ? diff.text.slice(diff.text.indexOf(":") + 1).trim() : "";
  return `Changing ${what} changed ${n} decision${n === 1 ? "" : "s"}: ${detail}`;
}

/** Fold a profile's change-log policy entries (in order, skipping undone ones) into its current edits. */
export function foldPolicyEntries(entries: { undone: boolean; policy?: { profileId: BrandProfileId; reset?: true; edits?: PolicyEdit[] } }[]): Partial<Record<BrandProfileId, PolicyEdit[]>> {
  const out: Partial<Record<BrandProfileId, PolicyEdit[]>> = {};
  for (const e of entries) {
    if (e.undone || !e.policy) continue;
    const id = e.policy.profileId;
    if (e.policy.reset) {
      delete out[id];
      continue;
    }
    const cur = new Map((out[id] ?? []).map((x) => [x.path, x]));
    for (const x of e.policy.edits ?? []) cur.set(x.path, x);
    out[id] = [...cur.values()];
  }
  return out;
}

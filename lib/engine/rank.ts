// Ranking key (SPEC §6.3) and location-offer order (§15.5). Lexicographic, so every comparison can
// name the first factor that differs. Name and preferred language are never used (G9.9).

import { formatDate } from "@/lib/planner/dates";
import type { Assessment, SpaceType } from "./readiness";

export type Factor =
  | "spaceType"
  | "territoryPriority"
  | "space"
  | "capital"
  | "experience"
  | "distance"
  | "launch"
  | "id";

export interface Ranked {
  a: Assessment;
  /** Distance from the applicant's pin to the nearest existing store (reliable coordinates only). */
  storeKm: number | null;
  /** Lower = higher priority. Only used when comparing across territories. */
  territoryPriority?: number;
}

export interface RankOptions {
  /** Location offers: no space first, then Rented, then Owned (SPEC §15.5). */
  bySpaceType?: boolean;
  byTerritoryPriority?: boolean;
}

const SPACE_TYPE_ORDER: Record<SpaceType, number> = { none: 0, Rented: 1, Owned: 2 };
const idCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function compareIds(a: Assessment, b: Assessment): number {
  return idCollator.compare(a.id, b.id) || a.app.row - b.app.row || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export interface Comparator {
  compare(x: Ranked, y: Ranked): number;
  /** The first factor on which x and y differ, phrased from the winner's side. */
  firstDifference(winner: Ranked, loser: Ranked): { factor: Factor; text: string };
  usesDistance: boolean;
}

const km = (x: number) => `${x.toFixed(1)} km`;
const lakh = (x: number) => `₹${Number.isInteger(x) ? x : x.toFixed(1)} lakh`;

/**
 * Build a comparator for one contest. Distance is used only if every applicant in the contest has a
 * reliable location; otherwise it is skipped for the whole group, which keeps the order consistent.
 */
export function makeComparator(group: Ranked[], opts: RankOptions = {}): Comparator {
  const usesDistance = group.length > 1 && group.every((r) => r.storeKm !== null);

  const steps: { factor: Factor; cmp: (x: Ranked, y: Ranked) => number }[] = [];
  if (opts.bySpaceType) {
    steps.push({ factor: "spaceType", cmp: (x, y) => SPACE_TYPE_ORDER[x.a.spaceType] - SPACE_TYPE_ORDER[y.a.spaceType] });
  }
  if (opts.byTerritoryPriority) {
    steps.push({ factor: "territoryPriority", cmp: (x, y) => (x.territoryPriority ?? 9) - (y.territoryPriority ?? 9) });
  }
  steps.push(
    { factor: "space", cmp: (x, y) => (y.a.bands?.space ?? 0) - (x.a.bands?.space ?? 0) },
    { factor: "capital", cmp: (x, y) => (y.a.bands?.capital ?? 0) - (x.a.bands?.capital ?? 0) },
    { factor: "experience", cmp: (x, y) => (y.a.bands?.experience ?? 0) - (x.a.bands?.experience ?? 0) },
  );
  if (usesDistance) {
    // Further from existing stores is better; compare at 0.1 km so rounding noise doesn't decide.
    steps.push({ factor: "distance", cmp: (x, y) => Math.round(y.storeKm! * 10) - Math.round(x.storeKm! * 10) });
  }
  steps.push(
    { factor: "launch", cmp: (x, y) => (x.a.launch.earliest < y.a.launch.earliest ? -1 : x.a.launch.earliest > y.a.launch.earliest ? 1 : 0) },
    { factor: "id", cmp: (x, y) => compareIds(x.a, y.a) },
  );

  const compare = (x: Ranked, y: Ranked) => {
    for (const s of steps) {
      const c = s.cmp(x, y);
      if (c !== 0) return c;
    }
    return 0;
  };

  const describe = (factor: Factor, w: Ranked, l: Ranked): string => {
    switch (factor) {
      case "spaceType":
        return `location offers go first to applicants with no space yet, then rented space, then owned space (${w.a.id}: ${w.a.spaceText}; ${l.a.id}: ${l.a.spaceText})`;
      case "territoryPriority":
        return `${w.a.id}'s territory has a higher priority`;
      case "space":
        return `${w.a.id} has a better space (${w.a.spaceText}, vs ${l.a.spaceText})`;
      case "capital":
        return `${w.a.id} has more investment capacity (${lakh(w.a.investment ?? 0)} vs ${lakh(l.a.investment ?? 0)})`;
      case "experience":
        return `${w.a.id} has more relevant experience (${w.a.experienceText}, vs ${l.a.experienceText})`;
      case "distance":
        return `${w.a.id}'s pin is further from existing stores (${km(w.storeKm!)} vs ${km(l.storeKm!)})`;
      case "launch":
        return `${w.a.id} can open sooner (${formatDate(w.a.launch.earliest)} vs ${formatDate(l.a.launch.earliest)})`;
      case "id":
        return `everything else is equal, so the earlier application wins (${w.a.id} before ${l.a.id})`;
    }
  };

  return {
    compare,
    usesDistance,
    firstDifference(w, l) {
      for (const s of steps) {
        if (s.cmp(w, l) !== 0) return { factor: s.factor, text: describe(s.factor, w, l) };
      }
      return { factor: "id", text: describe("id", w, l) };
    },
  };
}

export function sortRanked(list: Ranked[], cmp: Comparator): Ranked[] {
  return [...list].sort(cmp.compare);
}

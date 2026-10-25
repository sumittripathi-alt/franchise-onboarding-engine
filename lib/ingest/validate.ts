// Data checks A01–A18 and T01–T07 (SPEC §4, G2).

import { EXISTING_STORE_PINS, EXISTING_STORES } from "@/data/existingStores";
import {
  CITIES,
  CITY_NAMES,
  PRIORITY_RANK,
  cityForPin,
  type CityName,
  type Priority,
  type Tier,
} from "@/lib/policy/allowedValues";
import type { Application, Issue, Signals, Territory } from "@/lib/types";
import { describesRunningShop, extractSignalsHeuristic } from "./heuristics";
import { personKey } from "./normalise";

const label = (a: Application) => a.id || `(no ID, row ${a.row})`;
const at = (row: number) => `Row ${row}`;
const CITY_LIST = CITY_NAMES.join(", ");

type NewIssue = Omit<Issue, "message"> & { message: string };

function issue(i: NewIssue): Issue {
  return { ...i, message: `${at(i.row)}: ${i.message}` };
}

/** Heuristic signals for every application, keyed by application key. */
export function heuristicSignals(apps: Application[]): Record<string, Signals> {
  const out: Record<string, Signals> = {};
  for (const a of apps) out[a.key] = extractSignalsHeuristic({ business: a.business, notes: a.notes });
  return out;
}

export function checkApplications(apps: Application[], signals: Record<string, Signals>): Issue[] {
  const issues: Issue[] = [];
  const add = (a: Application, i: Omit<NewIssue, "subjectId" | "row">) =>
    issues.push(issue({ ...i, subjectId: a.key, row: a.row }));

  // A05: duplicate Application ID.
  const byId = new Map<string, Application[]>();
  for (const a of apps) if (a.id) byId.set(a.id, [...(byId.get(a.id) ?? []), a]);

  // A06: same applicant name with different IDs.
  const byPerson = new Map<string, Application[]>();
  for (const a of apps) {
    const k = personKey(a.name);
    if (k) byPerson.set(k, [...(byPerson.get(k) ?? []), a]);
  }

  for (const a of apps) {
    const s = signals[a.key] ?? extractSignalsHeuristic({ business: a.business, notes: a.notes });
    const name = label(a);

    // A01: required fields.
    const missing: string[] = [];
    if (!a.id) missing.push("Application ID");
    if (!a.name) missing.push("Applicant name");
    if (a.city.raw === null) missing.push("City");
    if (a.pin.raw === null) missing.push("Pin code");
    if (a.investmentLakh.raw === null) missing.push("Investment capacity");
    if (a.spaceAvailable.raw === null) missing.push("Space available");
    if (missing.length) {
      add(a, {
        code: "A01",
        severity: "blocking",
        field: missing.join(", "),
        message: `${name} is missing ${missing.join(", ")}.`,
        question: `Please share your ${missing.join(", ").toLowerCase()}.`,
      });
    }
    if (a.investmentLakh.raw !== null && a.investmentLakh.value === null) {
      add(a, {
        code: "A01",
        severity: "blocking",
        field: "Investment capacity",
        message: `${name}: investment "${a.investmentLakh.raw}" couldn't be read as an amount.`,
        question: "What is your investment capacity in ₹ lakh?",
      });
    }
    if (a.spaceAvailable.raw !== null && a.spaceAvailable.value === null) {
      add(a, {
        code: "A01",
        severity: "blocking",
        field: "Space available",
        message: `${name}: space available "${a.spaceAvailable.raw}" isn't one of Owned, Rented or Not yet identified.`,
        question: "Is your space owned, rented, or not yet identified?",
      });
    }

    // A02: pin isn't 6 digits.
    if (a.pin.raw !== null && a.pin.value === null) {
      add(a, {
        code: "A02",
        severity: "blocking",
        field: "Pin code",
        message: `${name}: pin code "${a.pin.raw}" isn't a 6-digit pin.`,
        question: "What is the correct 6-digit pin code of the proposed store?",
      });
    }

    // A04: state or city outside the plan.
    if (a.state.raw !== null && a.state.value === null) {
      add(a, {
        code: "A04",
        severity: "blocking",
        field: "State",
        message: `${name}: state "${a.state.raw}" isn't Karnataka.`,
        question: "We currently only onboard partners in Karnataka. Is the proposed store in Karnataka?",
      });
    }
    if (a.city.raw !== null && a.city.value === null) {
      add(a, {
        code: "A04",
        severity: "blocking",
        field: "City",
        message: `${name}: city "${a.city.raw}" isn't one of our cities (${CITY_LIST}).`,
        question: `Which of our cities is the store in: ${CITY_LIST}?`,
      });
    }

    // A03: pin prefix doesn't match the city.
    if (a.pin.value && a.city.value) {
      const expected = CITIES[a.city.value].prefix;
      if (!a.pin.value.startsWith(expected)) {
        const pinCity = cityForPin(a.pin.value)?.name;
        add(a, {
          code: "A03",
          severity: "blocking",
          field: "Pin code",
          message: pinCity
            ? `${name}: pin ${a.pin.value} is in ${pinCity}, but the city is ${a.city.value}.`
            : `${name}: pin ${a.pin.value} isn't in ${a.city.value} (${a.city.value} pins start with ${expected}).`,
          question: pinCity
            ? `Your pin code ${a.pin.value} is in ${pinCity}, but you chose ${a.city.value}. Which city do you mean?`
            : `Pin ${a.pin.value} doesn't look like a ${a.city.value} pin. Which city and pin code do you mean?`,
        });
      }
    }

    // A05.
    const sameId = a.id ? (byId.get(a.id) ?? []) : [];
    if (sameId.length > 1) {
      add(a, {
        code: "A05",
        severity: "blocking",
        field: "Application ID",
        message: `${name} is used by ${sameId.length} rows (${sameId.map((x) => x.row).join(", ")}).`,
        question: `Application ID ${a.id} appears more than once. Which row is correct, or should one get a new ID?`,
      });
    }

    // A06.
    const samePerson = (byPerson.get(personKey(a.name)) ?? []).filter((x) => x.id !== a.id);
    if (samePerson.length) {
      add(a, {
        code: "A06",
        severity: "info",
        field: "Applicant name",
        message: `${name}: same applicant name as ${samePerson.map(label).join(", ")}. A person can hold at most one slot.`,
      });
    }

    // A07: implausible investment.
    const inv = a.investmentLakh.value;
    if (inv !== null && (inv <= 0 || inv > 500)) {
      add(a, {
        code: "A07",
        severity: "blocking",
        field: "Investment capacity",
        message:
          inv <= 0
            ? `${name}: investment is ₹${inv} lakh, which can't be right.`
            : `${name}: investment is ₹${inv} lakh, which is probably a unit mix-up (rupees vs lakh).`,
        question: `Please confirm your investment capacity in ₹ lakh. You entered ${a.investmentLakh.raw}.`,
      });
    }

    const hasSpace = a.spaceAvailable.value === "Owned" || a.spaceAvailable.value === "Rented";
    const noSpace = a.spaceAvailable.value === "Not yet identified";
    const floor = a.floor.value;
    const concreteFloor = floor === "Ground" || floor === "Upper" || floor === "Mall unit";

    // A08: size blank.
    if (hasSpace && a.spaceSqft.value === null) {
      add(a, {
        code: "A08",
        severity: "condition",
        field: "Space size",
        message:
          a.spaceSqft.raw === null
            ? `${name}: space is ${a.spaceAvailable.value} but its size is blank.`
            : `${name}: space size "${a.spaceSqft.raw}" couldn't be read.`,
        question: "What is the size of the space in sq ft?",
      });
    }

    // A09: no space but a size or floor given.
    if (noSpace && (a.spaceSqft.raw !== null || concreteFloor)) {
      const given = [a.spaceSqft.raw !== null ? `size ${a.spaceSqft.raw}` : "", concreteFloor ? `floor ${floor}` : ""]
        .filter(Boolean)
        .join(" and ");
      add(a, {
        code: "A09",
        severity: "info",
        field: "Space available",
        message: `${name}: space is "Not yet identified" but ${given} is given. Treated as no space yet.`,
        question: `You said the space is not yet identified, but also gave ${given}. Have you found a space?`,
      });
    }

    // A10: floor unknown.
    if (hasSpace && !concreteFloor) {
      add(a, {
        code: "A10",
        severity: "condition",
        field: "Floor",
        message: `${name}: space is ${a.spaceAvailable.value} but the floor is ${a.floor.raw === null ? "blank" : `"${a.floor.raw}"`}.`,
        question: "Which floor is the space on: ground, upper, or a mall unit?",
      });
    }

    // A11: notes contradict a field.
    if (concreteFloor && s.notes_floor_claim && s.notes_floor_claim !== floor) {
      add(a, {
        code: "A11",
        severity: "blocking",
        field: "Floor",
        message: `${name}: the form says floor ${floor}, but the notes suggest ${s.notes_floor_claim === "Upper" ? "an upper floor" : s.notes_floor_claim === "Mall unit" ? "a mall unit" : "the ground floor"}.`,
        question: `Your form says ${floor}, but your notes suggest ${s.notes_floor_claim === "Upper" ? "an upper floor" : s.notes_floor_claim}. Which floor is the space on?`,
      });
    }
    if (hasSpace && s.notes_space_claim === "searching") {
      add(a, {
        code: "A11",
        severity: "blocking",
        field: "Space available",
        message: `${name}: the form says the space is ${a.spaceAvailable.value}, but the notes say they are still looking for one.`,
        question: "Have you already secured a space, or are you still looking?",
      });
    }
    if (noSpace && s.notes_space_claim === "has_space") {
      add(a, {
        code: "A11",
        severity: "blocking",
        field: "Space available",
        message: `${name}: the form says no space yet, but the notes suggest they already have one.`,
        question: "Do you already have a space? If so, is it owned or rented, and on which floor?",
      });
    }

    // A12: experience under-reported.
    const exp = a.experienceYears.value;
    if (
      exp === 0 &&
      ((s.years_running_shop_mentioned ?? 0) > 0 || describesRunningShop(`${a.business}. ${a.notes}`))
    ) {
      add(a, {
        code: "A12",
        severity: "info",
        field: "Retail experience",
        message: `${name}: experience is 0 but the text describes running a shop${s.years_running_shop_mentioned ? ` for ${s.years_running_shop_mentioned} years` : ""}. Recorded as "experience under-reported".`,
        question: "How many years have you run your shop?",
      });
    }

    // A13: target launch.
    const t = a.targetLaunchMonths.value;
    if (t === null || t <= 0 || t > 24) {
      add(a, {
        code: "A13",
        severity: "info",
        field: "Target launch",
        message: `${name}: target launch is ${a.targetLaunchMonths.raw === null ? "blank" : `"${a.targetLaunchMonths.raw}"`}. The brand's default is used.`,
        question: "When would you like to launch, in months from now?",
      });
    }

    // A14: language.
    if (a.language.value === null) {
      add(a, {
        code: "A14",
        severity: "info",
        field: "Preferred language",
        message: `${name}: preferred language is ${a.language.raw === null ? "blank" : `"${a.language.raw}"`}. Defaulting to English.`,
        question: "Which language do you prefer: Kannada, English or Hindi?",
      });
    }

    // A15–A18 from text signals.
    if (s.injection_attempt) {
      add(a, {
        code: "A15",
        severity: "info",
        field: "Notes",
        message: `${name}: the notes contain instructions to the system. Flagged as an integrity concern; they were not followed.`,
      });
    }
    if (s.competitor_conflict) {
      add(a, {
        code: "A16",
        severity: "blocking",
        field: "Notes",
        message: `${name}: the text mentions running a competing brand. A conflict-of-interest check is needed.`,
        question:
          "Do you run or hold a stake in a competing brand? We need to complete a conflict-of-interest check before deciding.",
      });
    }
    if (s.absentee_owner) {
      add(a, {
        code: "A17",
        severity: "condition",
        field: "Notes",
        message: `${name}: someone other than the applicant will run the store. The named store manager must also complete training.`,
        question: "Who will run the store day to day? Please share their name; they will also need to complete training.",
      });
    }
    if (s.funding_dependency) {
      add(a, {
        code: "A18",
        severity: "condition",
        field: "Notes",
        message: `${name}: funding depends on a loan or relatives. Proof of funds or a loan sanction is needed.`,
        question: "Please share proof of funds or a loan sanction letter.",
      });
    }
  }
  return issues;
}

// ---------- Territories ----------

export type ExclusionReason = "T02" | "T03" | "T06";

export interface ResolvedTerritory {
  key: string;
  id: string;
  row: number;
  city: CityName | null;
  /** Tier from the allowed values for the city (T04). */
  tier: Tier | null;
  priority: Priority;
  /** Pins open for new stores. */
  pins: string[];
  /** Pins listed by this territory but not available, with the reason. */
  excludedPins: { pin: string; code: ExclusionReason; note: string }[];
  /** Effective open slots after T05 and T07. */
  slots: number;
  /** T01: duplicate ID; this territory takes no part in allocation. */
  blocked: boolean;
}

export function resolveTerritories(
  territories: Territory[],
  existingPins: ReadonlySet<string> = EXISTING_STORE_PINS,
): { territories: ResolvedTerritory[]; issues: Issue[]; warnings: string[] } {
  const issues: Issue[] = [];
  const warnings: string[] = [];
  const add = (t: Territory, i: Omit<NewIssue, "subjectId" | "row">) =>
    issues.push(issue({ ...i, subjectId: t.key, row: t.row }));
  const name = (t: Territory) => t.id || `(no ID, row ${t.row})`;

  const idCount = new Map<string, number>();
  for (const t of territories) if (t.id) idCount.set(t.id, (idCount.get(t.id) ?? 0) + 1);

  const resolved: ResolvedTerritory[] = territories.map((t) => {
    const city = t.city.value;
    const allowedTier = city ? CITIES[city].tier : null;
    const blocked = !t.id || (idCount.get(t.id) ?? 0) > 1;
    if (blocked) {
      add(t, {
        code: "T01",
        severity: "blocking",
        field: "Territory ID",
        message: t.id
          ? `Territory ID ${t.id} appears more than once. Neither copy is used until this is fixed.`
          : "Territory has no ID and is not used.",
      });
    }

    if (t.city.value === null) {
      add(t, {
        code: "T03",
        severity: "info",
        field: "City",
        message: `${name(t)}: city "${t.city.raw ?? ""}" isn't one of our cities, so none of its pins can be used.`,
      });
    }

    // T04: tier mismatch.
    if (city && allowedTier && t.tier.value !== allowedTier) {
      add(t, {
        code: "T04",
        severity: "info",
        field: "City tier",
        message: `${name(t)}: tier is ${t.tier.raw === null ? "blank" : `"${t.tier.raw}"`}, but ${city} is ${allowedTier} in the allowed values. ${allowedTier} is used.`,
      });
    }

    let priority: Priority = t.priority.value ?? "Low";
    if (t.priority.value === null) {
      priority = "Low";
      warnings.push(
        `${at(t.row)}: ${name(t)} has priority ${t.priority.raw === null ? "blank" : `"${t.priority.raw}"`}; treated as Low.`,
      );
    }

    // T03: invalid tokens and pins outside the city.
    const excludedPins: ResolvedTerritory["excludedPins"] = [];
    for (const bad of t.invalidPins) {
      excludedPins.push({ pin: bad, code: "T03", note: `"${bad}" isn't a 6-digit pin` });
      add(t, {
        code: "T03",
        severity: "info",
        field: "Pin codes covered",
        message: `${name(t)}: "${bad}" isn't a valid 6-digit pin and was excluded.`,
      });
    }
    const pins: string[] = [];
    for (const p of t.pins) {
      if (!city) {
        excludedPins.push({ pin: p, code: "T03", note: "territory city isn't recognised" });
      } else if (!p.startsWith(CITIES[city].prefix)) {
        const pc = cityForPin(p)?.name;
        excludedPins.push({ pin: p, code: "T03", note: `pin is in ${pc ?? "another area"}, not ${city}` });
        add(t, {
          code: "T03",
          severity: "info",
          field: "Pin codes covered",
          message: pc
            ? `${name(t)}: pin ${p} is in ${pc}, not ${city}. It was excluded.`
            : `${name(t)}: pin ${p} isn't a ${city} pin. It was excluded.`,
        });
      } else pins.push(p);
    }

    // T05: slots.
    const rawSlots = t.openSlots.value;
    let slots = rawSlots === null || !Number.isFinite(rawSlots) ? 0 : Math.floor(rawSlots);
    if (rawSlots === null || rawSlots <= 0) {
      slots = 0;
      add(t, {
        code: "T05",
        severity: "info",
        field: "Open slots",
        message: `${name(t)}: open slots is ${t.openSlots.raw === null ? "blank" : `"${t.openSlots.raw}"`}. Treated as 0.`,
      });
    }

    return {
      key: t.key,
      id: t.id,
      row: t.row,
      city,
      tier: allowedTier,
      priority,
      pins,
      excludedPins,
      slots,
      blocked,
    };
  });

  // T02: a pin in two territories goes to the higher-priority one, then the lower ID.
  const owners = new Map<string, ResolvedTerritory[]>();
  for (const r of resolved) {
    if (r.blocked) continue;
    for (const p of r.pins) owners.set(p, [...(owners.get(p) ?? []), r]);
  }
  for (const [pin, list] of owners) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id.localeCompare(b.id),
    );
    const winner = sorted[0];
    for (const loser of sorted.slice(1)) {
      loser.pins = loser.pins.filter((p) => p !== pin);
      loser.excludedPins.push({ pin, code: "T02", note: `also listed in ${winner.id}, which has priority` });
      const t = territories.find((x) => x.key === loser.key)!;
      add(t, {
        code: "T02",
        severity: "info",
        field: "Pin codes covered",
        message: `${loser.id}: pin ${pin} is also listed in ${winner.id}. It was assigned to ${winner.id} (${winner.priority === loser.priority ? "lower ID" : "higher priority"}).`,
      });
    }
  }

  // T06: pins with an existing store; T07: slots above available pins.
  for (const r of resolved) {
    const t = territories.find((x) => x.key === r.key)!;
    for (const p of [...r.pins]) {
      if (!existingPins.has(p)) continue;
      const store = EXISTING_STORES.find((s) => s.pin === p);
      r.pins = r.pins.filter((x) => x !== p);
      const storeName = store ? `existing store ${store.id}` : "an existing store";
      r.excludedPins.push({ pin: p, code: "T06", note: `${storeName} is here` });
      add(t, {
        code: "T06",
        severity: "info",
        field: "Pin codes covered",
        message: `${r.id}: pin ${p} already has ${storeName}, so it is unavailable.`,
      });
    }
    if (r.blocked) r.slots = 0;
    else if (r.slots > r.pins.length) {
      add(t, {
        code: "T07",
        severity: "info",
        field: "Open slots",
        message: `${r.id}: ${r.slots} open slots but only ${r.pins.length} available pin${r.pins.length === 1 ? "" : "s"}. Capped at ${r.pins.length}.`,
      });
      r.slots = r.pins.length;
    }
  }

  return { territories: resolved, issues, warnings };
}

export interface DataCheckResult {
  issues: Issue[];
  territories: ResolvedTerritory[];
  warnings: string[];
}

export function runDataChecks(
  applications: Application[],
  territories: Territory[],
  signals: Record<string, Signals> = heuristicSignals(applications),
): DataCheckResult {
  const t = resolveTerritories(territories);
  return {
    issues: [...checkApplications(applications, signals), ...t.issues],
    territories: t.territories,
    warnings: t.warnings,
  };
}

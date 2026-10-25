// Allocation (SPEC §6.2, §6.4, §15.4, §15.5).
//
// Order of work, all deterministic:
//   1. Classify: forced by a human override, On hold, Not approved, locked, pin contestant,
//      location-offer candidate, or outside the plan.
//   2. Pre-reserve locked partners ("sent to partner") and forced-in overrides.
//   3. Pin contests in every territory; losers become location-offer candidates.
//   4. Slot contests, territories by priority then ID; losers are waitlisted with a rank.
//   5. Location offers per city, candidates in offer order (no space → Rented → Owned, then rank).
//   6. On-hold applicants: where they would stand once clarified; provisional wins.

import { PRIORITY_RANK } from "@/lib/policy/allowedValues";
import type { ResolvedTerritory } from "@/lib/ingest/validate";
import type { BrandProfile } from "@/lib/policy/types";
import type { Competitor, ReasonCode, Status } from "@/lib/types";
import { compareIds, makeComparator, sortRanked, type Comparator, type Ranked } from "./rank";
import type { Assessment } from "./readiness";
import type { HumanOverride, Lock } from "./types";

/** Blocking checks that question the location or the investment, so no "if clarified" rank is shown. */
const UNRANKABLE = new Set(["A01", "A02", "A03", "A04", "A07"]);

export type HomeReason = "store" | "notInTerritory" | "lostPin";

export interface Outcome {
  key: string;
  status: Status | null; // null until conditions decide APPROVED vs CONDITIONAL
  codes: ReasonCode[];
  homeTerritoryKey: string | null;
  pin: string | null;
  slotTerritoryKey: string | null;
  kind: "won" | "offer" | "locked" | "forced" | null;
  offer: { pin: string; territoryKey: string; distanceKm: number | null; homeReason: HomeReason } | null;
  competitors: Competitor[];
  waitlist: { scope: "territory"; territoryKey: string; rank: number } | { scope: "city"; city: string; rank: number } | null;
  lostTo: { key: string; text: string } | null;
  committedTo: { key: string; date: string } | null;
  duplicateOf: string | null;
  locked: Lock | null;
  override: HumanOverride | null;
  ifClarified: { territoryKey: string; rank: number; winsPin: boolean; pin: string } | null;
  provisional: { byKey: string } | null;
  /** Slot-contest position among pin winners in the territory (1 = best). */
  slotRank: number | null;
  slotContestSize: number | null;
}

export interface ForcedIn {
  status: Status;
  pin: string;
  territoryKey: string;
  override: HumanOverride;
}

export interface AllocationInput {
  assessments: Assessment[];
  territories: ResolvedTerritory[];
  profile: BrandProfile;
  storePins: ReadonlySet<string>;
  /** Distance from a pin to the nearest existing store, or null when coordinates are uncertain. */
  storeKm: (pin: string) => number | null;
  /** Reliable distance between two pins, or null. */
  pinKm: (a: string, b: string) => number | null;
  locks: Lock[];
  forcedIn: Map<string, ForcedIn>;
  forcedOut: Map<string, HumanOverride>;
}

export interface Allocation {
  outcomes: Map<string, Outcome>;
  /** Effective slots per territory key (raised to the number of locked partners if needed). */
  slots: Map<string, number>;
  reserved: Map<string, { key: string; pin: string }[]>;
  waitlists: Map<string, string[]>;
  overCommitted: Set<string>;
  warnings: string[];
  refusedForced: { key: string; message: string }[];
}

function newOutcome(key: string): Outcome {
  return {
    key,
    status: null,
    codes: [],
    homeTerritoryKey: null,
    pin: null,
    slotTerritoryKey: null,
    kind: null,
    offer: null,
    competitors: [],
    waitlist: null,
    lostTo: null,
    committedTo: null,
    duplicateOf: null,
    locked: null,
    override: null,
    ifClarified: null,
    provisional: null,
    slotRank: null,
    slotContestSize: null,
  };
}

const territoryOrder = (a: ResolvedTerritory, b: ResolvedTerritory) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || new Intl.Collator("en", { numeric: true }).compare(a.id, b.id);

export function allocate(input: AllocationInput): Allocation {
  const { profile } = input;
  const byKey = new Map(input.assessments.map((a) => [a.key, a]));
  const outcomes = new Map<string, Outcome>();
  const warnings: string[] = [];
  const refusedForced: Allocation["refusedForced"] = [];

  const active = input.territories.filter((t) => !t.blocked).sort(territoryOrder);
  const terByKey = new Map(active.map((t) => [t.key, t]));
  const pinTerritory = new Map<string, ResolvedTerritory>();
  const storePinTerritory = new Map<string, ResolvedTerritory>();
  for (const t of active) {
    for (const p of t.pins) pinTerritory.set(p, t);
    for (const e of t.excludedPins) if (e.code === "T06") storePinTerritory.set(e.pin, t);
  }
  const activeCities = new Set(active.map((t) => t.city).filter(Boolean) as string[]);

  const ranked = (a: Assessment, pin: string | null = a.app.pin.value): Ranked => ({
    a,
    storeKm: pin ? input.storeKm(pin) : null,
  });

  const reserved = new Map<string, { key: string; pin: string }[]>(active.map((t) => [t.key, []]));
  const slots = new Map(active.map((t) => [t.key, t.slots]));
  const pinsTaken = new Map<string, string>(); // pin → app key
  const personHolds = new Map<string, string>(); // person → app key
  const reserve = (key: string, t: ResolvedTerritory, pin: string) => {
    reserved.get(t.key)!.push({ key, pin });
    pinsTaken.set(pin, key);
    const person = byKey.get(key)!.person;
    if (person) personHolds.set(person, key);
  };
  const free = (t: ResolvedTerritory) => slots.get(t.key)! - reserved.get(t.key)!.length;

  // ---- 1. Classify ----
  const contestants = new Map<string, Map<string, Assessment[]>>(); // territory → pin → applicants
  const candidates: { a: Assessment; home: ResolvedTerritory | null; reason: HomeReason }[] = [];
  const locksByKey = new Map(input.locks.map((l) => [l.appKey, l]));
  const toLock: { a: Assessment; lock: Lock; t: ResolvedTerritory }[] = [];

  const sorted = [...input.assessments].sort(compareIds);
  for (const a of sorted) {
    const o = newOutcome(a.key);
    outcomes.set(a.key, o);
    const pin = a.app.pin.value;
    o.homeTerritoryKey = (pin && (pinTerritory.get(pin) ?? storePinTerritory.get(pin))?.key) ?? null;

    const forcedOut = input.forcedOut.get(a.key);
    if (forcedOut) {
      o.status = forcedOut.status;
      o.override = forcedOut;
      o.kind = "forced";
      o.codes.push("HUMAN_OVERRIDE");
      continue;
    }
    if (input.forcedIn.has(a.key)) continue; // placed in step 2

    const lock = locksByKey.get(a.key);
    if (lock && (lock.status === "APPROVED" || lock.status === "CONDITIONAL")) {
      const t = terByKey.get(lock.territoryKey);
      if (t && t.pins.includes(lock.pin)) {
        toLock.push({ a, lock, t });
        continue;
      }
      warnings.push(
        `${a.id} was marked as sent to partner, but pin ${lock.pin} is no longer available in that territory, so the lock could not be kept.`,
      );
    }

    if (a.blocking.length) {
      o.status = "HOLD";
      o.codes.push("BLOCKING_DATA_ISSUE");
      continue;
    }
    if (a.gate) {
      o.status = "REJECT";
      o.codes.push(a.gate.code);
      continue;
    }
    if (!a.bands || !pin) {
      o.status = "HOLD";
      o.codes.push("BLOCKING_DATA_ISSUE");
      continue;
    }
    const t = pinTerritory.get(pin);
    if (t) {
      const byPin = contestants.get(t.key) ?? new Map<string, Assessment[]>();
      byPin.set(pin, [...(byPin.get(pin) ?? []), a]);
      contestants.set(t.key, byPin);
    } else if (input.storePins.has(pin) && a.app.city.value && activeCities.has(a.app.city.value)) {
      o.codes.push("PIN_HAS_EXISTING_STORE");
      candidates.push({ a, home: storePinTerritory.get(pin) ?? null, reason: "store" });
    } else if (a.app.city.value && activeCities.has(a.app.city.value)) {
      o.codes.push("PIN_NOT_IN_TERRITORY");
      candidates.push({ a, home: null, reason: "notInTerritory" });
    } else {
      o.status = "WAITLIST";
      o.codes.push(input.storePins.has(pin) ? "PIN_HAS_EXISTING_STORE" : "OUTSIDE_PLAN");
      if (!o.codes.includes("OUTSIDE_PLAN")) o.codes.push("OUTSIDE_PLAN");
    }
  }

  // ---- 2. Pre-reserve: locked partners, then forced-in overrides ----
  for (const { a, lock, t } of toLock) {
    const o = outcomes.get(a.key)!;
    if (pinsTaken.has(lock.pin)) {
      warnings.push(`${a.id} and another locked partner share pin ${lock.pin}; only the first lock was kept.`);
      o.status = "HOLD";
      o.codes.push("BLOCKING_DATA_ISSUE");
      continue;
    }
    reserve(a.key, t, lock.pin);
    Object.assign(o, { status: lock.status, kind: "locked", locked: lock, pin: lock.pin, slotTerritoryKey: t.key });
    o.codes.push("LOCKED");
    if (a.blocking.length) warnings.push(`${a.id} was sent to the partner but now has a blocking data issue. Follow up directly.`);
  }
  const overCommitted = new Set<string>();
  for (const t of active) {
    const n = reserved.get(t.key)!.length;
    if (n > slots.get(t.key)!) {
      overCommitted.add(t.key);
      slots.set(t.key, n);
      warnings.push(
        `${t.id} now has ${t.slots} open slot${t.slots === 1 ? "" : "s"} but ${n} partners were already sent a decision. Their slots are kept.`,
      );
    }
  }

  for (const [key, f] of [...input.forcedIn].sort(([x], [y]) => compareIds(byKey.get(x)!, byKey.get(y)!))) {
    const a = byKey.get(key);
    const t = terByKey.get(f.territoryKey);
    const o = outcomes.get(key) ?? newOutcome(key);
    outcomes.set(key, o);
    if (!a || !t) continue;
    const refusal = pinsTaken.has(f.pin)
      ? `Pin ${f.pin} is already held by ${byKey.get(pinsTaken.get(f.pin)!)?.id}, who was sent a decision. One store per pin can't be overridden.`
      : a.person && personHolds.has(a.person)
        ? `${a.id}'s applicant already holds a slot through ${byKey.get(personHolds.get(a.person)!)?.id}. One slot per person.`
        : free(t) <= 0
          ? `Every slot in ${t.id} is committed to partners who were already sent a decision, so none can be freed.`
          : null;
    if (refusal) {
      refusedForced.push({ key, message: refusal });
      o.status = "HOLD";
      o.codes.push("BLOCKING_DATA_ISSUE");
      continue;
    }
    reserve(key, t, f.pin);
    Object.assign(o, { status: f.status, kind: "forced", override: f.override, pin: f.pin, slotTerritoryKey: t.key });
    o.codes.push("HUMAN_OVERRIDE");
  }
  // ---- 3. Pin contests ----
  const pinWinners = new Map<string, Assessment[]>(); // territory → winners
  const pinContest = new Map<string, { winner: Assessment | null; group: Assessment[] }>(); // pin → contest
  for (const t of active) {
    const byPin = contestants.get(t.key) ?? new Map<string, Assessment[]>();
    const winners: Assessment[] = [];
    for (const pin of [...byPin.keys()].sort()) {
      const group = byPin.get(pin)!;
      const holderKey = pinsTaken.get(pin);
      if (holderKey) {
        // The pin is already held by a locked partner or an override.
        const holder = byKey.get(holderKey)!;
        const holderOutcome = outcomes.get(holderKey)!;
        const cmp = makeComparator([holder, ...group].map((x) => ranked(x)));
        for (const c of group) {
          const o = outcomes.get(c.key)!;
          const outranks = cmp.compare(ranked(c), ranked(holder)) < 0;
          if (holderOutcome.kind === "locked" && outranks) {
            o.status = "WAITLIST";
            o.codes.push("SLOT_COMMITTED");
            o.committedTo = { key: holderKey, date: holderOutcome.locked!.date };
          } else {
            o.codes.push("LOST_PIN_CONTEST");
            o.lostTo = {
              key: holderKey,
              text: holderOutcome.kind === "forced" ? `a human override gave pin ${pin} to ${holder.id}` : cmp.firstDifference(ranked(holder), ranked(c)).text,
            };
            candidates.push({ a: c, home: t, reason: "lostPin" });
          }
        }
        pinContest.set(pin, { winner: holder, group });
        continue;
      }
      const cmp = makeComparator(group.map((x) => ranked(x)));
      const order = sortRanked(group.map((x) => ranked(x)), cmp);
      const winner = order[0];
      winners.push(winner.a);
      pinContest.set(pin, { winner: winner.a, group });
      for (const loser of order.slice(1)) {
        const diff = cmp.firstDifference(winner, loser).text;
        const lo = outcomes.get(loser.a.key)!;
        lo.codes.push("LOST_PIN_CONTEST");
        lo.lostTo = { key: winner.a.key, text: diff };
        lo.competitors.push({ appId: winner.a.id, appKey: winner.a.key, relation: "pin", won: false, firstDifferingFactor: diff });
        outcomes.get(winner.a.key)!.competitors.push({
          appId: loser.a.id,
          appKey: loser.a.key,
          relation: "pin",
          won: true,
          firstDifferingFactor: diff,
        });
        candidates.push({ a: loser.a, home: t, reason: "lostPin" });
      }
    }
    pinWinners.set(t.key, winners);
  }

  // ---- 4. Slot contests ----
  const waitlists = new Map<string, string[]>();
  for (const t of active) {
    const group = (pinWinners.get(t.key) ?? []).map((x) => ranked(x));
    const lockedHere = reserved
      .get(t.key)!
      .map((r) => outcomes.get(r.key)!)
      .filter((o) => o.kind === "locked");
    const cmp = makeComparator([...group, ...lockedHere.map((o) => ranked(byKey.get(o.key)!, o.pin))]);
    const order = sortRanked(group, cmp);
    const winnersHere: Ranked[] = [];
    const wl: string[] = [];
    order.forEach((r, i) => {
      const o = outcomes.get(r.a.key)!;
      o.slotRank = i + 1;
      o.slotContestSize = order.length;
      const holder = r.a.person ? personHolds.get(r.a.person) : undefined;
      if (holder) {
        o.status = "WAITLIST";
        o.codes.push("DUPLICATE_PERSON");
        o.duplicateOf = holder;
        return;
      }
      if (free(t) > 0) {
        reserve(r.a.key, t, r.a.app.pin.value!);
        Object.assign(o, { kind: "won", pin: r.a.app.pin.value, slotTerritoryKey: t.key });
        winnersHere.push(r);
        return;
      }
      o.status = "WAITLIST";
      o.codes.push("NO_SLOT");
      wl.push(r.a.key);
      // The applicant they would need to beat: the lowest-ranked slot holder here.
      const bar = winnersHere[winnersHere.length - 1];
      if (bar) {
        const diff = cmp.firstDifference(bar, r).text;
        o.competitors.push({ appId: bar.a.id, appKey: bar.a.key, relation: "slot", won: false, firstDifferingFactor: diff });
        const bo = outcomes.get(bar.a.key)!;
        if (bo.competitors.filter((c) => c.relation === "slot").length < 3) {
          bo.competitors.push({ appId: r.a.id, appKey: r.a.key, relation: "slot", won: true, firstDifferingFactor: diff });
        }
      }
      const outranked = lockedHere.find((lo) => cmp.compare(r, ranked(byKey.get(lo.key)!, lo.pin)) < 0);
      if (outranked) {
        o.codes.push("SLOT_COMMITTED");
        o.committedTo = { key: outranked.key, date: outranked.locked!.date };
      }
    });
    wl.forEach((k, i) => (outcomes.get(k)!.waitlist = { scope: "territory", territoryKey: t.key, rank: i + 1 }));
    waitlists.set(t.key, wl);
  }

  // ---- 5. Location offers, per city ----
  const holdPins = new Set(
    input.assessments.filter((a) => outcomes.get(a.key)!.status === "HOLD" && a.app.pin.value).map((a) => a.app.pin.value!),
  );
  const byCity = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const city = c.a.app.city.value!;
    byCity.set(city, [...(byCity.get(city) ?? []), c]);
  }
  for (const city of [...byCity.keys()].sort()) {
    const list = byCity.get(city)!;
    const cmp = makeComparator(list.map((c) => ranked(c.a)), { bySpaceType: true });
    const order = sortRanked(list.map((c) => ranked(c.a)), cmp);
    const homeOf = new Map(list.map((c) => [c.a.key, c]));
    const cityWaitlist: string[] = [];
    let lastOffered: Ranked | null = null;
    for (const r of order) {
      const c = homeOf.get(r.a.key)!;
      const o = outcomes.get(r.a.key)!;
      const holder = r.a.person ? personHolds.get(r.a.person) : undefined;
      if (holder) {
        o.status = "WAITLIST";
        o.codes.push("DUPLICATE_PERSON");
        o.duplicateOf = holder;
        continue;
      }
      const targets = active
        .filter((t) => t.city === city && free(t) > 0 && t.pins.some((p) => !pinsTaken.has(p)))
        .sort((x, y) => (x.key === c.home?.key ? -1 : y.key === c.home?.key ? 1 : territoryOrder(x, y)));
      const t = targets[0];
      if (!t) {
        o.status = "WAITLIST";
        o.codes.push("NO_SLOT_IN_CITY");
        cityWaitlist.push(r.a.key);
        if (lastOffered) {
          const diff = cmp.firstDifference(lastOffered, r).text;
          o.competitors.push({ appId: lastOffered.a.id, appKey: lastOffered.a.key, relation: "offer", won: false, firstDifferingFactor: diff });
        }
        continue;
      }
      const pin = choosePin(t, r.a, input, pinsTaken, holdPins, profile);
      reserve(r.a.key, t, pin);
      Object.assign(o, {
        kind: "offer",
        status: "REDIRECT",
        pin,
        slotTerritoryKey: t.key,
        offer: { pin, territoryKey: t.key, distanceKm: r.a.app.pin.value ? input.pinKm(r.a.app.pin.value, pin) : null, homeReason: c.reason },
      });
      o.codes.push("REDIRECT_OFFERED");
      lastOffered = r;
    }
    cityWaitlist.forEach((k, i) => (outcomes.get(k)!.waitlist = { scope: "city", city, rank: i + 1 }));
  }

  // ---- 6. On hold: standing once clarified, and provisional wins ----
  const provisionalBy = new Map<string, Ranked>(); // winner key → best on-hold challenger
  for (const a of sorted) {
    const o = outcomes.get(a.key)!;
    if (o.status !== "HOLD" || o.kind === "forced" || !a.bands || a.gate) continue;
    // Only project a rank when the facts used for ranking aren't themselves in question.
    if (a.blocking.some((i) => UNRANKABLE.has(i.code))) continue;
    const pin = a.app.pin.value;
    const t = pin ? pinTerritory.get(pin) : undefined;
    if (!pin || !t || a.app.city.value !== t.city) continue;
    const contest = pinContest.get(pin);
    const me = ranked(a);
    let winsPin = true;
    let cmp: Comparator | null = null;
    if (contest?.winner) {
      cmp = makeComparator([me, ...contest.group.map((x) => ranked(x)), ranked(contest.winner)]);
      winsPin = cmp.compare(me, ranked(contest.winner)) < 0;
    }
    // Rank among this territory's pin winners, with this applicant in its pin's place if it would win.
    const others = (pinWinners.get(t.key) ?? []).filter((w) => !(winsPin && w.app.pin.value === pin));
    const group = winsPin ? [...others, a] : others;
    const slotCmp = makeComparator(group.map((x) => ranked(x)));
    const order = sortRanked(group.map((x) => ranked(x)), slotCmp);
    const rank = winsPin ? order.findIndex((r) => r.a.key === a.key) + 1 : order.length + 1;
    o.ifClarified = { territoryKey: t.key, rank, winsPin, pin };
    if (winsPin && contest?.winner) {
      const wo = outcomes.get(contest.winner.key)!;
      if (wo.kind === "won") {
        const prev = provisionalBy.get(contest.winner.key);
        if (!prev || cmp!.compare(me, prev) < 0) provisionalBy.set(contest.winner.key, me);
      }
    }
  }
  for (const [winnerKey, challenger] of provisionalBy) {
    const wo = outcomes.get(winnerKey)!;
    wo.provisional = { byKey: challenger.a.key };
    wo.codes.push("PROVISIONAL");
  }

  return { outcomes, slots, reserved, waitlists, overCommitted, warnings, refusedForced };
}

/**
 * The pin to offer (SPEC §6.4 step 3, §15.5): a free pin in the territory, outside every existing store's
 * inner radius where possible; then, as tie-breaks, away from other new partners' locations and from pins
 * on-hold applicants want; then nearest to the applicant's own pin.
 */
function choosePin(
  t: ResolvedTerritory,
  a: Assessment,
  input: AllocationInput,
  pinsTaken: Map<string, string>,
  holdPins: Set<string>,
  profile: BrandProfile,
): string {
  const radius = t.tier ? profile.cannibalisationRadiusKm[t.tier] : 0;
  const own = a.app.pin.value;
  const score = (p: string) => {
    const d = input.storeKm(p);
    const zone = d === null ? 1 : d <= radius ? 2 : 0;
    const crowded = [...pinsTaken.keys()].some((q) => {
      const k = input.pinKm(p, q);
      return k !== null && k <= radius;
    });
    const km = own ? input.pinKm(own, p) : null;
    return { zone, crowded: crowded ? 1 : 0, hold: holdPins.has(p) ? 1 : 0, km: km ?? Number.POSITIVE_INFINITY, p };
  };
  const options = t.pins.filter((p) => !pinsTaken.has(p)).map(score);
  options.sort(
    (x, y) => x.zone - y.zone || x.crowded - y.crowded || x.hold - y.hold || x.km - y.km || (x.p < y.p ? -1 : x.p > y.p ? 1 : 0),
  );
  return options[0].p;
}

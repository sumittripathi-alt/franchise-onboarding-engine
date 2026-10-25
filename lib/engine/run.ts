// runEngine (SPEC §6): pure and deterministic. No side effects, no LLM calls, no randomness.

import { EXISTING_STORES } from "@/data/existingStores";
import { reliableDistanceKm } from "@/lib/geo/pins";
import { extractSignalsHeuristic } from "@/lib/ingest/heuristics";
import { checkApplications, resolveTerritories, type ResolvedTerritory } from "@/lib/ingest/validate";
import { addDays } from "@/lib/planner/dates";
import {
  RESERVED_STATUSES,
  STATUS_META,
  type Condition,
  type DecisionRecord,
  type Flag,
  type Issue,
  type ReasonCode,
  type Signals,
  type Status,
} from "@/lib/types";
import { allocate, type ForcedIn, type Outcome } from "./allocate";
import { assessCannibalisation, nearestStore } from "./cannibalisation";
import { explain, type ExplainContext } from "./explain";
import { applyFacts } from "./facts";
import { checkInvariants, fingerprint } from "./invariants";
import { estimatePayback } from "./payback";
import { assess, type Assessment, type ConditionDraft } from "./readiness";
import type { EngineInput, EngineResult, HumanOverride, PendingOverride, RejectedOverride, TerritoryState } from "./types";

interface Pass {
  result: EngineResult;
  refused: { key: string; message: string }[];
}

function runPass(input: EngineInput, overrides: HumanOverride[]): Pass {
  const profile = input.policy.profile;
  const stores = input.existingStores ?? EXISTING_STORES;
  const storePins = new Set(stores.map((s) => s.pin));
  const today = input.today;

  // 1. Facts on top of the parsed data.
  const { applications, territories: rawTerritories, withdrawn, updated } = applyFacts(input.applications, input.territories, input.facts);

  // 2. Signals: provided (LLM) or heuristic fallback.
  const signals: Record<string, Signals> = {};
  for (const a of applications) {
    signals[a.key] = input.signals?.[a.key] ?? extractSignalsHeuristic({ business: a.business, notes: a.notes });
  }

  // 3. Data checks.
  // A fact stated after the application supersedes the notes on that field, so the old
  // notes-vs-form contradiction (A11) no longer applies to it.
  const supersededBy: Record<string, string> = { Floor: "floor", "Space available": "spaceAvailable" };
  const appIssues = checkApplications(applications, signals).filter(
    (i) => !(i.code === "A11" && i.field && updated.get(i.subjectId)?.has(supersededBy[i.field] ?? "")),
  );
  const resolved = resolveTerritories(rawTerritories, storePins);
  const issuesByKey = new Map<string, Issue[]>();
  for (const i of appIssues) issuesByKey.set(i.subjectId, [...(issuesByKey.get(i.subjectId) ?? []), i]);

  // 4. Readiness.
  const assessments = applications.map((a) => assess(a, signals[a.key], issuesByKey.get(a.key) ?? [], profile, today));
  const byKey = new Map(assessments.map((a) => [a.key, a]));
  const terByKey = new Map(resolved.territories.map((t) => [t.key, t]));
  const activeByPin = new Map<string, ResolvedTerritory>();
  for (const t of resolved.territories) if (!t.blocked) for (const p of t.pins) activeByPin.set(p, t);

  // 5. Human overrides become forced placements.
  const forcedIn = new Map<string, ForcedIn>();
  const forcedOut = new Map<string, HumanOverride>();
  const refused: Pass["refused"] = [];
  for (const o of overrides) {
    const a = byKey.get(o.appKey);
    if (!a) continue;
    if (o.status === "APPROVED" || o.status === "CONDITIONAL") {
      const pin = a.app.pin.value;
      const store = pin ? stores.find((s) => s.pin === pin) : undefined;
      const t = pin ? activeByPin.get(pin) : undefined;
      if (!pin) refused.push({ key: a.key, message: `${a.id} has no valid pin, so there is no location to approve.` });
      else if (store) refused.push({ key: a.key, message: `Pin ${pin} already has existing store ${store.id}. One store per pin can't be overridden.` });
      else if (!t) refused.push({ key: a.key, message: `Pin ${pin} isn't in any active territory, so there is no slot to give.` });
      else forcedIn.set(a.key, { status: o.status, pin, territoryKey: t.key, override: o });
    } else {
      forcedOut.set(a.key, o);
    }
  }

  // 6. Allocation.
  const storeKmCache = new Map<string, number | null>();
  const storeKm = (pin: string) => {
    if (!storeKmCache.has(pin)) storeKmCache.set(pin, nearestStore(pin, stores)?.km ?? null);
    return storeKmCache.get(pin)!;
  };
  const alloc = allocate({
    assessments,
    territories: resolved.territories,
    profile,
    storePins,
    storeKm,
    pinKm: reliableDistanceKm,
    locks: input.locks ?? [],
    forcedIn,
    forcedOut,
  });
  refused.push(...alloc.refusedForced);

  // 7. Final statuses, conditions, cannibalisation, payback, explanations.
  const idOf = (key: string) => byKey.get(key)?.id || key;
  const cityQueues = new Map<string, string[]>();
  for (const o of alloc.outcomes.values()) {
    if (o.waitlist?.scope === "city") {
      const q = cityQueues.get(o.waitlist.city) ?? [];
      q[o.waitlist.rank - 1] = o.key;
      cityQueues.set(o.waitlist.city, q);
    }
  }
  const nextInLine = (territoryKey: string | null, city: string | null) => {
    const t = territoryKey ? terByKey.get(territoryKey) : undefined;
    const fromTerritory = territoryKey ? alloc.waitlists.get(territoryKey)?.[0] : undefined;
    const fromCity = cityQueues.get(city ?? t?.city ?? "")?.[0];
    const k = fromTerritory ?? fromCity;
    return k ? idOf(k) : null;
  };

  const reservedPins = [...alloc.outcomes.values()].filter((o) => o.pin).map((o) => ({ key: o.key, appId: idOf(o.key), pin: o.pin! }));

  const ctx: ExplainContext = {
    profile,
    today,
    idOf,
    nameOf: (key) => byKey.get(key)?.app.name ?? key,
    territoryId: (key) => (key ? (terByKey.get(key)?.id ?? key) : ""),
    slotsOf: (key) => alloc.slots.get(key) ?? terByKey.get(key)?.slots ?? 0,
    nextInLine,
    storeAt: (pin) => stores.find((s) => s.pin === pin)?.id ?? null,
  };

  const decisions: DecisionRecord[] = applications.map((app) => {
    const a = byKey.get(app.key)!;
    const o = alloc.outcomes.get(app.key)!;
    return finalise(a, o);
  });

  function finalise(a: Assessment, o: Outcome): DecisionRecord {
    const slotT = o.slotTerritoryKey ? terByKey.get(o.slotTerritoryKey) : undefined;
    const flags: Flag[] = [...a.flags];
    let drafts: ConditionDraft[] = [];
    if (o.kind === "won" || (o.kind === "locked" && o.status === "CONDITIONAL") || (o.kind === "forced" && o.status === "CONDITIONAL")) {
      drafts = [...a.conditions];
    } else if (o.kind === "offer") {
      const days = profile.noSpaceRule.kind === "condition" ? profile.noSpaceRule.days : 30;
      drafts = [
        { source: "SPACE_NOT_IDENTIFIED", text: `Find a suitable space in pin ${o.pin}`, days },
        ...a.portableConditions,
      ];
    }

    let cann = null;
    let payback = null;
    if (o.pin && slotT?.tier) {
      cann = assessCannibalisation(
        o.pin,
        slotT.tier,
        profile,
        stores,
        reservedPins.filter((r) => r.key !== o.key),
      );
      if (cann.zone === 2) {
        flags.push({ code: "CANNIBALISATION_RISK", text: cann.note });
        const store = cann.nearestStore && cann.nearestStore.km <= cann.radiusKm ? cann.nearestStore.id : null;
        const near = [store, ...cann.nearbyReserved.map((r) => `${r.appId}'s location`)].filter(Boolean).join(" and ");
        if (o.kind === "won" || o.kind === "offer") {
          drafts.push({
            source: "EXPANSION_SIGNOFF",
            text: `Get expansion-head sign-off (within ${cann.radiusKm} km of ${near})${store ? ` and inform the existing partner at ${store} before announcing` : ""}`,
            days: profile.conditionDays.expansionSignOff,
          });
        }
      } else if (cann.zone === "uncertain") {
        flags.push({ code: "LOCATION_UNCERTAIN", text: cann.note });
      }
      payback = estimatePayback(slotT.tier, profile);
      if (payback.warning) {
        flags.push({
          code: "PAYBACK_WARNING",
          text: `Estimated payback of ${Math.round(payback.months)} months is slower than the ${profile.paybackWarningMonths}-month threshold.`,
        });
      }
    }

    let status: Status = o.status ?? (drafts.length ? "CONDITIONAL" : "APPROVED");
    if (o.kind === "won") status = drafts.length ? "CONDITIONAL" : "APPROVED";

    const next = nextInLine(o.slotTerritoryKey, a.app.city.value);
    const conditions: Condition[] = drafts.map((d, i) => ({
      id: `${a.id || a.key}-C${i + 1}`,
      text: d.text,
      deadline: addDays(today, d.days),
      ifMissed: next ? `The slot is released to the next applicant in line: ${next}.` : "The slot is released and offered to the next eligible applicant.",
      source: d.source,
    }));

    if (o.provisional) {
      flags.push({ code: "PROVISIONAL", text: `Provisional: ${idOf(o.provisional.byKey)} (on hold) ranks higher for this pin if their details are confirmed.` });
    }
    if (o.override) flags.push({ code: "HUMAN_OVERRIDE", text: `Human override: ${o.override.reason}` });
    if (o.locked) flags.push({ code: "LOCKED", text: `Sent to partner on ${o.locked.date}.` });

    const codes: ReasonCode[] = [...o.codes];
    if (o.kind === "won") codes.unshift(status === "APPROVED" ? "CLEAN_WIN" : "WON_SLOT_WITH_CONDITIONS");
    for (const c of conditions) codes.push(c.source);
    for (const f of flags) codes.push(f.code);
    if (codes.length === 0) codes.push(status === "WAITLIST" ? "NO_SLOT" : "BLOCKING_DATA_ISSUE");

    const ex = explain(a, o, status, conditions, cann, payback, ctx);
    const reservedStatus = RESERVED_STATUSES.includes(status);

    return {
      appKey: a.key,
      appId: a.id || a.key,
      name: a.app.name,
      row: a.app.row,
      city: a.app.city.value,
      status,
      label: STATUS_META[status].label,
      reasonCodes: [...new Set(codes)],
      headline: ex.headline,
      explanation: ex.explanation,
      counterfactual: ex.counterfactual,
      nextSteps: ex.nextSteps,
      questions: ex.questions,
      conditions,
      flags: dedupeFlags(flags),
      homePin: a.app.pin.value,
      territoryId: o.homeTerritoryKey ? (terByKey.get(o.homeTerritoryKey)?.id ?? null) : null,
      pin: reservedStatus ? o.pin : null,
      slotTerritoryId: reservedStatus && slotT ? slotT.id : null,
      offer:
        o.offer && status === "REDIRECT"
          ? {
              pin: o.offer.pin,
              territoryId: terByKey.get(o.offer.territoryKey)?.id ?? o.offer.territoryKey,
              expires: addDays(today, 7),
              spaceNote: a.spaceType === "none" ? null : a.spaceType === "Owned" ? "Owned space can't be used; a new space is needed." : "The current lease would need to move.",
              distanceKm: o.offer.distanceKm,
            }
          : null,
      competitors: o.competitors,
      bands: a.bands,
      waitlistRank: status === "WAITLIST" ? (o.waitlist?.rank ?? null) : null,
      ifClarified: o.ifClarified
        ? { territoryId: terByKey.get(o.ifClarified.territoryKey)?.id ?? "", rank: o.ifClarified.rank, winsPin: o.ifClarified.winsPin, pin: o.ifClarified.pin }
        : null,
      provisional: o.provisional ? { byAppId: idOf(o.provisional.byKey), until: addDays(today, 7) } : null,
      cannibalisation: reservedStatus ? cann : null,
      payback: reservedStatus ? payback : null,
      launch: a.launch,
      evidence: a.issues.filter((i) => i.evidence).map((i) => ({ code: i.code, quote: i.evidence! })),
      locked: o.locked ? { date: o.locked.date } : null,
      override: o.override ? { status: o.override.status, reason: o.override.reason, time: o.override.time } : null,
      version: 1,
      history: [],
    };
  }

  // 8. Territory states.
  const appPins = new Set(applications.map((a) => a.pin.value).filter(Boolean) as string[]);
  const territoryStates: TerritoryState[] = resolved.territories.map((t) => {
    const reserved = decisions
      .filter((d) => d.pin && d.slotTerritoryId === t.id && !t.blocked)
      .map((d) => ({ appKey: d.appKey, appId: d.appId, pin: d.pin!, status: d.status }));
    return {
      key: t.key,
      id: t.id,
      city: t.city,
      tier: t.tier,
      priority: t.priority,
      slots: alloc.slots.get(t.key) ?? t.slots,
      pins: t.pins,
      excludedPins: t.excludedPins,
      blocked: t.blocked,
      reserved,
      waitlist: (alloc.waitlists.get(t.key) ?? []).map(idOf),
      whiteSpacePins: t.pins.filter((p) => !appPins.has(p) && !reserved.some((r) => r.pin === p)),
      overCommitted: alloc.overCommitted.has(t.key),
    };
  });

  const result: EngineResult = {
    today,
    profileId: profile.id,
    decisions,
    territories: territoryStates,
    issues: [...appIssues, ...resolved.issues],
    withdrawn,
    pendingOverrides: [],
    rejectedOverrides: [],
    warnings: [...resolved.warnings, ...alloc.warnings],
    invariantViolations: [],
  };
  result.invariantViolations = checkInvariants(result, applications, storePins);
  return { result, refused };
}

function dedupeFlags(flags: Flag[]): Flag[] {
  const seen = new Set<string>();
  return flags.filter((f) => (seen.has(f.code) ? false : (seen.add(f.code), true)));
}

const reservedKeys = (r: EngineResult) =>
  new Set(r.decisions.filter((d) => RESERVED_STATUSES.includes(d.status)).map((d) => d.appKey));

/**
 * Run the engine. Human overrides are applied one at a time, in time order. An override that would
 * take a slot from someone is held as pending until the user confirms exactly who is bumped (G9.3).
 */
export function runEngine(input: EngineInput): EngineResult {
  const pending: PendingOverride[] = [];
  const rejected: RejectedOverride[] = [];
  const applied: HumanOverride[] = [];
  let current = runPass(input, applied);

  const ordered = [...(input.overrides ?? [])].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.appKey < b.appKey ? -1 : 1));
  for (const o of ordered) {
    const id = current.result.decisions.find((d) => d.appKey === o.appKey)?.appId ?? o.appKey;
    if (!o.reason?.trim()) {
      rejected.push({ appKey: o.appKey, status: o.status, message: `An override of ${id} needs a reason.` });
      continue;
    }
    if (!current.result.decisions.some((d) => d.appKey === o.appKey)) {
      rejected.push({ appKey: o.appKey, status: o.status, message: `${o.appKey} isn't in the current applications.` });
      continue;
    }
    const trial = runPass(input, [...applied.filter((x) => x.appKey !== o.appKey), o]);
    const refusal = trial.refused.find((r) => r.key === o.appKey);
    if (refusal) {
      rejected.push({ appKey: o.appKey, status: o.status, message: refusal.message });
      continue;
    }
    const before = reservedKeys(current.result);
    const after = reservedKeys(trial.result);
    const bumped = [...before].filter((k) => !after.has(k) && k !== o.appKey).sort();
    const confirmed = new Set(o.confirmedBumps ?? []);
    if (bumped.some((k) => !confirmed.has(k))) {
      const ids = bumped.map((k) => current.result.decisions.find((d) => d.appKey === k)?.appId ?? k);
      pending.push({
        appKey: o.appKey,
        status: o.status,
        wouldBump: bumped,
        message: `Overriding ${id} to ${STATUS_META[o.status].label} would take the slot from ${ids.join(", ")}. Confirm to go ahead.`,
      });
      continue;
    }
    applied.splice(0, applied.length, ...applied.filter((x) => x.appKey !== o.appKey), o);
    current = trial;
  }

  return { ...current.result, pendingOverrides: pending, rejectedOverrides: rejected };
}

/** runEngine plus invariant 6: the same input must give the same output. */
export function runEngineChecked(input: EngineInput): EngineResult {
  const first = runEngine(input);
  const second = runEngine(structuredClone(input));
  if (fingerprint(first.decisions) !== fingerprint(second.decisions)) {
    return { ...first, invariantViolations: [...first.invariantViolations, "6: the same input gave a different output on rerun."] };
  }
  return first;
}

// runEngine (SPEC §6): pure and deterministic. No side effects, no LLM calls, no randomness.

import { EXISTING_STORES } from "@/data/existingStores";
import { reliableDistanceKm } from "@/lib/geo/pins";
import { extractSignalsHeuristic } from "@/lib/ingest/heuristics";
import { checkApplications, likelyDuplicates, resolveTerritories, type ResolvedTerritory } from "@/lib/ingest/validate";
import { addDays, daysBetween } from "@/lib/planner/dates";
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
import { assess, assessTimeline, type Assessment, type ConditionDraft } from "./readiness";
import { buildOnboardingPlan, earliestLaunch } from "@/lib/planner/onboarding";
import { applyCohort } from "@/lib/planner/cohortShift";
import { buildCohorts, buildTrainingPlan } from "@/lib/planner/training";
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
  // "One person" = a likely-duplicate group (same name and city plus similar business or investment), not a name alone.
  const duplicateOf = likelyDuplicates(applications);
  const personOf = new Map(applications.map((a) => [a.key, duplicateOf.get(a.key) ?? a.key]));
  for (const a of assessments) a.person = personOf.get(a.key)!;
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
  /** City waitlist entries whose own pin is in the territory, in rank order. */
  const inTerritoryLine = (territoryKey: string) => {
    const t = terByKey.get(territoryKey);
    if (!t) return [];
    return (alloc.cityWaitlists.get(t.city ?? "") ?? []).filter((k) => {
      const pin = byKey.get(k)?.app.pin.value;
      return pin !== null && pin !== undefined && t.pins.includes(pin);
    });
  };
  // A slot freed in a territory goes first to the highest-ranked waitlisted applicant whose pin is in it,
  // then to the highest-ranked in the city.
  const nextInLineKey = (territoryKey: string | null, city: string | null) => {
    const t = territoryKey ? terByKey.get(territoryKey) : undefined;
    return (territoryKey ? inTerritoryLine(territoryKey)[0] : undefined) ?? alloc.cityWaitlists.get(city ?? t?.city ?? "")?.[0] ?? null;
  };
  const nextInLine = (territoryKey: string | null, city: string | null) => {
    const k = nextInLineKey(territoryKey, city);
    return k ? idOf(k) : null;
  };
  // Filled after statuses are known: who is next in line for an at-risk slot, and who pre-onboards.
  const tags = { nextInLine: new Map<string, string[]>(), preOnboard: new Set<string>() };
  const activeCities = new Set(resolved.territories.filter((t) => !t.blocked).map((t) => t.city));

  const reservedPins = [...alloc.outcomes.values()].filter((o) => o.pin).map((o) => ({ key: o.key, appId: idOf(o.key), pin: o.pin! }));

  const ctx: ExplainContext = {
    profile,
    today,
    idOf,
    nameOf: (key) => byKey.get(key)?.app.name ?? key,
    territoryId: (key) => (key ? (terByKey.get(key)?.id ?? key) : ""),
    slotsOf: (key) => alloc.slots.get(key) ?? terByKey.get(key)?.slots ?? 0,
    slotHolders: (key) => (alloc.reserved.get(key) ?? []).map((r) => idOf(r.key)).sort(),
    nextInLine,
    lineFor: (key, territoryKey) => {
      const i = inTerritoryLine(territoryKey).indexOf(key);
      return i < 0 ? null : i + 1;
    },
    cityHasTerritory: (city) => activeCities.has(city as never),
    storeAt: (pin) => stores.find((s) => s.pin === pin)?.id ?? null,
    nextInLineFor: (key) => tags.nextInLine.get(key) ?? [],
    preOnboard: (key) => tags.preOnboard.has(key),
    reviewDate: addDays(today, profile.waitlistReviewDays),
    pinHolder: (pin) => [...alloc.reserved.values()].flat().find((r) => r.pin === pin)?.key ?? null,
    pinInTerritory: (territoryId, pin) => resolved.territories.some((t) => t.id === territoryId && t.pins.includes(pin)),
  };

  // Two passes: the first settles every status (conditions depend on cannibalisation, not on tags);
  // tags for at-risk slots are then derived, and the second pass writes the final explanations.
  const firstPass = applications.map((app) => finalise(byKey.get(app.key)!, alloc.outcomes.get(app.key)!));
  const atRisk = new Set(
    firstPass
      .filter((d) => d.status === "CONDITIONAL" || d.provisional)
      .map((d) => alloc.outcomes.get(d.appKey)!.slotTerritoryKey)
      .filter((k): k is string => !!k),
  );
  for (const t of resolved.territories) {
    if (!atRisk.has(t.key)) continue;
    const k = nextInLineKey(t.key, t.city);
    if (k) tags.nextInLine.set(k, [...(tags.nextInLine.get(k) ?? []), t.id]);
  }
  // Pre-onboarding: next-in-line applicants first, then the top of each city's waitlist, up to the limit.
  for (const list of alloc.cityWaitlists.values()) {
    const ordered = [...list.filter((k) => tags.nextInLine.has(k)), ...list.filter((k) => !tags.nextInLine.has(k))];
    for (const k of ordered.slice(0, profile.preOnboarding.topN)) tags.preOnboard.add(k);
  }
  const decisions: DecisionRecord[] = applications.map((app) => finalise(byKey.get(app.key)!, alloc.outcomes.get(app.key)!));

  // Training cohorts across committed partners (Approved and Approved with conditions): planned starts within
  // 10 days of each other share one real start date. A partner with slack is moved later to it, and only if their
  // opening date doesn't move.
  const cohorts = buildCohorts(
    decisions
      .filter((d) => (d.status === "APPROVED" || d.status === "CONDITIONAL") && d.training && d.onboarding && d.city)
      .map((d) => ({
        appId: d.appId,
        appKey: d.appKey,
        city: d.city!,
        language: d.training!.language,
        earliestStart: d.training!.start,
        latestStart: addDays(d.training!.start, d.training!.slackDays),
        launch: d.onboarding!.earliestLaunch,
      })),
  );
  for (const c of cohorts) {
    for (const m of c.members) {
      const d = decisions.find((x) => x.appKey === m.appKey)!;
      applyCohort(d.onboarding!, d.training!, c, m.start);
      d.preparation = preparationText(d.training!.summary, d.onboarding!.ifAccepted, c.label);
    }
  }

  function finalise(a: Assessment, o: Outcome): DecisionRecord {
    const slotT = o.slotTerritoryKey ? terByKey.get(o.slotTerritoryKey) : undefined;
    const flags: Flag[] = [...a.flags];
    let drafts: ConditionDraft[] = [];
    if (o.kind === "won" || (o.kind === "locked" && o.status === "CONDITIONAL") || (o.kind === "forced" && o.status === "CONDITIONAL")) {
      drafts = [...a.conditions];
    } else if (o.kind === "offer") {
      const days = profile.noSpaceRule.kind === "condition" ? profile.noSpaceRule.days : 30;
      drafts = [
        { source: "SPACE_NOT_IDENTIFIED", text: `Find a suitable space in pin ${o.pin}`, short: `finds a space in pin ${o.pin}`, days, owner: "partner" },
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
          // Internal: the team acts on these, not the partner.
          drafts.push({
            source: "EXPANSION_SIGNOFF",
            text: `Get expansion-head sign-off (within ${cann.radiusKm} km of ${near})${store ? ` and inform the existing partner at ${store} before announcing` : ""}`,
            short: "gets expansion-head sign-off",
            days: profile.conditionDays.expansionSignOff,
            owner: "team",
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
      short: d.short,
      owner: d.owner,
      deadline: addDays(today, d.days),
      ifMissed: next ? `The slot is released to the next applicant in line: ${next}.` : "The slot is released and offered to the next eligible applicant.",
      source: d.source,
    }));

    if (o.provisional) {
      flags.push({ code: "PROVISIONAL", text: `Provisional: ${idOf(o.provisional.byKey)} (on hold) ranks higher for this pin if their details are confirmed.` });
    }
    if (o.override) flags.push({ code: "HUMAN_OVERRIDE", text: `Human override: ${o.override.reason}` });
    if (o.locked) flags.push({ code: "LOCKED", text: `Sent to partner on ${o.locked.date}.` });


    // Plans (SPEC §7): for a location offer, the plan applies if accepted and needs a new space.
    const reservedStatus = RESERVED_STATUSES.includes(status);
    let view: Assessment = a;
    let onboarding = null;
    let training = null;
    if (reservedStatus && o.pin) {
      const isOffer = status === "REDIRECT";
      const pendingSignOff = conditions.length > 0 && conditions.every((c) => c.owner === "team");
      const path = {
        ...(isOffer ? a.pathIfNewSpace : a.path),
        internalSignOffDays: pendingSignOff ? Math.max(...conditions.map((c) => daysBetween(today, c.deadline))) : 0,
      };
      // The plan is the single source for the launch date: re-test feasibility against it.
      const timeline = assessTimeline(earliestLaunch(today, profile, path), a.launch.target!, a.launch.festival, isOffer || a.spaceType === "none");
      const TIMELINE = new Set(["TARGET_NOT_FEASIBLE", "TIGHT_TIMELINE", "NOTES_TARGET_DISAGREE"]);
      view = { ...a, launch: timeline.launch, flags: [...a.flags.filter((f) => !TIMELINE.has(f.code)), ...timeline.flags] };
      for (let i = flags.length - 1; i >= 0; i--) if (TIMELINE.has(flags[i].code)) flags.splice(i, 1);
      flags.push(...timeline.flags);
      onboarding = buildOnboardingPlan({
        today,
        profile,
        input: path,
        target: view.launch.target,
        festival: view.launch.festival,
        conditions,
        storeManager: a.signals.absentee_owner,
        ifAccepted: isOffer,
        pin: o.pin,
      });
      const tm = onboarding.milestones.find((m) => m.id === "training")!;
      training = buildTrainingPlan({
        profile,
        track: a.track,
        experienceText: a.experienceText,
        language: a.app.language.value,
        storeManager: a.signals.absentee_owner,
        pin: o.pin,
        city: a.app.city.value,
        stores,
        // Shadow a store the new store won't compete with: never one inside its own catchment.
        catchmentKm: slotT?.tier ? profile.cannibalisationRadiusKm[slotT.tier] : 0,
        start: tm.start,
        end: tm.end,
        auditStart: onboarding.milestones.find((m) => m.id === "audit")!.start,
        auditEnd: onboarding.milestones.find((m) => m.id === "audit")!.end,
        induction: (() => {
          const im = onboarding.milestones.find((m) => m.id === "induction")!;
          return im.skipped ? null : { start: im.start, end: im.end };
        })(),
        hiringEnd: onboarding.milestones.find((m) => m.id === "hiring")!.end,
      });
    }

    const codes: ReasonCode[] = [...o.codes];
    if (o.kind === "won") codes.unshift(status === "APPROVED" ? "CLEAN_WIN" : "WON_SLOT_WITH_CONDITIONS");
    for (const c of conditions) codes.push(c.source);
    for (const f of flags) codes.push(f.code);
    if (codes.length === 0) codes.push(status === "WAITLIST" ? "NO_SLOT" : "BLOCKING_DATA_ISSUE");

    const ex = explain(view, o, status, conditions, cann, payback, ctx);

    return {
      appKey: a.key,
      appId: a.id || a.key,
      name: a.app.name,
      row: a.app.row,
      city: a.app.city.value,
      status,
      label:
        status === "CONDITIONAL" && conditions.length > 0 && conditions.every((c) => c.owner === "team")
          ? "Approved, pending internal sign-off"
          : STATUS_META[status].label,
      reasonCodes: [...new Set(codes)],
      headline: ex.headline,
      explanation: ex.explanation,
      counterfactual: ex.counterfactual,
      partnerSteps: ex.partnerSteps,
      teamSteps: ex.teamSteps,
      partnerNextStep: ex.partnerSteps[0] ?? "",
      teamNextStep: ex.teamSteps[0] ?? "",
      suggestions: a.suggestions,
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
      waitlist:
        status === "WAITLIST" && o.waitlist
          ? {
              city: o.waitlist.city,
              rank: o.waitlist.rank,
              wantedTerritoryId: o.homeTerritoryKey ? (terByKey.get(o.homeTerritoryKey)?.id ?? null) : null,
              nextInLineFor: tags.nextInLine.get(a.key) ?? [],
              preOnboarding: tags.preOnboard.has(a.key),
            }
          : null,
      talentPool: status === "WAITLIST" && o.codes.includes("OUTSIDE_PLAN") ? a.app.city.value : null,
      waitlistRank: status === "WAITLIST" ? (o.waitlist?.rank ?? null) : null,
      ifClarified: o.ifClarified
        ? { territoryId: terByKey.get(o.ifClarified.territoryKey)?.id ?? "", rank: o.ifClarified.rank, winsPin: o.ifClarified.winsPin, pin: o.ifClarified.pin }
        : null,
      provisional: o.provisional ? { byAppId: idOf(o.provisional.byKey), until: addDays(today, 7) } : null,
      cannibalisation: reservedStatus ? cann : null,
      payback: reservedStatus ? payback : null,
      launch: view.launch,
      evidence: a.issues.filter((i) => i.evidence).map((i) => ({ code: i.code, quote: i.evidence! })),
      locked: o.locked ? { date: o.locked.date } : null,
      override: o.override ? { status: o.override.status, reason: o.override.reason, time: o.override.time } : null,
      onboarding,
      training,
      preparation: training ? preparationText(training.summary, onboarding?.ifAccepted ?? false, null) : null,
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
      // "Recruit here" (SPEC §10.1): only where the territory still has free slots.
      whiteSpacePins:
        !t.blocked && reserved.length < (alloc.slots.get(t.key) ?? t.slots)
          ? t.pins.filter((p) => !appPins.has(p) && !reserved.some((r) => r.pin === p))
          : [],
      overCommitted: alloc.overCommitted.has(t.key),
    };
  });

  const result: EngineResult = {
    today,
    profileId: profile.id,
    decisions,
    territories: territoryStates,
    cohorts,
    issues: [...appIssues, ...resolved.issues],
    withdrawn,
    pendingOverrides: [],
    rejectedOverrides: [],
    warnings: [...resolved.warnings, ...alloc.warnings],
    invariantViolations: [],
  };
  result.invariantViolations = checkInvariants(result, applications, storePins, personOf);
  return { result, refused };
}

function preparationText(summary: string, ifAccepted: boolean, cohortLabel: string | null): string {
  return `${summary}.${ifAccepted ? " (If the offer is accepted.)" : ""}${cohortLabel ? ` ${cohortLabel}.` : ""}`;
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
    // Bumped = anyone holding a slot now who would lose it, drop from their own slot to an offer, or be moved
    // to a different pin (a cascade can move several). Promotions don't need confirmation.
    const before = reservedKeys(current.result);
    const find = (r: EngineResult, k: string) => r.decisions.find((d) => d.appKey === k);
    const level = (st: Status | undefined) => (st === "APPROVED" || st === "CONDITIONAL" ? 2 : st === "REDIRECT" ? 1 : 0);
    const bumped = [...before]
      .filter((k) => k !== o.appKey)
      .filter((k) => {
        const b = find(current.result, k)!;
        const t = find(trial.result, k);
        const lb = level(b.status);
        const lt = level(t?.status);
        return lt < lb || (lt === lb && t!.pin !== b.pin);
      })
      .sort();
    const confirmed = new Set(o.confirmedBumps ?? []);
    if (bumped.some((k) => !confirmed.has(k))) {
      const changes = bumped.map((k) => {
        const b = find(current.result, k)!;
        const t = find(trial.result, k);
        return `${b.appId} (${b.label} → ${t ? t.label : "removed"})`;
      });
      pending.push({
        appKey: o.appKey,
        status: o.status,
        wouldBump: bumped,
        message: `Overriding ${id} to ${STATUS_META[o.status].label} would change ${changes.join(", ")}. Confirm to go ahead.`,
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

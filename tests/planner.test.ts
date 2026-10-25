// Phase 4: onboarding critical path, festival calendar, training plan, cohorts (SPEC §7).

import { describe, expect, it } from "vitest";
import { EXISTING_STORES } from "@/data/existingStores";
import { BRAND_PROFILES, defaultPolicy } from "@/lib/policy/brandProfiles";
import { festivalDate } from "@/lib/planner/calendar";
import { applyCohort } from "@/lib/planner/cohortShift";
import { SOFT_LAUNCH_MIN_GAIN_DAYS, buildOnboardingPlan, choosePhasedOption, criticalPathDays, scheduleMilestones, type PathInput } from "@/lib/planner/onboarding";
import { KANNADA_MODULE, buildCohorts, shadowStore, trainingDays } from "@/lib/planner/training";
import { RESERVED_STATUSES } from "@/lib/types";
import { decision, trickyRun } from "./engineHelpers";

const eyewear = BRAND_PROFILES.eyewear;
const rented: PathInput = { needsSpaceSearch: false, spaceSearchDays: 0, needsLease: true, track: "Standard" };
const dates = (ms: ReturnType<typeof scheduleMilestones>) => Object.fromEntries(ms.map((m) => [m.id, `${m.start}→${m.end}`]));

describe("onboarding critical path (SPEC §7.1)", () => {
  it("rented space: licences, fit-out and hiring after the lease; stock after fit-out; audit after all", () => {
    const ms = scheduleMilestones("2026-10-25", eyewear, rented);
    expect(dates(ms)).toEqual({
      signoff: "2026-10-25→2026-10-25",
      loi: "2026-10-25→2026-11-01",
      space: "2026-10-25→2026-10-25",
      lease: "2026-11-01→2026-11-15",
      licences: "2026-11-15→2026-12-15",
      fitout: "2026-11-15→2026-12-30",
      hiring: "2026-11-15→2026-12-15",
      training: "2026-12-15→2027-01-05",
      stock: "2026-12-30→2027-01-06",
      induction: "2027-01-03→2027-01-06",
      audit: "2027-01-06→2027-01-09",
      launch: "2027-01-09→2027-01-09",
    });
    expect(ms.filter((m) => m.critical && !m.skipped).map((m) => m.id)).toEqual(["loi", "lease", "fitout", "stock", "audit", "launch"]);
    expect(criticalPathDays(eyewear, rented)).toBe(76);
  });

  it("owned space skips the lease; the extended track puts training on the critical path", () => {
    const ms = scheduleMilestones("2026-10-25", eyewear, { ...rented, needsLease: false, track: "Extended" });
    const m = Object.fromEntries(ms.map((x) => [x.id, x]));
    expect(m.lease.skipped).toBe(true);
    expect(m.training.days).toBe(28);
    expect(m.training.critical).toBe(true);
    expect(m.launch.end).toBe("2027-01-01");
  });

  it("a space search starts today, in parallel with the letter of intent, and ends on the condition deadline", () => {
    const ms = scheduleMilestones("2026-10-25", eyewear, { ...rented, needsSpaceSearch: true, spaceSearchDays: 45 });
    const m = Object.fromEntries(ms.map((x) => [x.id, x]));
    expect(m.space.end).toBe("2026-12-09");
    expect(m.lease.start).toBe("2026-12-09");
    expect(m.launch.end).toBe("2027-02-16");
  });

  it("pending internal sign-off comes before the letter of intent", () => {
    const ms = scheduleMilestones("2026-10-25", eyewear, { ...rented, internalSignOffDays: 7 });
    const m = Object.fromEntries(ms.map((x) => [x.id, x]));
    expect(m.signoff.end).toBe("2026-11-01");
    expect(m.loi.start).toBe("2026-11-01");
    expect(m.launch.end).toBe("2027-01-16");
  });

  it("today is configurable: every date moves with it", () => {
    const a = scheduleMilestones("2026-10-25", eyewear, rented).at(-1)!.end;
    const b = scheduleMilestones("2026-11-04", eyewear, rented).at(-1)!.end;
    expect(a).toBe("2027-01-09");
    expect(b).toBe("2027-01-19");
  });

  it("other brand profiles use their own lead times", () => {
    expect(criticalPathDays(BRAND_PROFILES.delivery, rented)).toBe(7 + 14 + Math.max(21, 21 + 7, 15 + 10) + 3);
    expect(criticalPathDays(BRAND_PROFILES.partner_point, { ...rented, needsLease: false })).toBe(7 + Math.max(7, 3 + 7, 0 + 2) + 3);
  });
});

describe("feasibility, phased option and festivals (SPEC §7.1, §15.7)", () => {
  it("festival dates are marked verify and only count when still ahead", () => {
    expect(festivalDate("Diwali", "2026-10-25")).toEqual({ name: "Diwali", date: "2026-11-08", verify: true });
    expect(festivalDate("Diwali", "2026-11-09")).toBeNull();
    expect(festivalDate("Sankranti", "2026-10-25")?.date).toBe("2027-01-14");
  });

  it("an infeasible target gets the earliest realistic date", () => {
    const plan = buildOnboardingPlan({
      today: "2026-10-25",
      profile: eyewear,
      input: { needsSpaceSearch: true, spaceSearchDays: 45, needsLease: true, track: "Fast-track" },
      target: "2027-01-25",
      festival: { name: "Diwali", date: "2026-11-08" },
      conditions: [],
      storeManager: false,
      ifAccepted: false,
      pin: "570020",
    });
    expect(plan.feasible).toBe(false);
    expect(plan.testDate).toBe("2026-11-08");
    expect(plan.summary).toBe("Target not feasible: opening before Diwali (8 Nov 2026, verify) isn't possible; earliest realistic date is 16 Feb 2027.");
  });

  it("a soft launch is only offered when it gains at least 14 days over the full launch", () => {
    const base = scheduleMilestones("2026-10-25", eyewear, rented);
    // With the standard step lengths a soft launch gains at most a week, so it is never offered.
    expect(choosePhasedOption(base, eyewear, "2026-12-01", null)).toBeNull();
    // A schedule where the full launch is 20 days after everything but the audit and stock are ready.
    const long = base.map((m) => (m.id === "audit" || m.id === "launch" ? { ...m, end: "2027-01-29" } : m));
    const o = choosePhasedOption(long, eyewear, "2027-01-15", null);
    expect(o).toMatchObject({ softLaunch: "2027-01-11", fullLaunch: "2027-01-29", gainDays: 18 });
    expect(o!.text).toBe(
      "Phased option: a soft launch with starter stock on 11 Jan 2027, 18 days before the full launch on 29 Jan 2027 (after the mock audit). The soft launch meets the target.",
    );
    // Just under the threshold: not offered.
    const near = base.map((m) => (m.id === "audit" || m.id === "launch" ? { ...m, end: "2027-01-24" } : m));
    expect(choosePhasedOption(near, eyewear, null, null)).toBeNull();
    expect(choosePhasedOption(near, eyewear, null, null, 13)).not.toBeNull();
    // Exactly 14 days qualifies.
    const exact = base.map((m) => (m.id === "audit" || m.id === "launch" ? { ...m, end: "2027-01-25" } : m));
    expect(choosePhasedOption(exact, eyewear, null, null)?.gainDays).toBe(14);
    expect(SOFT_LAUNCH_MIN_GAIN_DAYS).toBe(14);
  });

  it("no decision on the fixture offers a soft launch (none gains 14 days)", () => {
    for (const x of trickyRun().decisions) expect(x.onboarding?.phasedOption ?? null, x.appKey).toBeNull();
  });

  it("a feasible target says how many days are spare", () => {
    expect(decision(trickyRun(), "APP-001").onboarding!.summary).toBe(
      "Opening by 25 Feb 2027 is feasible: earliest realistic opening is 26 Dec 2026, 61 days to spare.",
    );
  });
});

describe("plans on decisions", () => {
  const r = trickyRun();
  const d = (k: string) => decision(r, k);

  it("Approved, Approved with conditions and offers get plans; nobody else does", () => {
    for (const x of r.decisions) {
      const reserved = RESERVED_STATUSES.includes(x.status);
      expect(!!x.onboarding, x.appKey).toBe(reserved);
      expect(!!x.training, x.appKey).toBe(reserved);
      expect(!!x.preparation, x.appKey).toBe(reserved);
    }
    expect(d("APP-034").onboarding!.ifAccepted).toBe(true);
    expect(d("APP-034").preparation).toMatch(/\(If the offer is accepted\.\)$/);
  });

  it("the plan is the single source for the launch date shown on the decision", () => {
    for (const x of r.decisions) if (x.onboarding) expect(x.launch!.earliest, x.appKey).toBe(x.onboarding.earliestLaunch);
  });

  it("the checklist has owners and due dates, merges conditions, and never repeats a step", () => {
    const c19 = d("APP-019").onboarding!.checklist;
    expect(c19.map((c) => c.item)).toContain("Move to a ground-floor space");
    expect(c19.filter((c) => /space/i.test(c.item) && c.source !== "condition")).toEqual([]);
    expect([...c19].map((c) => c.due)).toEqual([...c19].map((c) => c.due).sort());
    const c33 = d("APP-033").onboarding!.checklist;
    expect(c33[0]).toMatchObject({ owner: "team", source: "condition" });
    expect(c33[0].item).toMatch(/^Get expansion-head sign-off/);
  });

  it("pending internal sign-off delays the letter of intent (APP-033)", () => {
    const m = Object.fromEntries(d("APP-033").onboarding!.milestones.map((x) => [x.id, x]));
    expect(m.signoff.skipped).toBe(false);
    expect(m.loi.start).toBe("2026-11-01");
    expect(d("APP-033").onboarding!.earliestLaunch).toBe("2027-01-16");
  });

  it("a location offer plans for a new space", () => {
    const m = Object.fromEntries(d("APP-034").onboarding!.milestones.map((x) => [x.id, x]));
    expect(m.space.skipped).toBe(false);
    expect(m.lease.skipped).toBe(false);
  });
});

describe("training plan (SPEC §7.2)", () => {
  const r = trickyRun();
  const t = (k: string) => decision(r, k).training!;

  it("track follows the experience band, with track-specific days", () => {
    expect(t("APP-001").track).toBe("Fast-track");
    expect(t("APP-018").track).toBe("Standard");
    expect(t("APP-020").track).toBe("Extended");
    expect([t("APP-001").days, t("APP-018").days, t("APP-020").days]).toEqual([16, 21, 28]);
    expect(trainingDays(eyewear, "Extended")).toBe(28);
    expect(t("APP-020").modules.map((m) => m.name)).toEqual(expect.arrayContaining(["Basic store operations", "Finance basics: cash, GST and margins"]));
  });

  it("language: Hindi or English speakers get Kannada customer basics and a staffing note", () => {
    expect(t("APP-015").language).toBe("Hindi");
    expect(t("APP-015").modules.map((m) => m.name)).toContain(KANNADA_MODULE);
    expect(t("APP-015").staffingNote).toBe("Recommend hiring at least one Kannada-speaking staff member.");
    expect(t("APP-019").modules.map((m) => m.name)).toContain(KANNADA_MODULE);
    expect(t("APP-016").modules.map((m) => m.name)).not.toContain(KANNADA_MODULE);
    expect(t("APP-016").staffingNote).toBeNull();
  });

  it("shadowing at the nearest existing store; Tier 3 cities use the nearest city's store", () => {
    expect(t("APP-001").shadow).toMatchObject({ storeId: "ST-05", km: 3.7, days: 3, note: "nearest existing store" });
    expect(t("APP-017").shadow).toMatchObject({ storeId: "ST-01", storeCity: "Bengaluru", note: "Tumakuru has no existing stores yet; the nearest is in Bengaluru" });
    expect(t("APP-026").shadow!.note).toMatch(/distance approximate/);
    expect(shadowStore(null, "Davanagere", EXISTING_STORES, 3)?.storeCity).toBeTruthy();
  });

  it("never shadows a store inside the new store's catchment: the next nearest is used, with a note", () => {
    for (const k of ["APP-026", "APP-033"]) {
      expect(t(k).shadow, k).toMatchObject({ storeId: "ST-07", storeCity: "Mysuru", skipped: ["ST-06"] });
      expect(t(k).shadow!.note, k).toContain("Not ST-06: it's within the new store's catchment");
    }
    expect(t("APP-033").shadow!.km).toBeGreaterThan(2.5);
    // Whatever the choice, the shadow store is never inside the new store's catchment when another exists.
    for (const x of r.decisions) {
      if (!x.training?.shadow || !x.cannibalisation) continue;
      if (x.training.shadow.km !== null) expect(x.training.shadow.km, x.appKey).toBeGreaterThan(x.cannibalisation.radiusKm);
    }
    // Unit: radius 0 keeps the nearest store; a large radius skips every store inside it.
    expect(shadowStore("570005", "Mysuru", EXISTING_STORES, 3, 0)?.storeId).toBe("ST-06");
    expect(shadowStore("570005", "Mysuru", EXISTING_STORES, 3, 2.5)?.storeId).toBe("ST-07");
    expect(shadowStore("570005", "Mysuru", EXISTING_STORES, 3, 5)?.skipped).toEqual(["ST-06", "ST-07"]);
    expect(shadowStore("570005", "Mysuru", EXISTING_STORES, 3, 5)?.note).toMatch(/Not ST-06 or ST-07: they're within/);
  });

  it("a named store manager trains too (absentee owner)", () => {
    expect(t("APP-027").storeManagerAttends).toBe(true);
    expect(decision(r, "APP-027").onboarding!.milestones.find((m) => m.id === "training")!.note).toBe(
      "The named store manager attends every module too.",
    );
  });

  it("readiness check before launch: quiz, mock audit, sign-off", () => {
    expect(t("APP-001").readinessCheck.map((x) => x.item)).toEqual(["Product and process quiz", "Mock audit", "Trainer sign-off"]);
    expect(t("APP-001").readinessCheck[2].due).toBe(decision(r, "APP-001").onboarding!.earliestLaunch);
  });
});

describe("store-team induction (How your team will be prepared)", () => {
  const r = trickyRun();

  it("comes after hiring and fit-out and before the mock audit, within the last two weeks", () => {
    for (const x of r.decisions) {
      if (!x.onboarding) continue;
      const m = Object.fromEntries(x.onboarding.milestones.map((y) => [y.id, y]));
      expect(m.induction.skipped, x.appKey).toBe(false);
      expect(m.induction.start >= m.hiring.end, `${x.appKey} hiring first`).toBe(true);
      expect(m.induction.start >= m.fitout.end, `${x.appKey} fit-out first`).toBe(true);
      expect(m.induction.end <= m.audit.start, `${x.appKey} before audit`).toBe(true);
      const daysBeforeOpening = (Date.parse(x.onboarding.earliestLaunch) - Date.parse(m.induction.start)) / 86_400_000;
      expect(daysBeforeOpening, x.appKey).toBeLessThanOrEqual(14);
      expect(daysBeforeOpening, x.appKey).toBeGreaterThanOrEqual(3);
    }
  });

  it("appears in the training plan under its own heading, and in the checklist", () => {
    const t = decision(r, "APP-001").training!.teamPreparation!;
    expect(t.heading).toBe("How your team will be prepared");
    expect(t).toMatchObject({ who: "Certified optometrist and store staff", days: 3, start: "2026-12-20", end: "2026-12-23", hiringEnds: "2026-12-01" });
    expect(t.text).toBe(
      "Certified optometrist and store staff are inducted for 3 days (20 Dec 2026 to 23 Dec 2026), after hiring ends on 1 Dec 2026 and the store is fitted out, in the last days before the mock audit. Topics: Store walkthrough and opening routine; Eye-test workflow with the optometrist; Point of sale; Customer service.",
    );
    expect(decision(r, "APP-001").onboarding!.checklist.map((c) => c.item)).toContain("Store-team induction: Certified optometrist and store staff");
    expect(decision(r, "APP-001").preparation).toContain("team induction 20 Dec 2026");
  });

  it("comes from the brand profile: delivery has its own team, partner point has none", () => {
    const delivery = trickyRun("delivery");
    expect(decision(delivery, "APP-001").training!.teamPreparation).toMatchObject({ who: "Supervisor and riders", days: 2 });
    const point = trickyRun("partner_point");
    for (const x of point.decisions) if (x.training) expect(x.training.teamPreparation, x.appKey).toBeNull();
  });

  it("is delayed when hiring ends later than the late slot would allow", () => {
    const longHiring = { ...eyewear, leadTimes: { ...eyewear.leadTimes, hiringDays: 60 } };
    const ms = Object.fromEntries(scheduleMilestones("2026-10-25", longHiring, rented).map((m) => [m.id, m]));
    expect(ms.induction.start >= ms.hiring.end).toBe(true);
  });
});

describe("cohorts (SPEC §7.2)", () => {
  it("groups committed partners by language and city whose training starts are within 10 days", () => {
    const r = trickyRun();
    expect(r.cohorts.map((c) => c.label)).toEqual(["Kannada cohort, Bengaluru, starts 1 Dec 2026: APP-001, APP-023, APP-031"]);
    // Cohort dates are real shared start dates.
    for (const c of r.cohorts) {
      for (const m of c.members) expect(decision(r, m.appKey).training!.start, m.appId).toBe(c.start);
    }
    // APP-003 starts training 14 days later and APP-033/APP-016 are 21 days apart: not within 10 days.
    expect(decision(r, "APP-003").training!.cohortId).toBeNull();
    expect(decision(r, "APP-016").training!.cohortId).toBeNull();
    expect(decision(r, "APP-001").preparation).toContain("Kannada cohort, Bengaluru");
    expect(r.cohorts.flatMap((c) => c.members.map((m) => m.appId))).not.toContain("APP-010");
  });

  it("a partner with slack is moved later to the cohort's start, and their opening date does not move", () => {
    // APP-033 owned with a 4-day internal sign-off: its training can start 5 Dec; APP-016 (owned, 1 Dec) has 6 days of slack.
    const policy = defaultPolicy("eyewear");
    policy.profile.conditionDays.expansionSignOff = 4;
    const base = trickyRun("eyewear", { policy });
    const r = trickyRun("eyewear", {
      policy,
      facts: [{ target: "application", key: "APP-033", field: "spaceAvailable", value: "Owned" }],
    });
    expect(r.invariantViolations).toEqual([]);
    const a = decision(r, "APP-016");
    const b = decision(r, "APP-033");
    expect(r.cohorts.map((c) => c.label)).toContain("Kannada cohort, Mysuru, starts 5 Dec 2026: APP-016, APP-033");
    expect(a.training!.start).toBe("2026-12-05");
    expect(b.training!.start).toBe("2026-12-05");
    expect(a.training!.shifted).toMatchObject({ from: "2026-12-01", to: "2026-12-05" });
    expect(b.training!.shifted).toBeNull();
    // The opening date and everything else is unchanged for the shifted partner.
    expect(a.onboarding!.earliestLaunch).toBe(decision(base, "APP-016").onboarding!.earliestLaunch);
    expect(a.training!.end <= a.onboarding!.milestones.find((m) => m.id === "audit")!.start).toBe(true);
    expect(a.onboarding!.milestones.find((m) => m.id === "training")!.start).toBe("2026-12-05");
    expect(a.onboarding!.checklist.find((c) => c.source === "training")!.due).toBe(a.training!.end);
    expect(a.preparation).toContain("from 5 Dec 2026");
  });

  const cand = (appId: string, earliestStart: string, latestStart: string) => ({
    appId,
    appKey: appId,
    city: "Mysuru",
    language: "Kannada" as const,
    earliestStart,
    latestStart,
    launch: "2027-02-01",
  });

  it("only shifts when the slack allows it; a partner who can't reach the date is left out", () => {
    // A can slide to 5 Dec, B can't (no slack), so B anchors the cohort date only if A can reach it.
    const [c] = buildCohorts([cand("A", "2026-12-01", "2026-12-07"), cand("B", "2026-12-05", "2026-12-05")]);
    expect(c.start).toBe("2026-12-05");
    expect(c.members.map((m) => [m.appId, m.shiftedDays])).toEqual([["A", 4], ["B", 0]]);
    // C starts 6 days after A and A has only 5 days of slack: no cohort.
    expect(buildCohorts([cand("A", "2026-12-01", "2026-12-06"), cand("C", "2026-12-07", "2026-12-07")])).toEqual([]);
    // More than 10 days apart: no cohort even with plenty of slack.
    expect(buildCohorts([cand("A", "2026-12-01", "2026-12-30"), cand("D", "2026-12-12", "2026-12-12")])).toEqual([]);
  });

  it("picks the shared date that fits the most partners, then starts another cohort for the rest", () => {
    const cohorts = buildCohorts([
      cand("A", "2026-12-01", "2026-12-09"),
      cand("B", "2026-12-04", "2026-12-09"),
      cand("C", "2026-12-09", "2026-12-09"),
      cand("D", "2027-02-01", "2027-02-05"),
      cand("E", "2027-02-05", "2027-02-05"),
    ]);
    expect(cohorts.map((c) => [c.start, c.members.map((m) => m.appId)])).toEqual([
      ["2026-12-09", ["A", "B", "C"]],
      ["2027-02-05", ["D", "E"]],
    ]);
  });

  it("applyCohort keeps the plan consistent", () => {
    const r = trickyRun();
    const d = decision(r, "APP-001");
    const onboarding = structuredClone(d.onboarding!);
    const training = structuredClone(d.training!);
    applyCohort(onboarding, training, { id: "x", label: "Kannada cohort, Bengaluru, starts 5 Dec 2026: A", city: "Bengaluru", language: "Kannada", start: "2026-12-05", members: [{ appId: "A", appKey: "A", plannedStart: "2026-12-01", start: "2026-12-05", shiftedDays: 4, launch: "2026-12-26" }] }, "2026-12-05");
    expect(training.slackDays).toBe(2);
    expect(training.end).toBe("2026-12-21");
    expect(onboarding.earliestLaunch).toBe(d.onboarding!.earliestLaunch);
  });
});

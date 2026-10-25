// Phase 4: onboarding critical path, festival calendar, training plan, cohorts (SPEC §7).

import { describe, expect, it } from "vitest";
import { EXISTING_STORES } from "@/data/existingStores";
import { BRAND_PROFILES } from "@/lib/policy/brandProfiles";
import { festivalDate } from "@/lib/planner/calendar";
import { buildOnboardingPlan, criticalPathDays, scheduleMilestones, type PathInput } from "@/lib/planner/onboarding";
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

  it("an infeasible target gets the earliest realistic date and a soft-launch option", () => {
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
    expect(plan.phasedOption).toEqual({
      softLaunch: "2027-02-10",
      fullLaunch: "2027-02-16",
      text: "Phased option: a soft launch with starter stock on 10 Feb 2027, then the full launch after the mock audit on 16 Feb 2027.",
    });
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

describe("cohorts (SPEC §7.2)", () => {
  it("groups committed partners by language and city with launches within 30 days", () => {
    const r = trickyRun();
    expect(r.cohorts.map((c) => c.label)).toEqual([
      "Kannada cohort, Bengaluru, starts 1 Dec 2026: APP-001, APP-003, APP-023, APP-031",
      "Kannada cohort, Mysuru, starts 1 Dec 2026: APP-016, APP-033",
      "Kannada cohort, Tumakuru, starts 1 Dec 2026: APP-017, APP-018",
    ]);
    // APP-026 (Mysuru, Kannada) launches more than 30 days after APP-016, so it isn't in that cohort.
    expect(decision(r, "APP-026").training!.cohortId).toBeNull();
    expect(decision(r, "APP-001").preparation).toContain("Kannada cohort, Bengaluru");
    // Location offers aren't committed yet, so they aren't in cohorts.
    expect(r.cohorts.flatMap((c) => c.members.map((m) => m.appId))).not.toContain("APP-010");
  });

  it("starts a new batch when a launch is more than 30 days after the batch's first", () => {
    const p = (appId: string, launch: string) => ({ appId, appKey: appId, city: "Mysuru", language: "Kannada" as const, trainingStart: launch, launch });
    const cohorts = buildCohorts([p("A", "2027-01-01"), p("B", "2027-01-20"), p("C", "2027-02-15"), p("D", "2027-03-01")]);
    expect(cohorts.map((c) => c.members.map((m) => m.appId))).toEqual([["A", "B"], ["C", "D"]]);
  });
});

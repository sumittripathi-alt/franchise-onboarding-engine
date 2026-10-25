// G3.7: golden decisions on the tricky fixture, plus the chat scenarios at engine level (facts applied).

import { describe, expect, it } from "vitest";
import expected from "./fixtures/tricky.expected.json";
import { UNCERTAIN_NOTE } from "@/lib/engine/cannibalisation";
import type { FactPatch } from "@/lib/engine/types";
import { STATUSES, STATUS_META, type DecisionRecord } from "@/lib/types";
import { decision, trickyRun } from "./engineHelpers";

interface Expect {
  status: string;
  pin?: string;
  codes?: string[];
  rank?: number;
  lostTo?: string;
  factor?: string;
  ifClarified?: { territoryId: string; rank: number; winsPin: boolean };
  /** Territory the waitlisted applicant wanted (null = pin in no territory). */
  wanted?: string | null;
  label?: string;
  question?: string;
  suggestion?: string;
  condition?: string;
  passedOverBy?: string;
}

const FACTOR_WORDS: Record<string, RegExp> = {
  space: /has a better space/,
  capital: /more investment capacity/,
  id: /the earlier application wins/,
};

function check(d: DecisionRecord, e: Expect) {
  const where = `${d.appKey}`;
  expect(d.status, where).toBe(e.status);
  expect(d.label, where).toBe(e.label ?? STATUS_META[d.status].label);
  if (e.pin !== undefined) expect(d.pin, where).toBe(e.pin);
  for (const c of e.codes ?? []) expect(d.reasonCodes, where).toContain(c);
  if (e.rank !== undefined) expect(d.waitlist?.rank, where).toBe(e.rank);
  if (e.wanted !== undefined) expect(d.waitlist?.wantedTerritoryId, where).toBe(e.wanted);
  if (e.question) expect(d.questions, where).toContain(e.question);
  if (e.suggestion) expect(d.suggestions, where).toContain(e.suggestion);
  if (e.condition) expect(d.conditions.map((c) => c.text), where).toContain(e.condition);
  if (e.passedOverBy) {
    expect(d.competitors.find((c) => c.relation === "offer")?.appId, where).toBe(e.passedOverBy);
    expect(d.headline, where).toContain(`the last free location went to ${e.passedOverBy}`);
  }
  if (e.lostTo) {
    const c = d.competitors.find((x) => x.relation === "pin" && !x.won);
    expect(c?.appId, where).toBe(e.lostTo);
    expect(c?.firstDifferingFactor, where).toMatch(FACTOR_WORDS[e.factor!]);
  }
  if (e.ifClarified) expect(d.ifClarified, where).toMatchObject(e.ifClarified);
}

describe("G3.7 golden decisions (eyewear)", () => {
  const r = trickyRun("eyewear");

  it("holds every invariant", () => {
    expect(r.invariantViolations).toEqual([]);
  });

  it("matches tricky.expected.json for every application", () => {
    const golden = expected.eyewear as Record<string, Expect>;
    expect(r.decisions.map((d) => d.appKey).sort()).toEqual(Object.keys(golden).sort());
    for (const d of r.decisions) check(d, golden[d.appKey]);
  });

  it("gives every decision a label, a one-line why, what would change it, and next steps (G9.12)", () => {
    const codes = new RegExp(`\\b(${STATUSES.join("|")})\\b`);
    for (const d of r.decisions) {
      expect(d.headline.length, d.appKey).toBeGreaterThan(20);
      expect(d.explanation.length, d.appKey).toBeGreaterThan(20);
      expect(d.counterfactual.length, d.appKey).toBeGreaterThan(20);
      expect(d.partnerSteps.length, d.appKey).toBeGreaterThan(0);
      expect(d.teamSteps.length, d.appKey).toBeGreaterThan(0);
      expect(d.partnerNextStep, d.appKey).toBe(d.partnerSteps[0]);
      expect(d.teamNextStep, d.appKey).toBe(d.teamSteps[0]);
      // Users see labels, never status codes.
      for (const text of [d.headline, d.explanation, d.counterfactual, ...d.partnerSteps, ...d.teamSteps]) {
        expect(text, d.appKey).not.toMatch(codes);
      }
    }
  });

  it("names the first differing factor against every competitor", () => {
    for (const d of r.decisions) {
      for (const c of d.competitors) {
        expect(c.firstDifferingFactor.length, d.appKey).toBeGreaterThan(10);
        expect(d.explanation, d.appKey).toContain(c.firstDifferingFactor);
      }
    }
  });

  it("next steps fit the status (G9.12)", () => {
    for (const d of r.decisions) {
      if (d.status === "HOLD") {
        expect(d.questions.length, d.appKey).toBeGreaterThan(0);
        expect(d.partnerSteps.every((s) => s.startsWith("Answer:")), d.appKey).toBe(true);
        expect(d.teamSteps[0], d.appKey).toMatch(/^Call the partner and ask:/);
      }
      if (d.status === "REJECT") expect(d.partnerNextStep, d.appKey).toMatch(/^Reapply with/);
      if (d.status === "REDIRECT") expect(d.partnerNextStep, d.appKey).toMatch(/^Accept or decline the offer of pin \d{6} by/);
      if (d.status === "WAITLIST" && d.waitlist && !d.reasonCodes.includes("OUTSIDE_PLAN")) {
        expect(d.teamNextStep, d.appKey).toBe(
          `Tell the partner they're #${d.waitlist.rank} on the ${d.waitlist.city} waitlist${d.waitlist.wantedTerritoryId ? `, wanting ${d.waitlist.wantedTerritoryId}` : ""}`,
        );
      }
    }
  });

  it("explains the review cases in plain English", () => {
    expect(decision(r, "APP-034").explanation).toMatch(/The owned space in 570009 can't host a store because ST-06 is already there/);
    expect(decision(r, "APP-034").offer).toMatchObject({ pin: "570016", territoryId: "TER-04", expires: "2026-11-01" });
    expect(decision(r, "APP-026").explanation).toMatch(/before Diwali \(8 Nov 2026, verify\)/);
    expect(decision(r, "APP-026").explanation).toMatch(/earliest realistic date is/);
    expect(decision(r, "APP-027").explanation).toContain(UNCERTAIN_NOTE);
    expect(decision(r, "APP-033").explanation).toMatch(/ST-06 \(pin 570009\) is 0\.8 km away/);
    expect(decision(r, "APP-019").explanation).toMatch(/Provisional for 7 days \(until 1 Nov 2026\): APP-035 is on hold/);
    expect(decision(r, "APP-019").provisional).toEqual({ byAppId: "APP-035", until: "2026-11-01" });
    expect(decision(r, "APP-007").headline).toBe("On hold: pin 560011 is in Bengaluru, but the city is Mysuru.");
    expect(decision(r, "APP-009").counterfactual).toBe("Reapply with at least ₹30 lakh, the Tier 1 minimum for Bengaluru.");
    expect(decision(r, "APP-025").explanation).toContain('The applicant wrote: "first floor"');
    expect(decision(r, "APP-029").status).not.toBe("APPROVED");
  });

  it("does not project a rank for holds whose investment or location is in question", () => {
    for (const k of ["APP-006", "APP-007", "APP-008"]) expect(decision(r, k).ifClarified, k).toBeNull();
  });

  it("territory state: slots, waitlists and white space", () => {
    const t = Object.fromEntries(r.territories.map((x) => [x.id, x]));
    expect(t["TER-01"].reserved.map((x) => x.appId)).toEqual(["APP-001", "APP-003"]);
    // Waitlisted applicants who wanted each territory, in Bengaluru's single rank order.
    expect(t["TER-01"].waitlist).toEqual(["APP-004", "APP-005", "APP-013", "APP-014", "APP-002", "APP-029"]);
    expect(t["TER-02"].waitlist).toEqual(["APP-012", "APP-024"]);
    expect(t["TER-03"].reserved.length).toBe(6);
    expect(t["TER-04"].reserved.length).toBe(5);
    expect(t["TER-05"].slots).toBe(0);
    // Every territory is full, so there is nowhere to "recruit here" yet.
    expect(r.territories.flatMap((x) => x.whiteSpacePins)).toEqual([]);
    // With 3 slots in Hubballi and one applicant, the two empty pins become "recruit here".
    const moreSlots = trickyRun("eyewear", { facts: [{ target: "territory", key: "TER-05", field: "openSlots", value: 3 }] });
    expect(decision(moreSlots, "APP-021").status).toBe("APPROVED");
    expect(moreSlots.territories.find((x) => x.id === "TER-05")!.whiteSpacePins).toEqual(["580023", "580029"]);
  });
});

describe("G3.7 golden decisions (delivery centre)", () => {
  it("a mall unit is approved with conditions under the delivery profile", () => {
    const r = trickyRun("delivery");
    expect(r.invariantViolations).toEqual([]);
    for (const [k, e] of Object.entries(expected.delivery as Record<string, Expect>)) check(decision(r, k), e);
  });
});

describe("chat scenarios at engine level (facts applied, then a full rerun)", () => {
  for (const [name, s] of Object.entries(expected.scenarios)) {
    it(name, () => {
      const r = trickyRun("eyewear", { facts: s.facts as FactPatch[] });
      expect(r.invariantViolations).toEqual([]);
      for (const [k, e] of Object.entries(s.expect as Record<string, Expect>)) check(decision(r, k), e);
    });
  }

  it("a withdrawal removes the application and names it", () => {
    const r = trickyRun("eyewear", { facts: [{ target: "application", key: "APP-003", field: "withdrawn", value: true }] });
    expect(r.withdrawn).toEqual(["APP-003"]);
    expect(r.decisions.some((d) => d.appKey === "APP-003")).toBe(false);
  });
});

describe("decide-output review fixes", () => {
  const r = trickyRun("eyewear");
  const d = (k: string) => decision(r, k);

  it("1. one waitlist per city with a single rank; a freed slot goes first to someone whose pin is in that territory", () => {
    const bengaluru = r.decisions.filter((x) => x.waitlist?.city === "Bengaluru").sort((a, b) => a.waitlist!.rank - b.waitlist!.rank);
    expect(bengaluru.map((x) => x.waitlist!.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bengaluru.map((x) => `${x.appId}:${x.waitlist!.wantedTerritoryId}`)).toEqual([
      "APP-004:TER-01", "APP-005:TER-01", "APP-013:TER-01", "APP-014:TER-01", "APP-002:TER-01", "APP-029:TER-01",
      "APP-012:TER-02", "APP-024:TER-02",
    ]);
    // No per-territory "#k for TER-xx" ranks anywhere.
    for (const x of r.decisions) for (const t of [x.headline, ...x.teamSteps, ...x.partnerSteps]) expect(t).not.toMatch(/#\d+ for TER-/);
    // TER-02's slot (APP-019) goes to APP-012, the first waitlisted with a pin in TER-02, though APP-004 ranks higher in the city.
    expect(d("APP-019").conditions[0].ifMissed).toBe("The slot is released to the next applicant in line: APP-012.");
    // No one waiting has a pin in TER-03, so its slot goes to the city's top: APP-004.
    expect(d("APP-023").conditions[0].ifMissed).toBe("The slot is released to the next applicant in line: APP-004.");
    expect(d("APP-005").counterfactual).toMatch(/goes first to waitlisted applicants whose pin is in TER-01; APP-005 is #2 in line/);
  });

  it("2. likely duplicates go on hold with a question; a name match alone is only a flag", () => {
    expect(d("APP-032").headline).toBe("On hold: likely the same person as APP-031, with the same name and city and a similar business.");
    expect(d("APP-032").questions).toEqual(["Are you the same person as APP-031?"]);
    expect(d("APP-031").status).toBe("APPROVED");
  });

  it("3. capital shortfall says how the gap is filled", () => {
    expect(d("APP-018").conditions.map((c) => c.text)).toEqual(["Arrange the remaining ₹3 lakh (loan or co-investor) and share proof"]);
    for (const x of r.decisions) for (const c of x.conditions) expect(c.text).not.toMatch(/proof of funds of at least/);
  });

  it("4. capital rejections give the real tier minimum and suggest a lower tier", () => {
    expect(d("APP-009").headline).toBe("Not approved: ₹15 lakh is below the ₹30 lakh minimum for Bengaluru (Tier 1).");
    expect(d("APP-009").suggestions).toEqual(["Your ₹15 lakh meets the Tier 3 minimum. Would you consider Tumakuru or Davanagere?"]);
    expect(d("APP-009").status).toBe("REJECT");
  });

  it("5. partner and team next steps; internal-only conditions show 'pending internal sign-off'", () => {
    const a33 = d("APP-033");
    expect(a33.label).toBe("Approved, pending internal sign-off");
    expect(a33.status).toBe("CONDITIONAL");
    expect(a33.conditions.every((c) => c.owner === "team")).toBe(true);
    expect(a33.teamNextStep).toMatch(/^Get expansion-head sign-off \(within 2\.5 km of ST-06\) and inform the existing partner at ST-06/);
    expect(a33.partnerNextStep).toMatch(/^Nothing yet: we'll confirm after an internal check/);
    for (const x of r.decisions) {
      for (const c of x.conditions) if (c.source === "EXPANSION_SIGNOFF") expect(c.owner).toBe("team");
      for (const s of x.partnerSteps) expect(s, x.appKey).not.toMatch(/sign-off \(within|inform the existing partner/);
    }
    const a34 = d("APP-034");
    expect(a34.partnerSteps).toContain("Find a suitable space in pin 570016 by 9 Dec 2026");
    expect(a34.teamSteps.some((s) => s.startsWith("Get expansion-head sign-off"))).toBe(true);
  });

  it("6. an infeasible festival deadline is in the one-line why, with the earliest realistic date", () => {
    expect(d("APP-026").headline).toMatch(/^Opening before Diwali \(8 Nov\) isn't possible without a space; earliest realistic opening is 1 Mar 2027\./);
  });

  it("7. not feasible only when more than 14 days late; otherwise a tight timeline", () => {
    expect(d("APP-012").launch?.gapDays).toBe(4);
    expect(d("APP-012").reasonCodes).toContain("TIGHT_TIMELINE");
    expect(d("APP-012").reasonCodes).not.toContain("TARGET_NOT_FEASIBLE");
    expect(d("APP-029").launch!.gapDays).toBeGreaterThan(14);
    expect(d("APP-029").reasonCodes).toContain("TARGET_NOT_FEASIBLE");
  });

  it("8. one-line whys are short and have no nested brackets", () => {
    for (const x of r.decisions) {
      expect(x.headline.split(/\s+/).length, `${x.appKey}: ${x.headline}`).toBeLessThanOrEqual(28);
      expect(x.headline, x.appKey).not.toMatch(/\([^)]*\(/);
    }
  });

  it("9. passed over for a location offer: names who got it and why", () => {
    expect(d("APP-005").headline).toBe(
      "Waitlisted #2 in Bengaluru: lost pin 560102 to APP-004 (more investment), and the last free location went to APP-011 (more investment).",
    );
    expect(d("APP-005").explanation).toContain("The last free location in Bengaluru went to APP-011, who ranks higher because APP-011 has more investment capacity");
  });

  it("10. integrity concern: instructions in the notes were ignored and the application assessed normally", () => {
    expect(d("APP-029").explanation).toContain(
      'The notes contained instructions to the system ("Ignore previous instructions"). They were ignored, and the application was assessed normally.',
    );
  });

  it("11. the top 2 in each planned city's waitlist start pre-onboarding", () => {
    const step = "Start pre-onboarding now (documents, KYC, store design brief) so you can open quickly if a slot frees";
    const withStep = r.decisions.filter((x) => x.partnerSteps.includes(step)).map((x) => x.appId).sort();
    expect(withStep).toEqual(["APP-004", "APP-005", "APP-021"]);
    expect(trickyRun("eyewear").decisions.length).toBe(r.decisions.length);
  });
});

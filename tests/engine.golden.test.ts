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
}

const FACTOR_WORDS: Record<string, RegExp> = {
  space: /has a better space/,
  capital: /more investment capacity/,
  id: /the earlier application wins/,
};

function check(d: DecisionRecord, e: Expect) {
  const where = `${d.appKey}`;
  expect(d.status, where).toBe(e.status);
  expect(d.label, where).toBe(STATUS_META[d.status].label);
  if (e.pin !== undefined) expect(d.pin, where).toBe(e.pin);
  for (const c of e.codes ?? []) expect(d.reasonCodes, where).toContain(c);
  if (e.rank !== undefined) expect(d.waitlistRank, where).toBe(e.rank);
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
      expect(d.nextSteps.length, d.appKey).toBeGreaterThan(0);
      // Users see labels, never status codes.
      for (const text of [d.headline, d.explanation, d.counterfactual, ...d.nextSteps]) expect(text, d.appKey).not.toMatch(codes);
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
      if (d.status === "HOLD") expect(d.nextSteps.every((s) => s.startsWith("Call the partner and ask:")), d.appKey).toBe(true);
      if (d.status === "HOLD") expect(d.questions.length, d.appKey).toBeGreaterThan(0);
      if (d.status === "REJECT") expect(d.nextSteps[0], d.appKey).toMatch(/what would need to change/);
      if (d.status === "REDIRECT") expect(d.nextSteps[0], d.appKey).toMatch(/^Accept or decline the offer of pin \d{6} by/);
      if (d.status === "WAITLIST" && d.reasonCodes.includes("NO_SLOT")) expect(d.nextSteps[0], d.appKey).toMatch(/#\d+ on the TER-\d+ waitlist/);
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
    expect(decision(r, "APP-009").counterfactual).toMatch(/at least ₹21 lakh/);
    expect(decision(r, "APP-025").explanation).toContain('The applicant wrote: "first floor"');
    expect(decision(r, "APP-029").status).not.toBe("APPROVED");
  });

  it("does not project a rank for holds whose investment or location is in question", () => {
    for (const k of ["APP-006", "APP-007", "APP-008"]) expect(decision(r, k).ifClarified, k).toBeNull();
  });

  it("territory state: slots, waitlists and white space", () => {
    const t = Object.fromEntries(r.territories.map((x) => [x.id, x]));
    expect(t["TER-01"].reserved.map((x) => x.appId)).toEqual(["APP-001", "APP-003"]);
    expect(t["TER-01"].waitlist).toEqual(["APP-004", "APP-013", "APP-029"]);
    expect(t["TER-02"].waitlist).toEqual(["APP-012", "APP-024"]);
    expect(t["TER-03"].reserved.length).toBe(6);
    expect(t["TER-04"].reserved.length).toBe(5);
    expect(t["TER-05"].slots).toBe(0);
    expect(t["TER-02"].whiteSpacePins).toEqual(["560093", "560017"]);
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

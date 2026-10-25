// SPEC §15.4: locking (G9.2), provisional wins, human overrides (G9.3); invariant failures (G3.6).

import { describe, expect, it } from "vitest";
import { checkInvariants } from "@/lib/engine/invariants";
import { likelyDuplicates } from "@/lib/ingest/validate";
import type { FactPatch, HumanOverride, Lock } from "@/lib/engine/types";
import { EXISTING_STORE_PINS } from "@/data/existingStores";
import { decision, trickyInput, trickyRun } from "./engineHelpers";

const FOUND_SPACE: FactPatch[] = [
  { target: "application", key: "APP-012", field: "spaceAvailable", value: "Rented" },
  { target: "application", key: "APP-012", field: "floor", value: "Ground" },
];
const lockOf = (key: string, r = trickyRun()): Lock => {
  const d = decision(r, key);
  const t = r.territories.find((x) => x.id === d.slotTerritoryId)!;
  return { appKey: key, status: d.status, pin: d.pin!, territoryKey: t.key, date: "2026-10-25" };
};
const override = (o: Partial<HumanOverride> & Pick<HumanOverride, "appKey" | "status">): HumanOverride => ({
  reason: "Ops lead decision after a site visit",
  time: "2026-10-26T10:00:00Z",
  ...o,
});

describe("G9.2 decisions sent to the partner are never displaced", () => {
  it("a newcomer who would outrank a locked partner is waitlisted with 'slot already committed'", () => {
    const unlocked = trickyRun("eyewear", { facts: FOUND_SPACE });
    expect(decision(unlocked, "APP-019").status).toBe("WAITLIST");

    const r = trickyRun("eyewear", { facts: FOUND_SPACE, locks: [lockOf("APP-019")] });
    expect(r.invariantViolations).toEqual([]);
    const d19 = decision(r, "APP-019");
    expect(d19.status).toBe("CONDITIONAL");
    expect(d19.pin).toBe("560037");
    expect(d19.reasonCodes).toContain("LOCKED");
    const d12 = decision(r, "APP-012");
    expect(d12.status).toBe("WAITLIST");
    expect(d12.reasonCodes).toContain("SLOT_COMMITTED");
    expect(d12.headline).toMatch(/^Waitlisted #\d+ in Bengaluru: slot already committed to APP-019 on 25 Oct 2026\.$/);
  });

  it("a locked partner keeps its slot when the territory's slots are cut, and the territory is flagged", () => {
    const r = trickyRun("eyewear", {
      locks: [lockOf("APP-001"), lockOf("APP-003")],
      facts: [{ target: "territory", key: "TER-01", field: "openSlots", value: 1 }],
    });
    expect(r.invariantViolations).toEqual([]);
    expect(decision(r, "APP-001").status).toBe("APPROVED");
    expect(decision(r, "APP-003").status).toBe("APPROVED");
    const t = r.territories.find((x) => x.id === "TER-01")!;
    expect(t.overCommitted).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/TER-01 now has 1 open slot but 2 partners were already sent a decision/);
  });

  it("a locked partner is not marked provisional", () => {
    const r = trickyRun("eyewear", { locks: [lockOf("APP-019")] });
    expect(decision(r, "APP-019").provisional).toBeNull();
  });
});

describe("provisional wins (SPEC §15.4)", () => {
  it("the current winner is provisional while a stronger on-hold applicant is clarified", () => {
    const r = trickyRun();
    expect(decision(r, "APP-019").reasonCodes).toContain("PROVISIONAL");
    expect(decision(r, "APP-035").ifClarified).toEqual({ territoryId: "TER-02", rank: 1, winsPin: true, pin: "560037" });
  });

  it("once the on-hold applicant's floor is confirmed, it takes the pin and slot", () => {
    const r = trickyRun("eyewear", { facts: [{ target: "application", key: "APP-035", field: "floor", value: "Ground" }] });
    expect(decision(r, "APP-035").status).toBe("APPROVED");
    expect(decision(r, "APP-019").status).not.toBe("CONDITIONAL");
  });
});

describe("G9.3 human overrides", () => {
  it("needs a reason", () => {
    const r = trickyRun("eyewear", { overrides: [override({ appKey: "APP-004", status: "APPROVED", reason: "  " })] });
    expect(r.rejectedOverrides[0].message).toMatch(/needs a reason/);
    expect(decision(r, "APP-004").status).toBe("WAITLIST");
  });

  it("shows who would be bumped and waits for confirmation", () => {
    const r = trickyRun("eyewear", { overrides: [override({ appKey: "APP-004", status: "APPROVED" })] });
    expect(r.pendingOverrides).toEqual([
      expect.objectContaining({ appKey: "APP-004", wouldBump: ["APP-003"] }),
    ]);
    expect(r.pendingOverrides[0].message).toMatch(/would take the slot from APP-003. Confirm/);
    expect(decision(r, "APP-004").status).toBe("WAITLIST");
  });

  it("applies once the bump is confirmed, labelled as a human override", () => {
    const r = trickyRun("eyewear", {
      overrides: [override({ appKey: "APP-004", status: "APPROVED", confirmedBumps: ["APP-003"] })],
    });
    expect(r.invariantViolations).toEqual([]);
    const d = decision(r, "APP-004");
    expect(d.status).toBe("APPROVED");
    expect(d.reasonCodes).toContain("HUMAN_OVERRIDE");
    expect(d.headline).toMatch(/^Human override: Approved\. Reason: Ops lead decision/);
    expect(decision(r, "APP-003").status).toBe("WAITLIST");
  });

  it("can never break one store per pin", () => {
    const r = trickyRun("eyewear", { overrides: [override({ appKey: "APP-010", status: "APPROVED" })] });
    expect(r.rejectedOverrides[0].message).toMatch(/Pin 560038 already has existing store ST-03. One store per pin can't be overridden/);
    expect(decision(r, "APP-010").status).toBe("REDIRECT");
  });

  it("can't take a slot from partners already sent a decision", () => {
    const r = trickyRun("eyewear", {
      locks: [lockOf("APP-001"), lockOf("APP-003")],
      overrides: [override({ appKey: "APP-004", status: "APPROVED", confirmedBumps: ["APP-001", "APP-003"] })],
    });
    expect(r.rejectedOverrides[0].message).toMatch(/Every slot in TER-01 is committed/);
    expect(decision(r, "APP-001").status).toBe("APPROVED");
  });

  it("an override that frees a slot promotes the next in line without confirmation", () => {
    const r = trickyRun("eyewear", { overrides: [override({ appKey: "APP-003", status: "WAITLIST" })] });
    expect(r.pendingOverrides).toEqual([]);
    expect(decision(r, "APP-003").status).toBe("WAITLIST");
    expect(decision(r, "APP-003").reasonCodes).toContain("HUMAN_OVERRIDE");
    expect(decision(r, "APP-004").status).toBe("APPROVED");
    expect(r.invariantViolations).toEqual([]);
  });
});

describe("G3.6 invariant failures are detected", () => {
  it("reports each broken invariant", () => {
    const input = trickyInput();
    const r = trickyRun();
    const broken = structuredClone(r);
    const a = broken.decisions.find((d) => d.appKey === "APP-001")!;
    const b = broken.decisions.find((d) => d.appKey === "APP-003")!;
    b.pin = a.pin; // 2: two slots share a pin
    broken.decisions.find((d) => d.appKey === "APP-015")!.pin = "570009"; // 1: a reserved pin with an existing store
    broken.decisions.find((d) => d.appKey === "APP-006")!.pin = "560078"; // 5: a hold with a pin
    broken.decisions.find((d) => d.appKey === "APP-004")!.status = "APPROVED"; // 3: TER-01 over its slots
    broken.decisions.find((d) => d.appKey === "APP-004")!.pin = "560102";
    broken.decisions.find((d) => d.appKey === "APP-004")!.slotTerritoryId = "TER-01";
    broken.decisions.find((d) => d.appKey === "APP-032")!.status = "APPROVED"; // 7: one person, two slots
    broken.decisions.find((d) => d.appKey === "APP-032")!.pin = "560010";
    broken.decisions.find((d) => d.appKey === "APP-009")!.partnerSteps = []; // 4
    const v = checkInvariants(broken, input.applications, EXISTING_STORE_PINS, likelyDuplicates(input.applications));
    for (const n of ["1:", "2:", "3:", "4:", "5:", "7:"]) expect(v.some((x) => x.startsWith(n)), n).toBe(true);
  });
});

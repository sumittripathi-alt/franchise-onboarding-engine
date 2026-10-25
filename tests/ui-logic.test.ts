// Filtering and upload comparison behind the lists (SPEC §10.1, §15.1).

import { describe, expect, it } from "vitest";
import { compareUploads } from "@/lib/insights/compare";
import { isFiltered, matchesFilters, type DecisionFilters } from "@/lib/insights/filter";
import type { PreviousSnapshot } from "@/lib/state/store";
import { trickyRun } from "./engineHelpers";

const r = trickyRun();
const none: DecisionFilters = { query: "", status: "all", territory: "all", city: "all", flag: "all" };
const ids = (f: Partial<DecisionFilters>) => r.decisions.filter((d) => matchesFilters(d, { ...none, ...f })).map((d) => d.appId);

describe("filters", () => {
  it("no filters show everything", () => {
    expect(ids({})).toHaveLength(38);
    expect(isFiltered(none)).toBe(false);
  });

  it("status, city and territory", () => {
    expect(ids({ status: "HOLD" })).toHaveLength(9);
    expect(ids({ status: "REJECT" })).toEqual(["APP-009"]);
    expect(ids({ city: "Mysuru" }).sort()).toEqual(["APP-007", "APP-015", "APP-016", "APP-025", "APP-026", "APP-033", "APP-034"]);
    // A territory filter matches applicants who wanted it and partners holding one of its slots.
    expect(ids({ territory: "TER-03" })).toContain("APP-010");
    expect(ids({ territory: "TER-03" })).toContain("APP-031");
  });

  it("search matches ID, name, pin and the one-line why, ignoring case and word order", () => {
    expect(ids({ query: "app-012" })).toEqual(["APP-012"]);
    expect(ids({ query: "lakshmi" })).toEqual(["APP-012"]);
    expect(ids({ query: "560048" })).toContain("APP-012");
    expect(ids({ query: "talent pool davanagere" })).toEqual(["APP-036"]);
    expect(ids({ query: "zzz nothing" })).toEqual([]);
  });

  it("flag filters by flag or reason code", () => {
    expect(ids({ flag: "PROVISIONAL" })).toEqual(["APP-019"]);
    expect(ids({ flag: "CANNIBALISATION_RISK" }).sort()).toEqual(["APP-033", "APP-034"]);
    expect(ids({ flag: "NO_SLOT_IN_CITY" })).toEqual(["APP-002", "APP-005", "APP-014"]);
  });

  it("filters combine, and isFiltered notices them", () => {
    expect(ids({ status: "WAITLIST", city: "Bengaluru" })).toHaveLength(7);
    expect(isFiltered({ ...none, query: "  " })).toBe(false);
    expect(isFiltered({ ...none, flag: "PROVISIONAL" })).toBe(true);
  });
});

describe("compare with previous upload", () => {
  const snap = (over: (d: PreviousSnapshot["decisions"]) => PreviousSnapshot["decisions"]): PreviousSnapshot => ({
    files: ["first.xlsx"],
    decisions: over(r.decisions.map((d) => ({ appKey: d.appKey, appId: d.appId, name: d.name, status: d.status, label: d.label, pin: d.pin }))),
  });

  it("identical uploads: nothing changed", () => {
    const c = compareUploads(snap((d) => d), r);
    expect(c).toMatchObject({ added: [], removed: [], changed: [], unchanged: 38, text: "0 decisions changed, 0 added, 0 removed, 38 unchanged." });
  });

  it("finds changed, added and removed applications by Application ID", () => {
    const prev = snap((d) =>
      d
        .filter((x) => x.appId !== "APP-001") // not in the old file → added now
        .map((x) => (x.appId === "APP-002" ? { ...x, status: "APPROVED" as const, label: "Approved", pin: "560068" } : x))
        .concat([{ appKey: "APP-099", appId: "APP-099", name: "Gone Person", status: "WAITLIST", label: "Waitlisted", pin: null }]),
    );
    const c = compareUploads(prev, r);
    expect(c.added.map((a) => a.appId)).toEqual(["APP-001"]);
    expect(c.removed.map((a) => a.appId)).toEqual(["APP-099"]);
    expect(c.changed).toEqual([{ appId: "APP-002", name: "Mohammed Irfan", fromLabel: "Approved", toLabel: "Waitlisted", pinFrom: "560068", pinTo: null }]);
    expect(c.text).toBe("1 decision changed, 1 added, 1 removed, 36 unchanged.");
  });
});

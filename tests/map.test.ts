// The map's data (SPEC §10.1, §15.8, G8.4): every fact on the map is also text, uncertain locations are marked, rings use the
// policy's radius, and nothing from an applicant can become HTML.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXISTING_STORES } from "@/data/existingStores";
import { getPin } from "@/lib/geo/pins";
import { buildTerritoryBoard } from "@/lib/insights/board";
import { buildMapModel, locate } from "@/lib/insights/map";
import { computeResult, effectivePolicy, newSession, type Session } from "@/lib/state/session";
import { CITIES } from "@/lib/policy/allowedValues";
import { parseOk, trickyFile } from "./helpers";

const session = (): Session => {
  const r = parseOk([trickyFile()]);
  return newSession({ files: ["t"], applications: r.applications, territories: r.territories, skippedExample: r.skippedExample, report: r.report, today: "2026-10-26" });
};
const model = (s = session()) => {
  const result = computeResult(s);
  return { result, m: buildMapModel(result, buildTerritoryBoard(result), effectivePolicy(s, "eyewear").profile), s };
};

describe("G8.4 the map's data, and the same facts in words", () => {
  it("has every existing store, with a ring from the policy's radius for its city tier (only where the location is reliable)", () => {
    const { m, s } = model();
    expect(m.stores.map((x) => x.id)).toEqual(EXISTING_STORES.map((x) => x.id));
    for (const st of m.stores) {
      expect(st.radiusKm).toBe(s.policy.cannibalisationRadiusKm[CITIES[st.city as keyof typeof CITIES].tier]);
      expect(st.text).toContain(st.id);
      expect(st.text).toContain(st.pin);
    }
    expect(m.stores.every((x) => !x.point.approximate)).toBe(true); // the fixed store pins all have reliable locations
  });

  it("puts every applicant with a pin on the map, labelled with its decision", () => {
    const { m, result } = model();
    const withPin = result.decisions.filter((d) => d.homePin);
    expect(m.applicants).toHaveLength(withPin.length);
    for (const a of m.applicants) {
      const d = result.decisions.find((x) => x.appKey === a.appKey)!;
      expect(a.label).toBe(d.label);
      expect(a.text).toContain(a.appId);
      expect(a.text).toContain(d.label);
    }
  });

  it("marks uncertain locations as approximate and says why; reliable ones are exact", () => {
    for (const pin of ["560068", "570016", "560102"]) {
      const rec = getPin(pin)!;
      const p = locate(pin, rec.city)!;
      const reliable = rec.confidence === "high" || rec.confidence === "medium";
      expect(p.approximate, `${pin} (${rec.confidence})`).toBe(!reliable);
      if (!reliable) expect(p.why).toMatch(/rough estimate|isn't known/);
    }
    const { m } = model();
    for (const a of m.approximate) expect(a.why).toMatch(new RegExp(`pin ${a.pin}`));
    // An unknown pin is drawn near its city's centre, never at 0,0.
    const unknown = locate("561999", "Mysuru")!;
    expect(unknown.approximate).toBe(true);
    expect(Math.abs(unknown.lat - 12.2958)).toBeLessThan(0.05);
  });

  it("recruit-here pins are exactly the board's white space, each with its sentence", () => {
    const { m, result } = model();
    const board = buildTerritoryBoard(result);
    const expected = board.flatMap((t) => t.whiteSpace.map((p) => `${t.id}:${p}`)).sort();
    expect(m.whiteSpace.map((w) => `${w.territoryId}:${w.pin}`).sort()).toEqual(expected);
    for (const w of m.whiteSpace) expect(w.text).toMatch(/Recruit here/);
  });

  it("opening more slots than there are applicants for creates recruit-here pins, drawn and described", () => {
    const s = session();
    const next = { ...s, entries: [{ id: "c1", time: "t", source: "manual" as const, description: "slots", undone: false, facts: [{ target: "territory" as const, key: "TER-05", field: "openSlots" as const, value: 6 }], diff: { changes: [], slots: [], text: "" } }] };
    const { m, result } = model(next);
    const ws = m.whiteSpace.filter((w) => w.territoryId === "TER-05");
    expect(ws.length).toBeGreaterThan(0);
    expect(ws.length).toBe(buildTerritoryBoard(result).find((t) => t.id === "TER-05")!.whiteSpace.length);
    for (const w of ws) {
      expect(w.text).toMatch(/TER-05, pin \d{6}: no applicant wants it and the territory still has \d free slots?\. Recruit here/);
      expect(m.facts.find((f) => f.title.startsWith("Recruit here"))!.items).toContain(w.text);
    }
  });

  it("competitor lines are one per pair and kind, and each is described", () => {
    const { m } = model();
    const keys = m.competitions.map((c) => `${c.a}|${c.b}|${c.relation}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of m.competitions) {
      expect(c.a < c.b || c.a.localeCompare(c.b, "en", { numeric: true }) < 0).toBe(true);
      expect(c.text).toContain(c.a);
      expect(c.text).toContain(c.b);
    }
  });

  it("every fact on the map is also in the text list", () => {
    const { m } = model();
    const text = m.facts.flatMap((f) => f.items);
    for (const s of m.stores) expect(text).toContain(s.text);
    for (const a of m.applicants) expect(text).toContain(a.text);
    for (const w of m.whiteSpace) expect(text).toContain(w.text);
    for (const c of m.competitions) expect(text).toContain(c.text);
    for (const t of m.territoryPins) expect(text).toContain(t.text);
  });

  it("changes with the data: withdrawing an applicant takes them off the map", () => {
    const base = model();
    const s = base.s;
    const next = { ...s, entries: [{ id: "c1", time: "t", source: "manual" as const, description: "w", undone: false, facts: [{ target: "application" as const, key: "APP-003", field: "withdrawn" as const, value: true as const }], diff: { changes: [], slots: [], text: "" } }] };
    const { m } = model(next);
    expect(base.m.applicants.some((a) => a.appId === "APP-003")).toBe(true);
    expect(m.applicants.some((a) => a.appId === "APP-003")).toBe(false);
  });

  it("applicant words never become HTML on the map: only text nodes reach Leaflet", () => {
    const src = readFileSync(join(__dirname, "..", "components/workspace/map-view.tsx"), "utf8");
    expect(src).not.toMatch(/innerHTML|bindPopup|setContent\(/);
    const calls = [...src.matchAll(/\.bindTooltip\(([^,]+)/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThan(4);
    for (const c of calls) expect(c.startsWith("tip(")).toBe(true);
    expect(src).toMatch(/textContent = t/);
    // The one HTML string given to Leaflet is empty.
    expect([...src.matchAll(/html: ("[^"]*")/g)].map((m) => m[1])).toEqual(['""']);
  });
});

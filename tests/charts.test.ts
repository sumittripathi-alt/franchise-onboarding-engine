// The dashboard's charts (SPEC §10.1): the donut and the portfolio Gantt, and the same facts as text.

import { describe, expect, it } from "vitest";
import { buildPortfolioTimeline, DONUT_CIRCUMFERENCE, donutSegments, donutSummary, STATUS_COLOUR } from "@/lib/insights/charts";
import { computeResult, newSession, type Session } from "@/lib/state/session";
import { STATUSES, type Status } from "@/lib/types";
import { parseOk, trickyFile } from "./helpers";

const session = (): Session => {
  const r = parseOk([trickyFile()]);
  return newSession({ files: ["t"], applications: r.applications, territories: r.territories, skippedExample: r.skippedExample, report: r.report, today: "2026-10-26" });
};
const counts = (o: Partial<Record<Status, number>>): Record<Status, number> => ({ APPROVED: 0, CONDITIONAL: 0, HOLD: 0, WAITLIST: 0, REDIRECT: 0, REJECT: 0, ...o });

describe("the decisions donut", () => {
  it("has one segment per status that has applications, in the app's status order, and shares that add to 100", () => {
    const { total, segments } = donutSegments(counts({ APPROVED: 7, HOLD: 8, WAITLIST: 12, REJECT: 1 }));
    expect(total).toBe(28);
    expect(segments.map((s) => s.status)).toEqual(["APPROVED", "HOLD", "WAITLIST", "REJECT"]);
    expect(segments.reduce((n, s) => n + s.count, 0)).toBe(28);
    expect(Math.round(segments.reduce((n, s) => n + s.pct, 0))).toBe(100);
    expect(segments.every((s) => STATUS_COLOUR[s.status])).toBe(true);
  });

  it("lays the segments end to end around the ring, none overlapping and none past the circle", () => {
    const { segments } = donutSegments(counts({ APPROVED: 7, CONDITIONAL: 6, HOLD: 9, WAITLIST: 11, REDIRECT: 4, REJECT: 1 }));
    let cursor = 0;
    for (const s of segments) {
      const [len] = s.dashArray.split(" ").map(Number);
      expect(-s.dashOffset).toBeGreaterThanOrEqual(cursor - 1e-6); // starts where the last one ended, or later
      cursor = -s.dashOffset + len;
      expect(cursor).toBeLessThanOrEqual(DONUT_CIRCUMFERENCE + 1e-6);
    }
  });

  it("a single status fills the whole ring; no applications draws nothing", () => {
    const one = donutSegments(counts({ HOLD: 5 }));
    expect(one.segments).toHaveLength(1);
    expect(Number(one.segments[0].dashArray.split(" ")[0])).toBeCloseTo(DONUT_CIRCUMFERENCE, 1);
    expect(donutSegments(counts({})).segments).toEqual([]);
    expect(donutSummary(counts({}), String)).toBe("No applications.");
  });

  it("is described in words, with the label the app uses for each status", () => {
    const text = donutSummary(counts({ APPROVED: 7, HOLD: 8 }), (s) => (s === "HOLD" ? "On hold" : "Approved"));
    expect(text).toBe("15 applications: 7 approved (46.7%), 8 on hold (53.3%).");
  });

  it("matches the engine's own counts on the sample", () => {
    const result = computeResult(session());
    const c = counts({});
    for (const d of result.decisions) c[d.status]++;
    const { total, segments } = donutSegments(c);
    expect(total).toBe(result.decisions.length);
    for (const s of STATUSES) expect(segments.find((x) => x.status === s)?.count ?? 0).toBe(c[s]);
  });
});

describe("the portfolio Gantt", () => {
  const result = computeResult(session());
  const tl = buildPortfolioTimeline(result, "2026-10-26");

  it("has a row for every partner with an onboarding plan, and nobody else", () => {
    const planned = result.decisions.filter((d) => d.onboarding).map((d) => d.appId).sort();
    expect(tl.rows.map((r) => r.appId).sort()).toEqual(planned);
    expect(tl.rows.length).toBeGreaterThan(5);
    for (const r of tl.rows) expect(["APPROVED", "CONDITIONAL", "REDIRECT"]).toContain(r.status);
  });

  it("is in order of opening date, then by ID, and runs from today to the last opening", () => {
    const launches = tl.rows.map((r) => r.launch);
    expect([...launches].sort()).toEqual(launches);
    expect(tl.from).toBe("2026-10-26");
    expect(tl.to).toBe(launches[launches.length - 1]);
  });

  it("keeps every bar inside the chart, with training inside the bar and the opening at its end", () => {
    for (const r of tl.rows) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.left + r.width).toBeLessThanOrEqual(100.0001);
      expect(r.start <= r.launch).toBe(true);
      if (r.training) {
        expect(r.trainingLeft!).toBeGreaterThanOrEqual(r.left - 1e-9);
        expect(r.trainingLeft! + r.trainingWidth!).toBeLessThanOrEqual(r.left + r.width + 1.1);
        expect(r.training.start >= r.start && r.training.end <= r.launch).toBe(true);
      }
    }
    expect(Math.max(...tl.rows.map((r) => r.left + r.width))).toBeCloseTo(100, 0);
  });

  it("has month ticks inside the chart, in order", () => {
    expect(tl.ticks.length).toBeGreaterThan(2);
    for (const t of tl.ticks) {
      expect(t.left).toBeGreaterThanOrEqual(0);
      expect(t.left).toBeLessThanOrEqual(100);
    }
    expect(tl.ticks.map((t) => t.left)).toEqual([...tl.ticks.map((t) => t.left)].sort((a, b) => a - b));
    expect(tl.ticks[0].label).toBe("Nov");
  });

  it("describes every bar in words, with the dates, and says when a plan depends on an offer being accepted", () => {
    for (const r of tl.rows) {
      expect(r.text).toContain(r.appId);
      expect(r.text).toMatch(/earliest opening \d{1,2} \w{3} \d{4}/);
      if (r.ifAccepted) expect(r.text).toMatch(/only if the location offer is accepted/);
    }
    expect(tl.rows.some((r) => r.ifAccepted)).toBe(true); // the sample has offers
  });

  it("is empty when nobody has a plan", () => {
    const none = { ...result, decisions: result.decisions.map((d) => ({ ...d, onboarding: null })) };
    expect(buildPortfolioTimeline(none, "2026-10-26").rows).toEqual([]);
  });
});

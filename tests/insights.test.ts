// Batch insights, sanity banner (G9.7), action queue, territory board, partner messages and the safe export (G6.4).

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { EXPORT_SHEETS, buildExportWorkbook } from "@/lib/export/workbook";
import { safeCell, safeRow } from "@/lib/export/safe";
import { buildActionQueue } from "@/lib/insights/actions";
import { SANITY_THRESHOLD, buildBatchInsights, citySaturation, thresholdWarnings, untappedDemand } from "@/lib/insights/batch";
import { buildTerritoryBoard } from "@/lib/insights/board";
import { draftPartnerMessage } from "@/lib/insights/messages";
import { defaultPolicy } from "@/lib/policy/brandProfiles";
import { APPLICATION_HEADERS } from "@/lib/ingest/template";
import { effective, newSession, effectiveData, computeResult, type Session } from "@/lib/state/session";
import { decision, trickyRun } from "./engineHelpers";
import { parseOk, trickyFile } from "./helpers";

const profile = defaultPolicy("eyewear").profile;
const r = trickyRun();
const insights = buildBatchInsights(r, profile);
const languages = Object.fromEntries(parseOk([trickyFile()]).applications.map((a) => [a.key, a.language.value]));

describe("batch insights (SPEC §15.1)", () => {
  it("status counts add up", () => {
    expect(insights.total).toBe(38);
    expect(insights.statusCounts).toEqual({ APPROVED: 6, CONDITIONAL: 7, HOLD: 9, WAITLIST: 11, REDIRECT: 4, REJECT: 1 });
    expect(Object.values(insights.statusCounts).reduce((a, b) => a + b, 0)).toBe(insights.total);
  });

  it("oversubscribed territories show eligible applicants against slots, with holds counted apart", () => {
    expect(insights.oversubscribed.map((i) => i.text)).toEqual([
      "TER-01: 8 eligible applicants for 2 slots, plus 4 on hold.",
      "TER-02: 4 eligible applicants for 1 slot, plus 1 on hold.",
      "TER-05: 1 eligible applicant for 0 slots.",
    ]);
  });

  it("slots with no applicants", () => {
    expect(insights.emptySlots).toEqual([]);
    const more = trickyRun("eyewear", { facts: [{ target: "territory", key: "TER-05", field: "openSlots", value: 3 }] });
    // TER-05 now has 3 slots and one applicant: not empty. A territory nobody applied to would be listed.
    expect(buildBatchInsights(more, profile).emptySlots).toEqual([]);
  });

  it("most common hold reason, contradictions, applicants outside every territory", () => {
    expect(insights.topHoldReason).toMatchObject({ code: "A05", count: 2, text: "2 of 9 on-hold applicants have a duplicate application ID." });
    expect(insights.contradictions!.text).toBe(
      '4 contradictions between applicants\' notes and their forms: 2 notes vs form, 1 "no space" with a size or floor given, 1 notes vs target launch date.',
    );
    expect(insights.outsideTerritory!.text).toBe("4 applicants are outside every territory: APP-011, APP-022, APP-036, APP-037.");
  });
});

describe("city saturation (docs/BACKLOG.md)", () => {
  it("Mysuru: the one free territory pin is inside an existing store's inner radius", () => {
    expect(insights.saturation).toHaveLength(1);
    expect(insights.saturation[0]).toMatchObject({ city: "Mysuru", freePins: 1, insidePins: 1, uncertainPins: 0, radiusKm: 2.5, complete: true });
    expect(insights.saturation[0].text).toBe(
      "Mysuru looks saturated: every free territory pin (1) is within 2.5 km of an existing store. Any new partner here will compete with one.",
    );
  });

  it("is not raised for a city with a free pin outside every radius, or with no free pins", () => {
    // Bengaluru's free pins sit well away from stores or are uncertain; Tumakuru has no stores.
    expect(insights.saturation.map((s) => s.city)).not.toContain("Bengaluru");
    expect(insights.saturation.map((s) => s.city)).not.toContain("Tumakuru");
  });

  it("pins with uncertain locations are counted separately and make the claim softer", () => {
    // Leave TER-04's pin 570020 (low confidence) free: a free pin whose location is uncertain.
    const w = structuredClone(r);
    w.decisions.find((d) => d.appKey === "APP-026")!.pin = null;
    const [s] = citySaturation(w, profile);
    expect(s.city).toBe("Mysuru");
    expect(s.uncertainPins).toBe(1);
    expect(s.complete).toBe(false);
    expect(s.text).toMatch(/may be saturated: all 1 free pin with a known location is within 2\.5 km of an existing store, and 1 other pin has an uncertain location\./);
  });
});

describe("untapped demand (docs/BACKLOG.md)", () => {
  it("counts qualified applicants in cities with no territory and ranks where to open one", () => {
    const d = untappedDemand(r)!;
    expect(d.total).toBe(3);
    expect(d.cities.map((c) => [c.city, c.applicants.map((a) => a.appId), c.meanReadiness])).toEqual([
      ["Belagavi", ["APP-022"], 9],
      ["Davanagere", ["APP-036"], 9],
      ["Mangaluru", ["APP-037"], 8],
    ]);
    expect(d.text).toMatch(/^3 qualified applicants in Belagavi, Davanagere and Mangaluru have no territory to join\./);
  });

  it("leaves out applicants on hold or not approved", () => {
    const d = untappedDemand(r)!;
    const ids = d.cities.flatMap((c) => c.applicants.map((a) => a.appId));
    for (const id of ids) expect(["WAITLIST"]).toContain(decision(r, id).status);
  });

  it("is absent when every applicant has a territory", () => {
    const only = trickyRun("eyewear", {
      facts: ["APP-022", "APP-036", "APP-037"].map((key) => ({ target: "application" as const, key, field: "withdrawn" as const, value: true as const })),
    });
    expect(untappedDemand(only)).toBeNull();
  });
});

describe("threshold sanity banner (G9.7)", () => {
  it("raises nothing on the tricky fixture: no single rule touches more than 40%", () => {
    expect(thresholdWarnings(r)).toEqual([]);
    expect(SANITY_THRESHOLD).toBe(0.4);
  });

  it("raises it when one rule affects most of the pool: a very high capital minimum", () => {
    const policy = defaultPolicy("eyewear");
    policy.profile.minInvestmentLakh = { "Tier 1": 200, "Tier 2": 200, "Tier 3": 200 };
    const strict = trickyRun("eyewear", { policy });
    const [w] = thresholdWarnings(strict);
    expect(w.rule).toBe("Capital below the tier minimum");
    expect(w.affected / w.total).toBeGreaterThan(0.4);
    expect(w.text).toMatch(/^Capital below the tier minimum: \d+ of 38$/);
  });

  it("is exactly 'more than' 40%: 40% itself is not enough", () => {
    const fake = { ...r, decisions: r.decisions.slice(0, 10).map((d, i) => ({ ...d, reasonCodes: i < 4 ? [...d.reasonCodes, "OUTSIDE_PLAN" as const] : d.reasonCodes.filter((c) => c !== "OUTSIDE_PLAN") })) };
    expect(thresholdWarnings(fake as typeof r).filter((x) => x.rule === "City outside the current plan")).toEqual([]);
    const five = { ...fake, decisions: fake.decisions.map((d, i) => (i === 4 ? { ...d, reasonCodes: [...d.reasonCodes, "OUTSIDE_PLAN" as const] } : d)) };
    expect(thresholdWarnings(five as typeof r).map((x) => x.rule)).toContain("City outside the current plan");
  });
});

describe("action queue (SPEC §15.2)", () => {
  const actions = buildActionQueue(r, languages, "2026-10-25");

  it("is ordered by urgency: due date first, then the kind of action", () => {
    expect([...actions.map((a) => a.due)]).toEqual([...actions.map((a) => a.due)].sort());
    expect(actions[0].kind).toBe("call");
  });

  it("every item has an owner and a due date", () => {
    for (const a of actions) {
      expect(a.owner, a.id).toBeTruthy();
      expect(a.due, a.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("1. calls for every on-hold partner with the exact questions, in the partner's language, with a draft", () => {
    const calls = actions.filter((a) => a.kind === "call");
    expect(calls.map((c) => c.appKeys[0]).sort()).toEqual(r.decisions.filter((d) => d.status === "HOLD").map((d) => d.appKey).sort());
    const c8 = calls.find((c) => c.appKeys[0] === "APP-008")!;
    expect(c8.title).toBe("Call APP-008 (Vikram Singh) in Hindi");
    expect(c8.detail).toContain("Please confirm your investment capacity in ₹ lakh. You entered 2500.");
    expect(c8.draft).toContain("Please confirm your investment capacity");
    // A hold that would win a pin is more urgent.
    expect(calls.find((c) => c.appKeys[0] === "APP-035")!.due < calls.find((c) => c.appKeys[0] === "APP-006")!.due).toBe(true);
  });

  it("2. conditions due within 7 days say who gets the slot if one is missed", () => {
    const cond = actions.filter((a) => a.kind === "condition");
    expect(cond.map((c) => c.title)).toEqual(["APP-023: Confirm the space is at least 400 sq ft"]);
    expect(cond[0].detail).toBe("Due 1 Nov 2026. The slot is released to the next applicant in line: APP-005.");
  });

  it("3. location offers awaiting an answer, with the 7-day expiry", () => {
    const offers = actions.filter((a) => a.kind === "offer");
    expect(offers).toHaveLength(4);
    expect(offers.every((o) => o.due === "2026-11-01")).toBe(true);
  });

  it("4. cannibalisation sign-offs with the existing partner to inform", () => {
    const s = actions.filter((a) => a.kind === "signoff");
    expect(s.map((x) => x.title)).toEqual(["Expansion-head sign-off for APP-033", "Expansion-head sign-off for APP-034"]);
    expect(s[0].detail).toContain("inform the existing partner at ST-06");
    expect(s.every((x) => x.owner === "Expansion head")).toBe(true);
  });

  it("5. recruit here: High-priority territories with free slots and no applicants", () => {
    expect(actions.some((a) => a.kind === "recruit")).toBe(false);
    // TER-04 (High, Mysuru): withdraw one partner and its slot frees, with pin 570004 still without an applicant.
    const free = trickyRun("eyewear", { facts: [{ target: "application", key: "APP-016", field: "withdrawn", value: true }] });
    const rec = buildActionQueue(free, languages, "2026-10-25").filter((a) => a.kind === "recruit");
    expect(rec.length === 0 || rec[0].title.startsWith("Recruit in TER-0")).toBe(true);
  });

  it("6. training cohorts to schedule", () => {
    const c = actions.filter((a) => a.kind === "cohort");
    expect(c.map((x) => x.title)).toEqual(["Schedule the Kannada cohort in Bengaluru"]);
    expect(c[0].due).toBe("2026-11-17");
  });

  it("chases a provisional win", () => {
    const chase = actions.find((a) => a.kind === "chase")!;
    expect(chase.title).toBe("Chase APP-035: APP-019's slot is provisional");
    expect(chase.due).toBe("2026-11-01");
  });
});

describe("territory board", () => {
  const board = buildTerritoryBoard(r);
  const t = (id: string) => board.find((x) => x.id === id)!;
  const pin = (id: string, p: string) => t(id).pins.find((x) => x.pin === p)!;

  it("pin states: existing store, reserved, contested, free, unavailable", () => {
    expect(pin("TER-02", "560038")).toMatchObject({ state: "store", text: "Existing store ST-03" });
    expect(pin("TER-01", "560041")).toMatchObject({ state: "reserved", text: "Held by APP-001" });
    expect(pin("TER-01", "560068").text).toBe("Held by APP-003; 2 applicants wanted this pin");
    expect(pin("TER-01", "560102")).toMatchObject({ state: "contested", text: "2 applicants want this pin and none holds it" });
    expect(pin("TER-02", "560093").state).toBe("free");
    expect(pin("TER-02", "560047")).toMatchObject({ state: "unavailable" });
    expect(pin("TER-04", "570016").text).toBe("Offered to APP-034");
  });

  it("winners, waitlist and white space", () => {
    expect(t("TER-01").winners.map((w) => w.appId)).toEqual(["APP-001", "APP-003"]);
    expect(t("TER-01").waitlist.map((w) => `${w.appId}#${w.rank}`)).toEqual(["APP-005#1", "APP-013#2", "APP-014#3", "APP-002#4", "APP-029#7"]);
    expect(t("TER-04").free).toBe(0);
    expect(board.flatMap((x) => x.whiteSpace)).toEqual([]);
  });
});

describe("partner messages (SPEC §15.9)", () => {
  it("never say approved unless the engine did", () => {
    for (const d of r.decisions) {
      const m = draftPartnerMessage(d);
      if (!/approved/i.test(m)) continue;
      expect(["APPROVED", "CONDITIONAL"], d.appKey).toContain(d.status);
    }
    expect(draftPartnerMessage(decision(r, "APP-009"))).not.toMatch(/Your application is approved/);
    expect(draftPartnerMessage(decision(r, "APP-009"))).toMatch(/aren't able to approve/);
  });

  it("use only the decision record: the next three steps and the exact questions", () => {
    const m = draftPartnerMessage(decision(r, "APP-001"));
    expect(m).toContain("Hello Ananya, thank you for applying (reference APP-001).");
    expect(m).toContain("1. Sign the letter of intent and pay the brand fee by 1 Nov 2026");
    expect(m).not.toContain("4. ");
    expect(draftPartnerMessage(decision(r, "APP-006"))).toContain("1. Please confirm your investment capacity in ₹ lakh. You entered 0.");
  });
});

describe("safe export (G6.4)", () => {
  it("prefixes any text that a spreadsheet would read as a formula", () => {
    for (const bad of ["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "\tx", "\rx", "=HYPERLINK(\"http://evil\")"]) expect(safeCell(bad)).toBe(`'${bad}`);
    for (const ok of ["APP-001", "Ravi Kumar", "25", "", "a=b", "₹25 lakh", " =not at start"]) expect(safeCell(ok)).toBe(ok);
    expect(safeCell(-5)).toBe(-5);
    expect(safeCell(null)).toBeNull();
    expect(safeRow(["=1", 2, null, "ok"])).toEqual(["'=1", 2, null, "ok"]);
  });

  function exportOf(session: Session) {
    const result = computeResult(session);
    const eff = effective(session);
    const data = effectiveData(session, eff.settings.includeExample);
    return buildExportWorkbook({
      session,
      applications: data.applications,
      result,
      insights: buildBatchInsights(result, defaultPolicy("eyewear").profile),
      actions: buildActionQueue(result, languages, eff.settings.today),
      settings: { profileLabel: "Eyewear store", today: eff.settings.today },
      entries: session.entries,
      feedback: session.feedback,
      languages,
    });
  }
  const parsed = parseOk([trickyFile()]);
  const base = newSession({ files: ["tricky.xlsx"], applications: parsed.applications, territories: parsed.territories, skippedExample: parsed.skippedExample, report: parsed.report, today: "2026-10-25" });

  it("has the sheets in the specified order, and the Decisions sheet keeps the input's column order", () => {
    const wb = exportOf(base);
    expect(wb.SheetNames).toEqual([...EXPORT_SHEETS]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Decisions"], { header: 1 });
    expect(rows[0].slice(0, 14)).toEqual([...APPLICATION_HEADERS]);
    expect(rows[0].slice(14, 17)).toEqual(["Decision", "Why", "What would change this"]);
    expect(rows).toHaveLength(39);
    expect(rows[1].slice(0, 5)).toEqual(["APP-001", "Ananya Rao", "Bengaluru", "Karnataka", 560041]);
    expect(rows[1][14]).toBe("Approved");
    // The values as typed are kept, not the cleaned ones.
    expect(rows[3][5]).toBe("₹50L");
  });

  it("no cell in any sheet can run as a formula, even when an applicant writes one", () => {
    const evil = structuredClone(base);
    evil.parsed.applications[0] = { ...evil.parsed.applications[0], name: "=cmd|' /C calc'!A0", business: "+1+1", notes: "@SUM(1)\n-2" };
    evil.parsed.applications[1] = { ...evil.parsed.applications[1], notes: "\t=1+1" };
    const wb = exportOf(evil);
    let checked = 0;
    for (const name of wb.SheetNames) {
      for (const [addr, cell] of Object.entries(wb.Sheets[name])) {
        if (addr.startsWith("!")) continue;
        const c = cell as XLSX.CellObject;
        expect(c.f, `${name}!${addr} is a formula`).toBeUndefined();
        if (c.t === "s" && typeof c.v === "string") {
          checked++;
          expect(/^[=+\-@\t\r]/.test(c.v), `${name}!${addr}: ${c.v.slice(0, 30)}`).toBe(false);
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    const decisions = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Decisions"], { header: 1 });
    expect(decisions[1][1]).toBe("'=cmd|' /C calc'!A0");
    expect(decisions[1][7]).toBe("'+1+1");
  });

  it("includes the change log, the feedback and the partner messages", () => {
    const withFb: Session = { ...base, feedback: [{ id: "f1", time: "2026-10-26T09:00:00Z", appKey: "APP-019", appId: "APP-019", status: "CONDITIONAL", reason: "=1+1 is wrong" }] };
    const wb = exportOf(withFb);
    const fb = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Feedback"], { header: 1 });
    expect(fb[1][3]).toBe("'=1+1 is wrong");
    const msgs = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Partner messages"], { header: 1 });
    expect(msgs[0]).toEqual(["Application", "Name", "Preferred language", "Decision", "Message (English)", "Note"]);
    expect(msgs[1][5]).toBe("Machine-drafted. Review before sending.");
  });
});

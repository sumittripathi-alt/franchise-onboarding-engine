// G1: file upload and parsing.

import { describe, expect, it } from "vitest";
import { parseFloor, parseLakh, parseLanguage, parseNumber, parsePin, parseSpaceAvailable, splitPins } from "@/lib/ingest/normalise";
import { MAX_APPLICATION_ROWS } from "@/lib/ingest/parseWorkbook";
import { runDataChecks } from "@/lib/ingest/validate";
import { APPLICATION_EXAMPLE_ROW, APPLICATION_HEADERS, TERRITORY_HEADERS } from "@/lib/ingest/template";
import { TRICKY_APPLICATIONS } from "./fixtures/trickyData";
import {
  TER_ROW,
  appRow,
  csvFile,
  fileFrom,
  parseErrors,
  parseOk,
  rawWorkbookFile,
  templateFile,
  trickyFile,
} from "./helpers";

describe("G1.1 file type and size", () => {
  it("rejects unsupported file types with a friendly message", () => {
    const [err] = parseErrors([fileFrom("applications.pdf", new Uint8Array([1, 2, 3]))]);
    expect(err).toMatch(/isn't a supported file type/);
    expect(err).toMatch(/\.xlsx/);
  });

  it("rejects files over 5 MB", () => {
    const big = { name: "big.xlsx", size: 6 * 1024 * 1024, data: new Uint8Array(10) };
    expect(parseErrors([big])[0]).toMatch(/6\.0 MB.*limit is 5 MB/);
  });
});

describe("G1.2 missing sheets", () => {
  it("names the missing Territories sheet and how to fix it", () => {
    const f = rawWorkbookFile({ Applications: [["banner"], [...APPLICATION_HEADERS], appRow("APP-002")] });
    const errs = parseErrors([f]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/No Territories sheet found/);
    expect(errs[0]).toMatch(/Territory ID/);
  });

  it("names the missing Applications sheet", () => {
    const f = rawWorkbookFile({ Territories: [["banner"], [...TERRITORY_HEADERS], TER_ROW] });
    expect(parseErrors([f])[0]).toMatch(/No Applications sheet found/);
  });

  it("names missing required columns", () => {
    const headers = APPLICATION_HEADERS.filter((h) => h !== "Pin code");
    const f = rawWorkbookFile({
      Applications: [[...headers], ["APP-002", "A", "Bengaluru", "Karnataka", 50]],
      Territories: [[...TERRITORY_HEADERS], TER_ROW],
    });
    expect(parseErrors([f])[0]).toMatch(/missing required column\(s\): Pin code/);
  });
});

describe("G1.3 sheet and header-row discovery", () => {
  it("finds sheets by header signature when names differ, and skips the banner row", () => {
    const f = rawWorkbookFile({
      "Sheet A": [["Some banner"], ["another line"], [...APPLICATION_HEADERS], appRow("APP-002")],
      "Sheet B": [[...TERRITORY_HEADERS], TER_ROW],
    });
    const r = parseOk([f]);
    expect(r.report.applicationsSheet).toBe("Sheet A");
    expect(r.applications[0].row).toBe(4);
    expect(r.territories[0].row).toBe(2);
  });

  it("matches sheet names ignoring case and spaces", () => {
    const f = rawWorkbookFile({
      " applications ": [[...APPLICATION_HEADERS], appRow("APP-002")],
      TERRITORIES: [[...TERRITORY_HEADERS], TER_ROW],
    });
    expect(parseOk([f]).applications).toHaveLength(1);
  });

  it("does not mistake the Field guide sheet for data", () => {
    const r = parseOk([trickyFile()]);
    expect(r.report.applicationsSheet).toBe("Applications");
    expect(r.report.territoriesSheet).toBe("Territories");
  });

  it("accepts two separate CSV files", () => {
    const r = parseOk([
      csvFile("apps.csv", [[...APPLICATION_HEADERS], appRow("APP-002")]),
      csvFile("territories.csv", [[...TERRITORY_HEADERS], TER_ROW]),
    ]);
    expect(r.applications[0].pin.value).toBe("560041");
    expect(r.territories[0].pins).toEqual(["560041", "560068"]);
  });

  it("accepts the legacy .xls format", async () => {
    const { buildTemplateWorkbook, workbookBytes } = await import("@/lib/ingest/templateWorkbook");
    const bytes = workbookBytes(buildTemplateWorkbook({ applications: [appRow("APP-002")], territories: [TER_ROW] }), "xls");
    expect(parseOk([fileFrom("old.xls", bytes)]).applications).toHaveLength(1);
  });
});

describe("G1.4 loose headers", () => {
  it("handles renamed, reordered and extra columns, and reports the extras", () => {
    const headers = ["Notes", "Pincode", "Name", "App ID", "Investment (₹ Lakh)", "City", "Space", "Referral source", "Floor"];
    const row = ["", "560041", "Asha", "APP-002", "45", "bangalore", "Owned", "Instagram", "GF"];
    const f = rawWorkbookFile({
      Applications: [headers, row],
      Territories: [["Territory ID", "City", "Pins", "Slots", "Priority"], ["TER-01", "Bengaluru", "560041", 1, "High"]],
    });
    const r = parseOk([f]);
    const a = r.applications[0];
    expect(a.id).toBe("APP-002");
    expect(a.city.value).toBe("Bengaluru");
    expect(a.investmentLakh.value).toBe(45);
    expect(a.floor.value).toBe("Ground");
    expect(r.report.extraColumns[0].columns).toEqual(["Referral source"]);
    expect(r.report.warnings.join(" ")).toMatch(/Ignored extra column\(s\).*Referral source/);
  });
});

describe("G1.5 template example row", () => {
  it("skips the exact example row and reports it", () => {
    const r = parseOk([trickyFile()]);
    expect(r.applications.some((a) => a.row === 3)).toBe(false);
    expect(r.report.exampleRows).toEqual([
      { sheet: "Applications", row: 3, skipped: true },
      { sheet: "Territories", row: 3, skipped: true },
    ]);
  });

  it("includes it when the toggle is on", () => {
    const r = parseOk([trickyFile()], { includeExampleRow: true });
    expect(r.applications.find((a) => a.row === 3)?.name).toBe("Ravi Kumar");
    expect(r.report.exampleRows[0].skipped).toBe(false);
  });

  it("never skips a row that differs in any field", () => {
    const changed = [...APPLICATION_EXAMPLE_ROW] as (string | number)[];
    changed[13] = "Wants to open before Diwali!";
    const f = rawWorkbookFile({
      Applications: [["banner"], [...APPLICATION_HEADERS], changed],
      Territories: [[...TERRITORY_HEADERS], TER_ROW],
    });
    const r = parseOk([f]);
    expect(r.applications).toHaveLength(1);
    expect(r.report.exampleRows).toEqual([]);
  });
});

describe("G1.6 empty rows", () => {
  it("ignores empty formatted rows down to row 500 and keeps Excel row numbers", () => {
    const blanks = Array.from({ length: 400 }, () => ["", "", null, "  "]);
    const f = templateFile({ applications: [appRow("APP-002"), ...blanks, appRow("APP-003")], territories: [TER_ROW] });
    const r = parseOk([f]);
    expect(r.applications.map((a) => [a.id, a.row])).toEqual([
      ["APP-002", 4],
      ["APP-003", 405],
    ]);
    expect(r.report.emptyRowsIgnored).toBeGreaterThanOrEqual(400);
  });
});

describe("G1.7 normalisation keeps raw values", () => {
  it("pins", () => {
    expect(parsePin(570001.0)).toEqual({ value: "570001", raw: 570001 });
    expect(parsePin("570 001").value).toBe("570001");
    expect(parsePin("570-001").value).toBe("570001");
    expect(parsePin("570001.0").value).toBe("570001");
    expect(parsePin("57001")).toEqual({ value: null, raw: "57001" });
    expect(splitPins("570001; 570002\n570 008, 57x").pins).toEqual(["570001", "570002", "570008"]);
    expect(splitPins("570001; 570002\n570 008, 57x").invalid).toEqual(["57x"]);
  });

  it("investment in lakh, with rupee conversion", () => {
    expect(parseLakh("25 lakh").value).toBe(25);
    expect(parseLakh("₹25L").value).toBe(25);
    expect(parseLakh("25,00,000")).toEqual({ value: 25, raw: "25,00,000" });
    expect(parseLakh(2500000).value).toBe(25);
    expect(parseLakh(2500).value).toBe(2500);
    expect(parseLakh("1.2 crore").value).toBe(120);
    expect(parseLakh("lots").value).toBeNull();
  });

  it("numbers with units", () => {
    expect(parseNumber("450 sq ft").value).toBe(450);
    expect(parseNumber("3 months").value).toBe(3);
    expect(parseNumber("1,200 sqft").value).toBe(1200);
  });

  it("enum spelling variants", () => {
    expect(parseSpaceAvailable("not yet identified").value).toBe("Not yet identified");
    expect(parseSpaceAvailable("RENTED ").value).toBe("Rented");
    expect(parseFloor("Mall").value).toBe("Mall unit");
    expect(parseFloor("ground floor").value).toBe("Ground");
    expect(parseFloor("First Floor").value).toBe("Upper");
    expect(parseLanguage("ಕನ್ನಡ").value).toBe("Kannada");
    expect(parseLanguage("Tamil")).toEqual({ value: null, raw: "Tamil" });
  });

  it("applies to the fixture's mixed formats", () => {
    const r = parseOk([trickyFile()]);
    const get = (id: string) => r.applications.find((a) => a.id === id)!;
    expect(get("APP-003").investmentLakh).toEqual({ value: 50, raw: "₹50L" });
    expect(get("APP-003").spaceSqft).toEqual({ value: 550, raw: "550 sq ft" });
    expect(get("APP-011").investmentLakh.value).toBe(52);
    expect(get("APP-015").pin.value).toBe("570015");
    expect(get("APP-020").pin.value).toBe("560032");
    expect(get("APP-017").floor.value).toBe("Mall unit");
  });
});

describe("G1.8 row cap", () => {
  it(`stops above ${MAX_APPLICATION_ROWS} application rows`, () => {
    const rows = Array.from({ length: MAX_APPLICATION_ROWS + 1 }, (_, i) => appRow(`APP-${i + 2}`));
    const [err] = parseErrors([templateFile({ applications: rows, territories: [TER_ROW] })]);
    expect(err).toMatch(/2,001 rows; the limit is 2,000/);
  });
});

describe("G1.9 empty Applications sheet", () => {
  it('says "No applications found" instead of crashing', () => {
    expect(parseErrors([templateFile({ applications: [], territories: [TER_ROW] })])[0]).toMatch(
      /No applications found/,
    );
  });
});

describe("G1.10 existing stores sheet", () => {
  it("is silent when the sheet matches the fixed list", () => {
    expect(parseOk([trickyFile()]).report.warnings.join(" ")).not.toMatch(/Existing stores/);
  });

  it("warns and uses the fixed list when it differs", () => {
    const f = templateFile({
      applications: [appRow("APP-002")],
      territories: [TER_ROW],
      existingStores: [
        ["ST-01", "Bengaluru", 560001, 2019],
        ["ST-11", "Tumakuru", 572101, 2025],
      ],
    });
    const w = parseOk([f]).report.warnings.join(" ");
    expect(w).toMatch(/differs from the fixed store list/);
    expect(w).toMatch(/ST-11 572101/);
    expect(w).toMatch(/fixed list ST-01 to ST-10 was used/);
  });
});

describe("G1.11 corrupt or protected files", () => {
  it("explains a corrupt .xlsx", () => {
    const junk = new TextEncoder().encode("this is not a spreadsheet at all");
    expect(parseErrors([fileFrom("broken.xlsx", junk)])[0]).toMatch(/couldn't be read.*corrupt/);
  });

  it("explains a password-protected workbook", () => {
    const cfb = new Uint8Array(512);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(parseErrors([fileFrom("locked.xlsx", cfb)])[0]).toMatch(/password-protected/);
  });
});

describe("G1.12 row numbers in messages", () => {
  it("every issue cites its original Excel row", () => {
    const r = parseOk([trickyFile()]);
    const checks = runDataChecks(r.applications, r.territories);
    expect(checks.issues.length).toBeGreaterThan(10);
    for (const i of checks.issues) {
      expect(i.message.startsWith(`Row ${i.row}:`)).toBe(true);
      expect(i.row).toBeGreaterThanOrEqual(4);
    }
    // Fixture data starts at row 4, in order.
    expect(r.applications.map((a) => a.row)).toEqual(TRICKY_APPLICATIONS.map((_, i) => i + 4));
  });
});

describe("G9.8 skipped example territory covers an applicant", () => {
  it("warns prominently when an applicant's pin is in the skipped example territory", async () => {
    const { buildDataQualityReport } = await import("@/lib/ingest/report");
    const r = parseOk([
      templateFile({
        applications: [appRow("APP-002", { 2: "Mysuru", 4: 570002 }), appRow("APP-003")],
        territories: [["TER-02", "Mysuru", "Karnataka", "570010", "Tier 2", 1, "High"]],
      }),
    ]);
    expect(r.report.skippedExampleTerritory).toEqual({
      row: 3,
      id: "TER-01",
      pins: ["570001", "570002", "570008"],
      covers: [{ applicationId: "APP-002", pin: "570002" }],
    });
    const rep = buildDataQualityReport(r.report, r.applications, runDataChecks(r.applications, r.territories));
    expect(rep.exampleTerritoryWarning).toMatch(/example territory \(TER-01, row 3: 570001, 570002, 570008\) was skipped/);
    expect(rep.exampleTerritoryWarning).toMatch(/APP-002 \(570002\)/);
    expect(rep.warnings[0]).toBe(rep.exampleTerritoryWarning);
  });

  it("stays quiet when no applicant is covered, or when the row was included", async () => {
    const { buildDataQualityReport } = await import("@/lib/ingest/report");
    const quiet = parseOk([templateFile({ applications: [appRow("APP-002")], territories: [TER_ROW] })]);
    expect(quiet.report.skippedExampleTerritory?.covers).toEqual([]);
    const rep = buildDataQualityReport(quiet.report, quiet.applications, runDataChecks(quiet.applications, quiet.territories));
    expect(rep.exampleTerritoryWarning).toBeNull();

    const included = parseOk(
      [templateFile({ applications: [appRow("APP-002", { 2: "Mysuru", 4: 570002 })], territories: [TER_ROW] })],
      { includeExampleRow: true },
    );
    expect(included.report.skippedExampleTerritory).toBeNull();
  });
});

describe("G9.8 included example rows get their own IDs", () => {
  it("an included example territory never triggers T01 against a real TER-01", () => {
    const r = parseOk(
      [
        templateFile({
          applications: [appRow("APP-001", { 1: "Asha Rao", 2: "Mysuru", 4: 570002 }), appRow("APP-002")],
          territories: [
            ["TER-01", "Bengaluru", "Karnataka", "560041, 560068", "Tier 1", 1, "High"],
            ["TER-02", "Mysuru", "Karnataka", "570010", "Tier 2", 1, "High"],
          ],
        }),
      ],
      { includeExampleRow: true },
    );
    expect(r.territories.map((t) => t.id)).toEqual(["TER-01 (template example)", "TER-01", "TER-02"]);
    expect(r.applications.map((a) => a.id)).toEqual(["APP-001 (template example)", "APP-001", "APP-002"]);
    const checks = runDataChecks(r.applications, r.territories);
    expect(checks.issues.filter((i) => i.code === "T01" || i.code === "A05")).toEqual([]);
    const t = Object.fromEntries(checks.territories.map((x) => [x.key, x]));
    expect(t["TER-01 (template example)"].pins).toEqual(["570001", "570002", "570008"]);
    expect(t["TER-01"].pins).toEqual(["560041", "560068"]);
    expect(t["TER-01"].blocked).toBe(false);
  });
});

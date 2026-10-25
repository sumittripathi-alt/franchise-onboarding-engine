// Data-quality report shown before results (SPEC §3.2).

import { getPin } from "@/lib/geo/pins";
import type { Application, Issue, IssueSeverity } from "@/lib/types";
import type { ExampleRowInfo, ParseReport } from "./parseWorkbook";
import type { DataCheckResult } from "./validate";

export interface UnmappedPin {
  pin: string;
  reason: "not_in_dataset" | "location_unknown";
  usedBy: string[];
}

export interface DataQualityReport {
  files: string[];
  applicationsSheet: string;
  territoriesSheet: string;
  applicationRowsRead: number;
  territoryRowsRead: number;
  emptyRowsIgnored: number;
  exampleRows: ExampleRowInfo[];
  issueCounts: Record<IssueSeverity, number>;
  issues: Issue[];
  unmappedPins: UnmappedPin[];
  warnings: string[];
  /**
   * G9.8: the skipped example territory would have covered applicants' pins. Shown prominently,
   * with a one-click "Include it" (Phase 5).
   */
  exampleTerritoryWarning: string | null;
  /** One-line, human summary for the top of the report. */
  summary: string;
}

export function buildDataQualityReport(
  parse: ParseReport,
  applications: Application[],
  checks: DataCheckResult,
): DataQualityReport {
  const issueCounts: Record<IssueSeverity, number> = { blocking: 0, condition: 0, info: 0 };
  for (const i of checks.issues) issueCounts[i.severity]++;

  const usage = new Map<string, Set<string>>();
  const note = (pin: string, who: string) => usage.set(pin, (usage.get(pin) ?? new Set()).add(who));
  for (const a of applications) if (a.pin.value) note(a.pin.value, a.id || a.key);
  for (const t of checks.territories) for (const p of t.pins) note(p, t.id);

  const unmappedPins: UnmappedPin[] = [];
  for (const [pin, who] of [...usage].sort(([a], [b]) => a.localeCompare(b))) {
    const rec = getPin(pin);
    if (!rec) unmappedPins.push({ pin, reason: "not_in_dataset", usedBy: [...who].sort() });
    else if (rec.lat === null || rec.confidence === "none")
      unmappedPins.push({ pin, reason: "location_unknown", usedBy: [...who].sort() });
  }

  const exampleNotes = parse.exampleRows.map((e) =>
    e.skipped
      ? `Row ${e.row} of ${e.sheet} is the template's example row and was skipped.`
      : `Row ${e.row} of ${e.sheet} is the template's example row and was included (toggle on).`,
  );

  const ex = parse.skippedExampleTerritory;
  const exampleTerritoryWarning =
    ex && ex.covers.length
      ? `The template's example territory (${ex.id}, row ${ex.row}: ${ex.pins.join(", ")}) was skipped, but it covers ` +
        `the pin of ${ex.covers.map((c) => `${c.applicationId} (${c.pin})`).join(", ")}. ` +
        "If you kept it on purpose, include it."
      : null;

  const summary =
    `Read ${parse.applicationRowsRead} application${parse.applicationRowsRead === 1 ? "" : "s"} and ` +
    `${parse.territoryRowsRead} territor${parse.territoryRowsRead === 1 ? "y" : "ies"}. ` +
    `${issueCounts.blocking} blocking, ${issueCounts.condition} condition and ${issueCounts.info} info issue${checks.issues.length === 1 ? "" : "s"}.`;

  return {
    files: parse.files,
    applicationsSheet: parse.applicationsSheet,
    territoriesSheet: parse.territoriesSheet,
    applicationRowsRead: parse.applicationRowsRead,
    territoryRowsRead: parse.territoryRowsRead,
    emptyRowsIgnored: parse.emptyRowsIgnored,
    exampleRows: parse.exampleRows,
    issueCounts,
    issues: checks.issues,
    unmappedPins,
    warnings: [...(exampleTerritoryWarning ? [exampleTerritoryWarning] : []), ...exampleNotes, ...parse.warnings, ...checks.warnings],
    exampleTerritoryWarning,
    summary,
  };
}

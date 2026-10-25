// Excel export (SPEC §15.11, G6.4). Sheet order: Summary, Decisions, Action queue, Conditions, Onboarding,
// Training cohorts, Partner messages, Data issues, Change log, Feedback. The Decisions sheet keeps the input's
// column order and adds the decision columns at the end, so the team can work from it directly. Every text
// cell is protected against formula injection.

import * as XLSX from "xlsx";
import type { EngineResult } from "@/lib/engine/types";
import { APPLICATION_HEADERS } from "@/lib/ingest/template";
import type { ActionItem } from "@/lib/insights/actions";
import type { BatchInsights } from "@/lib/insights/batch";
import { draftPartnerMessage, MACHINE_DRAFTED } from "@/lib/insights/messages";
import { formatDate } from "@/lib/planner/dates";
import type { ChangeEntry, Feedback, Session } from "@/lib/state/session";
import type { Application } from "@/lib/types";
import { STATUSES } from "@/lib/types";
import { safeRow } from "./safe";

export { EXPORT_SHEETS } from "./sheets";

type Cell = string | number | boolean | null;

function sheet(headers: string[], rows: Cell[][], widths?: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([safeRow(headers), ...rows.map(safeRow)] as Cell[][]);
  ws["!cols"] = (widths ?? headers.map((h) => Math.max(12, Math.min(48, h.length + 4)))).map((wch) => ({ wch }));
  return ws;
}

const raw = <T>(p: { value: T | null; raw: string | number | null }): Cell => (p.raw ?? null) as Cell;

/** The applicant's own columns, in the template's order, with the values as typed. */
function inputColumns(a: Application): Cell[] {
  return [a.id, a.name, raw(a.city), raw(a.state), raw(a.pin), raw(a.investmentLakh), raw(a.experienceYears), a.business, raw(a.spaceAvailable), raw(a.spaceSqft), raw(a.floor), raw(a.targetLaunchMonths), raw(a.language), a.notes];
}

export function buildExportWorkbook(args: {
  session: Session;
  /** The applications the engine saw, in input order. */
  applications: Application[];
  result: EngineResult;
  insights: BatchInsights;
  actions: ActionItem[];
  settings: { profileLabel: string; today: string };
  entries: ChangeEntry[];
  feedback: Feedback[];
  /** Language by application key. */
  languages: Record<string, string | null>;
}): XLSX.WorkBook {
  const { result, applications, insights, actions, settings } = args;
  const wb = XLSX.utils.book_new();
  const byKey = new Map(result.decisions.map((d) => [d.appKey, d]));

  // 1. Summary
  const summary: Cell[][] = [
    ["Franchise partner decisions", null],
    ["Files", args.session.files.join(", ")],
    ["Brand type", settings.profileLabel],
    ["Today", formatDate(settings.today)],
    ["Applications", result.decisions.length],
    [null, null],
    ["Status", "Count"],
    ...STATUSES.map((s): Cell[] => [result.decisions.find((d) => d.status === s)?.label ?? s, insights.statusCounts[s]]),
    [null, null],
    ["Insights", null],
    ...insights.oversubscribed.map((i): Cell[] => ["Oversubscribed", i.text]),
    ...insights.emptySlots.map((i): Cell[] => ["No applicants", i.text]),
    ...(insights.topHoldReason ? [["Most common hold reason", insights.topHoldReason.text] as Cell[]] : []),
    ...(insights.contradictions ? [["Contradictions", insights.contradictions.text] as Cell[]] : []),
    ...(insights.outsideTerritory ? [["Outside every territory", insights.outsideTerritory.text] as Cell[]] : []),
    ...insights.saturation.map((s): Cell[] => ["City saturation", s.text]),
    ...(insights.untappedDemand ? [["Untapped demand", insights.untappedDemand.text] as Cell[]] : []),
    ...insights.warnings.map((w): Cell[] => ["Check this rule", `${w.text}. This rule is affecting most of this pool; review it in Policy.`]),
    ...result.warnings.map((w): Cell[] => ["Warning", w]),
  ];
  const sum = XLSX.utils.aoa_to_sheet(summary.map(safeRow) as Cell[][]);
  sum["!cols"] = [{ wch: 28 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, sum, "Summary");

  // 2. Decisions: input columns first, decision columns after.
  const decisionHeaders = [
    ...APPLICATION_HEADERS,
    "Decision",
    "Why",
    "What would change this",
    "Partner next step",
    "Team next step",
    "Pin held or offered",
    "Territory wanted",
    "Waitlist rank",
    "Conditions",
    "Flags",
    "Reason codes",
    "Earliest opening",
    "How they'll be prepared",
  ];
  const decisionRows = applications.map((a): Cell[] => {
    const d = byKey.get(a.key);
    const base = inputColumns(a);
    if (!d) return [...base, "Withdrawn", ...Array<Cell>(decisionHeaders.length - base.length - 1).fill(null)];
    return [
      ...base,
      d.label,
      d.headline,
      d.counterfactual,
      d.partnerNextStep,
      d.teamNextStep,
      d.pin,
      d.territoryId,
      d.waitlist ? d.waitlist.rank : null,
      d.conditions.map((c) => `${c.text} (by ${c.deadline}, ${c.owner})`).join("; "),
      d.flags.map((f) => f.text).join(" "),
      d.reasonCodes.join(", "),
      d.onboarding?.earliestLaunch ?? null,
      d.preparation,
    ];
  });
  XLSX.utils.book_append_sheet(wb, sheet(decisionHeaders, decisionRows, [...Array(14).fill(18), 22, 60, 60, 50, 50, 12, 12, 10, 60, 60, 30, 14, 70]), "Decisions");

  // 3. Action queue
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      ["Due", "Type", "Action", "Detail", "Owner", "Language", "Draft message"],
      actions.map((x): Cell[] => [x.due, x.kind, x.title, x.detail, x.owner, x.language, x.draft]),
      [12, 12, 50, 80, 22, 12, 80],
    ),
    "Action queue",
  );

  // 4. Conditions
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      ["Application", "Name", "Decision", "Condition", "Owner", "Deadline", "If missed", "Source"],
      result.decisions.flatMap((d) => d.conditions.map((c): Cell[] => [d.appId, d.name, d.label, c.text, c.owner, c.deadline, c.ifMissed, c.source])),
      [14, 22, 24, 70, 10, 12, 60, 24],
    ),
    "Conditions",
  );

  // 5. Onboarding
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      ["Application", "Name", "Milestone", "Owner", "Start", "End", "Critical path", "Note", "Applies if offer accepted"],
      result.decisions.flatMap((d) =>
        (d.onboarding?.milestones ?? [])
          .filter((m) => !m.skipped)
          .map((m): Cell[] => [d.appId, d.name, m.name, m.owner, m.start, m.end, m.critical ? "yes" : "", m.note, d.onboarding!.ifAccepted ? "yes" : ""]),
      ),
      [14, 22, 60, 16, 12, 12, 12, 70, 12],
    ),
    "Onboarding",
  );

  // 6. Training cohorts (every partner with a plan; cohort columns blank when there is none)
  const cohortOf = new Map(result.cohorts.flatMap((c) => c.members.map((m) => [m.appKey, c] as const)));
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      ["Cohort", "Language", "City", "Training starts", "Application", "Name", "Track", "Shadow store", "Team induction", "Opening", "Decision"],
      result.decisions
        .filter((d) => d.training)
        .sort((a, b) => (cohortOf.get(a.appKey)?.id ?? "~") .localeCompare(cohortOf.get(b.appKey)?.id ?? "~") || a.appId.localeCompare(b.appId, "en", { numeric: true }))
        .map((d): Cell[] => {
          const t = d.training!;
          return [
            cohortOf.get(d.appKey)?.label.split(":")[0] ?? "",
            t.language,
            d.city,
            t.start,
            d.appId,
            d.name,
            t.track,
            t.shadow ? `${t.shadow.storeId} (${t.shadow.storeCity}), ${t.shadow.days} days` : "",
            t.teamPreparation ? `${t.teamPreparation.start} to ${t.teamPreparation.end}` : "",
            d.onboarding?.earliestLaunch ?? null,
            d.label,
          ];
        }),
      [34, 10, 18, 14, 14, 22, 12, 30, 24, 12, 24],
    ),
    "Training cohorts",
  );

  // 7. Partner messages (template drafts until the AI drafts them in each partner's language)
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      ["Application", "Name", "Preferred language", "Decision", "Message (English)", "Note"],
      result.decisions.map((d): Cell[] => [d.appId, d.name, args.languages[d.appKey] ?? "English", d.label, draftPartnerMessage(d), MACHINE_DRAFTED]),
      [14, 22, 16, 24, 100, 34],
    ),
    "Partner messages",
  );

  // 8. Data issues
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      ["Row", "Subject", "Code", "Severity", "Field", "Message", "Question for the partner", "Applicant's own words"],
      result.issues.map((i): Cell[] => [i.row, i.subjectId, i.code, i.severity, i.field ?? null, i.message, i.question ?? null, i.evidence ?? null]),
      [8, 16, 8, 10, 22, 90, 70, 36],
    ),
    "Data issues",
  );

  // 9. Change log
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      ["Time", "Source", "Change", "Result", "Undone"],
      args.entries.map((e): Cell[] => [e.time, e.source, e.description, e.diff.text, e.undone ? "yes" : ""]),
      [26, 12, 70, 90, 8],
    ),
    "Change log",
  );

  // 10. Feedback ("Disagree" reasons)
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      ["Time", "Application", "Decision disagreed with", "Reason"],
      args.feedback.map((f): Cell[] => [f.time, f.appId, byKey.get(f.appKey)?.label ?? f.status, f.reason]),
      [26, 14, 26, 90],
    ),
    "Feedback",
  );
  return wb;
}

export function workbookToBlob(wb: XLSX.WorkBook): Blob {
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

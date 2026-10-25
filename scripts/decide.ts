// Prints the engine's decision for every application in a workbook, for reviewing its judgement.
//
//   npm run decide <file.xlsx> [-- --today=2026-10-25] [--profile=eyewear|delivery|partner_point]
//                              [--full] [--include-example] [--plans=APP-001,APP-019]
//
// Uses the heuristic notes reader (no Gemini), exactly as the app does when the AI is unavailable.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseWorkbooks } from "@/lib/ingest/parseWorkbook";
import { defaultPolicy } from "@/lib/policy/brandProfiles";
import type { BrandProfileId } from "@/lib/policy/types";
import { runEngineChecked } from "@/lib/engine/run";
import { addDays, isIsoDate, todayIST } from "@/lib/planner/dates";
import { STATUSES, STATUS_META } from "@/lib/types";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: npm run decide <file.xlsx> [-- --today=YYYY-MM-DD --profile=eyewear|delivery|partner_point --full]");
  process.exit(1);
}
const today = flag("today") ?? todayIST();
if (!isIsoDate(today)) {
  console.error(`--today must be YYYY-MM-DD, got "${today}"`);
  process.exit(1);
}
const profileId = (flag("profile") ?? "eyewear") as BrandProfileId;
if (!["eyewear", "delivery", "partner_point"].includes(profileId)) {
  console.error(`--profile must be eyewear, delivery or partner_point`);
  process.exit(1);
}

const bytes = new Uint8Array(readFileSync(file));
const parsed = parseWorkbooks([{ name: basename(file), size: bytes.length, data: bytes }], {
  includeExampleRow: args.includes("--include-example"),
});
if (!parsed.ok) {
  console.error(parsed.errors.join("\n"));
  process.exit(1);
}

const policy = defaultPolicy(profileId);
const result = runEngineChecked({ applications: parsed.applications, territories: parsed.territories, policy, today });

// ---- Table ----
const COLS = [
  { title: "ID", width: 8 },
  { title: "Decision", width: 18 },
  { title: "Why", width: 54 },
  { title: "Partner next step", width: 38 },
  { title: "Team next step", width: 38 },
  { title: "Pin", width: 6 },
  { title: "Flags", width: 19 },
];

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > width) {
        out.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    out.push(line);
  }
  return out;
}

const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
const rule = COLS.map((c) => "─".repeat(c.width)).join("─┼─");
const row = (cells: string[]) => {
  const wrapped = cells.map((c, i) => wrap(c, COLS[i].width));
  const h = Math.max(...wrapped.map((w) => w.length));
  const lines: string[] = [];
  for (let i = 0; i < h; i++) lines.push(wrapped.map((w, j) => pad(w[i] ?? "", COLS[j].width)).join(" │ "));
  return lines.join("\n");
};

const FLAG_SHORT: Record<string, string> = {
  CANNIBALISATION_RISK: "near-store",
  LOCATION_UNCERTAIN: "location-uncertain",
  PAYBACK_WARNING: "slow-payback",
  TARGET_NOT_FEASIBLE: "target-not-feasible",
  TIGHT_TIMELINE: "tight-timeline",
  NOTES_TARGET_DISAGREE: "notes≠target",
  RENT_BURDEN_RISK: "rent-burden",
  PROVISIONAL: "provisional",
  HUMAN_OVERRIDE: "override",
  LOCKED: "sent",
  INTEGRITY_CONCERN: "integrity",
  EXPERIENCE_UNDER_REPORTED: "exp-under-reported",
};

console.log(
  `\n${basename(file)} · ${policy.profile.label} (${policy.profile.styleHint}) · today ${today} · ${result.decisions.length} applications\n`,
);
console.log(row(COLS.map((c) => c.title)));
console.log(rule);
for (const d of result.decisions) {
  const flags = d.flags.map((f) => FLAG_SHORT[f.code] ?? f.code.toLowerCase()).join(", ");
  console.log(row([d.appId, d.label, d.headline, d.partnerNextStep, d.teamNextStep, d.pin ?? "", flags]));
  console.log(rule);
}

const counts = STATUSES.map((s) => `${STATUS_META[s].label}: ${result.decisions.filter((d) => d.status === s).length}`);
console.log(`\n${counts.join(" · ")}`);
for (const t of result.territories) {
  console.log(
    `${t.id.padEnd(8)} ${String(t.city).padEnd(17)} ${t.priority.padEnd(6)} slots ${t.reserved.length}/${t.slots}` +
      `  reserved: ${t.reserved.map((r) => `${r.appId}@${r.pin}`).join(", ") || "—"}` +
      (t.whiteSpacePins.length ? `  recruit here: ${t.whiteSpacePins.join(", ")}` : ""),
  );
}

console.log("\nWaitlists (one per city, single rank; wanted territory in brackets):");
const cities = [...new Set(result.decisions.filter((d) => d.waitlist).map((d) => d.waitlist!.city))].sort();
for (const c of cities) {
  const list = result.decisions
    .filter((d) => d.waitlist?.city === c)
    .sort((a, b) => a.waitlist!.rank - b.waitlist!.rank)
    .map((d) => `#${d.waitlist!.rank} ${d.appId} (${d.waitlist!.wantedTerritoryId ?? "no territory"})`);
  console.log(`  ${c.padEnd(17)} ${list.join(", ")}`);
}
if (result.warnings.length) console.log(`\nWarnings:\n- ${result.warnings.join("\n- ")}`);
console.log(
  result.invariantViolations.length
    ? `\n✗ INVARIANT VIOLATIONS:\n- ${result.invariantViolations.join("\n- ")}`
    : "\n✓ All invariants hold (6.7), including a rerun determinism check.",
);

const planIds = flag("plans")?.split(",").map((x) => x.trim().toUpperCase()) ?? [];
for (const id of planIds) {
  const d = result.decisions.find((x) => x.appId === id);
  if (!d) {
    console.log(`\nNo application ${id}.`);
    continue;
  }
  console.log(`\n══ ${d.appId} · ${d.name} · ${d.label}${d.pin ? ` · pin ${d.pin}` : ""} ══`);
  if (!d.onboarding || !d.training) {
    console.log("No onboarding plan: plans are made for Approved, Approved with conditions and location offers.");
    continue;
  }
  const o = d.onboarding;
  if (o.ifAccepted) console.log("(Location offer: this plan applies if the offer is accepted.)");
  console.log(`\nOnboarding: ${o.summary}`);
  if (o.phasedOption) console.log(o.phasedOption.text);
  // Text Gantt: one column per week from today.
  const weeks = Math.ceil((Date.parse(o.earliestLaunch) - Date.parse(result.today)) / (7 * 86400000)) + 1;
  const col = (iso: string) => Math.floor((Date.parse(iso) - Date.parse(result.today)) / (7 * 86400000));
  console.log(`\n${"Milestone".padEnd(58)} ${"Owner".padEnd(15)} ${"Start".padEnd(12)} ${"End".padEnd(12)} Weeks from ${result.today}`);
  for (const m of o.milestones) {
    const bar = Array.from({ length: weeks }, (_, w) =>
      m.skipped ? " " : m.days === 0 ? (w === col(m.end) ? "◆" : " ") : w >= col(m.start) && w <= col(addDays(m.end, -1)) ? (m.critical ? "█" : "░") : " ",
    ).join("");
    const name = `${m.skipped ? "(skipped) " : ""}${m.name}${m.critical && !m.skipped ? " *" : ""}`;
    console.log(`${name.slice(0, 58).padEnd(58)} ${m.owner.padEnd(15)} ${m.start.padEnd(12)} ${m.end.padEnd(12)} ${bar}`);
    if (m.note) console.log(`${"".padEnd(4)}↳ ${m.note}`);
  }
  console.log("  * critical path   █ critical   ░ has slack   ◆ launch");
  console.log("\nChecklist:");
  for (const c of o.checklist) console.log(`  [ ] ${c.due}  ${c.owner.padEnd(15)} ${c.item}`);
  const t = d.training;
  console.log(`\nTraining: ${t.summary}.`);
  console.log(`  Track: ${t.track} (${t.trackReason}); ${t.days} days, ${t.format}, ${t.start} → ${t.end}; language ${t.language}.`);
  console.log(`  Modules:\n${t.modules.map((m) => `    - ${m.name}${m.note ? ` (${m.note})` : ""}`).join("\n")}`);
  if (t.staffingNote) console.log(`  Staffing: ${t.staffingNote}`);
  if (t.shadow) console.log(`  Shadowing: ${t.shadow.days} days at ${t.shadow.storeId}, ${t.shadow.storeCity} (pin ${t.shadow.pin}${t.shadow.km !== null ? `, ${t.shadow.km} km away` : ""}): ${t.shadow.note}.`);
  if (t.storeManagerAttends) console.log("  The named store manager attends every module.");
  if (t.teamPreparation) console.log(`  ${t.teamPreparation.heading}: ${t.teamPreparation.text}`);
  if (t.shifted) console.log(`  ${t.shifted.text}`);
  const cohort = result.cohorts.find((c) => c.id === t.cohortId);
  console.log(`  Cohort: ${cohort ? cohort.label : "none (no other partner in the same city and language starts training within 10 days, or has the slack to move)"}`);
  console.log(`  Readiness check: ${t.readinessCheck.map((r) => `${r.item} by ${r.due}`).join("; ")}.`);
}

if (args.includes("--full")) {
  for (const d of result.decisions) {
    console.log(`\n── ${d.appId} · ${d.name} · ${d.label} ──`);
    console.log(wrap(d.explanation, 120).join("\n"));
    console.log(`What would change this: ${d.counterfactual}`);
    console.log(`Partner next steps:\n  - ${d.partnerSteps.join("\n  - ")}`);
    console.log(`Team next steps:\n  - ${d.teamSteps.join("\n  - ")}`);
    if (d.suggestions.length) console.log(`Suggestions: ${d.suggestions.join(" ")}`);
    if (d.conditions.length) console.log(`Conditions:\n  - ${d.conditions.map((c) => `[${c.owner}] ${c.text} (by ${c.deadline}; if missed: ${c.ifMissed})`).join("\n  - ")}`);
    console.log(`Reason codes: ${d.reasonCodes.join(", ")}`);
  }
}

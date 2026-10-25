// Onboarding plan (SPEC §7.1): milestones with dependencies, the critical path, the earliest feasible
// launch, a phased (soft-launch) option when the target can't be met, and a checklist with owners.
// The engine uses the same schedule for the "earliest feasible launch" ranking factor, so the two never disagree.

import type { BrandProfile } from "@/lib/policy/types";
import type { Condition } from "@/lib/types";
import { addDays, daysBetween, formatDate } from "./dates";
import { trainingDays, type TrainingTrack } from "./training";

/** Fixed step durations (days) that are not brand-specific. Shown as assumptions with the plan. */
export const STEP_DAYS = {
  letterOfIntent: 7,
  leasePaperwork: 14,
  stockAndPos: 7,
  mockAudit: 3,
  /** A soft launch opens with starter stock this many days after fit-out, training and licences are done. */
  softLaunchStock: 3,
} as const;

export const STEP_ASSUMPTIONS = [
  `Letter of intent and brand fee: ${STEP_DAYS.letterOfIntent} days, while any space search runs from today.`,
  `Lease or landlord paperwork: ${STEP_DAYS.leasePaperwork} days (not needed for owned space).`,
  `Stock and point-of-sale set-up: ${STEP_DAYS.stockAndPos} days, after fit-out.`,
  `Mock audit: ${STEP_DAYS.mockAudit} days, after training, stock and licences.`,
  "Licences, fit-out and hiring run in parallel once the lease is signed; training follows hiring.",
];

export type MilestoneId = "signoff" | "loi" | "space" | "lease" | "licences" | "fitout" | "hiring" | "training" | "stock" | "audit" | "launch";
export type Owner = "partner" | "brand" | "partner + brand";

export interface Milestone {
  id: MilestoneId;
  name: string;
  owner: Owner;
  days: number;
  /** ISO dates; for a skipped step, start = end. */
  start: string;
  end: string;
  dependsOn: MilestoneId[];
  critical: boolean;
  skipped: boolean;
  note: string | null;
}

export interface PathInput {
  /** A new space must be found (no space yet, a location offer, or the current space must change). */
  needsSpaceSearch: boolean;
  /** Days allowed for the space search (the condition's deadline, counted from today). */
  spaceSearchDays: number;
  /** When the only conditions are internal: days for the expansion-head sign-off, before the letter of intent. */
  internalSignOffDays?: number;
  /** Rented space or a new space needs a lease; owned space doesn't. */
  needsLease: boolean;
  track: TrainingTrack;
}

interface StepDef {
  id: MilestoneId;
  name: string;
  owner: Owner;
  dependsOn: MilestoneId[];
  days: (p: BrandProfile, i: PathInput) => number;
  skipped?: (i: PathInput) => boolean;
}

const STEPS: StepDef[] = [
  {
    id: "signoff",
    name: "Expansion-head sign-off",
    owner: "brand",
    dependsOn: [],
    days: (_p, i) => i.internalSignOffDays ?? 0,
    skipped: (i) => !i.internalSignOffDays,
  },
  { id: "loi", name: "Sign the letter of intent and pay the brand fee", owner: "partner", dependsOn: ["signoff"], days: () => STEP_DAYS.letterOfIntent },
  {
    // The search starts today, alongside the letter of intent, so it ends on the condition's deadline.
    id: "space",
    name: "Find a suitable space",
    owner: "partner",
    dependsOn: ["signoff"],
    days: (_p, i) => (i.needsSpaceSearch ? i.spaceSearchDays : 0),
    skipped: (i) => !i.needsSpaceSearch,
  },
  {
    id: "lease",
    name: "Lease or landlord paperwork",
    owner: "partner",
    dependsOn: ["loi", "space"],
    days: (_p, i) => (i.needsLease || i.needsSpaceSearch ? STEP_DAYS.leasePaperwork : 0),
    skipped: (i) => !i.needsLease && !i.needsSpaceSearch,
  },
  {
    id: "licences",
    name: "Trade licence, shop & establishment registration and GST",
    owner: "partner",
    dependsOn: ["lease"],
    days: (p) => p.leadTimes.licencesDays,
  },
  { id: "fitout", name: "Fit-out", owner: "partner + brand", dependsOn: ["lease"], days: (p) => p.leadTimes.fitOutDays },
  { id: "hiring", name: "Hiring", owner: "partner", dependsOn: ["lease"], days: (p) => p.leadTimes.hiringDays },
  { id: "training", name: "Training", owner: "brand", dependsOn: ["hiring"], days: (p, i) => trainingDays(p, i.track) },
  { id: "stock", name: "Stock and point-of-sale set-up", owner: "brand", dependsOn: ["fitout"], days: () => STEP_DAYS.stockAndPos },
  { id: "audit", name: "Mock audit", owner: "brand", dependsOn: ["training", "stock", "licences"], days: () => STEP_DAYS.mockAudit },
  { id: "launch", name: "Launch", owner: "partner + brand", dependsOn: ["audit"], days: () => 0 },
];

/** Schedule every milestone from today and mark the critical path. */
export function scheduleMilestones(today: string, profile: BrandProfile, input: PathInput): Milestone[] {
  const out = new Map<MilestoneId, Milestone>();
  for (const s of STEPS) {
    const start = s.dependsOn.length ? s.dependsOn.map((d) => out.get(d)!.end).sort().at(-1)! : today;
    const days = s.days(profile, input);
    out.set(s.id, {
      id: s.id,
      name: s.id === "hiring" && profile.specialHiring ? `Hiring, including: ${profile.specialHiring}` : s.name,
      owner: s.owner,
      days,
      start,
      end: addDays(start, days),
      dependsOn: s.dependsOn,
      critical: false,
      skipped: s.skipped?.(input) ?? false,
      note: null,
    });
  }
  // Walk back from launch along the dependency that finishes last.
  let cur: Milestone | undefined = out.get("launch");
  while (cur) {
    cur.critical = true;
    const deps: Milestone[] = cur.dependsOn.map((d) => out.get(d)!);
    cur = deps.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : STEPS.findIndex((s) => s.id === a.id) - STEPS.findIndex((s) => s.id === b.id)))[0];
  }
  return [...out.values()];
}

export function criticalPathDays(profile: BrandProfile, input: PathInput): number {
  const today = "2000-01-01";
  return daysBetween(today, scheduleMilestones(today, profile, input).find((m) => m.id === "launch")!.end);
}

export function earliestLaunch(today: string, profile: BrandProfile, input: PathInput): string {
  return scheduleMilestones(today, profile, input).find((m) => m.id === "launch")!.end;
}

export interface ChecklistItem {
  item: string;
  owner: Owner | "team";
  due: string;
  /** Where the item comes from: a milestone, or a condition on the decision. */
  source: MilestoneId | "condition";
}

export interface OnboardingPlan {
  milestones: Milestone[];
  criticalPath: MilestoneId[];
  earliestLaunch: string;
  target: string | null;
  festival: { name: string; date: string } | null;
  /** The earlier of target and festival (SPEC §15.7). */
  testDate: string | null;
  feasible: boolean;
  gapDays: number;
  /** "Target not feasible; earliest realistic date is DD MMM" or a confirmation, in plain English. */
  summary: string;
  /** Soft launch when the target can't be met. */
  phasedOption: { softLaunch: string; fullLaunch: string; text: string } | null;
  checklist: ChecklistItem[];
  /** For a location offer: this plan applies only if the offer is accepted. */
  ifAccepted: boolean;
  assumptions: string[];
}

export function buildOnboardingPlan(args: {
  today: string;
  profile: BrandProfile;
  input: PathInput;
  target: string | null;
  festival: { name: string; date: string } | null;
  conditions: Condition[];
  storeManager: boolean;
  ifAccepted: boolean;
  /** Pin where the store will be (own or offered), for the checklist wording. */
  pin: string | null;
}): OnboardingPlan {
  const { today, profile, input, target, festival, conditions } = args;
  const milestones = scheduleMilestones(today, profile, input);
  const m = Object.fromEntries(milestones.map((x) => [x.id, x])) as Record<MilestoneId, Milestone>;
  const launch = m.launch.end;
  const testDate = festival && target ? (festival.date < target ? festival.date : target) : (festival?.date ?? target);
  const gapDays = testDate ? daysBetween(testDate, launch) : 0;
  const feasible = gapDays <= 0;

  // Notes on steps tied to conditions.
  const spaceCond = conditions.find((c) => c.source === "SPACE_NOT_IDENTIFIED" || c.source === "FLOOR_NOT_SUITABLE" || c.source === "SIZE_BELOW_MIN");
  if (!m.space.skipped) m.space.note = spaceCond ? `Condition: ${spaceCond.text.replace(/\s+within \d+ days$/, "")} by ${formatDate(spaceCond.deadline)}.` : null;
  if (m.lease.skipped) m.lease.note = "Owned space: no lease needed.";
  if (profile.specialHiring) m.hiring.note = `Special hire: ${profile.specialHiring}.`;
  if (args.storeManager) m.training.note = "The named store manager attends every module too.";

  // Phased option: open with starter stock once fit-out, training and licences are done, audit after.
  let phasedOption: OnboardingPlan["phasedOption"] = null;
  if (!feasible) {
    const ready = [m.fitout.end, m.training.end, m.licences.end].sort().at(-1)!;
    const soft = addDays(ready, STEP_DAYS.softLaunchStock);
    if (soft < launch) {
      phasedOption = {
        softLaunch: soft,
        fullLaunch: launch,
        text: `Phased option: a soft launch with starter stock on ${formatDate(soft)}, then the full launch after the mock audit on ${formatDate(launch)}.${testDate && soft <= testDate ? ` The soft launch meets the ${festival && testDate === festival.date ? `${festival.name} date` : "target"}.` : ""}`,
      };
    }
  }

  const what = festival && testDate === festival.date ? `Opening before ${festival.name} (${formatDate(festival.date)}, verify)` : target ? `Opening by ${formatDate(target)}` : "Opening";
  const summary = feasible
    ? `${what} is feasible: earliest realistic opening is ${formatDate(launch)}${gapDays < 0 ? `, ${-gapDays} day${gapDays === -1 ? "" : "s"} to spare` : ""}.`
    : `Target not feasible: ${lcFirst(what)} isn't possible; earliest realistic date is ${formatDate(launch)}.`;

  const checklist: ChecklistItem[] = [];
  for (const c of conditions) {
    checklist.push({ item: c.text.replace(/\s+within \d+ days$/, ""), owner: c.owner === "team" ? "team" : "partner", due: c.deadline, source: "condition" });
  }
  for (const x of milestones) {
    if (x.skipped || x.id === "launch") continue;
    // A space or sign-off condition already covers these steps.
    if (x.id === "space" && spaceCond) continue;
    if (x.id === "signoff" && conditions.some((c) => c.source === "EXPANSION_SIGNOFF")) continue;
    checklist.push({ item: x.id === "space" && args.pin ? `${x.name} in pin ${args.pin}` : x.name, owner: x.owner, due: x.end, source: x.id });
  }
  checklist.push({ item: "Launch", owner: "partner + brand", due: launch, source: "launch" });
  checklist.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));

  return {
    milestones,
    criticalPath: milestones.filter((x) => x.critical && !x.skipped).map((x) => x.id),
    earliestLaunch: launch,
    target,
    festival,
    testDate,
    feasible,
    gapDays,
    summary,
    phasedOption,
    checklist,
    ifAccepted: args.ifAccepted,
    assumptions: STEP_ASSUMPTIONS,
  };
}

const lcFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

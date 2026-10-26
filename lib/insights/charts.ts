// Data for the dashboard's charts (SPEC §10.1): a donut of decisions by status and a portfolio Gantt of every partner's
// path to opening. Pure functions; each chart also has a text equivalent built here, so no number lives only in a picture.

import type { EngineResult } from "@/lib/engine/types";
import { daysBetween, formatDate } from "@/lib/planner/dates";
import { STATUSES, type Status } from "@/lib/types";

/** The status colours, as the app uses them elsewhere (WCAG AA against white text and against the page). */
export const STATUS_COLOUR: Record<Status, string> = {
  APPROVED: "#15803d",
  CONDITIONAL: "#0f766e",
  HOLD: "#b45309",
  WAITLIST: "#475569",
  REDIRECT: "#1d4ed8",
  REJECT: "#b91c1c",
};

// ---------- Donut ----------

export const DONUT_RADIUS = 42;
export const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;
const GAP = 1.2;

export interface DonutSegment {
  status: Status;
  count: number;
  /** Share of all applications, 0 to 100. */
  pct: number;
  /** SVG stroke-dasharray and stroke-dashoffset for a circle drawn with rotate(-90), so it starts at 12 o'clock and runs clockwise. */
  dashArray: string;
  dashOffset: number;
}

export function donutSegments(counts: Record<Status, number>): { total: number; segments: DonutSegment[] } {
  const total = STATUSES.reduce((n, s) => n + counts[s], 0);
  const present = STATUSES.filter((s) => counts[s] > 0);
  const gap = present.length > 1 ? GAP : 0;
  let start = 0;
  const segments: DonutSegment[] = [];
  for (const s of present) {
    const share = counts[s] / total;
    const len = Math.max(0.5, share * DONUT_CIRCUMFERENCE - gap);
    segments.push({
      status: s,
      count: counts[s],
      pct: Math.round(share * 1000) / 10,
      dashArray: `${len.toFixed(3)} ${(DONUT_CIRCUMFERENCE - len).toFixed(3)}`,
      dashOffset: -start,
    });
    start += share * DONUT_CIRCUMFERENCE;
  }
  return { total, segments };
}

export function donutSummary(counts: Record<Status, number>, label: (s: Status) => string): string {
  const { total, segments } = donutSegments(counts);
  return total === 0 ? "No applications." : `${total} applications: ${segments.map((s) => `${s.count} ${label(s.status).toLowerCase()} (${s.pct}%)`).join(", ")}.`;
}

// ---------- Portfolio Gantt ----------

export interface TimelineRow {
  appKey: string;
  appId: string;
  name: string;
  status: Status;
  label: string;
  /** ISO dates. */
  start: string;
  launch: string;
  training: { start: string; end: string } | null;
  /** The plan only applies if a location offer is accepted. */
  ifAccepted: boolean;
  /** Position on the axis, 0 to 100. */
  left: number;
  width: number;
  trainingLeft: number | null;
  trainingWidth: number | null;
  text: string;
}

export interface Tick {
  label: string;
  left: number;
}

export interface PortfolioTimeline {
  from: string;
  to: string;
  ticks: Tick[];
  rows: TimelineRow[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const idOrder = new Intl.Collator("en", { numeric: true });

function monthTicks(from: string, to: string, pct: (iso: string) => number): Tick[] {
  const ticks: Tick[] = [];
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  for (let i = 0; i < 48; i++) {
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    const iso = `${y}-${String(m).padStart(2, "0")}-01`;
    if (iso > to) break;
    ticks.push({ label: m === 1 ? `${MONTHS[0]} ${y}` : MONTHS[m - 1], left: pct(iso) });
  }
  return ticks;
}

/** Every partner who has an onboarding plan (approved, approved with conditions, or an offer if accepted): from their first step to opening. */
export function buildPortfolioTimeline(result: EngineResult, today: string): PortfolioTimeline {
  const planned = result.decisions.filter((d) => d.onboarding);
  const launches = planned.map((d) => d.onboarding!.earliestLaunch).sort();
  const to = launches.length ? launches[launches.length - 1] : today;
  const span = Math.max(1, daysBetween(today, to));
  const pct = (iso: string) => Math.min(100, Math.max(0, (daysBetween(today, iso) / span) * 100));

  const rows: TimelineRow[] = planned
    .map((d) => {
      const plan = d.onboarding!;
      const live = plan.milestones.filter((m) => !m.skipped);
      const start = live.reduce((min, m) => (m.start < min ? m.start : min), plan.earliestLaunch);
      const tr = live.find((m) => m.id === "training");
      const training = tr ? { start: tr.start, end: tr.end } : null;
      const left = pct(start);
      const right = pct(plan.earliestLaunch);
      const row: TimelineRow = {
        appKey: d.appKey,
        appId: d.appId,
        name: d.name,
        status: d.status,
        label: d.label,
        start,
        launch: plan.earliestLaunch,
        training,
        ifAccepted: plan.ifAccepted,
        left,
        width: Math.max(1.2, right - left),
        trainingLeft: training ? pct(training.start) : null,
        trainingWidth: training ? Math.max(1, pct(training.end) - pct(training.start)) : null,
        text: `${d.appId} (${d.name}), ${d.label}: steps start ${formatDate(start)}${training ? `, training ${formatDate(training.start)} to ${formatDate(training.end)}` : ""}, earliest opening ${formatDate(plan.earliestLaunch)}${plan.ifAccepted ? " (only if the location offer is accepted)" : ""}.`,
      };
      return row;
    })
    .sort((a, b) => (a.launch < b.launch ? -1 : a.launch > b.launch ? 1 : idOrder.compare(a.appId, b.appId)));

  return { from: today, to, ticks: monthTicks(today, to, pct), rows };
}

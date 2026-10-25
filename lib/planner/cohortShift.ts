// Moves a partner's training to a cohort's shared start date without moving their opening date.

import { addDays, formatDate } from "./dates";
import type { OnboardingPlan } from "./onboarding";
import { trainingSummary, type Cohort, type TrainingPlan } from "./training";

export function applyCohort(onboarding: OnboardingPlan, training: TrainingPlan, cohort: Cohort, newStart: string): void {
  const from = training.start;
  const member = cohort.members.find((m) => m.start === newStart);
  training.cohortId = cohort.id;
  if (newStart === from) return;

  const newEnd = addDays(newStart, training.days);
  const text = `Training moved from ${formatDate(from)} to ${formatDate(newStart)} so ${training.language} partners in ${cohort.city} share one start date. The opening date doesn't move: training still ends ${training.slackDays - (member?.shiftedDays ?? 0)} days before the mock audit.`;
  training.shifted = { from, to: newStart, text };
  training.start = newStart;
  training.end = newEnd;
  training.slackDays -= member?.shiftedDays ?? 0;
  training.readinessCheck = training.readinessCheck.map((r) => (r.item === "Product and process quiz" ? { ...r, due: newEnd } : r));
  training.summary = trainingSummary(training);

  const m = onboarding.milestones.find((x) => x.id === "training")!;
  const note = `Moved from ${formatDate(from)} to join the ${cohort.label.split(":")[0]}; opening date unchanged.`;
  m.start = newStart;
  m.end = newEnd;
  m.note = m.note ? `${m.note} ${note}` : note;
  const item = onboarding.checklist.find((c) => c.source === "training");
  if (item) item.due = newEnd;
  onboarding.checklist.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

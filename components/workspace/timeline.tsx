"use client";

import { daysBetween, formatDate } from "@/lib/planner/dates";
import type { OnboardingPlan } from "@/lib/planner/onboarding";
import { cn } from "@/lib/utils";

/** A simple Gantt-style timeline plus the checklist with owners (SPEC §7.1). Every bar has a text equivalent in the table. */
export function OnboardingTimeline({ plan, today }: { plan: OnboardingPlan; today: string }) {
  const rows = plan.milestones.filter((m) => !m.skipped);
  const end = plan.earliestLaunch;
  const span = Math.max(1, daysBetween(today, end));
  const pct = (iso: string) => Math.min(100, Math.max(0, (daysBetween(today, iso) / span) * 100));

  return (
    <div className="space-y-4">
      <p className="text-sm">{plan.summary}</p>
      {plan.phasedOption && <p className="rounded-lg bg-accent px-3 py-2 text-sm">{plan.phasedOption.text}</p>}
      {plan.ifAccepted && <p className="text-xs text-muted-foreground">This plan applies if the offer is accepted: a new space is needed.</p>}

      <ol className="space-y-1.5" aria-label="Timeline">
        {rows.map((m) => {
          const left = pct(m.start);
          const width = m.days === 0 ? 0 : Math.max(1.5, pct(m.end) - left);
          return (
            <li key={m.id} data-animate="timeline-row" className="grid grid-cols-[9.5rem_1fr] items-center gap-2 text-xs sm:grid-cols-[13rem_1fr]">
              <span className={cn("truncate", m.critical && "font-medium")} title={m.name}>
                {m.name}
              </span>
              <div className="relative h-4 rounded bg-muted/60" role="img" aria-label={`${m.name}: ${formatDate(m.start)} to ${formatDate(m.end)}${m.critical ? ", on the critical path" : ""}`}>
                {m.days === 0 ? (
                  <span className="absolute top-0 size-4 -translate-x-1/2 rotate-45 scale-75 rounded-[2px] bg-accent-brand" style={{ left: `${left}%` }} />
                ) : (
                  <span className={cn("absolute top-0.5 h-3 rounded", m.critical ? "bg-accent-brand" : "bg-muted-foreground/40")} style={{ left: `${left}%`, width: `${width}%` }} />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        <span className="mr-1 inline-block h-2 w-4 rounded bg-accent-brand align-middle" /> critical path
        <span className="ml-3 mr-1 inline-block h-2 w-4 rounded bg-muted-foreground/40 align-middle" /> has slack · from {formatDate(today)} to {formatDate(end)}
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <caption className="sr-only">Checklist</caption>
          <thead className="bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Due</th>
              <th scope="col" className="px-3 py-2 font-medium">Owner</th>
              <th scope="col" className="px-3 py-2 font-medium">Item</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {plan.checklist.map((c, i) => (
              <tr key={i} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDate(c.due)}</td>
                <td className="px-3 py-2 text-muted-foreground">{c.owner}</td>
                <td className="px-3 py-2">{c.item}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">Assumptions behind these dates</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {plan.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Panel, Section } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { buildPortfolioTimeline, DONUT_RADIUS, donutSegments, donutSummary, STATUS_COLOUR } from "@/lib/insights/charts";
import { formatDate } from "@/lib/planner/dates";
import { useStore } from "@/lib/state/store";
import { STATUS_META, type Status } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./context";

/** Decisions by outcome as a ring, with the numbers beside it as buttons that open the matching applications. */
export function DecisionDonut() {
  const { insights, result } = useWorkspace();
  const setFilters = useStore((s) => s.setFilters);
  const setTab = useStore((s) => s.setTab);
  const label = (s: Status) => result.decisions.find((d) => d.status === s)?.label ?? STATUS_META[s].label;
  const { total, segments } = donutSegments(insights.statusCounts);

  return (
    <Panel className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8" data-testid="donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={donutSummary(insights.statusCounts, label)} className="mx-auto size-40 shrink-0">
        <g transform="rotate(-90 60 60)">
          <circle cx="60" cy="60" r={DONUT_RADIUS} fill="none" strokeWidth="14" className="stroke-muted" />
          {segments.map((s) => (
            <circle key={s.status} data-status={s.status} cx="60" cy="60" r={DONUT_RADIUS} fill="none" strokeWidth="14" stroke={STATUS_COLOUR[s.status]} strokeDasharray={s.dashArray} strokeDashoffset={s.dashOffset}>
              <title>{`${label(s.status)}: ${s.count} (${s.pct}%)`}</title>
            </circle>
          ))}
        </g>
        <text x="60" y="60" textAnchor="middle" className="fill-foreground text-[26px] font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
          {total}
        </text>
        <text x="60" y="76" textAnchor="middle" className="fill-muted-foreground text-[9px]">
          applications
        </text>
      </svg>
      <ul className="grid min-w-0 flex-1 gap-x-6 gap-y-1 sm:grid-cols-2" aria-label="Decisions, with the share of all applications">
        {segments.map((s) => (
          <li key={s.status}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent"
              onClick={() => {
                setFilters({ status: s.status });
                setTab("applications");
              }}
            >
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOUR[s.status] }} />
              <span className="min-w-0 flex-1">{label(s.status)}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {s.count} · {s.pct}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const SHOWN = 10;

/** Every partner's path to opening: when their steps start, their training, and the earliest opening, on one calendar. */
export function PortfolioGantt() {
  const { result, settings } = useWorkspace();
  const openDrawer = useStore((s) => s.openDrawer);
  const tl = useMemo(() => buildPortfolioTimeline(result, settings.today), [result, settings.today]);
  const [all, setAll] = useState(false);
  const rows = all ? tl.rows : tl.rows.slice(0, SHOWN);

  if (tl.rows.length === 0) {
    return (
      <Section title="Path to opening" hint="Each partner who is approved, or has a location offer, from their first step to opening.">
        <Panel className="text-sm text-muted-foreground">No partner has an onboarding plan yet. Plans appear for approved applications and accepted location offers.</Panel>
      </Section>
    );
  }

  return (
    <Section title="Path to opening" hint={`Each partner who is approved, or has a location offer, from ${formatDate(tl.from)} to the last opening on ${formatDate(tl.to)}.`}>
      <Panel className="space-y-3" data-testid="portfolio-gantt">
        <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-[11px] text-muted-foreground sm:grid-cols-[11rem_1fr]">
          <span />
          <div className="relative h-4" aria-hidden>
            {tl.ticks.map((t) => (
              <span key={t.label + t.left} className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums" style={{ left: `${t.left}%` }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
        <ol className="space-y-1.5" aria-label="Opening timeline by partner">
          {rows.map((r) => (
            <li key={r.appKey} data-animate="timeline-row" className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs sm:grid-cols-[11rem_1fr]">
              <button type="button" className="truncate text-left font-medium hover:underline" title={`${r.appId} ${r.name}`} onClick={() => openDrawer(r.appKey)}>
                {r.appId} <span className="hidden font-normal text-muted-foreground sm:inline">{r.name}</span>
              </button>
              <div className="relative h-5 rounded bg-muted/60" role="img" aria-label={r.text}>
                <span
                  className={cn("absolute top-0.5 h-4 rounded-sm", r.ifAccepted && "border border-dashed bg-transparent")}
                  style={{ left: `${r.left}%`, width: `${r.width}%`, background: r.ifAccepted ? undefined : STATUS_COLOUR[r.status], opacity: r.ifAccepted ? 1 : 0.55, borderColor: STATUS_COLOUR[r.status] }}
                />
                {r.trainingLeft !== null && r.trainingWidth !== null && (
                  <span className="absolute top-1 h-3 rounded-sm" style={{ left: `${r.trainingLeft}%`, width: `${r.trainingWidth}%`, background: STATUS_COLOUR[r.status] }} />
                )}
                <span aria-hidden className="absolute top-0.5 size-4 -translate-x-1/2 rotate-45 scale-[0.7] rounded-[2px] border-2 border-background" style={{ left: `${Math.min(99, r.left + r.width)}%`, background: STATUS_COLOUR[r.status] }} />
              </div>
            </li>
          ))}
        </ol>
        {tl.rows.length > SHOWN && (
          <Button variant="ghost" size="sm" onClick={() => setAll((x) => !x)}>
            {all ? "Show fewer" : `Show all ${tl.rows.length}`}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Pale bar: the steps to opening. Solid bar: training. Diamond: earliest opening. Dashed outline: only if the location offer is accepted. Colour is the decision.
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">The timeline in words ({tl.rows.length})</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {tl.rows.map((r) => (
              <li key={r.appKey}>{r.text}</li>
            ))}
          </ul>
        </details>
      </Panel>
    </Section>
  );
}

"use client";

import { Search, X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isFiltered, matchesFilters } from "@/lib/insights/filter";
import { NO_FILTERS, useStore } from "@/lib/state/store";
import { STATUSES, STATUS_META, type DecisionRecord, type Status } from "@/lib/types";
import { useWorkspace } from "./context";

export function useFiltered(): { filtered: DecisionRecord[]; total: number } {
  const { result } = useWorkspace();
  const filters = useStore((s) => s.filters);
  const filtered = useMemo(() => result.decisions.filter((d) => matchesFilters(d, filters)), [result, filters]);
  return { filtered, total: result.decisions.length };
}

const selectClass =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function FilterBar({ full = false }: { full?: boolean }) {
  const { result, insights } = useWorkspace();
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const { filtered, total } = useFiltered();

  const cities = useMemo(() => [...new Set(result.decisions.map((d) => d.city).filter(Boolean) as string[])].sort(), [result]);
  const territories = result.territories.map((t) => t.id);
  const labelOf = (s: Status) => result.decisions.find((d) => d.status === s)?.label ?? STATUS_META[s].label;

  return (
    <div className="no-print space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by decision">
        <Button variant={filters.status === "all" ? "secondary" : "ghost"} size="sm" aria-pressed={filters.status === "all"} onClick={() => setFilters({ status: "all" })}>
          All <span className="tabular-nums text-muted-foreground">{total}</span>
        </Button>
        {STATUSES.filter((s) => insights.statusCounts[s] > 0).map((s) => (
          <Button key={s} variant={filters.status === s ? "secondary" : "ghost"} size="sm" aria-pressed={filters.status === s} onClick={() => setFilters({ status: s })}>
            {labelOf(s)} <span className="tabular-nums text-muted-foreground">{insights.statusCounts[s]}</span>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search applications"
            placeholder="Search ID, name, city, pin…"
            className="pl-8"
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
          />
        </div>
        {full && (
          <>
            <label className="sr-only" htmlFor="f-city">City</label>
            <select id="f-city" className={selectClass} value={filters.city} onChange={(e) => setFilters({ city: e.target.value })}>
              <option value="all">All cities</option>
              {cities.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="f-ter">Territory</label>
            <select id="f-ter" className={selectClass} value={filters.territory} onChange={(e) => setFilters({ territory: e.target.value })}>
              <option value="all">All territories</option>
              {territories.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="f-flag">Flag</label>
            <select id="f-flag" className={selectClass} value={filters.flag} onChange={(e) => setFilters({ flag: e.target.value })}>
              <option value="all">Any flag</option>
              {insights.topFlags.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.text} ({f.count})
                </option>
              ))}
            </select>
          </>
        )}
        {isFiltered(filters) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(NO_FILTERS)}>
            <X /> Clear
          </Button>
        )}
        <p className="ml-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
          Showing {filtered.length} of {total}
        </p>
      </div>
    </div>
  );
}

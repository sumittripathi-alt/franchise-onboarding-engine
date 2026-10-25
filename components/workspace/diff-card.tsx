"use client";

import { ArrowRight } from "lucide-react";
import { StatusChip } from "@/components/app/status-chip";
import { Pill } from "@/components/app/ui-bits";
import type { DiffSummary } from "@/lib/chat/diff";
import { useStore } from "@/lib/state/store";

/** What changed and why, with knock-on effects (SPEC §9). */
export function DiffList({ diff, max = 12 }: { diff: DiffSummary; max?: number }) {
  const openDrawer = useStore((s) => s.openDrawer);
  if (diff.changes.length === 0 && diff.slots.length === 0) return <p className="text-sm text-muted-foreground">No decisions changed.</p>;
  const shown = diff.changes.slice(0, max);
  return (
    <div data-animate="diff-card" className="space-y-2">
      <ul className="space-y-2">
        {shown.map((c) => (
          <li key={c.appKey} data-animate="diff-row" className="rounded-lg border bg-background p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <button className="font-medium underline-offset-2 hover:underline" onClick={() => openDrawer(c.appKey)}>
                {c.appId}
              </button>
              {!c.direct && <Pill tone="info">Knock-on</Pill>}
              {c.kind === "removed" ? (
                <span className="text-muted-foreground">removed from the pool</span>
              ) : (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {c.from && c.fromLabel ? <StatusChip status={c.from} label={c.fromLabel} /> : <span className="text-muted-foreground">new</span>}
                  <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
                  {c.to && c.toLabel && <StatusChip status={c.to} label={c.toLabel} />}
                </span>
              )}
              {c.pinFrom !== c.pinTo && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  pin {c.pinFrom ?? "none"} → {c.pinTo ?? "none"}
                </span>
              )}
            </div>
            {c.kind !== "removed" && <p className="mt-1 text-xs text-muted-foreground">{c.reason}</p>}
          </li>
        ))}
      </ul>
      {diff.changes.length > max && <p className="text-xs text-muted-foreground">and {diff.changes.length - max} more.</p>}
      {diff.slots.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Slots: {diff.slots.map((s) => `${s.territoryId} ${s.reservedFrom}→${s.reservedTo} reserved${s.slotsFrom !== s.slotsTo ? ` (of ${s.slotsFrom}→${s.slotsTo} open)` : ""}`).join("; ")}.
        </p>
      )}
    </div>
  );
}

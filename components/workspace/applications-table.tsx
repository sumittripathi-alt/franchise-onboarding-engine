"use client";

import { EmptyState, Pill } from "@/components/app/ui-bits";
import { StatusChip } from "@/components/app/status-chip";
import { REASON_TEXT } from "@/lib/engine/reasons";
import { useStore } from "@/lib/state/store";
import { FilterBar, useFiltered } from "./filter-bar";

/** The data table: search and filter, then click a row for the decision drawer. */
export function ApplicationsTable() {
  const { filtered } = useFiltered();
  const openDrawer = useStore((s) => s.openDrawer);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Applications</h2>
        <p className="text-sm text-muted-foreground">Search and filter every application.</p>
      </div>
      <FilterBar full />
      {filtered.length === 0 ? (
        <EmptyState title="No applications match">Clear the filters to see every application.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
            <caption className="sr-only">Applications</caption>
            <thead className="bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">ID</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                <th scope="col" className="px-4 py-2.5 font-medium">City</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Pin</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Territory</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Decision</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Key reason</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Conditions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((d) => (
                <tr key={d.appKey} className="cursor-pointer transition-colors hover:bg-accent/60" onClick={() => openDrawer(d.appKey)}>
                  <td className="px-4 py-2.5">
                    <button
                      className="font-medium underline-offset-2 hover:underline focus-visible:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrawer(d.appKey);
                      }}
                      aria-label={`Open the decision for ${d.appId}, ${d.name}`}
                    >
                      {d.appId}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">{d.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{d.city ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{d.homePin ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{d.territoryId ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <StatusChip status={d.status} label={d.label} />
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {REASON_TEXT[d.reasonCodes[0]]}
                    {d.reasonCodes.length > 1 && <span className="ml-1 text-xs">+{d.reasonCodes.length - 1}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{d.conditions.length ? <Pill tone="info">{d.conditions.length}</Pill> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

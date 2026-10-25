"use client";

import { Printer } from "lucide-react";
import { EmptyState } from "@/components/app/ui-bits";
import { StatusChip } from "@/components/app/status-chip";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/state/store";
import { useWorkspace } from "./context";
import { FilterBar, useFiltered } from "./filter-bar";
import { GuidedStart } from "./guided-start";

/**
 * The default view after upload (SPEC §15.1): one row per application, four columns that mirror the brief:
 * what happens, why, what they do next, and how they'll be prepared. Click a row for the full decision.
 */
export function DecisionSheet() {
  const { settings, policy, session } = useWorkspace();
  const { filtered } = useFiltered();
  const openDrawer = useStore((s) => s.openDrawer);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Decision sheet</h2>
          <p className="text-sm text-muted-foreground">Every application, what happens to it, and why. Click a row for the full decision.</p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>

      <div className="hidden print:block">
        <h1 className="text-lg font-semibold">Decision sheet: {session.files.join(", ")}</h1>
        <p>
          {policy.profile.label}, as of {settings.today}
        </p>
      </div>

      <GuidedStart />
      <FilterBar />

      {filtered.length === 0 ? (
        <EmptyState title="No applications match">Clear the filters to see every application.</EmptyState>
      ) : (
        <>
        {/* On a phone each application is a card; the table is for larger screens and for print. */}
        <ul className="space-y-3 md:hidden print:hidden" aria-label="Decision for every application">
          {filtered.map((d) => (
            <li key={d.appKey}>
              <button
                onClick={() => openDrawer(d.appKey)}
                className="w-full rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/60"
                aria-label={`Open the decision for ${d.appId}, ${d.name}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block font-medium">{d.appId}</span>
                    <span className="block text-muted-foreground">{d.name}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {d.city ?? "No city"}
                      {d.homePin ? ` · ${d.homePin}` : ""}
                    </span>
                  </span>
                  <StatusChip status={d.status} label={d.label} />
                </span>
                <span className="mt-3 block text-sm">{d.headline}</span>
                <span className="mt-3 block text-xs font-medium uppercase tracking-wider text-muted-foreground">What they do next</span>
                <span className="block text-sm">{d.partnerNextStep}</span>
                {d.preparation && (
                  <>
                    <span className="mt-3 block text-xs font-medium uppercase tracking-wider text-muted-foreground">How they&apos;ll be prepared</span>
                    <span className="block text-sm text-muted-foreground">{d.preparation}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="print-sheet hidden overflow-x-auto rounded-xl border bg-card md:block print:block" tabIndex={0} role="region" aria-label="Decision sheet table. Scrolls sideways on small screens.">
          <table className="w-full min-w-[64rem] border-collapse text-left text-sm">
            <caption className="sr-only">Decision for every application</caption>
            <thead className="bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="w-36 px-4 py-2.5 font-medium">Application</th>
                <th scope="col" className="w-44 px-4 py-2.5 font-medium">What happens</th>
                <th scope="col" className="min-w-[17rem] px-4 py-2.5 font-medium">Why</th>
                <th scope="col" className="w-64 px-4 py-2.5 font-medium">What they do next</th>
                <th scope="col" className="w-60 px-4 py-2.5 font-medium">How they&apos;ll be prepared</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((d) => (
                <tr
                  key={d.appKey}
                  className="cursor-pointer align-top transition-colors hover:bg-accent/60"
                  onClick={() => openDrawer(d.appKey)}
                >
                  <td className="px-4 py-3">
                    <button
                      className="text-left font-medium underline-offset-2 hover:underline focus-visible:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrawer(d.appKey);
                      }}
                      aria-label={`Open the decision for ${d.appId}, ${d.name}`}
                    >
                      {d.appId}
                    </button>
                    <p className="text-muted-foreground">{d.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {d.city ?? "No city"}
                      {d.homePin ? ` · ${d.homePin}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={d.status} label={d.label} />
                    {d.pin && <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">Pin {d.pin}{d.slotTerritoryId ? ` · ${d.slotTerritoryId}` : ""}</p>}
                    {d.waitlist && <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">#{d.waitlist.rank} in {d.waitlist.city}</p>}
                  </td>
                  <td className="px-4 py-3">{d.headline}</td>
                  <td className="px-4 py-3">
                    <p>{d.partnerNextStep}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Team: {d.teamNextStep}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{d.preparation ?? <span aria-label="Not applicable">Not yet: no store to prepare for</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

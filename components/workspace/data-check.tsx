"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { Panel, Pill, Section } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/state/store";
import type { Issue } from "@/lib/types";
import { useWorkspace } from "./context";

const SEVERITY_LABEL = { blocking: "Needs an answer", condition: "Becomes a condition", info: "For information" } as const;
const SEV_TONE = { blocking: "warn", condition: "info", info: "neutral" } as const;

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Panel className="p-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Panel>
  );
}

/** The example-territory warning with its one-click "Include it" (G9.8). */
export function ExampleTerritoryWarning() {
  const { report } = useWorkspace();
  const commit = useStore((s) => s.commit);
  if (!report.exampleTerritoryWarning) return null;
  return (
    <div role="alert" className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-st-hold-dot/50 bg-st-hold-bg p-4 text-st-hold">
      <div className="flex gap-3">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="text-sm">
          <p className="font-medium">A skipped example row covers your applicants&apos; pins</p>
          <p className="mt-0.5">{report.exampleTerritoryWarning}</p>
        </div>
      </div>
      <Button
        variant="outline"
        onClick={() => commit({ source: "settings", description: "Included the template's example territory and application", set: { includeExample: true } })}
      >
        Include it
      </Button>
    </div>
  );
}

export function DataCheckPanel({ onContinue }: { onContinue?: () => void }) {
  const { report, session } = useWorkspace();
  const reading = useStore((st) => st.reading);
  const [showAll, setShowAll] = useState(false);
  const groups = (["blocking", "condition", "info"] as const).map((sev) => ({ sev, items: report.issues.filter((i) => i.severity === sev) }));
  const LIMIT = 60;
  const otherWarnings = report.warnings.filter((w) => w !== report.exampleTerritoryWarning);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Check your data</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {report.summary} Nothing here stops you: applications with a problem are put on hold with the exact questions to ask.
        </p>
      </div>

      <ExampleTerritoryWarning />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Applications read" value={report.applicationRowsRead} />
        <Stat label="Territories read" value={report.territoryRowsRead} />
        <Stat label="Empty rows ignored" value={report.emptyRowsIgnored} />
        <Stat label="Issues found" value={report.issues.length} hint={`${report.issueCounts.blocking} need an answer`} />
      </div>

      {(otherWarnings.length > 0 || report.exampleRows.length > 0) && (
        <Section title="Notes about your file">
          <ul className="space-y-1.5 text-sm">
            {otherWarnings.map((w, i) => (
              <li key={i} className="flex gap-2">
                <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                {w}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.unmappedPins.length > 0 && (
        <Section title="Pins we can't place on the map" hint="Decisions don't depend on these locations, but distance checks are skipped for them.">
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {report.unmappedPins.map((p) => (
              <li key={p.pin} className="rounded-md border px-3 py-1.5">
                <span className="font-medium tabular-nums">{p.pin}</span>{" "}
                <span className="text-muted-foreground">
                  {p.reason === "not_in_dataset" ? "isn't in our pincode data" : "has no reliable location"}; used by {p.usedBy.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Issues by severity" hint={`From ${session.files.join(", ")}. Each one cites the row in your file.`}>
        {report.issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">No issues found. Every row passed every check.</p>
        ) : (
          <div className="space-y-5">
            {groups
              .filter((g) => g.items.length > 0)
              .map(({ sev, items }) => (
                <div key={sev}>
                  <div className="mb-2 flex items-center gap-2">
                    <Pill tone={SEV_TONE[sev]}>{SEVERITY_LABEL[sev]}</Pill>
                    <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
                  </div>
                  <ul className="divide-y rounded-xl border bg-card text-sm">
                    {(showAll ? items : items.slice(0, LIMIT)).map((i, idx) => (
                      <IssueRow key={`${i.subjectId}-${i.code}-${idx}`} issue={i} />
                    ))}
                  </ul>
                  {!showAll && items.length > LIMIT && (
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll(true)}>
                      Show all {items.length}
                    </Button>
                  )}
                </div>
              ))}
          </div>
        )}
      </Section>

      {onContinue && (
        <div className="sticky bottom-0 -mx-4 border-t bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <Button size="lg" onClick={onContinue} disabled={reading.status === "running"}>
            {reading.status === "running" ? (
              <>
                <Loader2 className="animate-spin" /> Reading the notes with AI…
              </>
            ) : (
              <>
                See the decisions <ArrowRight />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <li className="px-4 py-2.5">
      <p>
        <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums">{issue.code}</span>
        {issue.message}
      </p>
      {issue.question && <p className="mt-0.5 text-xs text-muted-foreground">Ask: {issue.question}</p>}
      {issue.evidence && <p className="mt-0.5 text-xs text-muted-foreground">Their words: &ldquo;{issue.evidence}&rdquo;</p>}
    </li>
  );
}

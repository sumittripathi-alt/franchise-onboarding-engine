"use client";

import { AlertOctagon, AlertTriangle, GitCompare, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MEMORY_NOTICE } from "@/lib/state/storage";
import { useStore } from "@/lib/state/store";
import { useWorkspace } from "./context";
import { ExampleTerritoryWarning } from "./data-check";

export function Banners() {
  const { violations, insights, result } = useWorkspace();
  const persistence = useStore((s) => s.persistence);
  const previous = useStore((s) => s.previous);
  const setCompareOpen = useStore((s) => s.setCompareOpen);
  const setTab = useStore((s) => s.setTab);

  return (
    <div className="no-print space-y-3 empty:hidden">
      {violations.length > 0 && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="flex items-center gap-2 font-semibold">
            <AlertOctagon aria-hidden className="size-4" /> The engine&apos;s own checks failed, so the latest result isn&apos;t shown
          </p>
          <p className="mt-1">You are seeing the last result that passed every check. Please tell the team what you just changed.</p>
          <ul className="mt-2 list-disc pl-5">
            {violations.slice(0, 3).map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>
      )}

      {persistence === "memory" && (
        <div role="status" className="flex items-center gap-2 rounded-xl border bg-muted px-4 py-2.5 text-sm">
          <HardDrive aria-hidden className="size-4 shrink-0" /> {MEMORY_NOTICE}
        </div>
      )}

      {insights.warnings.map((w) => (
        <div key={w.rule} role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-st-hold-dot/50 bg-st-hold-bg px-4 py-3 text-sm text-st-hold">
          <p className="flex items-center gap-2">
            <AlertTriangle aria-hidden className="size-4 shrink-0" />
            <span>
              <strong className="font-semibold">{w.text}.</strong> This rule is affecting most of this pool. Review it in Policy.
            </span>
          </p>
          <Button variant="outline" size="sm" onClick={() => setTab("policy")}>
            Open Policy
          </Button>
        </div>
      ))}

      <ExampleTerritoryWarning />

      {result.warnings.length > 0 && (
        <div role="status" className="rounded-xl border bg-muted px-4 py-2.5 text-sm">
          {result.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      {previous && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2.5 text-sm">
          <p className="flex items-center gap-2">
            <GitCompare aria-hidden className="size-4 shrink-0 text-muted-foreground" /> You uploaded a new file. The previous one was {previous.files.join(", ")}.
          </p>
          <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)}>
            Compare with previous upload
          </Button>
        </div>
      )}
    </div>
  );
}

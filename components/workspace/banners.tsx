"use client";

import { AlertOctagon, AlertTriangle, GitCompare, HardDrive, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MEMORY_NOTICE } from "@/lib/state/storage";
import { hasText } from "@/lib/llm/extractClient";
import { effective } from "@/lib/state/session";
import { useStore } from "@/lib/state/store";
import { useWorkspace } from "./context";
import { ExampleTerritoryWarning } from "./data-check";

/** Notes the AI hasn't read: the keyword reader was used for them, and a retry is one click. */
function ReadingBanner() {
  const { session } = useWorkspace();
  const reading = useStore((s) => s.reading);
  const retry = useStore((s) => s.retryReading);
  const tab = useStore((s) => s.tab);
  const have = { ...session.signals, ...effective(session).signals };
  const unread = session.parsed.applications.filter((a) => hasText(a) && !have[a.key]?.ai).length;
  // Only where the reading changes what you see.
  if (tab !== "sheet" && tab !== "overview" && tab !== "applications") return null;
  if (reading.status === "running") {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl border bg-muted px-4 py-2.5 text-sm">
        <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" /> The AI is reading the applicants&apos; notes…
      </div>
    );
  }
  if (unread === 0) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border bg-card px-4 py-2.5 text-sm">
      <p className="flex items-start gap-2">
        <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>
          Notes for {unread} application{unread === 1 ? " was" : "s were"} read by keywords only, not the AI. Decisions work either way.
          {reading.message ? ` ${reading.message}` : ""}
        </span>
      </p>
      <Button variant="outline" size="sm" onClick={() => void retry()}>
        Retry AI reading
      </Button>
    </div>
  );
}

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

      <ReadingBanner />

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

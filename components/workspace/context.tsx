"use client";

import { createContext, useContext, useMemo } from "react";
import type { EngineResult } from "@/lib/engine/types";
import type { DataQualityReport } from "@/lib/ingest/report";
import { buildActionQueue, type ActionItem } from "@/lib/insights/actions";
import { buildBatchInsights, type BatchInsights } from "@/lib/insights/batch";
import { buildTerritoryBoard, type BoardTerritory } from "@/lib/insights/board";
import type { Policy } from "@/lib/policy/types";
import {
  shownResult,
  effective,
  effectiveData,
  effectivePolicy,
  effectiveReport,
  type Session,
  type Settings,
} from "@/lib/state/session";
import type { Application, DecisionRecord } from "@/lib/types";

export interface WorkspaceData {
  session: Session;
  /** The result being shown: the latest one if it passed every check, otherwise the last one that did (G3.6). */
  result: EngineResult;
  /** Invariant failures of the latest run, shown in a red banner. Empty when all is well. */
  violations: string[];
  settings: Settings;
  policy: Policy;
  applications: Application[];
  appByKey: Map<string, Application>;
  decisionByKey: Map<string, DecisionRecord>;
  decisionById: Map<string, DecisionRecord>;
  languages: Record<string, string | null>;
  insights: BatchInsights;
  actions: ActionItem[];
  board: BoardTerritory[];
  report: DataQualityReport;
}

const Ctx = createContext<WorkspaceData | null>(null);

export function useWorkspace(): WorkspaceData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return v;
}

export function WorkspaceProvider({ session, children }: { session: Session; children: React.ReactNode }) {
  const data = useMemo((): WorkspaceData | { error: string } => {
    const shown = shownResult(session);
    if (shown.error || !shown.result) return { error: shown.error ?? "The decision engine failed." };
    const { result, violations } = shown;

    const eff = effective(session);
    const policy = effectivePolicy(session, eff.settings.profileId);
    const { applications } = effectiveData(session, eff.settings.includeExample);
    const languages = Object.fromEntries(applications.map((a) => [a.key, a.language.value]));
    return {
      session,
      result,
      violations,
      settings: eff.settings,
      policy,
      applications,
      appByKey: new Map(applications.map((a) => [a.key, a])),
      decisionByKey: new Map(result.decisions.map((d) => [d.appKey, d])),
      decisionById: new Map(result.decisions.map((d) => [d.appId, d])),
      languages,
      insights: buildBatchInsights(result, policy.profile),
      actions: buildActionQueue(result, languages, eff.settings.today),
      board: buildTerritoryBoard(result),
      report: effectiveReport(session),
    };
  }, [session]);

  if ("error" in data) {
    return (
      <div role="alert" className="mx-auto mt-16 max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="font-medium text-destructive">The decision engine couldn&apos;t run</p>
        <p className="mt-1 text-sm text-muted-foreground">{data.error}</p>
        <p className="mt-3 text-sm">Go back and upload the file again, or load a saved session.</p>
      </div>
    );
  }
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

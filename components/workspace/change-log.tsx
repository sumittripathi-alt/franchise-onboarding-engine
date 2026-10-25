"use client";

import { Undo2 } from "lucide-react";
import { EmptyState, Pill } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/state/store";
import { useWorkspace } from "./context";
import { DiffList } from "./diff-card";

const SOURCE_LABEL: Record<string, string> = {
  chat: "Assistant",
  policy: "Policy",
  brand: "Brand type",
  ai_notes: "AI reading of notes",
  manual: "New fact",
  lock: "Sent to partner",
  override: "Human override",
  settings: "Settings",
};

/** Every committed change, newest first, each with an Undo (SPEC §9, G5.4). */
export function ChangeLog() {
  const { session } = useWorkspace();
  const undo = useStore((s) => s.undo);
  const entries = [...session.entries].reverse();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Change log</h2>
        <p className="text-sm text-muted-foreground">Every change to facts, settings or decisions, what it moved, and an Undo for each.</p>
      </div>
      {entries.length === 0 ? (
        <EmptyState title="Nothing has changed yet">Give a new fact, switch the brand type, or send a decision to a partner, and it will appear here.</EmptyState>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <Pill>{SOURCE_LABEL[e.source] ?? e.source}</Pill>
                    <span className={e.undone ? "text-muted-foreground line-through" : undefined}>{e.description}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{e.time.slice(0, 16).replace("T", " ")} UTC</p>
                </div>
                {e.undone ? (
                  <Pill>Undone</Pill>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => undo(e.id)}>
                    <Undo2 /> Undo
                  </Button>
                )}
              </div>
              {!e.undone && (
                <div className="mt-3">
                  <p className="mb-2 text-sm text-muted-foreground">{e.diff.changes.length ? e.diff.text : "No decisions changed."}</p>
                  {e.diff.changes.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-sm font-medium">Show what moved</summary>
                      <div className="mt-2">
                        <DiffList diff={e.diff} max={30} />
                      </div>
                    </details>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

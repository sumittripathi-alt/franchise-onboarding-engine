"use client";

import { Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/state/store";
import { DiffList } from "./diff-card";
import { useWorkspace } from "./context";

/** The change just made: what moved, why, and an Undo (SPEC §9, G5.1). */
export function LastChangeCard({ inline = false }: { inline?: boolean }) {
  const { session } = useWorkspace();
  const drawerOpen = useStore((s) => s.drawerKey !== null);
  const assistantOpen = useStore((s) => s.chatOpen);
  const id = useStore((s) => s.lastChangeId);
  const undo = useStore((s) => s.undo);
  const dismiss = useStore((s) => s.dismissLastChange);
  const setTab = useStore((s) => s.setTab);
  const entry = id ? session.entries.find((e) => e.id === id && !e.undone) : undefined;
  if (!entry) return null;
  // While the drawer is open the change shows inside it (a floating card would sit behind its overlay).
  if (!inline && drawerOpen) return null;
  // The open assistant already shows the change, with its Undo.
  if (!inline && assistantOpen) return null;
  return (
    <aside
      id={inline ? "last-change-inline" : undefined}
      role="status"
      aria-live="polite"
      data-animate="diff-card"
      className={
        inline
          ? "no-print rounded-xl border border-accent-brand/40 bg-card p-4"
          : "no-print fixed bottom-[5.25rem] right-4 z-40 w-[min(26rem,calc(100vw-2rem))] rounded-xl sm:bottom-4 sm:right-24 border bg-popover p-4 text-popover-foreground shadow-lg"
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{entry.description}</p>
          <p className="text-xs text-muted-foreground">{entry.diff.changes.length === 0 ? "No decisions changed." : entry.diff.text.split(":")[0] + "."}</p>
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={dismiss}>
          <X />
        </Button>
      </div>
      <div className="mt-3 max-h-64 overflow-y-auto pr-1">
        <DiffList diff={entry.diff} max={6} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => undo(entry.id)}>
          <Undo2 /> Undo
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setTab("log")}>
          View change log
        </Button>
      </div>
    </aside>
  );
}

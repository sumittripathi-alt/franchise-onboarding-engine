"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { compareUploads } from "@/lib/insights/compare";
import { useStore } from "@/lib/state/store";
import { useWorkspace } from "./context";

/** What the new file decided differently from the previous one (SPEC §15.1). */
export function CompareDialog() {
  const { result } = useWorkspace();
  const previous = useStore((s) => s.previous);
  const open = useStore((s) => s.compareOpen);
  const setOpen = useStore((s) => s.setCompareOpen);
  const cmp = useMemo(() => (previous ? compareUploads(previous, result) : null), [previous, result]);
  if (!previous || !cmp) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New upload compared with the previous one</DialogTitle>
          <DialogDescription>
            {previous.files.join(", ")} → now. Applications are matched by Application ID. {cmp.text}
          </DialogDescription>
        </DialogHeader>
        {cmp.changed.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Decisions that changed</h3>
            <ul className="divide-y rounded-lg border text-sm">
              {cmp.changed.map((c) => (
                <li key={c.appId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="w-20 font-medium">{c.appId}</span>
                  <span className="text-muted-foreground">{c.name}</span>
                  <span className="ml-auto text-muted-foreground">{c.fromLabel} →</span>
                  <span className="font-medium">{c.toLabel}</span>
                  {c.pinFrom !== c.pinTo && <span className="text-xs text-muted-foreground tabular-nums">pin {c.pinFrom ?? "none"} → {c.pinTo ?? "none"}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {(["added", "removed"] as const).map((k) =>
          cmp[k].length > 0 ? (
            <section key={k}>
              <h3 className="mb-2 text-sm font-semibold">{k === "added" ? "New in this file" : "Not in this file any more"}</h3>
              <ul className="flex flex-wrap gap-2 text-sm">
                {cmp[k].map((a) => (
                  <li key={a.appId} className="rounded-md border px-2 py-1">
                    {a.appId} <span className="text-muted-foreground">{a.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null,
        )}
        {cmp.changed.length + cmp.added.length + cmp.removed.length === 0 && <p className="text-sm text-muted-foreground">Every decision is the same as before.</p>}
        <p className="text-xs text-muted-foreground">A move from &quot;Approved&quot; to &quot;Approved, pending internal sign-off&quot; counts as a change, because the label is what people see.</p>
      </DialogContent>
    </Dialog>
  );
}

// "Compare with previous upload" (SPEC §15.1): what a second file decided differently from the first.

import type { EngineResult } from "@/lib/engine/types";
import type { PreviousSnapshot } from "@/lib/state/store";

export interface UploadComparison {
  added: { appId: string; name: string; label: string }[];
  removed: { appId: string; name: string; label: string }[];
  changed: { appId: string; name: string; fromLabel: string; toLabel: string; pinFrom: string | null; pinTo: string | null }[];
  unchanged: number;
  text: string;
}

const idOrder = new Intl.Collator("en", { numeric: true });

/**
 * Applications are matched by Application ID, since the two files are different uploads. The engine's key is the ID,
 * with the row number added only when an ID is used twice, so duplicated IDs stay distinct.
 */
export function compareUploads(previous: PreviousSnapshot, now: EngineResult): UploadComparison {
  const before = new Map(previous.decisions.map((d) => [d.appKey, d]));
  const after = new Map(now.decisions.map((d) => [d.appKey, d]));
  const added = [...after.values()].filter((d) => !before.has(d.appKey)).map((d) => ({ appId: d.appId, name: d.name, label: d.label }));
  const removed = [...before.values()].filter((d) => !after.has(d.appKey)).map((d) => ({ appId: d.appId, name: d.name, label: d.label }));
  const changed: UploadComparison["changed"] = [];
  let unchanged = 0;
  for (const d of after.values()) {
    const p = before.get(d.appKey);
    if (!p) continue;
    if (p.status !== d.status || p.label !== d.label || p.pin !== d.pin) {
      changed.push({ appId: d.appId, name: d.name, fromLabel: p.label, toLabel: d.label, pinFrom: p.pin, pinTo: d.pin });
    } else unchanged++;
  }
  const byId = (a: { appId: string }, b: { appId: string }) => idOrder.compare(a.appId, b.appId);
  added.sort(byId);
  removed.sort(byId);
  changed.sort(byId);
  const text = `${changed.length} decision${changed.length === 1 ? "" : "s"} changed, ${added.length} added, ${removed.length} removed, ${unchanged} unchanged.`;
  return { added, removed, changed, unchanged, text };
}

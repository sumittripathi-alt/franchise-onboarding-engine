// Diff between two engine results (SPEC §9): which decisions changed and why, including knock-on effects.

import type { EngineResult } from "@/lib/engine/types";
import type { Status } from "@/lib/types";

export interface DecisionChange {
  appKey: string;
  appId: string;
  name: string;
  from: Status | null;
  to: Status | null;
  fromLabel: string | null;
  toLabel: string | null;
  pinFrom: string | null;
  pinTo: string | null;
  /** Why it is now this way: the new one-line why. */
  reason: string;
  /** True for the applications the change was about; false for knock-on effects. */
  direct: boolean;
  kind: "status" | "pin" | "added" | "removed";
}

export interface SlotChange {
  territoryId: string;
  slotsFrom: number;
  slotsTo: number;
  reservedFrom: number;
  reservedTo: number;
}

export interface DiffSummary {
  changes: DecisionChange[];
  slots: SlotChange[];
  /** "3 decisions changed: APP-012 Waitlisted → Approved with conditions; …" */
  text: string;
}

const idOrder = new Intl.Collator("en", { numeric: true });

export const EMPTY_DIFF: DiffSummary = { changes: [], slots: [], text: "No decisions changed." };

export function diffResults(prev: EngineResult | null, next: EngineResult, directKeys: string[] = []): DiffSummary {
  if (!prev) return EMPTY_DIFF;
  const before = new Map(prev.decisions.map((d) => [d.appKey, d]));
  const after = new Map(next.decisions.map((d) => [d.appKey, d]));
  const direct = new Set(directKeys);
  const changes: DecisionChange[] = [];

  for (const [key, n] of after) {
    const p = before.get(key);
    if (!p) {
      changes.push({
        appKey: key, appId: n.appId, name: n.name, from: null, to: n.status, fromLabel: null, toLabel: n.label,
        pinFrom: null, pinTo: n.pin, reason: n.headline, direct: direct.has(key), kind: "added",
      });
    } else if (p.status !== n.status || p.pin !== n.pin || p.label !== n.label) {
      changes.push({
        appKey: key, appId: n.appId, name: n.name, from: p.status, to: n.status, fromLabel: p.label, toLabel: n.label,
        pinFrom: p.pin, pinTo: n.pin, reason: n.headline, direct: direct.has(key),
        kind: p.status !== n.status || p.label !== n.label ? "status" : "pin",
      });
    }
  }
  for (const [key, p] of before) {
    if (!after.has(key)) {
      changes.push({
        appKey: key, appId: p.appId, name: p.name, from: p.status, to: null, fromLabel: p.label, toLabel: null,
        pinFrom: p.pin, pinTo: null, reason: "No longer in the pool.", direct: true, kind: "removed",
      });
    }
  }
  changes.sort((a, b) => Number(b.direct) - Number(a.direct) || idOrder.compare(a.appId, b.appId));

  const slots: SlotChange[] = [];
  const prevT = new Map(prev.territories.map((t) => [t.id, t]));
  for (const t of next.territories) {
    const p = prevT.get(t.id);
    if (p && (p.slots !== t.slots || p.reserved.length !== t.reserved.length)) {
      slots.push({ territoryId: t.id, slotsFrom: p.slots, slotsTo: t.slots, reservedFrom: p.reserved.length, reservedTo: t.reserved.length });
    }
  }

  const text = changes.length
    ? `${changes.length} decision${changes.length === 1 ? "" : "s"} changed: ${changes
        .map((c) => (c.kind === "removed" ? `${c.appId} removed` : c.kind === "added" ? `${c.appId} added as ${c.toLabel}` : c.kind === "pin" ? `${c.appId} moved from pin ${c.pinFrom} to ${c.pinTo}` : `${c.appId} ${c.fromLabel} → ${c.toLabel}`))
        .join("; ")}.`
    : "No decisions changed.";
  return { changes, slots, text };
}

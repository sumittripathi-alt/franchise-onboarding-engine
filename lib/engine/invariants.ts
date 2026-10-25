// Invariants (SPEC §6.7), asserted after every run. Determinism (invariant 6) is checked by
// runEngineChecked, which runs twice and compares.

import { personKey } from "@/lib/ingest/normalise";
import { RESERVED_STATUSES, STATUSES, type Application, type DecisionRecord } from "@/lib/types";
import type { EngineResult } from "./types";

export function checkInvariants(
  result: Pick<EngineResult, "decisions" | "territories">,
  applications: Application[],
  storePins: ReadonlySet<string>,
): string[] {
  const v: string[] = [];
  const reserved = result.decisions.filter((d) => RESERVED_STATUSES.includes(d.status));

  // 1. No reserved pin equals an existing-store pin.
  for (const d of reserved) {
    if (d.pin && storePins.has(d.pin)) v.push(`1: ${d.appId} holds pin ${d.pin}, which has an existing store.`);
  }

  // 2. No two reserved slots share a pin.
  const byPin = new Map<string, string[]>();
  for (const d of reserved) if (d.pin) byPin.set(d.pin, [...(byPin.get(d.pin) ?? []), d.appId]);
  for (const [pin, ids] of byPin) if (ids.length > 1) v.push(`2: pin ${pin} is held by ${ids.join(", ")}.`);

  // 3. Reserved slots per territory ≤ available slots.
  for (const t of result.territories) {
    const n = reserved.filter((d) => d.slotTerritoryId === t.id).length;
    if (n > t.slots) v.push(`3: ${t.id} has ${n} reserved slots but only ${t.slots} available.`);
  }

  // 4. Exactly one status, ≥ 1 reason code, a non-empty explanation (and next steps, G9.12).
  const counts = new Map<string, number>();
  for (const d of result.decisions) counts.set(d.appKey, (counts.get(d.appKey) ?? 0) + 1);
  for (const a of applications) {
    const n = counts.get(a.key) ?? 0;
    if (n !== 1) v.push(`4: ${a.id || a.key} has ${n} decisions.`);
  }
  for (const d of result.decisions) {
    if (!STATUSES.includes(d.status)) v.push(`4: ${d.appId} has an unknown status ${d.status}.`);
    if (d.reasonCodes.length === 0) v.push(`4: ${d.appId} has no reason code.`);
    if (!d.explanation.trim() || !d.headline.trim()) v.push(`4: ${d.appId} has no explanation.`);
    if (d.nextSteps.length === 0 || d.nextSteps.some((s) => !s.trim())) v.push(`4: ${d.appId} has no next steps.`);
  }

  // 5. Pins held only by reserved statuses, exactly one each.
  for (const d of result.decisions) {
    const isReserved = RESERVED_STATUSES.includes(d.status);
    if (isReserved && !d.pin) v.push(`5: ${d.appId} is ${d.status} but holds no pin.`);
    if (!isReserved && d.pin) v.push(`5: ${d.appId} is ${d.status} but holds pin ${d.pin}.`);
  }

  // 7. One person holds at most one slot.
  const names = new Map(applications.map((a) => [a.key, personKey(a.name)]));
  const byPerson = new Map<string, string[]>();
  for (const d of reserved) {
    const p = names.get(d.appKey);
    if (p) byPerson.set(p, [...(byPerson.get(p) ?? []), d.appId]);
  }
  for (const [, ids] of byPerson) if (ids.length > 1) v.push(`7: one person holds ${ids.length} slots (${ids.join(", ")}).`);

  return v;
}

/** Stable JSON for comparing two runs (invariant 6). */
export function fingerprint(decisions: DecisionRecord[]): string {
  return JSON.stringify(decisions);
}

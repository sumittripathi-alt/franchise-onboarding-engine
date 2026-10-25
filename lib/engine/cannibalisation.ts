// Cannibalisation zones (SPEC §6.5). Distance is only used when both pins have reliable coordinates (G3.8).

import type { ExistingStore } from "@/data/existingStores";
import { isLocationReliable, reliableDistanceKm } from "@/lib/geo/pins";
import type { Tier } from "@/lib/policy/allowedValues";
import type { BrandProfile } from "@/lib/policy/types";
import type { CannibalisationInfo } from "@/lib/types";

export const UNCERTAIN_NOTE = "Location data for this pin is uncertain; only the same-pin rule was applied.";

const km = (x: number) => `${x.toFixed(1)} km`;

export function nearestStore(pin: string, stores: readonly ExistingStore[]): { id: string; pin: string; km: number } | null {
  let best: { id: string; pin: string; km: number } | null = null;
  for (const s of stores) {
    const d = reliableDistanceKm(pin, s.pin);
    if (d !== null && (!best || d < best.km || (d === best.km && s.id < best.id))) best = { id: s.id, pin: s.pin, km: d };
  }
  return best;
}

export function assessCannibalisation(
  pin: string,
  tier: Tier,
  profile: BrandProfile,
  stores: readonly ExistingStore[],
  otherReserved: { appId: string; pin: string }[],
): CannibalisationInfo {
  const radiusKm = profile.cannibalisationRadiusKm[tier];
  if (!isLocationReliable(pin)) {
    return { zone: "uncertain", radiusKm, nearestStore: null, nearbyReserved: [], note: UNCERTAIN_NOTE };
  }
  const store = nearestStore(pin, stores);
  const nearbyReserved = otherReserved
    .map((r) => ({ ...r, km: reliableDistanceKm(pin, r.pin) }))
    .filter((r): r is { appId: string; pin: string; km: number } => r.km !== null && r.km <= radiusKm)
    .sort((a, b) => a.km - b.km || (a.appId < b.appId ? -1 : 1));
  const storeInside = store !== null && store.km <= radiusKm;

  let note: string;
  if (storeInside || nearbyReserved.length) {
    const parts: string[] = [];
    if (storeInside) parts.push(`existing store ${store!.id} (pin ${store!.pin}) is ${km(store!.km)} away`);
    for (const r of nearbyReserved) parts.push(`${r.appId}'s location (pin ${r.pin}) is ${km(r.km)} away`);
    note = `Inside the ${radiusKm} km inner radius: ${parts.join("; ")}. Allowed, but needs expansion-head sign-off.`;
  } else {
    note = store
      ? `Clear: the nearest existing store, ${store.id}, is ${km(store.km)} away (inner radius ${radiusKm} km).`
      : `Clear: no existing store with a known location is within ${radiusKm} km.`;
  }
  return { zone: storeInside || nearbyReserved.length ? 2 : 3, radiusKm, nearestStore: store, nearbyReserved, note };
}

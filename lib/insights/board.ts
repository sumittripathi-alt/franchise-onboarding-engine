// Territory board (SPEC §10.1): each territory's pins by state, its winners, its waitlist and its white space.

import { EXISTING_STORES } from "@/data/existingStores";
import { getPin, type PinConfidence } from "@/lib/geo/pins";
import type { EngineResult } from "@/lib/engine/types";
import type { Status } from "@/lib/types";

export type PinState = "store" | "reserved" | "contested" | "free" | "unavailable";

export interface BoardPin {
  pin: string;
  state: PinState;
  /** What the state means for this pin, in words. */
  text: string;
  holder: { appId: string; status: Status; label: string } | null;
  /** Everyone whose own pin this is. */
  contenders: { appId: string; status: Status; label: string }[];
  confidence: PinConfidence | "unknown";
}

export interface BoardTerritory {
  id: string;
  city: string | null;
  tier: string | null;
  priority: string;
  slots: number;
  reserved: number;
  free: number;
  blocked: boolean;
  overCommitted: boolean;
  pins: BoardPin[];
  winners: { appId: string; name: string; pin: string; label: string }[];
  /** Applicants who wanted this territory and are on the city waitlist, in rank order. */
  waitlist: { appId: string; rank: number; label: string }[];
  /** Pins with no applicant in a territory that still has free slots: "recruit here". */
  whiteSpace: string[];
}

const idOrder = new Intl.Collator("en", { numeric: true });
const EXCLUDE_TEXT: Record<string, string> = {
  T02: "Listed in a higher-priority territory too",
  T03: "Not a pin of this territory's city",
  T06: "Existing store",
};

export function buildTerritoryBoard(result: EngineResult): BoardTerritory[] {
  const byPin = new Map<string, EngineResult["decisions"]>();
  for (const d of result.decisions) if (d.homePin) byPin.set(d.homePin, [...(byPin.get(d.homePin) ?? []), d]);
  const holderOf = new Map(result.decisions.filter((d) => d.pin).map((d) => [d.pin!, d]));
  const brief = (d: EngineResult["decisions"][number]) => ({ appId: d.appId, status: d.status, label: d.label });

  return result.territories.map((t) => {
    const pins: BoardPin[] = [];
    for (const pin of t.pins) {
      const holder = holderOf.get(pin) ?? null;
      const contenders = (byPin.get(pin) ?? []).map(brief).sort((a, b) => idOrder.compare(a.appId, b.appId));
      const confidence = getPin(pin)?.confidence ?? "unknown";
      let state: PinState = "free";
      let text = "Free";
      if (holder) {
        state = "reserved";
        text = `${holder.status === "REDIRECT" ? "Offered to" : "Held by"} ${holder.appId}`;
        if (contenders.length > 1) text += `; ${contenders.length} applicants wanted this pin`;
      } else if (contenders.length > 1) {
        state = "contested";
        text = `${contenders.length} applicants want this pin and none holds it`;
      } else if (contenders.length === 1) {
        text = `Wanted by ${contenders[0].appId}, not reserved`;
      }
      pins.push({ pin, state, text, holder: holder ? brief(holder) : null, contenders, confidence });
    }
    for (const e of t.excludedPins) {
      const store = e.code === "T06" ? EXISTING_STORES.find((s) => s.pin === e.pin) : undefined;
      pins.push({
        pin: e.pin,
        state: e.code === "T06" ? "store" : "unavailable",
        text: store ? `Existing store ${store.id}` : `${EXCLUDE_TEXT[e.code] ?? "Unavailable"}: ${e.note}`,
        holder: null,
        contenders: (byPin.get(e.pin) ?? []).map(brief),
        confidence: getPin(e.pin)?.confidence ?? "unknown",
      });
    }

    const winners = result.decisions
      .filter((d) => d.pin && d.slotTerritoryId === t.id)
      .sort((a, b) => idOrder.compare(a.appId, b.appId))
      .map((d) => ({ appId: d.appId, name: d.name, pin: d.pin!, label: d.label }));
    const waitlist = result.decisions
      .filter((d) => d.waitlist && d.territoryId === t.id)
      .sort((a, b) => a.waitlist!.rank - b.waitlist!.rank)
      .map((d) => ({ appId: d.appId, rank: d.waitlist!.rank, label: d.label }));

    return {
      id: t.id,
      city: t.city,
      tier: t.tier,
      priority: t.priority,
      slots: t.slots,
      reserved: t.reserved.length,
      free: Math.max(0, t.slots - t.reserved.length),
      blocked: t.blocked,
      overCommitted: t.overCommitted,
      pins,
      winners,
      waitlist,
      whiteSpace: t.whiteSpacePins,
    };
  });
}

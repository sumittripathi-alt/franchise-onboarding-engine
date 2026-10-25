// The map's data (SPEC §10.1, §15.8), built from the engine's own result. Every fact on the map is also produced here as
// a sentence, so nothing needs the map to be understood (G8.4): if the tiles never load, the page still says all of it.

import { CITY_CENTRES } from "@/lib/geo/cities";
import { getPin } from "@/lib/geo/pins";
import type { LatLng } from "@/lib/geo/distance";
import type { EngineResult } from "@/lib/engine/types";
import { EXISTING_STORES } from "@/data/existingStores";
import { CITIES, type CityName } from "@/lib/policy/allowedValues";
import type { BrandProfile } from "@/lib/policy/types";
import { STATUSES, type Status } from "@/lib/types";
import type { BoardTerritory, PinState } from "./board";

export interface MapPoint extends LatLng {
  /** Plotted at a rough place, not a reliable one: shown with a dashed marker. */
  approximate: boolean;
  /** Why it is approximate, in words. */
  why: string | null;
}

export interface MapStore {
  id: string;
  city: string;
  pin: string;
  point: MapPoint;
  /** Inner radius in km for this store's city tier. */
  radiusKm: number | null;
  text: string;
}

export interface MapApplicant {
  appKey: string;
  appId: string;
  name: string;
  status: Status;
  label: string;
  pin: string;
  point: MapPoint;
  /** Where a location offer is, for those offered another pin. */
  offered: { pin: string; point: MapPoint } | null;
  text: string;
}

export interface MapCompetition {
  a: string;
  b: string;
  from: MapPoint;
  to: MapPoint;
  relation: "pin" | "slot" | "offer";
  text: string;
}

export interface MapTerritoryPin {
  territoryId: string;
  pin: string;
  state: PinState;
  point: MapPoint;
  text: string;
}

export interface MapWhiteSpace {
  territoryId: string;
  pin: string;
  point: MapPoint;
  text: string;
}

export interface MapFacts {
  title: string;
  items: string[];
}

export interface MapModel {
  stores: MapStore[];
  applicants: MapApplicant[];
  competitions: MapCompetition[];
  territoryPins: MapTerritoryPin[];
  whiteSpace: MapWhiteSpace[];
  /** Pins plotted approximately, with the reason. */
  approximate: { pin: string; why: string }[];
  facts: MapFacts[];
}

const jitter = (pin: string): LatLng => {
  // A small, repeatable offset so several approximate pins in one city don't sit on top of each other.
  const n = Number(pin.slice(-3)) || 0;
  const angle = (n * 137.5 * Math.PI) / 180;
  const r = 0.004 + (n % 7) * 0.0022;
  return { lat: Math.sin(angle) * r, lng: Math.cos(angle) * r };
};

/** Where to draw a pin. Reliable pins are exact; low-confidence ones are drawn where we think they are, but flagged; unknown ones at the city centre. */
export function locate(pin: string, city: string | null): MapPoint | null {
  const rec = getPin(pin);
  const centre = (city ?? rec?.city) && CITY_CENTRES[(city ?? rec?.city) as CityName];
  if (rec && rec.lat !== null && rec.lng !== null) {
    if (rec.confidence === "high" || rec.confidence === "medium") return { lat: rec.lat, lng: rec.lng, approximate: false, why: null };
    return { lat: rec.lat, lng: rec.lng, approximate: true, why: `the location of pin ${pin} is only a rough estimate` };
  }
  if (centre) {
    const j = jitter(pin);
    return { lat: centre.lat + j.lat, lng: centre.lng + j.lng, approximate: true, why: `the location of pin ${pin} isn't known, so it is drawn near the centre of ${city ?? rec?.city}` };
  }
  return null;
}

const idOrder = new Intl.Collator("en", { numeric: true });
const where = (p: MapPoint) => (p.approximate ? " (location approximate)" : "");

export function buildMapModel(result: EngineResult, board: BoardTerritory[], profile: BrandProfile): MapModel {
  const approximate = new Map<string, string>();
  const note = (pin: string, p: MapPoint) => {
    if (p.approximate && p.why) approximate.set(pin, p.why);
  };

  const stores: MapStore[] = [];
  for (const s of EXISTING_STORES) {
    const point = locate(s.pin, s.city);
    if (!point) continue;
    const tier = CITIES[s.city as CityName]?.tier;
    const radiusKm = tier ? profile.cannibalisationRadiusKm[tier] : null;
    note(s.pin, point);
    stores.push({
      id: s.id,
      city: s.city,
      pin: s.pin,
      point,
      radiusKm,
      text: `${s.id}, existing store in ${s.city}, pin ${s.pin}.${radiusKm !== null && !point.approximate ? ` No new store within ${radiusKm} km.` : radiusKm !== null ? ` The ${radiusKm} km ring is only drawn from a rough position.` : ""}`,
    });
  }

  const applicants: MapApplicant[] = [];
  const pointOf = new Map<string, MapPoint>();
  for (const d of result.decisions) {
    if (!d.homePin) continue;
    const point = locate(d.homePin, d.city);
    if (!point) continue;
    note(d.homePin, point);
    pointOf.set(d.appId, point);
    const offerPin = d.status === "REDIRECT" && d.pin && d.pin !== d.homePin ? d.pin : null;
    const op = offerPin ? locate(offerPin, d.city) : null;
    if (offerPin && op) note(offerPin, op);
    applicants.push({
      appKey: d.appKey,
      appId: d.appId,
      name: d.name,
      status: d.status,
      label: d.label,
      pin: d.homePin,
      point,
      offered: offerPin && op ? { pin: offerPin, point: op } : null,
      text: `${d.appId} (${d.name}), ${d.label}, wants pin ${d.homePin}${where(point)}${offerPin ? `; offered pin ${offerPin}${op ? where(op) : ""}` : d.pin && d.status !== "REDIRECT" ? `; holds pin ${d.pin}` : ""}.`,
    });
  }

  const competitions: MapCompetition[] = [];
  const seen = new Set<string>();
  for (const d of result.decisions) {
    for (const c of d.competitors) {
      const [x, y] = [d.appId, c.appId].sort((p, q) => idOrder.compare(p, q));
      const k = `${x}|${y}|${c.relation}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const from = pointOf.get(x);
      const to = pointOf.get(y);
      if (!from || !to) continue;
      const what = c.relation === "pin" ? "the same pin" : c.relation === "offer" ? "the same location offer" : "the same territory slot";
      competitions.push({ a: x, b: y, from, to, relation: c.relation, text: `${x} and ${y} were competing for ${what}. ${d.appId === x ? c.won ? `${x} came out ahead` : `${y} came out ahead` : c.won ? `${y} came out ahead` : `${x} came out ahead`}: ${c.firstDifferingFactor}` });
    }
  }

  const territoryPins: MapTerritoryPin[] = [];
  const whiteSpace: MapWhiteSpace[] = [];
  for (const t of board) {
    for (const p of t.pins) {
      if (p.state === "store") continue; // drawn as stores
      const point = locate(p.pin, t.city);
      if (!point) continue;
      note(p.pin, point);
      territoryPins.push({ territoryId: t.id, pin: p.pin, state: p.state, point, text: `${t.id}, pin ${p.pin}: ${p.text}.${where(point)}` });
    }
    for (const pin of t.whiteSpace) {
      const point = locate(pin, t.city);
      if (!point) continue;
      note(pin, point);
      whiteSpace.push({ territoryId: t.id, pin, point, text: `${t.id}, pin ${pin}: no applicant wants it and the territory still has ${t.free} free slot${t.free === 1 ? "" : "s"}. Recruit here.${where(point)}` });
    }
  }

  const byStatus = STATUSES.map((s) => ({ s, items: applicants.filter((a) => a.status === s).sort((p, q) => idOrder.compare(p.appId, q.appId)) })).filter((x) => x.items.length);
  const facts: MapFacts[] = [
    { title: "Existing stores", items: stores.map((s) => s.text) },
    ...byStatus.map((g) => ({ title: `${result.decisions.find((d) => d.status === g.s)?.label ?? g.s} (${g.items.length})`, items: g.items.map((a) => a.text) })),
    { title: "Competing applicants", items: competitions.map((c) => c.text) },
    { title: "Recruit here (no applicant, free slots)", items: whiteSpace.map((w) => w.text) },
    { title: "Territory pins", items: territoryPins.map((t) => t.text) },
  ].filter((f) => f.items.length);

  return { stores, applicants, competitions, territoryPins, whiteSpace, approximate: [...approximate].map(([pin, why]) => ({ pin, why })), facts };
}

import raw from "@/data/karnataka_pincodes.json";
import { haversineKm, type LatLng } from "./distance";

export type PinConfidence = "high" | "medium" | "low" | "none";

export interface PinRecord {
  pin: string;
  city: string;
  tier: string;
  district: string;
  offices: string[];
  lat: number | null;
  lng: number | null;
  confidence: PinConfidence;
  source: string;
  note?: string;
  km_from_city_centre?: number;
}

const PINS = (raw as unknown as { pins: Record<string, PinRecord> }).pins;

export const PIN_DATA_META = (raw as unknown as { meta: { source: string; method: string; guardrail: string } }).meta;

export function getPin(pin: string): PinRecord | undefined {
  return PINS[pin];
}

export function allPins(): string[] {
  return Object.keys(PINS).sort();
}

/** Distance-based rules may only use pins with medium or high confidence (SPEC §6.5, G3.8). */
export function isLocationReliable(pin: string): boolean {
  const p = PINS[pin];
  return !!p && (p.confidence === "high" || p.confidence === "medium") && p.lat !== null && p.lng !== null;
}

export function pinLatLng(pin: string): LatLng | null {
  const p = PINS[pin];
  return p && p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng } : null;
}

/**
 * Distance between two pins, or null when either location is uncertain.
 * Callers must treat null as "only the same-pin rule applies".
 */
export function reliableDistanceKm(a: string, b: string): number | null {
  if (!isLocationReliable(a) || !isLocationReliable(b)) return null;
  return haversineKm(pinLatLng(a)!, pinLatLng(b)!);
}

// Allowed values from the template's "Allowed values" sheet (SPEC §3.1).

export const TIERS = ["Tier 1", "Tier 2", "Tier 3"] as const;
export type Tier = (typeof TIERS)[number];

export const CITY_NAMES = [
  "Bengaluru",
  "Mysuru",
  "Mangaluru",
  "Hubballi-Dharwad",
  "Belagavi",
  "Tumakuru",
  "Davanagere",
] as const;
export type CityName = (typeof CITY_NAMES)[number];

export interface CityInfo {
  name: CityName;
  prefix: string;
  tier: Tier;
}

export const CITIES: Record<CityName, CityInfo> = {
  Bengaluru: { name: "Bengaluru", prefix: "560", tier: "Tier 1" },
  Mysuru: { name: "Mysuru", prefix: "570", tier: "Tier 2" },
  Mangaluru: { name: "Mangaluru", prefix: "575", tier: "Tier 2" },
  "Hubballi-Dharwad": { name: "Hubballi-Dharwad", prefix: "580", tier: "Tier 2" },
  Belagavi: { name: "Belagavi", prefix: "590", tier: "Tier 2" },
  Tumakuru: { name: "Tumakuru", prefix: "572", tier: "Tier 3" },
  Davanagere: { name: "Davanagere", prefix: "577", tier: "Tier 3" },
};

export const STATE = "Karnataka" as const;

export const LANGUAGES = ["Kannada", "English", "Hindi"] as const;
export type Language = (typeof LANGUAGES)[number];

export const SPACE_AVAILABLE = ["Owned", "Rented", "Not yet identified"] as const;
export type SpaceAvailable = (typeof SPACE_AVAILABLE)[number];

export const FLOORS = ["Ground", "Upper", "Mall unit", "Not known"] as const;
export type Floor = (typeof FLOORS)[number];

export const PRIORITIES = ["High", "Medium", "Low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Lower number = higher priority. Used for ordering territories. */
export const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };

export function cityForPin(pin: string): CityInfo | undefined {
  const prefix = pin.slice(0, 3);
  return Object.values(CITIES).find((c) => c.prefix === prefix);
}

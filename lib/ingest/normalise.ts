// Value normalisation (SPEC §3.3). Every parser keeps the raw cell next to the parsed value.

import {
  CITY_NAMES,
  FLOORS,
  LANGUAGES,
  PRIORITIES,
  SPACE_AVAILABLE,
  TIERS,
  type CityName,
  type Floor,
  type Language,
  type Priority,
  type SpaceAvailable,
  type Tier,
} from "@/lib/policy/allowedValues";
import type { Parsed } from "@/lib/types";

export type Cell = string | number | boolean | null | undefined;

export function rawOf(x: Cell): string | number | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "boolean") return String(x);
  if (typeof x === "string") {
    const t = x.trim();
    return t === "" ? null : t;
  }
  return Number.isFinite(x) ? x : null;
}

export function isBlank(x: Cell): boolean {
  return rawOf(x) === null;
}

export function text(x: Cell): string {
  const r = rawOf(x);
  return r === null ? "" : String(r).replace(/\s+/g, " ").trim();
}

// ---------- Pins ----------

/** "570001.0", 570001, "570 001", "570-001" → "570001". Returns null value when not 6 digits. */
export function parsePin(x: Cell): Parsed<string> {
  const raw = rawOf(x);
  if (raw === null) return { value: null, raw };
  let s: string;
  if (typeof raw === "number") s = String(Math.round(raw));
  else {
    s = raw.trim().replace(/\.0+$/, "").replace(/(?<=\d)[\s\-–]+(?=\d)/g, "");
    if (/^\d+(\.\d+)?$/.test(s)) s = String(Math.round(Number(s)));
  }
  return { value: /^\d{6}$/.test(s) ? s : null, raw };
}

/** Territory "Pin codes covered": split on commas, semicolons, spaces or new lines. */
export function splitPins(x: Cell): { pins: string[]; invalid: string[] } {
  const raw = rawOf(x);
  if (raw === null) return { pins: [], invalid: [] };
  if (typeof raw === "number") {
    const p = parsePin(raw).value;
    return p ? { pins: [p], invalid: [] } : { pins: [], invalid: [String(raw)] };
  }
  // Join "570 001" style pins before splitting on spaces.
  const joined = raw.replace(/\b(\d{3})[\s-](\d{3})\b/g, "$1$2");
  const tokens = joined.split(/[,;\s\n\r\t|/]+/).filter(Boolean);
  const pins: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    const p = parsePin(t).value;
    if (p) {
      if (!pins.includes(p)) pins.push(p);
    } else invalid.push(t);
  }
  return { pins, invalid };
}

// ---------- Numbers ----------

function firstNumber(s: string): number | null {
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Plain numeric fields with optional units: "450 sq ft", "3 months", "4 yrs". */
export function parseNumber(x: Cell): Parsed<number> {
  const raw = rawOf(x);
  if (raw === null) return { value: null, raw };
  if (typeof raw === "number") return { value: raw, raw };
  return { value: firstNumber(raw), raw };
}

/**
 * Investment in ₹ lakh. Handles "25", "25 lakh", "₹25L", "25,00,000", "1.2 crore".
 * A bare figure over 10,000 is read as rupees and converted to lakh.
 */
export function parseLakh(x: Cell): Parsed<number> {
  const raw = rawOf(x);
  if (raw === null) return { value: null, raw };
  if (typeof raw === "number") return { value: raw > 10_000 ? raw / 100_000 : raw, raw };
  const s = raw.toLowerCase().replace(/₹|rs\.?|inr/g, "").trim();
  const n = firstNumber(s);
  if (n === null) return { value: null, raw };
  if (/\b(cr|crore|crores)\b/.test(s)) return { value: n * 100, raw };
  if (/(\d|\b)(l|lakh|lakhs|lac|lacs|lk)\b/.test(s)) return { value: n, raw };
  return { value: n > 10_000 ? n / 100_000 : n, raw };
}

// ---------- Enums ----------

/** Lowercase, keep letters and digits in any script, drop everything else. */
export function enumKey(s: string): string {
  return s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
}

function makeEnumParser<T extends string>(values: readonly T[], synonyms: Record<string, T>) {
  const table = new Map<string, T>();
  for (const v of values) table.set(enumKey(v), v);
  for (const [k, v] of Object.entries(synonyms)) table.set(enumKey(k), v);
  return (x: Cell): Parsed<T> => {
    const raw = rawOf(x);
    if (raw === null) return { value: null, raw };
    return { value: table.get(enumKey(String(raw))) ?? null, raw };
  };
}

export const parseCity = makeEnumParser<CityName>(CITY_NAMES, {
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  blr: "Bengaluru",
  "bengaluru urban": "Bengaluru",
  mysore: "Mysuru",
  mangalore: "Mangaluru",
  hubli: "Hubballi-Dharwad",
  hubballi: "Hubballi-Dharwad",
  dharwad: "Hubballi-Dharwad",
  "hubli-dharwad": "Hubballi-Dharwad",
  belgaum: "Belagavi",
  tumkur: "Tumakuru",
  davangere: "Davanagere",
});

export const parseState = makeEnumParser<"Karnataka">(["Karnataka"], { ka: "Karnataka" });

export const parseSpaceAvailable = makeEnumParser<SpaceAvailable>(SPACE_AVAILABLE, {
  own: "Owned",
  "self owned": "Owned",
  rent: "Rented",
  leased: "Rented",
  lease: "Rented",
  "not identified": "Not yet identified",
  "not yet": "Not yet identified",
  "yet to identify": "Not yet identified",
  searching: "Not yet identified",
  none: "Not yet identified",
  no: "Not yet identified",
});

export const parseFloor = makeEnumParser<Floor>(FLOORS, {
  "ground floor": "Ground",
  gf: "Ground",
  g: "Ground",
  upper: "Upper",
  "upper floor": "Upper",
  "first floor": "Upper",
  "1st floor": "Upper",
  "second floor": "Upper",
  "2nd floor": "Upper",
  mall: "Mall unit",
  "mall unit": "Mall unit",
  unknown: "Not known",
  "dont know": "Not known",
  "not sure": "Not known",
});

export const parseLanguage = makeEnumParser<Language>(LANGUAGES, {
  kn: "Kannada",
  ಕನ್ನಡ: "Kannada",
  en: "English",
  eng: "English",
  hi: "Hindi",
  हिंदी: "Hindi",
  हिन्दी: "Hindi",
});

export const parseTier = makeEnumParser<Tier>(TIERS, {
  "1": "Tier 1",
  "2": "Tier 2",
  "3": "Tier 3",
  t1: "Tier 1",
  t2: "Tier 2",
  t3: "Tier 3",
});

export const parsePriority = makeEnumParser<Priority>(PRIORITIES, {
  med: "Medium",
  hi: "High",
  lo: "Low",
});

/** Lowercased, single-spaced name used for the "same person" check (A06). */
export function personKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

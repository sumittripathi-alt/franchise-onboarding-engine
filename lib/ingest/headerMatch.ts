// Loose header matching (SPEC §3.2, G1.3, G1.4).

import type { Cell } from "./normalise";

export type AppField =
  | "id"
  | "name"
  | "city"
  | "state"
  | "pin"
  | "investment"
  | "experience"
  | "business"
  | "spaceAvailable"
  | "spaceSize"
  | "floor"
  | "targetLaunch"
  | "language"
  | "notes";

export type TerField = "id" | "city" | "state" | "pins" | "tier" | "openSlots" | "priority";

export type StoreField = "id" | "city" | "pin" | "opened";

/** Lowercase; strip ₹, brackets, ·, punctuation and extra spaces. */
export function normaliseHeader(h: Cell): string {
  if (h === null || h === undefined) return "";
  return String(h)
    .toLowerCase()
    .replace(/[₹()[\]{}·•:;,.?!'"`*#/\\|_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Each field maps from several normalised spellings. The first entry is the template header.
export const APP_SYNONYMS: Record<AppField, string[]> = {
  id: ["application id", "app id", "application", "application no", "application number", "id"],
  name: ["applicant name", "name", "applicant", "partner name", "full name"],
  city: ["city", "town", "location city"],
  state: ["state"],
  pin: ["pin code", "pincode", "pin", "postal code", "zip", "zip code"],
  investment: [
    "investment capacity lakh",
    "investment capacity",
    "investment lakh",
    "investment",
    "capital",
    "budget",
    "budget lakh",
  ],
  experience: [
    "retail experience years",
    "retail experience",
    "experience years",
    "experience",
    "years of experience",
  ],
  business: ["current past business", "current business", "past business", "business", "occupation"],
  spaceAvailable: ["space available", "space", "space status", "premises"],
  spaceSize: ["space size sq ft", "space size sqft", "space size", "size sq ft", "size", "area sq ft", "area"],
  floor: ["floor", "floor level"],
  targetLaunch: ["target launch months", "target launch", "launch months", "launch in months", "timeline months"],
  language: ["preferred language", "language"],
  notes: ["notes from applicant", "notes", "applicant notes", "comments", "remarks"],
};

export const TER_SYNONYMS: Record<TerField, string[]> = {
  id: ["territory id", "territory", "territory no", "id"],
  city: ["city", "town"],
  state: ["state"],
  pins: ["pin codes covered", "pin codes", "pincodes", "pins", "pins covered", "pin code"],
  tier: ["city tier", "tier"],
  openSlots: ["open slots", "slots", "available slots", "slots open"],
  priority: ["priority"],
};

export const STORE_SYNONYMS: Record<StoreField, string[]> = {
  id: ["store id", "store", "id"],
  city: ["city"],
  pin: ["pin code", "pincode", "pin"],
  opened: ["opened", "year opened", "opened year", "opening year", "year"],
};

export const APP_REQUIRED: AppField[] = ["id", "name", "city", "pin", "investment", "spaceAvailable"];
export const TER_REQUIRED: TerField[] = ["id", "city", "pins", "openSlots"];

/** Header signatures used to recognise a sheet (G1.3). */
export const APP_SIGNATURES = ["application id", "app id", "application no", "application number"];
export const TER_SIGNATURES = ["territory id", "territory no"];

export interface HeaderMap<F extends string> {
  columns: Partial<Record<F, number>>;
  extra: string[];
}

export function mapHeaders<F extends string>(headerRow: Cell[], synonyms: Record<F, string[]>): HeaderMap<F> {
  const columns: Partial<Record<F, number>> = {};
  const extra: string[] = [];
  const fields = Object.keys(synonyms) as F[];
  headerRow.forEach((cell, idx) => {
    const h = normaliseHeader(cell);
    if (!h) return;
    // Exact synonym first, then "header starts with synonym" for things like "Investment capacity (in ₹ lakh)".
    let match = fields.find((f) => columns[f] === undefined && synonyms[f].includes(h));
    if (!match) {
      match = fields.find(
        (f) => columns[f] === undefined && synonyms[f].some((s) => s.length > 3 && h.startsWith(s + " ")),
      );
    }
    if (match) columns[match] = idx;
    else extra.push(String(cell).trim());
  });
  return { columns, extra };
}

/**
 * Index (0-based) of the header row within the first 10 rows, or -1.
 * The row must contain a signature and map at least 3 known columns, so a field-guide sheet
 * that merely mentions "Application ID" in a cell is not mistaken for data.
 */
export function findHeaderRow<F extends string>(
  rows: Cell[][],
  signatures: string[],
  synonyms: Record<F, string[]>,
): number {
  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    if (!row.some((c) => signatures.includes(normaliseHeader(c)))) continue;
    if (Object.keys(mapHeaders(row, synonyms).columns).length >= 3) return i;
  }
  return -1;
}

/** Sheet-name match ignoring case and spaces. */
export function sheetNameKey(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, "");
}

// Applies fact patches on top of the parsed data (SPEC §6, §8.2). Values are re-parsed with the same
// normalisers as the upload, so a fact can never carry a value the template wouldn't accept.

import {
  parseCity,
  parseFloor,
  parseLakh,
  parseLanguage,
  parseNumber,
  parsePin,
  parseSpaceAvailable,
} from "@/lib/ingest/normalise";
import type { Application, Territory } from "@/lib/types";
import type { FactPatch } from "./types";

export function applyFacts(
  applications: Application[],
  territories: Territory[],
  facts: FactPatch[] = [],
): { applications: Application[]; territories: Territory[]; withdrawn: string[]; updated: Map<string, Set<string>> } {
  const apps = new Map(applications.map((a) => [a.key, { ...a }]));
  const ters = new Map(territories.map((t) => [t.key, { ...t }]));
  const withdrawn = new Set<string>();
  /** Application key → fields set by a fact (newer than the applicant's notes). */
  const updated = new Map<string, Set<string>>();

  for (const f of facts) {
    if (f.target === "territory") {
      const t = ters.get(f.key);
      if (!t) continue;
      if (f.field === "openSlots") t.openSlots = { value: f.value, raw: f.value };
      else t.priority = { value: f.value, raw: f.value };
      continue;
    }
    const a = apps.get(f.key);
    if (!a) continue;
    updated.set(f.key, (updated.get(f.key) ?? new Set()).add(f.field));
    switch (f.field) {
      case "withdrawn":
        withdrawn.add(f.key);
        break;
      case "spaceAvailable":
        a.spaceAvailable = parseSpaceAvailable(f.value);
        break;
      case "spaceSqft":
        a.spaceSqft = parseNumber(f.value);
        break;
      case "floor":
        a.floor = parseFloor(f.value);
        break;
      case "investmentLakh":
        a.investmentLakh = parseLakh(f.value);
        break;
      case "experienceYears":
        a.experienceYears = parseNumber(f.value);
        break;
      case "targetLaunchMonths":
        a.targetLaunchMonths = parseNumber(f.value);
        break;
      case "language":
        a.language = parseLanguage(f.value);
        break;
      case "city":
        a.city = parseCity(f.value);
        break;
      case "pin":
        a.pin = parsePin(f.value);
        break;
      case "notes":
        a.notes = [a.notes, String(f.value ?? "")].filter(Boolean).join(" ");
        break;
    }
  }

  return {
    applications: applications.filter((a) => !withdrawn.has(a.key)).map((a) => apps.get(a.key)!),
    territories: territories.map((t) => ters.get(t.key)!),
    withdrawn: [...withdrawn],
    updated,
  };
}

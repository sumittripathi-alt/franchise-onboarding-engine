// Filtering the application lists (decision sheet and applications table).

import type { DecisionRecord, Status } from "@/lib/types";

export interface DecisionFilters {
  query: string;
  status: Status | "all";
  territory: string;
  city: string;
  flag: string;
}

export function matchesFilters(d: DecisionRecord, f: DecisionFilters): boolean {
  if (f.status !== "all" && d.status !== f.status) return false;
  if (f.city !== "all" && d.city !== f.city) return false;
  if (f.territory !== "all" && d.territoryId !== f.territory && d.slotTerritoryId !== f.territory) return false;
  if (f.flag !== "all" && !d.flags.some((x) => x.code === f.flag) && !d.reasonCodes.includes(f.flag as never)) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = `${d.appId} ${d.name} ${d.city ?? ""} ${d.homePin ?? ""} ${d.pin ?? ""} ${d.label} ${d.headline}`.toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

export const isFiltered = (f: DecisionFilters): boolean =>
  f.query.trim() !== "" || f.status !== "all" || f.territory !== "all" || f.city !== "all" || f.flag !== "all";

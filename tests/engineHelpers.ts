import { defaultPolicy } from "@/lib/policy/brandProfiles";
import type { BrandProfileId } from "@/lib/policy/types";
import { runEngine, runEngineChecked } from "@/lib/engine/run";
import type { EngineInput, EngineResult } from "@/lib/engine/types";
import { parseOk, trickyFile } from "./helpers";

export const TODAY = "2026-10-25";

export function trickyInput(profile: BrandProfileId = "eyewear", extra: Partial<EngineInput> = {}): EngineInput {
  const r = parseOk([trickyFile()]);
  return { applications: r.applications, territories: r.territories, policy: defaultPolicy(profile), today: TODAY, ...extra };
}

export function trickyRun(profile: BrandProfileId = "eyewear", extra: Partial<EngineInput> = {}): EngineResult {
  return runEngineChecked(trickyInput(profile, extra));
}

export function decision(r: EngineResult, key: string) {
  const d = r.decisions.find((x) => x.appKey === key);
  if (!d) throw new Error(`No decision for ${key}`);
  return d;
}

export { runEngine };

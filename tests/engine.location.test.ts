// Location honesty (G3.8): a pin with uncertain coordinates always says so; a pin with reliable ones never claims to be uncertain.

import { describe, expect, it } from "vitest";
import { UNCERTAIN_NOTE } from "@/lib/engine/cannibalisation";
import { getPin, isLocationReliable } from "@/lib/geo/pins";
import type { BrandProfileId } from "@/lib/policy/types";
import { decision, trickyRun } from "./engineHelpers";

describe("location data is described honestly", () => {
  for (const profile of ["eyewear", "delivery", "partner_point"] as BrandProfileId[]) {
    it(`${profile}: every held or offered pin with uncertain coordinates says so, and reliable ones don't`, () => {
      const r = trickyRun(profile);
      for (const d of r.decisions) {
        if (!d.pin) continue;
        if (isLocationReliable(d.pin)) {
          expect(d.explanation, `${d.appId} ${d.pin}`).not.toContain(UNCERTAIN_NOTE);
          expect(d.flags.map((f) => f.code), d.appId).not.toContain("LOCATION_UNCERTAIN");
        } else {
          expect(d.explanation, `${d.appId} ${d.pin}`).toContain(UNCERTAIN_NOTE);
          expect(d.flags.map((f) => f.code), d.appId).toContain("LOCATION_UNCERTAIN");
        }
      }
    });
  }

  it("APP-034's offer is to a pin with reliable coordinates, so it gives real distances", () => {
    const d = decision(trickyRun(), "APP-034");
    expect(d.pin).toBe("570016");
    expect(getPin("570016")?.confidence).toBe("medium");
    expect(d.explanation).toContain("Pin 570016 is 4.6 km from pin 570009.");
    expect(d.explanation).toContain("existing store ST-07 (pin 570017) is 1.4 km away");
    expect(d.explanation).not.toContain("uncertain");
  });
});

import { describe, expect, it } from "vitest";
import { EXISTING_STORES, EXISTING_STORE_PINS } from "@/data/existingStores";
import { BRAND_PROFILES, defaultPolicy, paybackMonths } from "@/lib/policy/brandProfiles";
import { CITIES, TIERS, cityForPin } from "@/lib/policy/allowedValues";
import { haversineKm } from "@/lib/geo/distance";
import { PIN_DATA_META, getPin, isLocationReliable, reliableDistanceKm } from "@/lib/geo/pins";

describe("existing stores", () => {
  it("has ST-01 to ST-10 with unique pins", () => {
    expect(EXISTING_STORES.map((s) => s.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `ST-${String(i + 1).padStart(2, "0")}`),
    );
    expect(EXISTING_STORE_PINS.size).toBe(10);
  });

  it("every store pin matches its city prefix and has a reliable location", () => {
    for (const s of EXISTING_STORES) {
      expect(cityForPin(s.pin)?.name).toBe(s.city);
      expect(getPin(s.pin)?.city).toBe(s.city);
      expect(isLocationReliable(s.pin)).toBe(true);
    }
  });
});

describe("allowed values", () => {
  it("matches the city table in the pincode dataset", () => {
    const meta = (PIN_DATA_META as unknown as { cities: Record<string, { prefix: string; tier: string }> }).cities;
    for (const c of Object.values(CITIES)) {
      expect(meta[c.name]).toMatchObject({ prefix: c.prefix, tier: c.tier });
    }
  });
});

describe("brand profiles", () => {
  it("defines all three profiles with every tier filled", () => {
    expect(Object.keys(BRAND_PROFILES).sort()).toEqual(["delivery", "eyewear", "partner_point"]);
    for (const p of Object.values(BRAND_PROFILES)) {
      for (const t of TIERS) {
        expect(p.minInvestmentLakh[t]).toBeGreaterThan(0);
        expect(p.cannibalisationRadiusKm[t]).toBeGreaterThan(0);
        expect(p.monthlyRevenueLakh[t]).toBeGreaterThan(0);
      }
    }
  });

  it("uses the calibrated eyewear minimums (SPEC §5 after review)", () => {
    expect(BRAND_PROFILES.eyewear.minInvestmentLakh).toEqual({ "Tier 1": 30, "Tier 2": 20, "Tier 3": 15 });
  });

  it("encodes the spec's key differences", () => {
    expect(BRAND_PROFILES.eyewear.floorRules["Mall unit"].kind).toBe("ok");
    expect(BRAND_PROFILES.delivery.floorRules["Mall unit"].kind).toBe("condition");
    expect(BRAND_PROFILES.partner_point.floorRules.Upper.kind).toBe("reject");
    expect(BRAND_PROFILES.partner_point.noSpaceRule.kind).toBe("reject");
    expect(BRAND_PROFILES.partner_point.hardFloorPct).toBe(0.5);
  });

  it("defaultPolicy returns an independent copy", () => {
    const p = defaultPolicy();
    p.profile.minInvestmentLakh["Tier 1"] = 1;
    expect(BRAND_PROFILES.eyewear.minInvestmentLakh["Tier 1"]).toBe(30);
  });

  it("computes payback = investment / (revenue × margin)", () => {
    expect(paybackMonths(40, 8, 0.2)).toBe(25);
  });
});

describe("geo", () => {
  it("haversine gives a sensible Bengaluru–Mysuru distance", () => {
    const d = haversineKm({ lat: 12.9716, lng: 77.5946 }, { lat: 12.2958, lng: 76.6394 });
    expect(d).toBeGreaterThan(120);
    expect(d).toBeLessThan(135);
  });

  it("refuses distances for low or unknown confidence pins (G3.8)", () => {
    expect(getPin("560005")?.confidence).toBe("low");
    expect(reliableDistanceKm("560005", "560001")).toBeNull();
    expect(getPin("560007")?.confidence).toBe("none");
    expect(reliableDistanceKm("560007", "560001")).toBeNull();
    expect(reliableDistanceKm("560034", "560038")).toBeGreaterThan(0);
  });
});

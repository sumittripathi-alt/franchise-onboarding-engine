import type { CityName } from "@/lib/policy/allowedValues";
import type { LatLng } from "./distance";

/** The centre of each city, used where a pin's own location isn't known (SPEC §15.8). */
export const CITY_CENTRES: Record<CityName, LatLng> = {
  Bengaluru: { lat: 12.9716, lng: 77.5946 },
  Mysuru: { lat: 12.2958, lng: 76.6394 },
  Mangaluru: { lat: 12.9141, lng: 74.856 },
  "Hubballi-Dharwad": { lat: 15.3647, lng: 75.124 },
  Belagavi: { lat: 15.8497, lng: 74.4977 },
  Tumakuru: { lat: 13.3379, lng: 77.1173 },
  Davanagere: { lat: 14.4644, lng: 75.9218 },
};

/** Karnataka as a whole, for a map that spans several cities. */
export const KARNATAKA_VIEW = { lat: 14.6, lng: 76.0, zoom: 6 };

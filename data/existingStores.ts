import type { CityName } from "@/lib/policy/allowedValues";

// Sheet 3 ("Existing stores") is fixed for this case, so it is hard-coded (SPEC §3.1).
// If an uploaded workbook's Existing stores sheet differs, this list wins and a warning is shown.

export interface ExistingStore {
  id: string;
  city: CityName;
  pin: string;
  openedYear: number;
}

export const EXISTING_STORES: readonly ExistingStore[] = [
  { id: "ST-01", city: "Bengaluru", pin: "560001", openedYear: 2019 },
  { id: "ST-02", city: "Bengaluru", pin: "560034", openedYear: 2020 },
  { id: "ST-03", city: "Bengaluru", pin: "560038", openedYear: 2021 },
  { id: "ST-04", city: "Bengaluru", pin: "560066", openedYear: 2022 },
  { id: "ST-05", city: "Bengaluru", pin: "560076", openedYear: 2023 },
  { id: "ST-06", city: "Mysuru", pin: "570009", openedYear: 2021 },
  { id: "ST-07", city: "Mysuru", pin: "570017", openedYear: 2024 },
  { id: "ST-08", city: "Mangaluru", pin: "575001", openedYear: 2022 },
  { id: "ST-09", city: "Hubballi-Dharwad", pin: "580020", openedYear: 2023 },
  { id: "ST-10", city: "Belagavi", pin: "590001", openedYear: 2024 },
];

export const EXISTING_STORE_PINS: ReadonlySet<string> = new Set(EXISTING_STORES.map((s) => s.pin));

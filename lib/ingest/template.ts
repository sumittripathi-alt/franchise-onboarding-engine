// The real template's layout (SPEC §3.1). Used to detect the grey example row and to build
// the blank template and the test fixtures.

export const APPLICATION_HEADERS = [
  "Application ID",
  "Applicant name",
  "City",
  "State",
  "Pin code",
  "Investment capacity (₹ lakh)",
  "Retail experience (years)",
  "Current / past business",
  "Space available",
  "Space size (sq ft)",
  "Floor",
  "Target launch (months)",
  "Preferred language",
  "Notes from applicant",
] as const;

export const TERRITORY_HEADERS = [
  "Territory ID",
  "City",
  "State",
  "Pin codes covered",
  "City tier",
  "Open slots",
  "Priority",
] as const;

export const EXISTING_STORE_HEADERS = ["Store ID", "City", "Pin code", "Opened"] as const;

export const APPLICATION_BANNER =
  "Applications — one row per record. Row 3 is an example (grey); enter data from row 4.";
export const TERRITORY_BANNER =
  "Territories — one row per record. Row 3 is an example (grey); enter data from row 4.";

export const APPLICATION_EXAMPLE_ROW = [
  "APP-001",
  "Ravi Kumar",
  "Mysuru",
  "Karnataka",
  570001,
  25,
  4,
  "Runs a footwear store",
  "Rented",
  450,
  "Ground",
  3,
  "Kannada",
  "Wants to open before Diwali",
] as const;

export const TERRITORY_EXAMPLE_ROW = [
  "TER-01",
  "Mysuru",
  "Karnataka",
  "570001, 570002, 570008",
  "Tier 2",
  3,
  "High",
] as const;

export const TEMPLATE_SHEET_NAMES = [
  "Applications",
  "Territories",
  "Existing stores",
  "Allowed values",
  "Field guide",
  "Glossary",
] as const;

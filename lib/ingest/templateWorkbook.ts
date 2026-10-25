// Builds workbooks in the real template layout: banner in row 1, headers in row 2,
// the grey example in row 3, data from row 4, plus the reference sheets.

import * as XLSX from "xlsx";
import { EXISTING_STORES } from "@/data/existingStores";
import { CITIES, FLOORS, LANGUAGES, PRIORITIES, SPACE_AVAILABLE } from "@/lib/policy/allowedValues";
import {
  APPLICATION_BANNER,
  APPLICATION_EXAMPLE_ROW,
  APPLICATION_HEADERS,
  EXISTING_STORE_HEADERS,
  TERRITORY_BANNER,
  TERRITORY_EXAMPLE_ROW,
  TERRITORY_HEADERS,
} from "./template";

export type Row = (string | number | null)[];

export interface TemplateContent {
  applications: Row[];
  territories: Row[];
  /** Override the Existing stores sheet (for tests of G1.10). */
  existingStores?: Row[];
  /** Pad the data sheets with empty rows down to this Excel row (validation range in the template). */
  padToRow?: number;
}

function dataSheet(banner: string, headers: readonly string[], example: readonly (string | number)[], rows: Row[], padToRow?: number) {
  const aoa: Row[] = [[banner], [...headers], [...example], ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  if (padToRow && padToRow > aoa.length) {
    // Empty-string cells mimic rows that carry formatting/validation but no data.
    XLSX.utils.sheet_add_aoa(ws, [[""]], { origin: { r: padToRow - 1, c: headers.length - 1 } });
  }
  return ws;
}

export function buildTemplateWorkbook(content: TemplateContent): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    dataSheet(APPLICATION_BANNER, APPLICATION_HEADERS, APPLICATION_EXAMPLE_ROW, content.applications, content.padToRow),
    "Applications",
  );
  XLSX.utils.book_append_sheet(
    wb,
    dataSheet(TERRITORY_BANNER, TERRITORY_HEADERS, TERRITORY_EXAMPLE_ROW, content.territories, content.padToRow),
    "Territories",
  );

  const stores: Row[] = content.existingStores ?? EXISTING_STORES.map((s) => [s.id, s.city, Number(s.pin), s.openedYear]);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Existing stores — fixed reference list."], [...EXISTING_STORE_HEADERS], ...stores]),
    "Existing stores",
  );

  const cities = Object.values(CITIES);
  const allowedLen = Math.max(cities.length, LANGUAGES.length, SPACE_AVAILABLE.length, FLOORS.length, PRIORITIES.length);
  const allowed: Row[] = [["City", "Pin prefix", "Tier", "State", "Language", "Space available", "Floor", "Priority"]];
  for (let i = 0; i < allowedLen; i++) {
    allowed.push([
      cities[i]?.name ?? null,
      cities[i] ? cities[i].prefix : null,
      cities[i]?.tier ?? null,
      i === 0 ? "Karnataka" : null,
      LANGUAGES[i] ?? null,
      SPACE_AVAILABLE[i] ?? null,
      FLOORS[i] ?? null,
      PRIORITIES[i] ?? null,
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(allowed), "Allowed values");

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Field", "What to enter"],
      ["Application ID", "Unique ID, e.g. APP-002"],
      ["Pin code", "6-digit pin of the proposed store"],
      ["Investment capacity (₹ lakh)", "Amount in lakh, e.g. 25 for ₹25,00,000"],
      ["Space available", "Owned, Rented or Not yet identified"],
      ["Floor", "Ground, Upper, Mall unit or Not known"],
      ["Territory ID", "Unique ID, e.g. TER-02"],
      ["Pin codes covered", "Comma-separated pins"],
    ]),
    "Field guide",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Term", "Meaning"],
      ["Territory", "A group of pin codes with a number of open franchise slots"],
      ["Open slots", "How many new partners the territory can take now"],
      ["Tier", "City tier used for investment and revenue assumptions"],
    ]),
    "Glossary",
  );
  return wb;
}

export function workbookBytes(wb: XLSX.WorkBook, bookType: "xlsx" | "xls" = "xlsx"): Uint8Array {
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer);
}

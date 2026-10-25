// Workbook parsing (SPEC §3.2, G1). Runs in the browser; no file ever leaves the judge's machine.

import * as XLSX from "xlsx";
import { EXISTING_STORES } from "@/data/existingStores";
import type { Application, Territory } from "@/lib/types";
import {
  APP_REQUIRED,
  APP_SIGNATURES,
  APP_SYNONYMS,
  STORE_SYNONYMS,
  TER_REQUIRED,
  TER_SIGNATURES,
  TER_SYNONYMS,
  findHeaderRow,
  mapHeaders,
  sheetNameKey,
  type AppField,
  type HeaderMap,
  type TerField,
} from "./headerMatch";
import {
  isBlank,
  parseCity,
  parseFloor,
  parseLakh,
  parseLanguage,
  parseNumber,
  parsePin,
  parsePriority,
  parseSpaceAvailable,
  parseState,
  parseTier,
  rawOf,
  splitPins,
  text,
  type Cell,
} from "./normalise";
import { ApplicationSchema, TerritorySchema } from "./schemas";
import {
  APPLICATION_EXAMPLE_ROW,
  APPLICATION_HEADERS,
  TERRITORY_EXAMPLE_ROW,
  TERRITORY_HEADERS,
} from "./template";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_APPLICATION_ROWS = 2000;
const ACCEPTED_EXTENSIONS = ["xlsx", "xls", "csv"];

export interface UploadFile {
  name: string;
  size: number;
  data: ArrayBuffer | Uint8Array;
}

export interface ParseOptions {
  includeExampleRow?: boolean;
}

export interface ExampleRowInfo {
  sheet: "Applications" | "Territories";
  row: number;
  skipped: boolean;
}

export interface ParseReport {
  files: string[];
  applicationsSheet: string;
  territoriesSheet: string;
  applicationRowsRead: number;
  territoryRowsRead: number;
  emptyRowsIgnored: number;
  exampleRows: ExampleRowInfo[];
  extraColumns: { sheet: string; columns: string[] }[];
  warnings: string[];
}

export type ParseResult =
  | { ok: true; applications: Application[]; territories: Territory[]; report: ParseReport }
  | { ok: false; errors: string[] };

interface SheetData {
  file: string;
  name: string;
  rows: Cell[][];
  /** Excel row number (1-based) of rows[0]. */
  firstRow: number;
}

const APP_LABELS: Record<AppField, string> = {
  id: APPLICATION_HEADERS[0],
  name: APPLICATION_HEADERS[1],
  city: APPLICATION_HEADERS[2],
  state: APPLICATION_HEADERS[3],
  pin: APPLICATION_HEADERS[4],
  investment: APPLICATION_HEADERS[5],
  experience: APPLICATION_HEADERS[6],
  business: APPLICATION_HEADERS[7],
  spaceAvailable: APPLICATION_HEADERS[8],
  spaceSize: APPLICATION_HEADERS[9],
  floor: APPLICATION_HEADERS[10],
  targetLaunch: APPLICATION_HEADERS[11],
  language: APPLICATION_HEADERS[12],
  notes: APPLICATION_HEADERS[13],
};

const TER_LABELS: Record<TerField, string> = {
  id: TERRITORY_HEADERS[0],
  city: TERRITORY_HEADERS[1],
  state: TERRITORY_HEADERS[2],
  pins: TERRITORY_HEADERS[3],
  tier: TERRITORY_HEADERS[4],
  openSlots: TERRITORY_HEADERS[5],
  priority: TERRITORY_HEADERS[6],
};

function extension(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

const ZIP_MAGIC = [0x50, 0x4b];
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];
const startsWith = (b: Uint8Array, magic: number[]) => magic.every((m, i) => b[i] === m);

/** Read one file into sheets, or return a friendly error (G1.1, G1.11). */
function readFile(file: UploadFile): { sheets: SheetData[] } | { error: string } {
  const ext = extension(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return {
      error: `"${file.name}" isn't a supported file type. Upload an Excel workbook (.xlsx or .xls) or CSV files.`,
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return { error: `"${file.name}" is ${mb} MB. The limit is 5 MB per file.` };
  }
  const bytes = toBytes(file.data);
  if (bytes.length === 0) return { error: `"${file.name}" is empty.` };

  const corrupt = `"${file.name}" couldn't be read. It may be corrupt or not a real Excel file. Open it in Excel, save it again as .xlsx, and re-upload.`;
  const locked = `"${file.name}" is password-protected. Remove the password in Excel (File → Info → Protect Workbook) and upload again.`;

  // An encrypted .xlsx is stored as a compound file rather than a zip.
  if (ext === "xlsx" && !startsWith(bytes, ZIP_MAGIC)) return { error: startsWith(bytes, CFB_MAGIC) ? locked : corrupt };

  let wb: XLSX.WorkBook;
  try {
    wb =
      ext === "csv"
        ? XLSX.read(new TextDecoder("utf-8").decode(bytes), { type: "string", raw: false })
        : XLSX.read(bytes, { type: "array" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: /password|encrypt/i.test(msg) ? locked : corrupt };
  }

  const sheets: SheetData[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws?.["!ref"];
    if (!ws || !ref) return { file: file.name, name, rows: [], firstRow: 1 };
    const range = XLSX.utils.decode_range(ref);
    const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    return { file: file.name, name: ext === "csv" ? file.name : name, rows, firstRow: range.s.r + 1 };
  });
  return { sheets };
}

function findSheet<F extends string>(
  sheets: SheetData[],
  nameKey: string,
  signatures: string[],
  synonyms: Record<F, string[]>,
): { sheet: SheetData; headerIdx: number } | null {
  const byName = sheets.find((s) => sheetNameKey(s.name) === nameKey);
  if (byName) {
    const idx = findHeaderRow(byName.rows, signatures, synonyms);
    if (idx >= 0) return { sheet: byName, headerIdx: idx };
  }
  for (const s of sheets) {
    if (s === byName) continue;
    const idx = findHeaderRow(s.rows, signatures, synonyms);
    if (idx >= 0) return { sheet: s, headerIdx: idx };
  }
  return null;
}

function cellOf<F extends string>(row: Cell[], map: HeaderMap<F>, f: F): Cell {
  const i = map.columns[f];
  return i === undefined ? null : row[i];
}

function isEmptyRow(row: Cell[] | undefined): boolean {
  return !row || row.every(isBlank);
}

/** Canonical form for comparing a row with the template's example row. */
function canon(x: Cell): string {
  const r = rawOf(x);
  if (r === null) return "";
  if (typeof r === "number") return String(r);
  const asNum = Number(r.replace(/,/g, ""));
  if (r !== "" && Number.isFinite(asNum)) return String(asNum);
  return r.toLowerCase().replace(/\s+/g, " ").replace(/\s*,\s*/g, ",");
}

function matchesExample<F extends string>(
  row: Cell[],
  map: HeaderMap<F>,
  fieldsInTemplateOrder: F[],
  example: readonly (string | number)[],
): boolean {
  return fieldsInTemplateOrder.every((f, i) => canon(cellOf(row, map, f)) === canon(example[i]));
}

interface DataRow {
  row: Cell[];
  excelRow: number;
}

function dataRows(sheet: SheetData, headerIdx: number): { rows: DataRow[]; empty: number } {
  const rows: DataRow[] = [];
  let empty = 0;
  for (let i = headerIdx + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    if (isEmptyRow(r)) {
      empty++;
      continue;
    }
    rows.push({ row: r, excelRow: sheet.firstRow + i });
  }
  return { rows, empty };
}

function assignKeys<T extends { id: string; row: number }>(items: T[]): (T & { key: string })[] {
  const counts = new Map<string, number>();
  for (const it of items) if (it.id) counts.set(it.id, (counts.get(it.id) ?? 0) + 1);
  return items.map((it) => ({
    ...it,
    key: !it.id ? `row${it.row}` : (counts.get(it.id) ?? 0) > 1 ? `${it.id}@row${it.row}` : it.id,
  }));
}

const APP_ORDER: AppField[] = [
  "id",
  "name",
  "city",
  "state",
  "pin",
  "investment",
  "experience",
  "business",
  "spaceAvailable",
  "spaceSize",
  "floor",
  "targetLaunch",
  "language",
  "notes",
];
const TER_ORDER: TerField[] = ["id", "city", "state", "pins", "tier", "openSlots", "priority"];

function buildApplication(r: DataRow, map: HeaderMap<AppField>): Omit<Application, "key"> {
  const c = (f: AppField) => cellOf(r.row, map, f);
  return {
    id: text(c("id")).toUpperCase(),
    row: r.excelRow,
    name: text(c("name")),
    city: parseCity(c("city")),
    state: parseState(c("state")),
    pin: parsePin(c("pin")),
    investmentLakh: parseLakh(c("investment")),
    experienceYears: parseNumber(c("experience")),
    business: text(c("business")),
    spaceAvailable: parseSpaceAvailable(c("spaceAvailable")),
    spaceSqft: parseNumber(c("spaceSize")),
    floor: parseFloor(c("floor")),
    targetLaunchMonths: parseNumber(c("targetLaunch")),
    language: parseLanguage(c("language")),
    notes: text(c("notes")),
  };
}

function buildTerritory(r: DataRow, map: HeaderMap<TerField>): Omit<Territory, "key"> {
  const c = (f: TerField) => cellOf(r.row, map, f);
  const { pins, invalid } = splitPins(c("pins"));
  return {
    id: text(c("id")).toUpperCase(),
    row: r.excelRow,
    city: parseCity(c("city")),
    state: parseState(c("state")),
    pins,
    invalidPins: invalid,
    pinsRaw: text(c("pins")),
    tier: parseTier(c("tier")),
    openSlots: parseNumber(c("openSlots")),
    priority: parsePriority(c("priority")),
  };
}

function compareExistingStores(sheet: SheetData): string | null {
  const idx = findHeaderRow(sheet.rows, ["store id"], STORE_SYNONYMS);
  if (idx < 0) return null;
  const map = mapHeaders(sheet.rows[idx], STORE_SYNONYMS);
  const uploaded = new Set<string>();
  for (const { row } of dataRows(sheet, idx).rows) {
    const id = text(cellOf(row, map, "id")).toUpperCase();
    const pin = parsePin(cellOf(row, map, "pin")).value ?? text(cellOf(row, map, "pin"));
    if (id) uploaded.add(`${id} ${pin}`);
  }
  const fixed = new Set(EXISTING_STORES.map((s) => `${s.id} ${s.pin}`));
  const missing = [...fixed].filter((s) => !uploaded.has(s));
  const added = [...uploaded].filter((s) => !fixed.has(s));
  if (missing.length === 0 && added.length === 0) return null;
  const parts: string[] = [];
  if (missing.length) parts.push(`not in your sheet: ${missing.join(", ")}`);
  if (added.length) parts.push(`only in your sheet: ${added.join(", ")}`);
  return `Your "Existing stores" sheet differs from the fixed store list (${parts.join("; ")}). The fixed list ST-01 to ST-10 was used.`;
}

/** Never throws: any unexpected failure becomes a readable error. */
export function parseWorkbooks(files: UploadFile[], options: ParseOptions = {}): ParseResult {
  try {
    return parseWorkbooksUnsafe(files, options);
  } catch {
    return {
      ok: false,
      errors: ["Something in this file couldn't be read. Check it matches the template, or try \"Try with sample data\"."],
    };
  }
}

function parseWorkbooksUnsafe(files: UploadFile[], options: ParseOptions): ParseResult {
  if (files.length === 0) return { ok: false, errors: ["No file selected."] };

  const errors: string[] = [];
  const sheets: SheetData[] = [];
  for (const f of files) {
    const res = readFile(f);
    if ("error" in res) errors.push(res.error);
    else sheets.push(...res.sheets);
  }
  if (errors.length) return { ok: false, errors };

  const appFound = findSheet(sheets, "applications", APP_SIGNATURES, APP_SYNONYMS);
  const terFound = findSheet(sheets, "territories", TER_SIGNATURES, TER_SYNONYMS);
  if (!appFound) {
    errors.push(
      'No Applications sheet found. Add a sheet named "Applications" whose header row includes "Application ID" (row 2 in the template).',
    );
  }
  if (!terFound) {
    errors.push(
      'No Territories sheet found. Add a sheet named "Territories" whose header row includes "Territory ID" (row 2 in the template), or upload it as a separate file.',
    );
  }
  if (!appFound || !terFound) return { ok: false, errors };

  const appMap = mapHeaders(appFound.sheet.rows[appFound.headerIdx], APP_SYNONYMS);
  const terMap = mapHeaders(terFound.sheet.rows[terFound.headerIdx], TER_SYNONYMS);

  const missingApp = APP_REQUIRED.filter((f) => appMap.columns[f] === undefined).map((f) => APP_LABELS[f]);
  const missingTer = TER_REQUIRED.filter((f) => terMap.columns[f] === undefined).map((f) => TER_LABELS[f]);
  if (missingApp.length) {
    errors.push(
      `The Applications sheet is missing required column(s): ${missingApp.join(", ")}. Check the header row (row ${appFound.sheet.firstRow + appFound.headerIdx}).`,
    );
  }
  if (missingTer.length) {
    errors.push(
      `The Territories sheet is missing required column(s): ${missingTer.join(", ")}. Check the header row (row ${terFound.sheet.firstRow + terFound.headerIdx}).`,
    );
  }
  if (errors.length) return { ok: false, errors };

  const appData = dataRows(appFound.sheet, appFound.headerIdx);
  const terData = dataRows(terFound.sheet, terFound.headerIdx);

  const exampleRows: ExampleRowInfo[] = [];
  const includeExample = options.includeExampleRow ?? false;
  if (appData.rows[0] && matchesExample(appData.rows[0].row, appMap, APP_ORDER, APPLICATION_EXAMPLE_ROW)) {
    exampleRows.push({ sheet: "Applications", row: appData.rows[0].excelRow, skipped: !includeExample });
    if (!includeExample) appData.rows.shift();
  }
  if (terData.rows[0] && matchesExample(terData.rows[0].row, terMap, TER_ORDER, TERRITORY_EXAMPLE_ROW)) {
    exampleRows.push({ sheet: "Territories", row: terData.rows[0].excelRow, skipped: !includeExample });
    if (!includeExample) terData.rows.shift();
  }

  if (appData.rows.length > MAX_APPLICATION_ROWS) {
    return {
      ok: false,
      errors: [
        `The Applications sheet has ${appData.rows.length.toLocaleString("en-IN")} rows; the limit is ${MAX_APPLICATION_ROWS.toLocaleString("en-IN")}. Split the file and upload again.`,
      ],
    };
  }

  if (appData.rows.length === 0) {
    return {
      ok: false,
      errors: ["No applications found. Enter applications from row 4 of the Applications sheet, then upload again."],
    };
  }

  const applications = assignKeys(appData.rows.map((r) => buildApplication(r, appMap))).map((a) =>
    ApplicationSchema.parse(a),
  );
  const territories = assignKeys(terData.rows.map((r) => buildTerritory(r, terMap))).map((t) =>
    TerritorySchema.parse(t),
  );

  const warnings: string[] = [];
  if (territories.length === 0) {
    warnings.push("The Territories sheet has no rows, so every application is outside the current plan.");
  }
  const storesSheet = sheets.find((s) => sheetNameKey(s.name) === "existingstores");
  if (storesSheet) {
    const w = compareExistingStores(storesSheet);
    if (w) warnings.push(w);
  }

  const extraColumns: ParseReport["extraColumns"] = [];
  if (appMap.extra.length) extraColumns.push({ sheet: appFound.sheet.name, columns: appMap.extra });
  if (terMap.extra.length) extraColumns.push({ sheet: terFound.sheet.name, columns: terMap.extra });
  for (const e of extraColumns) {
    warnings.push(`Ignored extra column(s) in "${e.sheet}": ${e.columns.join(", ")}.`);
  }

  return {
    ok: true,
    applications,
    territories,
    report: {
      files: files.map((f) => f.name),
      applicationsSheet: appFound.sheet.name,
      territoriesSheet: terFound.sheet.name,
      applicationRowsRead: applications.length,
      territoryRowsRead: territories.length,
      emptyRowsIgnored: appData.empty + terData.empty,
      exampleRows,
      extraColumns,
      warnings,
    },
  };
}

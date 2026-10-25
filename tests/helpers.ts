import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { parseWorkbooks, type ParseOptions, type UploadFile } from "@/lib/ingest/parseWorkbook";
import { buildTemplateWorkbook, workbookBytes, type Row, type TemplateContent } from "@/lib/ingest/templateWorkbook";

export function fileFrom(name: string, bytes: Uint8Array): UploadFile {
  return { name, size: bytes.length, data: bytes };
}

export function templateFile(content: TemplateContent, name = "upload.xlsx"): UploadFile {
  return fileFrom(name, workbookBytes(buildTemplateWorkbook(content)));
}

/** A workbook from raw sheets: { sheetName: rows }. */
export function rawWorkbookFile(sheets: Record<string, Row[]>, name = "raw.xlsx"): UploadFile {
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  return fileFrom(name, workbookBytes(wb));
}

export function csvFile(name: string, rows: Row[]): UploadFile {
  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(rows));
  return fileFrom(name, new TextEncoder().encode(csv));
}

export function trickyFile(): UploadFile {
  const bytes = new Uint8Array(readFileSync(join(__dirname, "fixtures", "tricky.xlsx")));
  return fileFrom("tricky.xlsx", bytes);
}

export function parseOk(files: UploadFile[], options?: ParseOptions) {
  const r = parseWorkbooks(files, options);
  if (!r.ok) throw new Error(`Expected parse to succeed: ${r.errors.join(" | ")}`);
  return r;
}

export function parseErrors(files: UploadFile[], options?: ParseOptions): string[] {
  const r = parseWorkbooks(files, options);
  if (r.ok) throw new Error("Expected parse to fail");
  return r.errors;
}

/** A valid application row in template column order, with overrides by index. */
export function appRow(id: string, overrides: Partial<Record<number, string | number | null>> = {}): Row {
  const base: Row = [id, `Person ${id}`, "Bengaluru", "Karnataka", 560041, 50, 4, "Apparel retail", "Rented", 500, "Ground", 4, "Kannada", ""];
  for (const [i, v] of Object.entries(overrides)) base[Number(i)] = v ?? null;
  return base;
}

export const TER_ROW: Row = ["TER-01", "Bengaluru", "Karnataka", "560041, 560068", "Tier 1", 1, "High"];

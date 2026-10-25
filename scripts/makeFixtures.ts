// Generates the tricky fixture, the sample workbook and the blank template.
// Run with: npm run fixtures

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildTemplateWorkbook, workbookBytes } from "@/lib/ingest/templateWorkbook";
import { TRICKY_APPLICATIONS, TRICKY_TERRITORIES } from "@/tests/fixtures/trickyData";

const root = join(dirname(new URL(import.meta.url).pathname), "..");

function write(rel: string, bytes: Uint8Array) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  console.log(`wrote ${rel} (${bytes.length} bytes)`);
}

// Pad to row 500, like the real template's validation range.
const tricky = workbookBytes(
  buildTemplateWorkbook({ applications: TRICKY_APPLICATIONS, territories: TRICKY_TERRITORIES, padToRow: 500 }),
);
write("tests/fixtures/tricky.xlsx", tricky);
write("data/sampleWorkbook.xlsx", tricky);
// Served to the browser for "Try with sample data" and "Download blank template".
write("public/data/sampleWorkbook.xlsx", tricky);
write("public/data/template.xlsx", workbookBytes(buildTemplateWorkbook({ applications: [], territories: [], padToRow: 500 })));

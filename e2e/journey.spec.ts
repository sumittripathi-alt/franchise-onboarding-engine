// The judge's journey, end to end, on a real deployment: upload the sample, open decisions, ask, change a fact,
// switch brand type, export, and open the same workspace from a second browser. Desktop and 375 px.

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";
import { ask, noHorizontalScroll, noteWorkspace, openTab, startSample } from "./helpers";

test("the full judge journey", async ({ page, browser }, info) => {
  const mobile = info.project.name === "mobile";
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Landing: no login, the privacy wording is there.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("anyone with the link can view and change it")).toBeVisible();
  await expect(page.getByText(/Google Gemini/)).toBeVisible();
  expect(page.url()).not.toMatch(/vercel\.com\/login|sso/);

  // Upload the sample; the data check comes first, then the decisions.
  const id = await startSample(page);
  await expect(page.getByRole("button", { name: /Open the decision for APP-001/ }).first()).toBeVisible();
  const rows = await page.getByRole("button", { name: /Open the decision for/ }).count();
  expect(rows).toBeGreaterThanOrEqual(38);

  // Open three decisions: each has an explanation, next steps, and closes with Escape.
  for (const appId of ["APP-001", "APP-007", "APP-012"]) {
    await page.getByRole("button", { name: new RegExp(`Open the decision for ${appId},`) }).first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(appId);
    await expect(dlg.getByText(/Why, in full/i)).toBeVisible();
    if (mobile) expect((await noHorizontalScroll(page)).scroll).toBeLessThanOrEqual(375);
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
  }

  // Ask two questions.
  await ask(page, "Why is APP-007 on hold?");
  await expect(page.getByRole("log").getByText(/APP-007 \(.*\) is On hold/)).toBeVisible();
  await ask(page, "Compare APP-005 and APP-013");
  await expect(page.getByRole("log").getByText(/Bands:/)).toBeVisible();

  // Apply one fact: it commits with a diff and an Undo, and the drawer opens.
  await ask(page, "APP-012 has now found a ground-floor space");
  await expect(page.getByRole("log").getByText(/treated the space as rented/)).toBeVisible();
  await expect(page.getByRole("log").getByRole("button", { name: "Undo" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Switch the brand type.
  await openTab(page, "Policy");
  await page.getByRole("radio", { name: /Delivery centre/ }).click();
  await expect(page.getByRole("radio", { name: /Delivery centre/ })).toBeChecked();

  // Export: an Excel workbook with the specified sheets, including the change log.
  await openTab(page, "Export");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download \.xlsx/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^decisions-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const path = await download.path();
  const wb = XLSX.read(readFileSync(path!));
  expect(wb.SheetNames.slice(0, 3)).toEqual(["Summary", "Decisions", "Action queue"]);
  expect(wb.SheetNames).toContain("Change log");
  const log = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets["Change log"]);
  expect(log.length).toBeGreaterThanOrEqual(2); // the fact and the brand switch
  const decisions = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets["Decisions"]);
  expect(decisions.length).toBeGreaterThanOrEqual(38);

  // A second browser opens the same workspace from the landing page and sees the same state.
  const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile: mobile });
  const p2 = await other.newPage();
  await p2.goto(`/w/${id}`);
  await expect(p2.getByRole("heading", { name: "Check your data" })).toBeVisible({ timeout: 30_000 });
  await p2.getByRole("button", { name: /See the decisions/ }).click();
  await openTab(p2, "Policy");
  await expect(p2.getByRole("radio", { name: /Delivery centre/ })).toBeChecked({ timeout: 15_000 });
  await openTab(p2, "Change log");
  await expect(p2.getByText(/APP-012/).first()).toBeVisible();
  // A change in the first browser reaches the second within a few seconds, with a notice.
  await openTab(page, "Policy");
  await page.getByRole("radio", { name: /Eyewear store/ }).click();
  await expect(p2.getByText(/Updated by another viewer/).first()).toBeVisible({ timeout: 20_000 });
  await other.close();

  expect(errors, "no uncaught errors in the page").toEqual([]);
  noteWorkspace(page);
});

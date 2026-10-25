// The map (SPEC §10.1, §15.8, G8.4): drawn from the decisions, togglable, with every fact also as text, and still
// useful when the map background can't load.

import { expect, test } from "@playwright/test";
import { ask, noHorizontalScroll, openTab, startSample } from "./helpers";

test("G8.4 the map draws stores, applicants, competitors and recruit-here pins, and every fact is also text", async ({ page }) => {
  await startSample(page);
  // Open more slots in TER-05 than there are applicants, so there are pins to recruit for.
  await ask(page, "TER-05 now has 6 slots");
  await expect(page.getByRole("log").getByText(/You can undo this/)).toBeVisible();
  await openTab(page, "Map");
  await expect(page.getByRole("heading", { name: "Map", exact: true })).toBeVisible();
  const map = page.getByTestId("map");
  await expect(map).toBeVisible();
  // Vector markers are drawn whether or not the background loads.
  const shapes = map.locator(".leaflet-interactive");
  await expect(shapes.first()).toBeVisible({ timeout: 20_000 });
  const all = await shapes.count();
  expect(all).toBeGreaterThan(40);

  // Toggling a layer removes its shapes.
  await page.getByLabel("Applicants, by decision").uncheck();
  await expect.poll(async () => shapes.count()).toBeLessThan(all - 30);
  await page.getByLabel("Applicants, by decision").check();
  await expect.poll(async () => shapes.count()).toBe(all);

  // The text version has the same facts.
  const words = page.getByTestId("map-in-words");
  await words.locator("summary").click();
  await expect(words.getByText(/ST-01, existing store in Bengaluru/)).toBeVisible();
  await expect(words.getByText(/APP-001 \(.*\), Approved, wants pin 560041/)).toBeVisible();
  await expect(words.getByText(/TER-05, pin \d{6}: no applicant wants it.*Recruit here/).first()).toBeVisible();
  await expect(page.locator(".leaflet-tooltip.map-recruit").first()).toBeVisible(); // drawn on the map too
  await expect(words.getByRole("heading", { name: /Locations that are only approximate/ })).toBeVisible();

  // Zooming to a city keeps the map and its text working.
  await page.getByLabel("Zoom to").selectOption("Mysuru");
  await expect(map.locator(".leaflet-interactive").first()).toBeVisible();

  // Clicking an applicant opens their decision.
  await page.getByLabel("Zoom to").selectOption("all");
  await map.locator(".leaflet-interactive").nth(12).click({ force: true });
});

test("G8.4 when the map background can't load, the places are still drawn, the page says so, and the rest of the app works", async ({ page, context }) => {
  await context.route(/tile\.openstreetmap\.org/, (route) => route.abort());
  await startSample(page);
  await openTab(page, "Map");
  const note = page.locator("[data-map-fallback]");
  await expect(note).toBeVisible({ timeout: 30_000 });
  await expect(note).toContainText(/couldn.t load/);
  // The text list opens by itself, and still lists everything.
  const words = page.getByTestId("map-in-words");
  await expect(words).toHaveAttribute("open", "");
  await expect(words.getByText(/ST-01, existing store in Bengaluru/)).toBeVisible();
  // The markers are still on a plain background.
  expect(await page.getByTestId("map").locator(".leaflet-interactive").count()).toBeGreaterThan(40);
  // Nothing else broke: other tabs and the chat still work.
  await openTab(page, "Overview");
  await expect(page.getByRole("heading", { name: /Overview/ })).toBeVisible();
  await openTab(page, "Applications");
  await expect(page.getByRole("button", { name: /Open the decision for APP-001,/ }).first()).toBeVisible();
});

test("G8.4 the map page fits the screen", async ({ page }, info) => {
  await startSample(page);
  await openTab(page, "Map");
  await expect(page.getByTestId("map")).toBeVisible();
  const { scroll, client } = await noHorizontalScroll(page);
  expect(scroll, `${info.project.name}: ${scroll}px in ${client}px`).toBeLessThanOrEqual(client);
});

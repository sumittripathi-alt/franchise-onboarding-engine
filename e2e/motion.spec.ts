// Motion in a real browser (SPEC §10.3, G8.5): it runs after a change and finishes, never blocks the page, switches off
// for reduced motion, and leaves nothing running when you leave.

import { expect, test, type Page } from "@playwright/test";
import { ask, openTab, startSample } from "./helpers";

const active = (page: Page) => page.evaluate(() => (window as unknown as { __motion: { active: () => number } }).__motion.active());

test("G8.5 after a change the cascade plays, the page stays usable, and it finishes cleanly", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await startSample(page);
  await openTab(page, "Applications");
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Ask" }).click();
  const box = page.getByLabel("Your question or update");
  await box.fill("APP-003 has withdrawn");
  await box.press("Enter");

  // The reply is readable straight away, and Undo works while things are still moving.
  const undo = page.getByRole("log").getByRole("button", { name: "Undo" });
  await expect(undo).toBeVisible();
  const sawMotion = await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      if ((window as unknown as { __motion: { active: () => number } }).__motion.active() > 0) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  });
  expect(sawMotion, "something animated after the change").toBe(true);
  await expect(undo).toBeEnabled();

  // It all finishes within a couple of seconds, and leaves no inline opacity or transform behind.
  await expect.poll(() => active(page), { timeout: 4000 }).toBe(0);
  const leftovers = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-animate="diff-card"], [data-animate="diff-row"], [data-animate="status-chip"]')].filter((e) => /opacity|transform/.test(e.getAttribute("style") ?? "")).length);
  expect(leftovers).toBe(0);
  const rows = page.locator('[data-animate="diff-row"]');
  expect(await rows.count()).toBeGreaterThan(1);
  for (const o of await rows.evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity))) expect(o).toBe("1");

  // Undo still works after the animation.
  await undo.click();
  await expect(page.getByRole("log").getByRole("button", { name: "Undone" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("G8.5 with reduced motion nothing animates, and everything is still there", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await active(page)).toBe(0); // the landing page arrives at once
  await startSample(page);
  await ask(page, "APP-003 has withdrawn");
  await expect(page.getByRole("log").getByRole("button", { name: "Undo" })).toBeVisible();
  expect(await active(page)).toBe(0);
  const rows = page.locator('[data-animate="diff-row"]');
  expect(await rows.count()).toBeGreaterThan(1);
  for (const o of await rows.evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity))) expect(o).toBe("1");
  // CSS transitions are off too: the drawer's slide takes effectively no time.
  const t = await page.evaluate(() => getComputedStyle(document.body.appendChild(Object.assign(document.createElement("div"), { className: "transition duration-200" }))).transitionDuration);
  expect(parseFloat(t)).toBeLessThan(0.01);
  await ctx.close();
});

test("G8.5 leaving in the middle of an animation leaves nothing running and breaks nothing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await startSample(page);
  await ask(page, "APP-003 has withdrawn");
  await expect(page.getByRole("log").getByRole("button", { name: "Undo" })).toBeVisible();
  await page.getByRole("button", { name: "Leave" }).click(); // straight away, while the cascade is still moving
  await page.waitForURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.poll(() => active(page), { timeout: 4000 }).toBe(0);
  expect(errors).toEqual([]);
});

test("G8.5 the landing page arrives section by section and ends fully visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.poll(() => active(page), { timeout: 3000 }).toBe(0);
  const opacities = await page.locator('[data-animate="landing-section"]').evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity));
  expect(opacities.length).toBeGreaterThanOrEqual(3);
  for (const o of opacities) expect(o).toBe("1");
});

test("G8.5 a decision opens with its sections settling in, and fully visible after", async ({ page }) => {
  await startSample(page);
  await page.getByRole("button", { name: /Open the decision for APP-007,/ }).first().click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("APP-007");
  await expect.poll(() => active(page), { timeout: 3000 }).toBe(0);
  const hidden = await dlg.locator("h2, h3, h4, p, summary").evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== "1" && getComputedStyle(e).visibility !== "hidden" && (e as HTMLElement).offsetParent !== null).length);
  expect(hidden).toBe(0);
});

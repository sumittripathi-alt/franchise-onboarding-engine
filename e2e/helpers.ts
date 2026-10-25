import { appendFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

/** Every workspace the tests create is recorded here, so they can be cleaned up from the database afterwards. */
const CREATED = "e2e/created-workspaces.txt";

export function noteWorkspace(page: Page) {
  const id = new URL(page.url()).pathname.split("/").pop();
  if (id) appendFileSync(CREATED, `${id}\n`);
  return id as string;
}

/** Upload the sample workbook from the landing page and wait until its decisions can be opened. Returns the workspace id. */
export async function startSample(page: Page, opts: { review?: boolean } = {}) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try with sample data" }).click();
  await page.waitForURL(/\/w\/[0-9a-f-]{36}/);
  const id = noteWorkspace(page);
  const go = page.getByRole("button", { name: /See the decisions/ });
  await expect(go).toBeEnabled({ timeout: 60_000 }); // the AI reads the notes first (at most 25 s)
  if (opts.review !== false) {
    await go.click();
    await expect(page.getByRole("heading", { name: "Decision sheet" })).toBeVisible();
  }
  return id;
}

export async function openTab(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "Sections" });
  await nav.getByRole("button", { name }).click();
}

export async function ask(page: Page, text: string) {
  await openTab(page, "Ask");
  const box = page.getByLabel("Your question or update");
  await box.fill(text);
  await box.press("Enter");
}

export const noHorizontalScroll = async (page: Page) =>
  page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));

/** Wait until the page has started and no animation is running, so colours and positions are measured at rest. */
export async function settle(page: Page) {
  await page.waitForFunction(() => (window as unknown as { __motion?: unknown }).__motion !== undefined);
  await page.waitForTimeout(500); // hydration, and any animation it starts
  await expect.poll(() => page.evaluate(() => (window as unknown as { __motion: { active: () => number } }).__motion.active()), { timeout: 5000 }).toBe(0);
  await page.waitForTimeout(150); // CSS transitions
}

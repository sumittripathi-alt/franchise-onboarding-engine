// The assistant (a round button at the bottom right) and the dashboard charts, in a real browser, desktop and 375 px.

import { expect, test } from "@playwright/test";
import { ask, closeChat, noHorizontalScroll, openTab, startSample } from "./helpers";

test("the assistant is a round button at the bottom right, not a tab", async ({ page }) => {
  await startSample(page);
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Ask" })).toHaveCount(0);
  const launcher = page.getByRole("button", { name: "Open the assistant" });
  await expect(launcher).toBeVisible();
  const vp = page.viewportSize()!;
  const b = (await launcher.boundingBox())!;
  expect(b.x + b.width, "near the right edge").toBeGreaterThan(vp.width - 40);
  expect(b.y + b.height, "near the bottom").toBeGreaterThan(vp.height - 40);
  expect(b.width, "a comfortable touch target").toBeGreaterThanOrEqual(44);
  await expect(launcher).toHaveAttribute("aria-expanded", "false");

  await launcher.click();
  const panel = page.getByRole("dialog", { name: "Assistant" });
  await expect(panel).toBeVisible();
  await expect(page.getByRole("button", { name: "Close the assistant" }).first()).toBeVisible();
  await expect(page.getByLabel("Your question or update")).toBeFocused();
  const p = (await panel.boundingBox())!;
  expect(p.x).toBeGreaterThanOrEqual(0);
  expect(p.x + p.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(p.y + p.height).toBeLessThanOrEqual(vp.height + 0.5);
  // The page behind it is still there and usable.
  await expect(page.getByRole("heading", { name: "Decision sheet" })).toBeVisible();
  await closeChat(page);
  await expect(launcher).toBeFocused();
});

test("an application named in an answer is a link to that application's decision", async ({ page }) => {
  await startSample(page);
  await ask(page, "Compare APP-005 and APP-013");
  const links = page.getByRole("log").getByRole("button", { name: /Open the decision for APP-0(05|13)/ });
  await expect(links.first()).toBeVisible();
  await links.first().click();
  const dlg = page.getByRole("dialog").filter({ hasText: /APP-0(05|13)/ });
  await expect(dlg).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Assistant" })).toBeHidden(); // put away so the decision isn't covered
  await page.keyboard.press("Escape");
  // The "Open APP-xxx" button does the same.
  await ask(page, "Why is APP-007 on hold?");
  await page.getByRole("log").getByRole("button", { name: "Open APP-007", exact: true }).click();
  await expect(page.getByRole("dialog").filter({ hasText: "APP-007" })).toBeVisible();
  // The conversation is kept when the assistant is opened again.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open the assistant" }).click();
  await expect(page.getByRole("log").getByText(/Compare APP-005 and APP-013/)).toBeVisible();
});

test("the Overview shows the decisions as a ring and every partner's path to opening as a Gantt chart", async ({ page }, info) => {
  await startSample(page);
  await openTab(page, "Overview");
  const donut = page.getByTestId("donut");
  await expect(donut).toBeVisible();
  const label = await donut.getByRole("img").getAttribute("aria-label");
  expect(label).toMatch(/^38 applications: \d+ approved/i);
  // Every number is also text, in a list that opens the matching applications.
  const items = donut.getByRole("list").getByRole("button");
  expect(await items.count()).toBeGreaterThanOrEqual(4);
  const counts = (await items.allInnerTexts()).map((t) => Number(/(\d+) ·/.exec(t)![1]));
  expect(counts.reduce((a, b) => a + b, 0)).toBe(38);
  expect(await donut.locator("circle[data-status]").count()).toBe(counts.length);
  await items.first().click();
  await expect(page.getByRole("heading", { name: "Applications" }).first()).toBeVisible();
  await openTab(page, "Overview");

  const gantt = page.getByTestId("portfolio-gantt");
  await expect(gantt).toBeVisible();
  const rows = gantt.getByRole("list", { name: "Opening timeline by partner" }).getByRole("listitem");
  expect(await rows.count()).toBe(10); // the first ten, then "Show all"
  const first = rows.first().getByRole("img");
  await expect(first).toHaveAttribute("aria-label", /earliest opening \d+ \w+ \d{4}/);
  await gantt.getByRole("button", { name: /Show all \d+/ }).click();
  expect(await rows.count()).toBeGreaterThan(10);
  // The same facts in words.
  await gantt.locator("summary").click();
  expect(await gantt.locator("details li").count()).toBe(await rows.count());
  // Each bar sits inside the chart, and a partner's ID opens their decision.
  for (const r of await rows.locator('[role="img"] > span').evaluateAll((els) => els.map((e) => [parseFloat((e as HTMLElement).style.left), parseFloat((e as HTMLElement).style.width || "0")]))) {
    expect(r[0]).toBeGreaterThanOrEqual(0);
    expect(r[0] + r[1]).toBeLessThanOrEqual(100.5);
  }
  await rows.first().getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  const { scroll, client } = await noHorizontalScroll(page);
  expect(scroll, `${info.project.name}: ${scroll}px in ${client}px`).toBeLessThanOrEqual(client);
});

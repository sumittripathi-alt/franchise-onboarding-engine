import { defineConfig, devices } from "@playwright/test";

// End-to-end checks against a running site (default: production). Desktop and a 375 px phone.
//   npx playwright test                         (production)
//   E2E_BASE_URL=http://localhost:3000 npx playwright test
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "e2e/results.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://onboarding-engine-dun.vercel.app",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
});

// `pnpm e2e` (#55): the presenter's path (docs/demo.md) clicked through in Chromium against the
// built app, each test on its own replay server. Run `pnpm build` first.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  outputDir: "test-results",
  // A whole path takes about 15 s unpaced, so one worker and one port suffice.
  workers: 1,
  timeout: 3 * 60_000,
  forbidOnly: !!process.env.CI,
  reporter: [["list", { printSteps: true }]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});

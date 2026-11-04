import { defineConfig } from "@playwright/test";

// The page is loaded from file:// with every network request aborted, so
// the test proves the verifier runs with no network at all.
export default defineConfig({
  testDir: "./test",
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    browserName: "chromium",
    offline: true,
    trace: "retain-on-failure",
  },
});

import { defineConfig, devices } from "@playwright/test";
import { loadTestEnvironment } from "./server/runtime/test-environment.mjs";

const storageStatePath = "tests/e2e/.auth/state.json";
loadTestEnvironment({ requireDatabase: true });
const testFrontendPort = process.env.TEST_FRONTEND_PORT ?? "5174";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 8_000,
  retries: 1,
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${testFrontendPort}`,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: storageStatePath },
    },
    {
      name: "webkit",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.spec\.ts/,
      use: { ...devices["Desktop Safari"], storageState: storageStatePath },
    },
  ],
  reporter: [["html", { outputFolder: "tests/e2e/reports/html", open: "never" }], ["list"]],
  outputDir: "tests/e2e/reports/artifacts",
});

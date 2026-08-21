import { defineConfig, devices } from "@playwright/test"
import path from "path"
import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

const PORT = process.env.PORT || 3000
const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || `http://localhost:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  snapshotDir: "./e2e/visual/baselines",
  snapshotPathTemplate: "{snapshotDir}/{arg}",
  outputDir: "./e2e/.results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "e2e/.report", open: "never" }],
  ],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
      animations: "disabled",
    },
  },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    // 1. Global Setup (Live Auth)
    {
      name: "setup",
      testMatch: /.*auth\.setup\.ts/,
    },
    // 2. Desktop Chrome (1440x900 - Penpot Standard Viewport)
    {
      name: "Desktop Chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: path.join(__dirname, "e2e/.auth/user.json"),
      },
      dependencies: ["setup"],
      testIgnore: [/.*auth\.setup\.ts/, /.*auth\.spec\.ts/],
    },
    // 3. Mobile Device (Pixel 7 - 412x915)
    {
      name: "Mobile Chrome",
      use: {
        ...devices["Pixel 7"],
        storageState: path.join(__dirname, "e2e/.auth/user.json"),
      },
      dependencies: ["setup"],
      testMatch: [/.*touch-responsive\.spec\.ts/],
    },
    // 4. Unauthenticated Public Flow (Login page tests)
    {
      name: "Unauthenticated",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
      testMatch: [/.*auth\.spec\.ts/],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
})

import { test as setup, expect } from "@playwright/test"
import path from "path"
import fs from "fs"

const authFile = path.join(__dirname, "../.auth/user.json")

setup("authenticate with live server", async ({ page, baseURL }) => {
  const authDir = path.dirname(authFile)
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true })
  }

  const baseUrlStr = baseURL || "http://localhost:3000"

  // 1. Establish session via page.request so cookies attach directly to page context
  const res = await page.request.post(`${baseUrlStr}/api/auth/test-session`, {
    data: {
      userId: "playwright-test-user",
      username: "PlaywrightTester",
      isAdmin: true,
      enableDownloading: true,
    },
    headers: {
      "Content-Type": "application/json",
    },
  })

  expect(res.ok()).toBeTruthy()

  // 2. Visit the live server root to verify session is active
  await page.goto(baseUrlStr)
  await page.waitForLoadState("domcontentloaded")

  // Ensure authenticated
  expect(page.url()).not.toContain("/login")

  // 3. Persist storage state for all authenticated test suites
  await page.context().storageState({ path: authFile })
})

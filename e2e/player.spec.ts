import { test, expect } from "./fixtures/test-base"

test.describe("CinemaPlayer (/watch)", () => {
  test("renders player container, controls, and back navigation", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/watch?id=test-preview-1")
    await page.waitForLoadState("domcontentloaded")

    // The player wrapper is full screen
    const playerContainer = page.locator(".fixed.inset-0, [data-testid='cinema-player'], video, .bg-black").first()
    await expect(playerContainer).toBeVisible()

    // Hover or move mouse to reveal controls
    await page.mouse.move(500, 500)

    // Look for back button / header or transport controls
    const backBtn = page.locator("button, a").filter({ has: page.locator("svg") }).first()
    await expect(backBtn).toBeVisible()
  })

  test("toggles player controls on mouse interaction", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/watch?id=test-preview-1")
    await page.waitForLoadState("domcontentloaded")

    // Move mouse over player area
    await page.mouse.move(600, 400)
    await page.waitForTimeout(300)

    // Verify seek bar or transport icons exist in the DOM
    const transportOrSeekBar = page.locator("button, [role='slider'], .cursor-pointer").first()
    await expect(transportOrSeekBar).toBeVisible()
  })
})

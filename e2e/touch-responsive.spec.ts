import { test, expect } from "./fixtures/test-base"

test.describe("Responsive & Mobile Viewports", () => {
  test("adapts navigation and layout on mobile viewport (390x844)", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")
    await page.waitForLoadState("domcontentloaded")

    // Mobile header or logo visible
    const header = page.locator("header")
    await expect(header).toBeVisible()

    // Media cards fluidly render in single/double columns or horizontal swipe
    const mediaCards = page.locator("article, [data-testid='movie-card'], .aspect-\\[2\\/3\\]")
    await expect(mediaCards.first()).toBeVisible({ timeout: 15_000 })
  })

  test("adapts layout on tablet viewport (768x1024)", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto("/")
    await page.waitForLoadState("domcontentloaded")

    const header = page.locator("header")
    await expect(header).toBeVisible()

    const mediaCards = page.locator("article, [data-testid='movie-card'], .aspect-\\[2\\/3\\]")
    await expect(mediaCards.first()).toBeVisible({ timeout: 15_000 })
  })
})

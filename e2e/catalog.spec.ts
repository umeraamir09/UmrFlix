import { test, expect } from "./fixtures/test-base"

test.describe("Catalog & Browsing Pages", () => {
  test("loads Movies page with Hero and Category Rows", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/movie")
    await page.waitForLoadState("domcontentloaded")

    // Verify header exists
    await expect(page.locator("header")).toBeVisible()

    // Verify hero or movie row items
    const mediaCards = page.locator("article, [data-testid='movie-card'], .group.relative.cursor-pointer, .aspect-\\[2\\/3\\]")
    await expect(mediaCards.first()).toBeVisible({ timeout: 15_000 })
  })

  test("loads TV Shows page with Series Rows", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/tv")
    await page.waitForLoadState("domcontentloaded")

    // Verify header exists
    await expect(page.locator("header")).toBeVisible()

    // Verify media cards exist
    const mediaCards = page.locator("article, [data-testid='movie-card'], .group.relative.cursor-pointer, .aspect-\\[2\\/3\\]")
    await expect(mediaCards.first()).toBeVisible({ timeout: 15_000 })
  })

  test("loads My Library (/library) page", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/library")
    await page.waitForLoadState("domcontentloaded")

    await expect(page.locator("header")).toBeVisible()
    await expect(page.getByRole("heading", { name: /Library|My Library/i }).or(page.locator("h1"))).toBeVisible()
  })
})

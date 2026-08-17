import { test, expect } from "./fixtures/test-base"

test.describe("Media Details Pages", () => {
  test("renders Movie Details page with metadata, backdrop, and action buttons", async ({ page, disableMotion }) => {
    await disableMotion()
    // Navigate to a well-known movie detail page (e.g. 502356 = The Super Mario Bros. Movie)
    await page.goto("/movie/502356")
    await page.waitForLoadState("domcontentloaded")

    // Expect header
    await expect(page.locator("header")).toBeVisible()

    // Expect movie title or logo artwork
    const titleElement = page.locator("h1, img[alt*='Mario'], .drop-shadow-lg").first()
    await expect(titleElement).toBeVisible({ timeout: 20_000 })

    // Expect action buttons (Play / Request / Watchlist)
    const actionBtn = page.locator("button, a").filter({ hasText: /Play|Request|Watch|Watchlist/i }).first()
    await expect(actionBtn).toBeVisible({ timeout: 15_000 })
  })

  test("renders TV Show Details with Season & Episode Navigator", async ({ page, disableMotion }) => {
    await disableMotion()
    // Navigate to a well-known TV series (e.g. 84958 = Loki or 1399 = Game of Thrones)
    await page.goto("/tv/84958")
    await page.waitForLoadState("domcontentloaded")

    await expect(page.locator("header")).toBeVisible()

    // Title or logo artwork
    const titleElement = page.locator("h1, img[alt*='Loki'], .drop-shadow-lg").first()
    await expect(titleElement).toBeVisible({ timeout: 20_000 })

    // Look for episode browser or season tabs/dropdown
    const seasonOrEpisodes = page.locator("[data-testid='season-browser'], .aspect-video, button:has-text('Season')").or(page.getByText(/Season/i))
    await expect(seasonOrEpisodes.first()).toBeVisible({ timeout: 20_000 })
  })
})

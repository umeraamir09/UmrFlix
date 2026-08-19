import { test, expect } from "./fixtures/test-base"

test.describe("Catalog & Browsing Pages", () => {
  test("loads Movies page (/movies) with Hero, Top Genre Selector, and Category Rows", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/movies")
    await page.waitForLoadState("domcontentloaded")

    // Verify header exists
    await expect(page.locator("header")).toBeVisible()

    // Verify page heading
    await expect(page.locator("h1")).toBeVisible()

    // Verify top genre selector trigger button is present
    await expect(page.getByRole("button", { name: /Genres/i })).toBeVisible()

    // Verify hero section or media cards
    const heroOrCards = page.locator("[data-testid='hero-billboard'], article, [data-testid='movie-card'], .aspect-\\[240\\/136\\], .aspect-\\[2\\/3\\], .aspect-\\[16\\/9\\]")
    await expect(heroOrCards.first()).toBeVisible({ timeout: 15_000 })
  })

  test("loads TV Shows page (/tvshows) with Series Rows and Top Genre Selector", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/tvshows")
    await page.waitForLoadState("domcontentloaded")

    // Verify header exists
    await expect(page.locator("header")).toBeVisible()

    // Verify page heading (Series)
    await expect(page.locator("h1")).toContainText(/Series/i)

    // Verify top genre selector trigger button is present
    await expect(page.getByRole("button", { name: /Genres/i })).toBeVisible()

    // Verify hero section or media cards exist
    const heroOrCards = page.locator("[data-testid='hero-billboard'], article, [data-testid='movie-card'], .aspect-\\[240\\/136\\], .aspect-\\[2\\/3\\], .aspect-\\[16\\/9\\]")
    await expect(heroOrCards.first()).toBeVisible({ timeout: 15_000 })
  })

  test("redirects legacy routes: /movie -> /movies and /tv -> /tvshows", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/movie")
    await page.waitForURL(/\/movies/)
    expect(page.url()).toContain("/movies")

    await page.goto("/tv")
    await page.waitForURL(/\/tvshows/)
    expect(page.url()).toContain("/tvshows")
  })

  test("filters movies catalog by genre using the top genre selector dropdown", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/movies")
    await page.waitForLoadState("domcontentloaded")

    // Open top genre dropdown
    const genreTrigger = page.locator("[data-testid='top-genre-selector']").first()
    await expect(genreTrigger).toBeVisible({ timeout: 15_000 })
    await genreTrigger.click()

    // Wait for popover
    const popover = page.locator("[data-testid='top-genre-popover']").first()
    await expect(popover).toBeVisible({ timeout: 10_000 })

    // Find and click Action genre option
    const actionOption = popover.locator("a", { hasText: /^Action$/i }).first()
    await expect(actionOption).toBeVisible({ timeout: 10_000 })
    await actionOption.click()

    await page.waitForURL(/genre=Action/, { timeout: 15_000 })
    expect(page.url()).toContain("genre=Action")

    // Verify filtered heading and active selector button
    await expect(page.locator("h1")).toContainText(/Action/i, { timeout: 15_000 })
    await expect(page.locator("[data-testid='top-genre-selector']")).toContainText(/Action/i, { timeout: 10_000 })
  })

  test("loads My Library (/library) page", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/library")
    await page.waitForLoadState("domcontentloaded")

    await expect(page.locator("header")).toBeVisible()
    await expect(page.getByRole("heading", { name: /Library|My Library/i }).or(page.locator("h1"))).toBeVisible()
  })
})


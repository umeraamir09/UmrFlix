import { test, expect } from "./fixtures/test-base"

test.describe("Home Page (/)", () => {
  test.beforeEach(async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/")
    await page.waitForLoadState("domcontentloaded")
  })

  test("renders branded navigation bar with all primary routes and actions", async ({ page }) => {
    const header = page.locator("header")
    await expect(header).toBeVisible()

    // Logo / Home link
    await expect(page.locator("header a[href='/']").first()).toBeVisible()

    // Navigation links (Penpot Navbar items)
    await expect(header.getByRole("link", { name: "Home", exact: true })).toBeVisible()
    await expect(header.getByRole("link", { name: /Series|Tv Shows/i })).toBeVisible()
    await expect(header.getByRole("link", { name: "Movies", exact: true })).toBeVisible()
    await expect(header.getByRole("link", { name: "Library", exact: true })).toBeVisible()
    await expect(header.getByRole("link", { name: "My List", exact: true })).toBeVisible()
    await expect(header.getByRole("button", { name: /Browse by Genre/i })).toBeVisible()

    // Search and Notifications
    await expect(page.locator("input[placeholder*='Search'], button:has-text('Search'), [aria-label*='Search']").first()).toBeVisible()
  })

  test("displays hero billboard with call-to-action buttons and media fanart", async ({ page }) => {
    // Hero section presence
    const hero = page.locator("[data-testid='hero-billboard'], .relative.h-\\[65vh\\], .relative.min-h-\\[70vh\\], section:first-of-type").first()
    await expect(hero).toBeVisible()

    // Action buttons (Watch / Play and Info)
    const actionBtn = page.locator("a:has-text('START WATCHING'), a:has-text('More Info'), a:has-text('WATCH NOW'), button:has-text('Play'), [data-testid='hero-action']").first()
    await expect(actionBtn).toBeVisible()
  })

  test("renders horizontal movie/series carousels with posters", async ({ page }) => {
    // Look for media rows or poster cards
    const movieCards = page.locator("article, [data-testid='movie-card'], .group.relative.cursor-pointer, .aspect-\\[2\\/3\\], .aspect-\\[16\\/9\\]")
    await expect(movieCards.first()).toBeVisible({ timeout: 15_000 })

    const count = await movieCards.count()
    expect(count).toBeGreaterThan(0)
  })

  test("interacts with navbar search and navigates to search page", async ({ page }) => {
    const searchTrigger = page.locator("a[aria-label='Search media catalog'], a[href='/search']").first()
    await expect(searchTrigger).toBeVisible()
    await searchTrigger.click()

    await page.waitForURL(/\/search/)
    expect(page.url()).toContain("/search")
  })
})

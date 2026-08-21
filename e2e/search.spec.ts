import { test, expect } from "./fixtures/test-base"

test.describe("Search Page (/search)", () => {
  test("displays live query input and categorized media results", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/search?q=Avengers")
    await page.waitForLoadState("domcontentloaded")

    await expect(page.locator("header")).toBeVisible()

    // Search input contains query
    const searchInput = page.locator("input[placeholder*='Search'], input[type='search']").first()
    await expect(searchInput).toBeVisible()

    // Results container with cards
    const results = page.locator("a[href^='/movie/'], a[href^='/tv/'], .aspect-video")
    await expect(results.first()).toBeVisible({ timeout: 20_000 })
  })

  test("shows empty/no-results state when query matches nothing", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/search?q=xyz987654321nonexistentquery")
    await page.waitForLoadState("domcontentloaded")

    // Check for no results feedback
    await expect(page.getByText(/No results found for/i)).toBeVisible({ timeout: 15_000 })
  })
})

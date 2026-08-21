import { test, expect } from "@playwright/test"

test.describe("Login Page (/login)", () => {
  test.beforeEach(async ({ page }) => {
    // Clear cookies for clean unauthenticated state
    await page.context().clearCookies()
    await page.goto("/login")
  })

  test("renders sign in header, form inputs, and branding", async ({ page }) => {
    // Verify title and heading
    await expect(page.getByRole("heading", { name: /Sign in to UmrFlix/i })).toBeVisible()

    // Verify inputs
    const usernameInput = page.getByPlaceholder(/Username/i)
    const passwordInput = page.getByPlaceholder(/Password/i)
    const submitBtn = page.getByRole("button", { name: /CONTINUE|Sign In/i })

    await expect(usernameInput).toBeVisible()
    await expect(passwordInput).toBeVisible()
    await expect(submitBtn).toBeVisible()
  })

  test("toggles custom server URL accordion", async ({ page }) => {
    const customUrlToggle = page.getByRole("button", { name: /Custom Server Url/i })
    await expect(customUrlToggle).toBeVisible()

    const accordionContainer = page.locator(".grid.transition-all").filter({ has: page.getByPlaceholder(/http:\/\/localhost:8096/i) })
    await expect(accordionContainer).toHaveClass(/opacity-0|grid-rows-\[0fr\]/)

    // Click to expand
    await customUrlToggle.click()
    await expect(accordionContainer).toHaveClass(/opacity-100|grid-rows-\[1fr\]/)

    // Fill in custom URL
    const serverUrlInput = page.getByPlaceholder(/http:\/\/localhost:8096/i)
    await serverUrlInput.fill("http://custom-media-server:8096")
    await expect(serverUrlInput).toHaveValue("http://custom-media-server:8096")

    // Click again to collapse
    await customUrlToggle.click()
    await expect(accordionContainer).toHaveClass(/opacity-0|grid-rows-\[0fr\]/)
  })

  test("displays validation feedback on empty or invalid submissions", async ({ page }) => {
    const submitBtn = page.getByRole("button", { name: /CONTINUE|Sign In/i })
    
    // Submitting with empty username triggers HTML5 validation or error banner
    await submitBtn.click()
    
    // Fill in a dummy username to trigger the server auth attempt
    const usernameInput = page.getByPlaceholder(/Username/i)
    await usernameInput.fill("nonexistent_user_test_123")
    await submitBtn.click()

    // Expect loading state or error feedback
    await expect(
      page.locator(".text-red-400, [role='alert'], .bg-red-500\\/10").or(page.getByText(/failed|invalid|error/i))
    ).toBeVisible({ timeout: 10_000 })
  })
})

/* eslint-disable react-hooks/rules-of-hooks, @typescript-eslint/no-unused-vars */
import { test as base, expect, Locator } from "@playwright/test"

export type CustomFixtures = {
  checkTokenStyles: (
    locator: Locator,
    expectedStyles: Record<string, string>
  ) => Promise<void>
  disableMotion: () => Promise<void>
  waitForMediaReady: () => Promise<void>
}

export const test = base.extend<CustomFixtures>({
  checkTokenStyles: async ({ page }, use) => {
    await use(async (locator: Locator, expectedStyles: Record<string, string>) => {
      for (const [prop, expectedVal] of Object.entries(expectedStyles)) {
        const computedVal = await locator.evaluate(
          (el, cssProp) => window.getComputedStyle(el).getPropertyValue(cssProp),
          prop
        )
        expect(computedVal.trim()).toBe(expectedVal.trim())
      }
    })
  },

  disableMotion: async ({ page }, use) => {
    await use(async () => {
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0.001s !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.001s !important;
            scroll-behavior: auto !important;
          }
        `,
      })
    })
  },

  waitForMediaReady: async ({ page }, use) => {
    await use(async () => {
      await page.waitForLoadState("networkidle").catch(() => {})
      // Wait for all images to complete loading
      await page.evaluate(async () => {
        const images = Array.from(document.querySelectorAll("img"))
        await Promise.all(
          images.map((img) => {
            if (img.complete) return Promise.resolve()
            return new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true })
              img.addEventListener("error", resolve, { once: true })
            })
          })
        )
      })
    })
  },
})

export { expect }

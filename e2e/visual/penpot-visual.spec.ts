import { test, expect } from "../fixtures/test-base"
import fs from "fs"
import path from "path"

const manifestPath = path.join(__dirname, "penpot-manifest.json")
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"))

test.describe("Penpot Visual Regression Specs", () => {
  for (const target of manifest.targets) {
    test(`Visual match: ${target.name} [${target.id}]`, async ({ page, disableMotion }) => {
      await disableMotion()
      await page.setViewportSize(target.viewport)

      await page.goto(target.route, { waitUntil: "domcontentloaded" })

      // Apply interaction if requested
      if (target.interaction === "expand-custom-url") {
        const toggle = page.getByText(/Custom Server Url/i)
        if (await toggle.isVisible().catch(() => false)) {
          await toggle.click()
          await page.waitForTimeout(300)
        }
      }

      await page.waitForTimeout(500)

      if (target.selector) {
        const element = page.locator(target.selector).first()
        if (await element.isVisible().catch(() => false)) {
          await expect(element).toHaveScreenshot(target.baselineFile, {
            maxDiffPixelRatio: target.threshold || 0.08,
            animations: "disabled",
          })
          return
        }
      }

      await expect(page).toHaveScreenshot(target.baselineFile, {
        maxDiffPixelRatio: target.threshold || 0.08,
        animations: "disabled",
        fullPage: false,
      })
    })
  }
})

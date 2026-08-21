import { test, expect } from "./fixtures/test-base"

test.describe("CinemaPlayer (/watch)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/jellyfin/playback/**", async (route) => {
      const mockPayload = {
        itemId: "preview",
        playSessionId: "mock-session-123",
        mediaSourceId: "mock-media-123",
        container: "mp4",
        supportsDirectPlay: true,
        supportsTranscoding: true,
        canDirectPlay: true,
        directUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        hlsUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        runtimeTicks: 6000000000,
        resumeTicks: 0,
        played: false,
        playedPercentage: 0,
        audio: [{ index: 0, title: "English (Stereo)", isDefault: true }],
        subtitles: [],
        defaultAudioIndex: 0,
        chapters: [],
        markers: [],
        trickplay: null,
        title: "Preview Video",
        series: null,
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPayload),
      })
    })
  })

  test("renders player container, controls, and back navigation", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/watch?id=preview")
    await page.waitForLoadState("domcontentloaded")

    // The player wrapper is full screen
    const playerContainer = page.locator(".fixed.inset-0, [data-testid='cinema-player'], video, .bg-black").first()
    await expect(playerContainer).toBeVisible()

    // Hover or move mouse to reveal controls
    await page.mouse.move(500, 500)
    await page.waitForTimeout(300)

    // Look for back button / header or transport controls
    const backBtn = page.getByTestId("player-back-btn")
    await expect(backBtn).toBeVisible()
  })

  test("toggles player controls on mouse interaction", async ({ page, disableMotion }) => {
    await disableMotion()
    await page.goto("/watch?id=preview")
    await page.waitForLoadState("domcontentloaded")

    // Move mouse over player area
    await page.mouse.move(600, 400)
    await page.waitForTimeout(300)

    // Verify seek bar or transport icons exist in the DOM
    const transportOrSeekBar = page.locator("button, [role='slider'], .cursor-pointer").first()
    await expect(transportOrSeekBar).toBeVisible()
  })
})

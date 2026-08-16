import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { SelectionList } from "../player-menus"
import { NextEpisodeOverlay } from "../PlayerOverlays"
import { DEFAULT_SUBTITLE_STYLE } from "../SubtitleOverlay"
import { TouchControls } from "../touch/TouchControls"

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
})

describe("PR #42 Code Review Fixes", () => {
  describe("TouchControls BrightnessRail keyboard & ARIA semantics", () => {
    function renderTouchControls() {
      return render(
        <TouchControls
          visible={true}
          title="Test Title"
          playing={true}
          currentTime={10}
          duration={100}
          buffered={20}
          qualityId="auto"
          audioTracks={[]}
          audioIndex={null}
          subtitleTracks={[]}
          subtitleIndex={null}
          subStyle={DEFAULT_SUBTITLE_STYLE}
          onSubStyleChange={vi.fn()}
          playbackRate={1}
          chapters={[]}
          itemId="item-1"
          trickplay={null}
          episodeBrowserOpen={false}
          onToggleEpisodeBrowser={vi.fn()}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
          onSkipBy={vi.fn()}
          onQualityChange={vi.fn()}
          onAudioChange={vi.fn()}
          onSubtitleChange={vi.fn()}
          onPlaybackRateChange={vi.fn()}
          onInteract={vi.fn()}
          ripple={null}
        />,
      )
    }

    it("exposes brightness slider with proper role, tabIndex, and vertical ARIA attributes", () => {
      renderTouchControls()
      const slider = screen.getByRole("slider", { name: "Brightness" })
      expect(slider).toBeTruthy()
      expect(slider.getAttribute("tabIndex")).toBe("0")
      expect(slider.getAttribute("aria-orientation")).toBe("vertical")
      expect(slider.getAttribute("aria-valuemin")).toBe("20")
      expect(slider.getAttribute("aria-valuemax")).toBe("100")
      expect(slider.getAttribute("aria-valuenow")).toBeTruthy()
    })

    it("handles keyboard interaction (ArrowUp/ArrowDown/Home/End/PageUp/PageDown)", () => {
      renderTouchControls()
      const slider = screen.getByRole("slider", { name: "Brightness" })
      slider.focus()

      const initialVal = Number(slider.getAttribute("aria-valuenow"))

      // ArrowDown reduces brightness
      fireEvent.keyDown(slider, { key: "ArrowDown" })
      const afterDown = Number(slider.getAttribute("aria-valuenow"))
      expect(afterDown).toBeLessThanOrEqual(initialVal)

      // ArrowUp increases brightness
      fireEvent.keyDown(slider, { key: "ArrowUp" })
      const afterUp = Number(slider.getAttribute("aria-valuenow"))
      expect(afterUp).toBeGreaterThanOrEqual(afterDown)

      // Home sets to min brightness (20%)
      fireEvent.keyDown(slider, { key: "Home" })
      expect(slider.getAttribute("aria-valuenow")).toBe("20")

      // End sets to max brightness (100%)
      fireEvent.keyDown(slider, { key: "End" })
      expect(slider.getAttribute("aria-valuenow")).toBe("100")

      // PageDown steps down by 20%
      fireEvent.keyDown(slider, { key: "PageDown" })
      expect(slider.getAttribute("aria-valuenow")).toBe("80")

      // PageUp steps up by 20%
      fireEvent.keyDown(slider, { key: "PageUp" })
      expect(slider.getAttribute("aria-valuenow")).toBe("100")
    })
  })

  describe("SelectionList cursor synchronization and click handling", () => {
    const testOptions = [
      { key: "opt-0", label: "Option 0", selected: false },
      { key: "opt-1", label: "Option 1", selected: true },
      { key: "opt-2", label: "Option 2", selected: false },
    ]

    function Harness() {
      const [selectedIndex, setSelectedIndex] = useState(1)
      return (
        <SelectionList
          id="test-menu"
          label="Test Menu"
          options={testOptions.map((opt, idx) => ({ ...opt, selected: idx === selectedIndex }))}
          selectedIndex={selectedIndex}
          onSelect={(idx) => setSelectedIndex(idx)}
        />
      )
    }

    it("updates cursor and aria-activedescendant when an option is clicked", () => {
      render(<Harness />)
      const listbox = screen.getByRole("listbox", { name: "Test Menu" })
      expect(listbox.getAttribute("aria-activedescendant")).toBe("test-menu-opt-1")

      // Click option 2
      const option2 = screen.getByText("Option 2")
      fireEvent.click(option2)

      expect(listbox.getAttribute("aria-activedescendant")).toBe("test-menu-opt-2")
    })

    it("navigates with keyboard from the newly clicked cursor", () => {
      render(<Harness />)
      const listbox = screen.getByRole("listbox", { name: "Test Menu" })

      // Click option 0
      fireEvent.click(screen.getByText("Option 0"))
      expect(listbox.getAttribute("aria-activedescendant")).toBe("test-menu-opt-0")

      // Press ArrowDown -> should move to option 1
      fireEvent.keyDown(listbox, { key: "ArrowDown" })
      expect(listbox.getAttribute("aria-activedescendant")).toBe("test-menu-opt-1")

      // Press Enter to select option 1
      fireEvent.keyDown(listbox, { key: "Enter" })
      expect(listbox.getAttribute("aria-activedescendant")).toBe("test-menu-opt-1")
    })
  })

  describe("NextEpisodeOverlay focus restoration", () => {
    function OverlayHarness() {
      const [open, setOpen] = useState(false)
      return (
        <div role="application" tabIndex={0} data-testid="player-surface">
          <button data-testid="open-btn" onClick={() => setOpen(true)}>
            Open Next
          </button>
          {open && (
            <NextEpisodeOverlay
              next={{ id: "ep-2", title: "Next Episode Title", label: "S1:E2" }}
              countdownSeconds={10}
              onPlayNow={vi.fn()}
              onCancel={() => setOpen(false)}
            />
          )}
        </div>
      )
    }

    it("traps focus and restores focus to trigger on cancel / Escape", () => {
      render(<OverlayHarness />)
      const openBtn = screen.getByTestId("open-btn")
      openBtn.focus()
      fireEvent.click(openBtn)

      // Dialog is open and focused inside
      const dialog = screen.getByRole("dialog", { name: "Up next" })
      expect(dialog).toBeTruthy()

      // Cancel via Escape
      fireEvent.keyDown(window, { key: "Escape" })

      // Focus should be restored to openBtn
      expect(document.activeElement).toBe(openBtn)
    })

    it("restores focus to the player surface if no trigger button had focus", () => {
      render(<OverlayHarness />)
      // Open without focusing the button (e.g. automatic trigger at end of media)
      fireEvent.click(screen.getByTestId("open-btn"))

      const cancelBtn = screen.getByRole("button", { name: /cancel/i })
      expect(cancelBtn).toBeTruthy()

      // Click cancel
      fireEvent.click(cancelBtn)

      // Focus should be restored to the player surface container
      expect(document.activeElement).toBe(screen.getByTestId("player-surface"))
    })
  })
})

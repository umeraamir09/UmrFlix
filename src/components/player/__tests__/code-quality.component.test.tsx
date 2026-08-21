import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadPlayerSettings, updatePlayerSettings } from "@/lib/player-settings"
import { useReportToast } from "../hooks/useReportToast"
import { useReporterCleanup } from "../hooks/useReporterCleanup"
import { usePlayerControls } from "../hooks/usePlayerControls"

describe("Code Quality & Maintainability Tests (Audit 10.1 - 10.5)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    cleanup()
  })

  describe("10.1 — handleReport Timer Cleanup", () => {
    it("clears the production toast timer on unmount", () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout")
      const { result, unmount } = renderHook(() => useReportToast())

      act(() => {
        result.current.handleReport()
      })

      expect(result.current.reportToast).toBe(true)
      unmount()

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
      act(() => {
        vi.advanceTimersByTime(3000)
      })
    })

    it("resets the previous production timeout on repeated reports", () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout")
      const { result } = renderHook(() => useReportToast())

      act(() => {
        result.current.handleReport()
      })
      act(() => {
        vi.advanceTimersByTime(1500)
        result.current.handleReport()
      })

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
      act(() => {
        vi.advanceTimersByTime(1600)
      })
      expect(result.current.reportToast).toBe(true)

      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(result.current.reportToast).toBe(false)
    })

    it("uses the supplied report callback instead of showing a toast", () => {
      const onReport = vi.fn()
      const { result } = renderHook(() => useReportToast(onReport))

      act(() => {
        result.current.handleReport()
      })

      expect(onReport).toHaveBeenCalledOnce()
      expect(result.current.reportToast).toBe(false)
    })
  })

  describe("10.5 — Quality Settings Updates Without Full Object Dependency", () => {
    it("updatePlayerSettings persists preferences reactively", () => {
      expect(loadPlayerSettings().qualityPreference).toBe("auto")

      updatePlayerSettings({ qualityPreference: "1080p" })

      expect(loadPlayerSettings().qualityPreference).toBe("1080p")
      expect(loadPlayerSettings().subtitleMode).toBe("client")
    })
  })

  describe("10.6 — Reporter cleanup stability", () => {
    it("does not stop reporting on rerenders, but stops on item change and unmount", () => {
      const stop = vi.fn()
      const { rerender, unmount } = renderHook(
        ({ itemId }: { itemId: string }) => useReporterCleanup(itemId, stop),
        { initialProps: { itemId: "item-1" } },
      )

      rerender({ itemId: "item-1" })
      expect(stop).not.toHaveBeenCalled()

      rerender({ itemId: "item-2" })
      expect(stop).toHaveBeenCalledOnce()

      unmount()
      expect(stop).toHaveBeenCalledTimes(2)
    })
  })

  describe("10.7 — usePlayerControls and cursor auto-hide", () => {
    it("auto-hides controls after 3500ms when playing", () => {
      const { result } = renderHook(() =>
        usePlayerControls({
          playing: true,
          episodeBrowserOpen: false,
        }),
      )

      expect(result.current.controlsVisible).toBe(true)

      act(() => {
        vi.advanceTimersByTime(3500)
      })

      expect(result.current.controlsVisible).toBe(false)
    })

    it("resets auto-hide timer when pokeControls is invoked", () => {
      const { result } = renderHook(() =>
        usePlayerControls({
          playing: true,
          episodeBrowserOpen: false,
        }),
      )

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(result.current.controlsVisible).toBe(true)

      act(() => {
        result.current.pokeControls()
      })

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(result.current.controlsVisible).toBe(true)

      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(result.current.controlsVisible).toBe(false)
    })

    it("keeps controls visible when paused or when episode browser is open", () => {
      const { result, rerender } = renderHook(
        ({ playing, episodeBrowserOpen }) =>
          usePlayerControls({ playing, episodeBrowserOpen }),
        { initialProps: { playing: false, episodeBrowserOpen: false } },
      )

      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(result.current.controlsVisible).toBe(true)

      rerender({ playing: true, episodeBrowserOpen: true })
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(result.current.controlsVisible).toBe(true)
    })
  })
})

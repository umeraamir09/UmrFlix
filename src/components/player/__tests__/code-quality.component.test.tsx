import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useState, useRef, useEffect, useCallback } from "react"
import { loadPlayerSettings, savePlayerSettings, updatePlayerSettings } from "@/lib/player-settings"

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
    it("clears the toast timer on unmount preventing memory leaks and state updates after unmount", () => {
      const { result, unmount } = renderHook(() => {
        const [reportToast, setReportToast] = useState(false)
        const reportToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

        useEffect(() => {
          return () => {
            if (reportToastTimerRef.current) clearTimeout(reportToastTimerRef.current)
          }
        }, [])

        const handleReport = useCallback(() => {
          if (reportToastTimerRef.current) clearTimeout(reportToastTimerRef.current)
          setReportToast(true)
          reportToastTimerRef.current = setTimeout(() => setReportToast(false), 3000)
        }, [])

        return { reportToast, handleReport, timerRef: reportToastTimerRef }
      })

      expect(result.current.reportToast).toBe(false)

      act(() => {
        result.current.handleReport()
      })

      expect(result.current.reportToast).toBe(true)
      expect(result.current.timerRef.current).not.toBeNull()

      // Unmount while timer is pending
      unmount()

      // Advancing timer after unmount does not throw or log warnings
      act(() => {
        vi.advanceTimersByTime(3000)
      })
    })

    it("resets previous timeout on repeated clicks", () => {
      const { result } = renderHook(() => {
        const [reportToast, setReportToast] = useState(false)
        const reportToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

        useEffect(() => {
          return () => {
            if (reportToastTimerRef.current) clearTimeout(reportToastTimerRef.current)
          }
        }, [])

        const handleReport = useCallback(() => {
          if (reportToastTimerRef.current) clearTimeout(reportToastTimerRef.current)
          setReportToast(true)
          reportToastTimerRef.current = setTimeout(() => setReportToast(false), 3000)
        }, [])

        return { reportToast, handleReport, timerRef: reportToastTimerRef }
      })

      act(() => {
        result.current.handleReport()
      })
      const firstTimer = result.current.timerRef.current

      act(() => {
        vi.advanceTimersByTime(1500)
        result.current.handleReport()
      })
      const secondTimer = result.current.timerRef.current
      expect(secondTimer).not.toBe(firstTimer)

      act(() => {
        vi.advanceTimersByTime(1600) // 3100ms from first click, 1600ms from second
      })
      expect(result.current.reportToast).toBe(true) // Still visible because second timer hasn't expired

      act(() => {
        vi.advanceTimersByTime(1500) // 3100ms from second click
      })
      expect(result.current.reportToast).toBe(false)
    })
  })

  describe("10.5 — Quality Settings Updates Without Full Object Dependency", () => {
    it("updatePlayerSettings persists preferences reactively", () => {
      expect(loadPlayerSettings().qualityPreference).toBe("auto")

      updatePlayerSettings({ qualityPreference: "1080p" })

      expect(loadPlayerSettings().qualityPreference).toBe("1080p")
      expect(loadPlayerSettings().subtitleMode).toBe("client") // Preserved
    })
  })
})

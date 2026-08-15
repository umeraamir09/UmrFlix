import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTouchGestures } from "../touch/use-touch-gestures"
import { useOrientationLock } from "@/hooks/use-orientation-lock"

describe("Mobile & Cross-Browser Tests (Audit 7.1 - 7.5)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    cleanup()
  })

  describe("7.4 — useTouchGestures 200ms responsive tap & double tap", () => {
    function createPointerEvent(type: string, x: number, y: number, pointerType = "touch") {
      return {
        clientX: x,
        clientY: y,
        pointerType,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
        },
      } as unknown as React.PointerEvent<HTMLDivElement>
    }

    it("triggers single tap after 200ms delay", () => {
      const onSingleTap = vi.fn()
      const onSkip = vi.fn()
      const onMouseClick = vi.fn()

      const { result } = renderHook(() =>
        useTouchGestures({
          enabled: true,
          onSingleTap,
          onSkip,
          onMouseClick,
        }),
      )

      act(() => {
        result.current.gestureHandlers.onPointerDown(createPointerEvent("pointerdown", 500, 300))
        result.current.gestureHandlers.onPointerUp(createPointerEvent("pointerup", 500, 300))
      })

      expect(onSingleTap).not.toHaveBeenCalled()

      // Advance by 190ms (not yet fired)
      act(() => {
        vi.advanceTimersByTime(190)
      })
      expect(onSingleTap).not.toHaveBeenCalled()

      // Advance past 200ms -> fired
      act(() => {
        vi.advanceTimersByTime(15)
      })
      expect(onSingleTap).toHaveBeenCalledTimes(1)
      expect(onSkip).not.toHaveBeenCalled()
    })

    it("triggers double-tap skip and cancels single-tap when second tap occurs within 200ms", () => {
      const onSingleTap = vi.fn()
      const onSkip = vi.fn()
      const onMouseClick = vi.fn()

      const { result } = renderHook(() =>
        useTouchGestures({
          enabled: true,
          onSingleTap,
          onSkip,
          onMouseClick,
        }),
      )

      // First tap on right zone (> 65% width = > 650px)
      act(() => {
        result.current.gestureHandlers.onPointerDown(createPointerEvent("pointerdown", 800, 300))
        result.current.gestureHandlers.onPointerUp(createPointerEvent("pointerup", 800, 300))
      })

      // Advance 100ms (within 200ms window)
      act(() => {
        vi.advanceTimersByTime(100)
      })

      // Second tap on right zone
      act(() => {
        result.current.gestureHandlers.onPointerDown(createPointerEvent("pointerdown", 850, 300))
        result.current.gestureHandlers.onPointerUp(createPointerEvent("pointerup", 850, 300))
      })

      expect(onSkip).toHaveBeenCalledWith(10)
      expect(result.current.ripple).toEqual({ side: "right", count: 1 })

      // Advance 300ms — single tap must NEVER fire
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(onSingleTap).not.toHaveBeenCalled()
    })

    it("executes primary mouse clicks immediately without double-tap delay", () => {
      const onSingleTap = vi.fn()
      const onSkip = vi.fn()
      const onMouseClick = vi.fn()

      const { result } = renderHook(() =>
        useTouchGestures({
          enabled: true,
          onSingleTap,
          onSkip,
          onMouseClick,
        }),
      )

      const mouseEvent = {
        clientX: 500,
        clientY: 300,
        pointerType: "mouse",
        button: 0,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
        },
      } as unknown as React.PointerEvent<HTMLDivElement>

      act(() => {
        result.current.gestureHandlers.onPointerUp(mouseEvent)
      })

      expect(onMouseClick).toHaveBeenCalledTimes(1)
      expect(onSingleTap).not.toHaveBeenCalled()
    })
  })

  describe("7.3 — useOrientationLock error handling and active lock tracking", () => {
    it("returns unsupported when screen.orientation.lock is not available", () => {
      // Mock window.screen without lock
      const originalScreen = window.screen
      Object.defineProperty(window, "screen", {
        configurable: true,
        value: { orientation: { type: "portrait-primary", angle: 0 } },
      })

      const { result } = renderHook(() => useOrientationLock())
      expect(result.current.status).toBe("unsupported")

      // Calling release when unsupported does not throw
      act(() => {
        void result.current.release()
      })
      expect(result.current.status).toBe("unsupported")

      Object.defineProperty(window, "screen", {
        configurable: true,
        value: originalScreen,
      })
    })

    it("locks landscape when supported and safely unlocks on release", async () => {
      const mockLock = vi.fn().mockResolvedValue(undefined)
      const mockUnlock = vi.fn()

      const originalScreen = window.screen
      Object.defineProperty(window, "screen", {
        configurable: true,
        value: {
          orientation: {
            lock: mockLock,
            unlock: mockUnlock,
            type: "landscape-primary",
            angle: 90,
          },
        },
      })

      const { result } = renderHook(() => useOrientationLock())
      expect(result.current.status).toBe("idle")

      // Lock landscape
      await act(async () => {
        await result.current.lockLandscape(null)
      })

      expect(mockLock).toHaveBeenCalledWith("landscape")
      expect(result.current.status).toBe("locked")

      // Release
      await act(async () => {
        await result.current.release()
      })

      expect(mockUnlock).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe("idle")

      // Redundant release does NOT call unlock again (prevents Firefox throw)
      await act(async () => {
        await result.current.release()
      })
      expect(mockUnlock).toHaveBeenCalledTimes(1)

      Object.defineProperty(window, "screen", {
        configurable: true,
        value: originalScreen,
      })
    })

    it("handles orientation unlock exceptions gracefully without throwing", async () => {
      const mockLock = vi.fn().mockResolvedValue(undefined)
      const mockUnlock = vi.fn().mockImplementation(() => {
        throw new DOMException("The orientation is not locked.", "InvalidStateError")
      })

      const originalScreen = window.screen
      Object.defineProperty(window, "screen", {
        configurable: true,
        value: {
          orientation: {
            lock: mockLock,
            unlock: mockUnlock,
            type: "landscape-primary",
            angle: 90,
          },
        },
      })

      const { result } = renderHook(() => useOrientationLock())

      await act(async () => {
        await result.current.lockLandscape(null)
      })
      expect(result.current.status).toBe("locked")

      // Release should catch and set status to idle without throwing
      await act(async () => {
        await result.current.release()
      })
      expect(result.current.status).toBe("idle")

      Object.defineProperty(window, "screen", {
        configurable: true,
        value: originalScreen,
      })
    })
  })
})

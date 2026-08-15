import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTouchGestures } from "../touch/use-touch-gestures"
import { useMediaSession } from "../hooks/useMediaSession"
import { useNetworkStatus } from "../hooks/useNetworkStatus"
import { useFrozenPlaybackDetector } from "../hooks/useFrozenPlaybackDetector"

describe("UX Component & Hook Tests (Audit 6.1 - 6.5)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    cleanup()
  })

  describe("6.5 — useTouchGestures 2x speed long-press", () => {
    it("engages 2x speed after 450ms long-press and releases on pointer up", () => {
      const onSingleTap = vi.fn()
      const onSkip = vi.fn()
      const onMouseClick = vi.fn()
      const on2xSpeedChange = vi.fn()

      const { result } = renderHook(() =>
        useTouchGestures({
          enabled: true,
          onSingleTap,
          onSkip,
          onMouseClick,
          on2xSpeedChange,
        }),
      )

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

      // Pointer down
      act(() => {
        result.current.gestureHandlers.onPointerDown(createPointerEvent("pointerdown", 500, 300))
      })

      expect(on2xSpeedChange).not.toHaveBeenCalled()

      // Advance 460ms -> triggers 2x hold
      act(() => {
        vi.advanceTimersByTime(460)
      })

      expect(on2xSpeedChange).toHaveBeenCalledWith(true)
      expect(result.current.is2xActive).toBe(true)

      // Pointer up releases 2x speed and does NOT fire single tap
      act(() => {
        result.current.gestureHandlers.onPointerUp(createPointerEvent("pointerup", 500, 300))
      })

      expect(on2xSpeedChange).toHaveBeenCalledWith(false)
      expect(result.current.is2xActive).toBe(false)
      expect(onSingleTap).not.toHaveBeenCalled()
    })
  })

  describe("6.1 — useMediaSession", () => {
    it("updates MediaMetadata and handles action registrations", () => {
      const mockSetActionHandler = vi.fn()
      const mockSetPositionState = vi.fn()

      // Mock navigator.mediaSession
      const mockMediaSession = {
        metadata: null,
        playbackState: "none",
        setActionHandler: mockSetActionHandler,
        setPositionState: mockSetPositionState,
      }
      Object.defineProperty(navigator, "mediaSession", {
        configurable: true,
        value: mockMediaSession,
      })

      const onTogglePlay = vi.fn()
      const onSeekTo = vi.fn()
      const onSkipBy = vi.fn()

      renderHook(() =>
        useMediaSession({
          title: "Inception",
          subtitle: "Movie",
          poster: "https://example.com/poster.jpg",
          playing: true,
          currentTime: 120,
          duration: 3600,
          playbackRate: 1,
          onTogglePlay,
          onSeekTo,
          onSkipBy,
        }),
      )

      expect(mockMediaSession.playbackState).toBe("playing")
      expect(mockSetActionHandler).toHaveBeenCalledWith("play", expect.any(Function))
      expect(mockSetActionHandler).toHaveBeenCalledWith("pause", expect.any(Function))
      expect(mockSetActionHandler).toHaveBeenCalledWith("seekforward", expect.any(Function))
      expect(mockSetActionHandler).toHaveBeenCalledWith("seekbackward", expect.any(Function))
      expect(mockSetActionHandler).toHaveBeenCalledWith("seekto", expect.any(Function))
    })
  })

  describe("6.3 — useNetworkStatus", () => {
    it("detects offline and online events and invokes callbacks", () => {
      const onOnline = vi.fn()
      const onOffline = vi.fn()

      const { result } = renderHook(() =>
        useNetworkStatus({ onOnline, onOffline }),
      )

      expect(result.current.isOffline).toBe(false)

      act(() => {
        window.dispatchEvent(new Event("offline"))
      })
      expect(result.current.isOffline).toBe(true)
      expect(onOffline).toHaveBeenCalledTimes(1)

      act(() => {
        window.dispatchEvent(new Event("online"))
      })
      expect(result.current.isOffline).toBe(false)
      expect(onOnline).toHaveBeenCalledTimes(1)
    })
  })

  describe("6.2 — useFrozenPlaybackDetector", () => {
    it("escalates recovery when playback is frozen across polling intervals", () => {
      const video = document.createElement("video")
      Object.defineProperty(video, "paused", { configurable: true, get: () => false })
      Object.defineProperty(video, "readyState", { configurable: true, get: () => 4 })
      Object.defineProperty(video, "currentTime", { configurable: true, get: () => 42.0, set: () => {} })
      Object.defineProperty(video, "seeking", { configurable: true, get: () => false })

      const onRecoverAttempt = vi.fn()
      const onFrozenDetected = vi.fn()

      renderHook(() =>
        useFrozenPlaybackDetector({
          videoRef: { current: video },
          playing: true,
          buffering: false,
          engine: "direct",
          hlsRef: { current: null },
          onRecoverAttempt,
          onFrozenDetected,
        }),
      )

      // Advance 3s (1st check: records position)
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(onRecoverAttempt).not.toHaveBeenCalled()

      // Advance another 3s (6s total: 2nd check -> nudge)
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(onRecoverAttempt).toHaveBeenCalledWith(1)

      // Advance another 3s (9s total: 3rd check -> reload/recover)
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(onRecoverAttempt).toHaveBeenCalledWith(2)

      // Advance another 3s (12s total: 4th check -> onFrozenDetected)
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(onFrozenDetected).toHaveBeenCalled()
    })
  })
})

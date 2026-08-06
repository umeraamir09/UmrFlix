"use client"

import { useEffect, useRef, useState } from "react"

export type SkipSide = "left" | "right"
export type SkipRipple = { side: SkipSide; count: number } | null

/** Window in which a second tap on the same side is treated as a double-tap skip. */
const DOUBLE_TAP_MS = 300
/** Movement beyond this between pointerdown/up cancels the tap (it was a drag). */
const TAP_SLOP_PX = 12
/** Taps within the leftmost/rightmost 35% of the layer are skip zones. */
const SIDE_ZONE = 0.35
const SKIP_STEP_SEC = 10
const RIPPLE_LIFETIME_MS = 700

/**
 * Pointer-event gesture recognizer for the player surface.
 *
 * Replaces the old onClick-based tap detection (which relied on synthesized
 * click timing and raced synthesized mouse events) with a deterministic
 * pointerdown/up state machine:
 *
 *  - single tap (deferred by DOUBLE_TAP_MS) → toggle controls
 *  - double tap on the outer 35% zones      → ±10s skip; each further
 *    double-tap pair within the window accumulates the ripple counter
 *  - touch drags (slop) are ignored so scroll/seek gestures never fire taps
 *  - mouse primary click  → instant play/pause toggle (no double-tap delay)
 *  - while locked, taps merely ping `onLockedTap` so the UI can flash the
 *    lock affordance — no playback or visibility state changes
 */
export function useTouchGestures({
  enabled,
  onSingleTap,
  onSkip,
  onMouseClick,
}: {
  /** Master switch — disable while a modal surface (episode browser) is up. */
  enabled: boolean
  onSingleTap: () => void
  onSkip: (deltaSec: number) => void
  onMouseClick: () => void
}) {
  const [ripple, setRipple] = useState<SkipRipple>(null)

  const lastTapRef = useRef<{ time: number; side: SkipSide | "center" }>({
    time: 0,
    side: "center",
  })
  const downPosRef = useRef<{ x: number; y: number } | null>(null)
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rippleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Latest-callback refs keep the gesture handlers referentially stable.
  const callbacksRef = useRef({ onSingleTap, onSkip, onMouseClick })
  useEffect(() => {
    callbacksRef.current = { onSingleTap, onSkip, onMouseClick }
  }, [onSingleTap, onSkip, onMouseClick])

  const clearSingleTapTimer = () => {
    if (singleTapTimerRef.current !== null) {
      clearTimeout(singleTapTimerRef.current)
      singleTapTimerRef.current = null
    }
  }

  // Unmount cleanup: never let a deferred toggle or a stale ripple outlive the player.
  useEffect(() => {
    return () => {
      clearSingleTapTimer()
      if (rippleTimerRef.current !== null) clearTimeout(rippleTimerRef.current)
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || e.pointerType !== "touch") return
    downPosRef.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled) return

    // Mouse path: instant primary-click action, no double-tap window.
    if (e.pointerType === "mouse") {
      if (e.button === 0) callbacksRef.current.onMouseClick()
      return
    }
    if (e.pointerType !== "touch") return

    const down = downPosRef.current
    downPosRef.current = null
    if (!down) return
    // A drag that crossed the slop threshold is not a tap.
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP_PX) return

    const rect = e.currentTarget.getBoundingClientRect()
    const pctX = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5
    const side: SkipSide | "center" =
      pctX < SIDE_ZONE ? "left" : pctX > 1 - SIDE_ZONE ? "right" : "center"
    const now = Date.now()
    const prev = lastTapRef.current

    // Double-tap on the same outer side within the window → skip.
    if (side !== "center" && prev.side === side && now - prev.time < DOUBLE_TAP_MS) {
      clearSingleTapTimer()
      lastTapRef.current = { time: 0, side: "center" }
      callbacksRef.current.onSkip(side === "left" ? -SKIP_STEP_SEC : SKIP_STEP_SEC)
      setRipple((r) => ({ side, count: r?.side === side ? r.count + 1 : 1 }))
      if (rippleTimerRef.current !== null) clearTimeout(rippleTimerRef.current)
      rippleTimerRef.current = setTimeout(() => setRipple(null), RIPPLE_LIFETIME_MS)
      return
    }

    // First tap (or a center tap): defer the toggle until the double-tap
    // window expires so a following tap can promote to a skip instead.
    lastTapRef.current = { time: now, side }
    clearSingleTapTimer()
    singleTapTimerRef.current = setTimeout(() => {
      singleTapTimerRef.current = null
      callbacksRef.current.onSingleTap()
    }, DOUBLE_TAP_MS)
  }

  const onPointerCancel = () => {
    downPosRef.current = null
    clearSingleTapTimer()
  }

  return {
    gestureHandlers: { onPointerDown, onPointerUp, onPointerCancel },
    ripple,
  }
}

"use client"

import { useCallback, useState } from "react"

export type LockStatus = "idle" | "locked" | "unsupported" | "denied"

/** screen.orientation.lock() isn't declared in every TS lib.dom version; type it locally. */
type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>
  angle: number
}

function isLockableOrientation(): boolean {
  if (typeof window === "undefined") return false
  const orientation = window.screen?.orientation as LockableScreenOrientation | undefined
  return !!orientation && typeof orientation.lock === "function"
}

export function useOrientationLock() {
  // Lazy init replaces the old mount-effect probe for lock support
  // (e.g. iOS Safari), so "unsupported" is known from the first render
  // without a setState-inside-effect cascade.
  const [status, setStatus] = useState<LockStatus>(() =>
    isLockableOrientation() ? "idle" : "unsupported",
  )

  const lockLandscape = useCallback(
    async (target?: HTMLElement | null) => {
      if (!isLockableOrientation()) {
        // iOS Safari and browsers where screen.orientation.lock doesn't exist
        setStatus("unsupported")
        return
      }
      const orientation = window.screen?.orientation as LockableScreenOrientation | undefined
      if (!orientation) return

      try {
        const el = target ?? document.documentElement
        if (!document.fullscreenElement) {
          if (el.requestFullscreen) {
            await el.requestFullscreen().catch(() => {})
          } else {
            const webkit = (el as unknown as { webkitRequestFullscreen?: () => void })
              .webkitRequestFullscreen
            if (webkit) webkit.call(el)
          }
        }

        await orientation.lock?.("landscape")
        setStatus("locked")
      } catch (err) {
        // Duplicate/reflexive lock requests (device already rotated, or a
        // re-issued request) must not downgrade a previously successful
        // "locked" state into "denied".
        const or = window.screen?.orientation as LockableScreenOrientation | undefined
        if (typeof or?.angle === "number" && (or.angle === 90 || or.angle === 270)) {
          setStatus("locked")
          return
        }
        const rejectedWhileFullscreen =
          err instanceof DOMException &&
          err.name === "NotAllowedError" &&
          !!document.fullscreenElement
        if (rejectedWhileFullscreen) {
          // Fullscreen already active without a fresh gesture — keep current
          // status; the lock is retried on the next user gesture.
          return
        }
        console.warn("[useOrientationLock] Orientation lock failed:", err)
        setStatus("denied")
      }
    },
    [],
  )

  const release = useCallback(async () => {
    if (typeof window === "undefined") return
    try {
      if (window.screen?.orientation?.unlock) {
        window.screen.orientation.unlock()
      }
    } catch {}
    setStatus("idle")
  }, [])

  return { status, setStatus, lockLandscape, release }
}
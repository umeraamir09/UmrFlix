"use client"

import { useCallback, useEffect, useState } from "react"

export type LockStatus = "idle" | "locked" | "unsupported" | "denied"

export function useOrientationLock() {
  const [status, setStatus] = useState<LockStatus>("idle")

  const lockLandscape = useCallback(
    async (target?: HTMLElement | null) => {
      if (typeof window === "undefined") return
      const orientation = window.screen?.orientation

      if (!orientation || typeof (orientation as any).lock !== "function") {
        // iOS Safari and browsers where screen.orientation.lock doesn't exist
        setStatus("unsupported")
        return
      }

      try {
        const el = target ?? document.documentElement
        if (!document.fullscreenElement) {
          if (el.requestFullscreen) {
            await el.requestFullscreen().catch(() => {})
          } else if ((el as any).webkitRequestFullscreen) {
            await (el as any).webkitRequestFullscreen().catch(() => {})
          }
        }

        await (orientation as any).lock("landscape")
        setStatus("locked")
      } catch (err) {
        console.warn("[useOrientationLock] Orientation lock failed:", err)
        setStatus("denied")
      }
    },
    []
  )

  const release = useCallback(async () => {
    if (typeof window === "undefined") return
    try {
      if (window.screen?.orientation?.unlock) {
        window.screen.orientation.unlock()
      }
    } catch {}
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {})
      }
    } catch {}
    setStatus("idle")
  }, [])

  // Initial check on mount: detect missing lock support (e.g. iOS Safari)
  useEffect(() => {
    if (typeof window === "undefined") return
    const orientation = window.screen?.orientation
    if (!orientation || typeof (orientation as any).lock !== "function") {
      setStatus("unsupported")
    }
  }, [])

  return { status, setStatus, lockLandscape, release }
}

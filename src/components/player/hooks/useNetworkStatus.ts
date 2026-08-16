"use client"

import { useEffect, useState } from "react"
import { playerLog } from "../player-debug"

export type UseNetworkStatusProps = {
  onOnline?: () => void
  onOffline?: () => void
}

/**
 * 6.3 — Network disconnection & reconnection handling.
 * Monitors browser online/offline status, informs the player to display
 * an offline indicator, and triggers automatic reload / hls resume when
 * connectivity returns.
 */
export function useNetworkStatus({ onOnline, onOffline }: UseNetworkStatusProps = {}) {
  const [isOffline, setIsOffline] = useState(() => {
    if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") return false
    return !navigator.onLine
  })

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleOffline = () => {
      playerLog.warn("network", "browser went offline")
      setIsOffline(true)
      onOffline?.()
    }

    const handleOnline = () => {
      playerLog.info("network", "browser connection restored")
      setIsOffline(false)
      onOnline?.()
    }

    window.addEventListener("offline", handleOffline)
    window.addEventListener("online", handleOnline)

    return () => {
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("online", handleOnline)
    }
  }, [onOnline, onOffline])

  return { isOffline }
}

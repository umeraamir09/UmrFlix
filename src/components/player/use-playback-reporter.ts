"use client"

import { useCallback, useEffect, useRef } from "react"

const REPORT_URL = "/api/jellyfin/playback/progress"

export type ReporterState = {
  itemId: string
  mediaSourceId?: string
  playSessionId?: string
  positionTicks: number
  isPaused: boolean
  isMuted: boolean
  volumeLevel: number
  playMethod: "DirectPlay" | "DirectStream" | "Transcode"
  context?: string
}

type ReporterEvent = "start" | "progress" | "stopped"

async function post(body: object, beacon = false) {
  try {
    if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        REPORT_URL,
        new Blob([JSON.stringify(body)], { type: "application/json" }),
      )
      return
    }
    await fetch(REPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    /* reporting must never break playback */
  }
}

/**
 * Bi-directional Jellyfin playback state sync.
 *
 * - `start()`  → POST /Sessions/Playing
 * - interval   → POST /Sessions/Playing/Progress every `heartbeatMs`
 * - `stop()`   → POST /Sessions/Playing/Stopped (also on pagehide via beacon)
 */
export function usePlaybackReporter(
  getState: () => ReporterState | null,
  heartbeatMs = 10_000,
) {
  const startedRef = useRef(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Latest-getter stored in a ref so `send` keeps a stable identity and
  // re-renders / prop changes never reset the heartbeat interval.
  const getStateRef = useRef(getState)
  useEffect(() => {
    getStateRef.current = getState
  })

  const send = useCallback((event: ReporterEvent, beacon = false) => {
    const state = getStateRef.current()
    if (!state) return
    void post({ ...state, event }, beacon)
  }, [])

  const start = useCallback(() => {
    if (startedRef.current) return
    startedRef.current = true
    send("start")
    intervalRef.current = setInterval(() => send("progress"), heartbeatMs)
  }, [send, heartbeatMs])

  const ping = useCallback(() => {
    if (startedRef.current) send("progress")
  }, [send])

  const stop = useCallback(
    (beacon = false) => {
      if (!startedRef.current) return
      startedRef.current = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      send("stopped", beacon)
    },
    [send],
  )

  // Final "Stopped" report when the tab closes / navigates away
  useEffect(() => {
    const handleHide = () => stop(true)
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") stop(true)
    }
    window.addEventListener("pagehide", handleHide)
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      window.removeEventListener("pagehide", handleHide)
      document.removeEventListener("visibilitychange", handleVisibility)
      stop(true)
    }
  }, [stop])

  return { start, stop, ping, isReporting: startedRef }
}

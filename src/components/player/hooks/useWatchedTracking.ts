import { useEffect, useRef } from "react"
import type { PlaybackPayload } from "@/lib/playback-types"

const TICKS_PER_SECOND = 10_000_000
const WATCHED_THRESHOLD = 0.9

export type UseWatchedTrackingParams = {
  payload: PlaybackPayload | null
  currentTime: number
  duration: number
  onWatched?: () => void
}

export function useWatchedTracking({
  payload,
  currentTime,
  duration,
  onWatched,
}: UseWatchedTrackingParams) {
  const watchedReportedRef = useRef(false)

  // Reset when item changes
  useEffect(() => {
    watchedReportedRef.current = false
  }, [payload?.itemId])

  // ── Auto-mark watched at 90% ──
  useEffect(() => {
    if (!payload || watchedReportedRef.current) return
    const runtime =
      payload.runtimeTicks > 0 ? payload.runtimeTicks / TICKS_PER_SECOND : duration
    if (runtime > 0 && currentTime / runtime >= WATCHED_THRESHOLD) {
      watchedReportedRef.current = true
      fetch(`/api/jellyfin/played/${payload.itemId}`, { method: "POST" }).catch(() => {})
      onWatched?.()
    }
  }, [payload, currentTime, duration, onWatched])

  // ── Auto-mark watched once the outro of an episode is reached ──
  useEffect(() => {
    if (!payload?.series || watchedReportedRef.current) return
    const runtime =
      payload.runtimeTicks > 0 ? payload.runtimeTicks / TICKS_PER_SECOND : duration
    const outro = payload.markers.find((m) => m.type === "outro")
    if (outro && currentTime >= outro.start && runtime > 0 && outro.start >= runtime * 0.85) {
      watchedReportedRef.current = true
      fetch(`/api/jellyfin/played/${payload.itemId}`, { method: "POST" }).catch(() => {})
      onWatched?.()
    }
  }, [currentTime, duration, payload, onWatched])

  return { watchedReportedRef }
}

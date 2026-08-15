"use client"

import { useEffect, useRef } from "react"

export type UseMediaSessionProps = {
  title: string
  subtitle?: string
  poster?: string
  playing: boolean
  currentTime: number
  duration: number
  playbackRate: number
  onTogglePlay: () => void
  onSeekTo: (positionSec: number) => void
  onSkipBy: (deltaSec: number) => void
  onNextTrack?: () => void
}

/**
 * 6.1 — Integrates with the browser's Media Session API so mobile lock screens,
 * notification centers, smartwatches, and desktop media keys display accurate
 * title/artwork metadata and control playback.
 */
export function useMediaSession({
  title,
  subtitle,
  poster,
  playing,
  currentTime,
  duration,
  playbackRate,
  onTogglePlay,
  onSeekTo,
  onSkipBy,
  onNextTrack,
}: UseMediaSessionProps) {
  // Callback refs keep action handlers fresh without re-registering handlers on every render
  const callbacksRef = useRef({ onTogglePlay, onSeekTo, onSkipBy, onNextTrack })
  useEffect(() => {
    callbacksRef.current = { onTogglePlay, onSeekTo, onSkipBy, onNextTrack }
  }, [onTogglePlay, onSeekTo, onSkipBy, onNextTrack])

  // Update Media Metadata
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return

    try {
      const artwork = poster
        ? [
            { src: poster, sizes: "96x96", type: "image/jpeg" },
            { src: poster, sizes: "128x128", type: "image/jpeg" },
            { src: poster, sizes: "192x192", type: "image/jpeg" },
            { src: poster, sizes: "256x256", type: "image/jpeg" },
            { src: poster, sizes: "512x512", type: "image/jpeg" },
          ]
        : []

      navigator.mediaSession.metadata = new window.MediaMetadata({
        title,
        artist: subtitle || "UmrFlix",
        album: subtitle ? title : "UmrFlix",
        artwork,
      })
    } catch {
      /* MediaMetadata construction error / unsupported */
    }
  }, [title, subtitle, poster])

  // Register Media Session Action Handlers
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return

    const ms = navigator.mediaSession

    const safeSetAction = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        /* some actions might not be supported across all browsers */
      }
    }

    safeSetAction("play", () => callbacksRef.current.onTogglePlay())
    safeSetAction("pause", () => callbacksRef.current.onTogglePlay())
    safeSetAction("seekforward", (details) =>
      callbacksRef.current.onSkipBy(details.seekOffset ?? 10),
    )
    safeSetAction("seekbackward", (details) =>
      callbacksRef.current.onSkipBy(-(details.seekOffset ?? 10)),
    )
    safeSetAction("seekto", (details) => {
      if (details.seekTime != null && Number.isFinite(details.seekTime)) {
        callbacksRef.current.onSeekTo(details.seekTime)
      }
    })

    if (onNextTrack) {
      safeSetAction("nexttrack", () => callbacksRef.current.onNextTrack?.())
    } else {
      safeSetAction("nexttrack", null)
    }

    return () => {
      safeSetAction("play", null)
      safeSetAction("pause", null)
      safeSetAction("seekforward", null)
      safeSetAction("seekbackward", null)
      safeSetAction("seekto", null)
      safeSetAction("nexttrack", null)
    }
  }, [onNextTrack])

  // Sync Playback State
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return
    try {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused"
    } catch {
      /* ignore */
    }
  }, [playing])

  // Sync Position State
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("mediaSession" in navigator) ||
      !("setPositionState" in navigator.mediaSession) ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return
    }

    try {
      navigator.mediaSession.setPositionState({
        duration: Math.max(0, duration),
        playbackRate: Math.max(0.1, playbackRate || 1),
        position: Math.min(Math.max(0, currentTime), duration),
      })
    } catch {
      /* PositionState validation failed or unsupported */
    }
  }, [currentTime, duration, playbackRate])
}

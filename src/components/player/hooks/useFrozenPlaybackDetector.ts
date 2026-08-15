"use client"

import { useEffect, useRef } from "react"
import type Hls from "hls.js"
import { playerLog } from "../player-debug"

export type UseFrozenPlaybackDetectorProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  playing: boolean
  buffering: boolean
  engine: "direct" | "hls"
  hlsRef: React.RefObject<Hls | null>
  onRecoverAttempt?: (attempt: number) => void
  onFrozenDetected?: () => void
}

/**
 * 6.2 — Frozen playback detection.
 * If the decoder deadlocks (e.g. edge-case HEVC streams or GPU decoder lockup),
 * the video element stays unpaused with readyState >= 2, but currentTime stops
 * advancing without firing stalled/waiting events.
 *
 * This hook polls at 3s intervals and performs escalating recovery:
 *  - Check 2 (6s): micro-nudge video.currentTime (+0.05s) to kickstart the decoder
 *  - Check 3 (9s): recover media / reload buffer via hls.js or video.load()
 *  - Check 4 (12s): trigger onFrozenDetected callback to surface retry/error UI
 */
export function useFrozenPlaybackDetector({
  videoRef,
  playing,
  buffering,
  engine,
  hlsRef,
  onRecoverAttempt,
  onFrozenDetected,
}: UseFrozenPlaybackDetectorProps) {
  const lastTimeRef = useRef<number>(-1)
  const stallCountRef = useRef<number>(0)

  useEffect(() => {
    // Reset state whenever playback stops or starts buffering
    if (!playing || buffering) {
      stallCountRef.current = 0
      lastTimeRef.current = -1
      return
    }

    const intervalId = setInterval(() => {
      const v = videoRef.current
      if (!v || v.paused || !playing || buffering || v.readyState < 2 || v.seeking) {
        stallCountRef.current = 0
        lastTimeRef.current = -1
        return
      }

      const current = v.currentTime
      if (lastTimeRef.current >= 0 && Math.abs(current - lastTimeRef.current) < 0.05) {
        stallCountRef.current += 1
        const count = stallCountRef.current

        if (count === 1) {
          playerLog.warn(
            "frozen-detector",
            `playback frozen @ ${current.toFixed(2)}s (6s stall) — nudging decoder playhead`,
          )
          v.currentTime = Math.max(0, current + 0.05)
          onRecoverAttempt?.(1)
        } else if (count === 2) {
          playerLog.warn(
            "frozen-detector",
            `playback still frozen @ ${current.toFixed(2)}s (9s stall) — triggering stream recovery (${engine})`,
          )
          if (engine === "hls" && hlsRef.current) {
            try {
              hlsRef.current.recoverMediaError()
              hlsRef.current.startLoad()
            } catch {
              /* ignore */
            }
          } else {
            const savedPos = v.currentTime
            try {
              v.load()
              v.currentTime = savedPos
              const playPromise = v.play()
              if (playPromise && typeof playPromise.catch === "function") {
                playPromise.catch(() => {})
              }
            } catch {
              /* ignore */
            }
          }
          onRecoverAttempt?.(2)
        } else if (count >= 3) {
          playerLog.error(
            "frozen-detector",
            `playback unrecoverable @ ${current.toFixed(2)}s (12s stall) — alerting player`,
          )
          onFrozenDetected?.()
        }
      } else {
        stallCountRef.current = 0
        lastTimeRef.current = current
      }
    }, 3000)

    return () => {
      clearInterval(intervalId)
      stallCountRef.current = 0
    }
  }, [playing, buffering, engine, videoRef, hlsRef, onRecoverAttempt, onFrozenDetected])
}

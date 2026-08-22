import { useEffect, type RefObject } from "react"
import type Hls from "hls.js"
import { QUALITY_PRESETS, type PlaybackPayload } from "@/lib/playback-types"
import type { BandwidthEstimator, QualitySuggestionInput } from "../bandwidth-estimator"
import { playerLog } from "../player-debug"

/**
 * After any seek, the buffer needs time to refill before buffer-health is a
 * meaningful ABR signal again. Decisions resume once this window passes.
 */
const SEEK_REFILL_GRACE_MS = 12_000

/** ABR evaluation cadence (buffer-health ring is sized for this interval). */
const EVAL_INTERVAL_MS = 2_000

export type UseAdaptiveBitrateParams = {
  playing: boolean
  qualityId: string
  engine: "direct" | "hls"
  payload: PlaybackPayload | null
  /** Currently APPLIED auto target (null = still running on the initial scan cap). */
  appliedAutoBps: number | null
  /** Effective cap the stream is actually using right now (initial cap or applied). */
  effectiveAutoBps: number
  videoRef: RefObject<HTMLVideoElement | null>
  hlsRef: RefObject<Hls | null>
  estimatorRef: RefObject<BandwidthEstimator>
  rebuildAtPosition: (apply: () => void, label?: string) => void
  setAutoCapBps: (bps: number) => void
  setEstimatedBw: (bw: number) => void
}

function labelForPresetId(id: string): string {
  return QUALITY_PRESETS.find((q) => q.id === id)?.label ?? id
}

export function useAdaptiveBitrate({
  playing,
  qualityId,
  engine,
  payload,
  appliedAutoBps,
  effectiveAutoBps,
  videoRef,
  hlsRef,
  estimatorRef,
  rebuildAtPosition,
  setAutoCapBps,
  setEstimatedBw,
}: UseAdaptiveBitrateParams) {
  useEffect(() => {
    if (!playing || qualityId !== "auto" || engine !== "hls" || !payload) return

    // ── Seek grace window ──
    // A seek (user scrub, keyboard skip, party sync) drains the buffer BY
    // DESIGN — it says nothing about network capacity. Any 'seeking' event
    // opens a grace window during which ABR makes no decisions at all.
    let seekGraceUntil = 0
    const markSeek = () => {
      seekGraceUntil = Date.now() + SEEK_REFILL_GRACE_MS
    }
    const videoEl = videoRef.current
    videoEl?.addEventListener("seeking", markSeek)
    if (videoEl?.seeking) markSeek() // effect attached mid-seek

    const evaluate = (urgent: boolean) => {
      const v = videoRef.current
      if (!v) return
      if (v.seeking || Date.now() < seekGraceUntil) {
        setEstimatedBw(estimatorRef.current.estimatedBandwidth)
        return
      }

      const bufferAhead = v.buffered.length
        ? v.buffered.end(v.buffered.length - 1) - v.currentTime
        : 0

      // Real encoded bitrate of the active level — Jellyfin frequently
      // encodes far below the requested cap, and knowing the true cost lets
      // upgrades happen much sooner.
      const hls = hlsRef.current
      const levelIdx = hls?.currentLevel ?? -1
      const rawActual = levelIdx >= 0 ? hls?.levels?.[levelIdx]?.bitrate : undefined

      const input: QualitySuggestionInput = {
        currentTargetBps: effectiveAutoBps,
        isInitial: appliedAutoBps == null,
        bufferAheadSeconds: bufferAhead,
        sourceBitrate: payload.bitrate ?? undefined,
        actualStreamBitrate: typeof rawActual === "number" && rawActual > 0 ? rawActual : undefined,
        urgent,
      }
      const suggestion = estimatorRef.current.suggest(input)

      setEstimatedBw(suggestion.estimatedBandwidth)

      if (suggestion.action !== "hold") {
        playerLog.info(
          "abr",
          `${suggestion.action} → ${(suggestion.targetBitrateBps / 1_000_000).toFixed(2)}Mbps (${suggestion.reason})`,
        )
        rebuildAtPosition(() => setAutoCapBps(suggestion.targetBitrateBps), labelForPresetId(suggestion.targetPresetId))
      }
    }

    const intervalId = setInterval(() => evaluate(false), EVAL_INTERVAL_MS)

    // Event-driven emergency evaluation: a real stall must react NOW, not on
    // the next tick.
    const onWaiting = () => evaluate(true)
    videoEl?.addEventListener("waiting", onWaiting)

    return () => {
      clearInterval(intervalId)
      videoEl?.removeEventListener("seeking", markSeek)
      videoEl?.removeEventListener("waiting", onWaiting)
    }
  }, [
    playing,
    qualityId,
    engine,
    payload,
    appliedAutoBps,
    effectiveAutoBps,
    videoRef,
    hlsRef,
    estimatorRef,
    rebuildAtPosition,
    setAutoCapBps,
    setEstimatedBw,
  ])
}

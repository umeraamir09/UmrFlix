import { useEffect, type RefObject } from "react"
import { QUALITY_PRESETS, type PlaybackPayload } from "@/lib/playback-types"
import type { BandwidthEstimator } from "../bandwidth-estimator"
import { playerLog } from "../player-debug"

export type UseAdaptiveBitrateParams = {
  playing: boolean
  qualityId: string
  engine: "direct" | "hls"
  payload: PlaybackPayload | null
  autoResolvedId: string | null
  videoRef: RefObject<HTMLVideoElement | null>
  estimatorRef: RefObject<BandwidthEstimator>
  rebuildAtPosition: (apply: () => void, label?: string) => void
  setAutoResolvedId: (id: string | null) => void
  setEstimatedBw: (bw: number) => void
}

export function useAdaptiveBitrate({
  playing,
  qualityId,
  engine,
  payload,
  autoResolvedId,
  videoRef,
  estimatorRef,
  rebuildAtPosition,
  setAutoResolvedId,
  setEstimatedBw,
}: UseAdaptiveBitrateParams) {
  useEffect(() => {
    if (!playing || qualityId !== "auto" || engine !== "hls" || !payload) return

    const id = setInterval(() => {
      const video = videoRef.current
      if (!video) return
      const bufferAhead = video.buffered.length
        ? video.buffered.end(video.buffered.length - 1) - video.currentTime
        : 0

      const suggestion = estimatorRef.current.suggest(
        autoResolvedId ?? "auto",
        bufferAhead,
        payload.bitrate,
      )

      setEstimatedBw(suggestion.estimatedBandwidth)

      if (suggestion.action !== "hold" && suggestion.targetPresetId !== autoResolvedId) {
        playerLog.info(
          "abr",
          `${suggestion.action}: ${autoResolvedId ?? "auto"} → ${suggestion.targetPresetId} (${suggestion.reason})`,
        )
        const abrLabel =
          QUALITY_PRESETS.find((q) => q.id === suggestion.targetPresetId)?.label ??
          suggestion.targetPresetId
        rebuildAtPosition(() => setAutoResolvedId(suggestion.targetPresetId), abrLabel)
      }
    }, 5_000)

    return () => clearInterval(id)
  }, [
    playing,
    qualityId,
    engine,
    payload,
    autoResolvedId,
    videoRef,
    estimatorRef,
    rebuildAtPosition,
    setAutoResolvedId,
    setEstimatedBw,
  ])
}

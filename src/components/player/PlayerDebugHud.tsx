"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { ClipboardCopy, X } from "lucide-react"
import { getDebugEntries, subscribeDebugEntries } from "./player-debug"
import type { PlaybackPayload } from "@/lib/playback-types"
import { maskUrl } from "@/lib/url-utils"

const READY_STATE: Record<number, string> = {
  0: "HAVE_NOTHING",
  1: "HAVE_METADATA",
  2: "HAVE_CURRENT_DATA",
  3: "HAVE_FUTURE_DATA",
  4: "HAVE_ENOUGH_DATA",
}
const NETWORK_STATE: Record<number, string> = {
  0: "EMPTY",
  1: "IDLE",
  2: "LOADING",
  3: "NO_SOURCE",
}

function useDebugEntries() {
  return useSyncExternalStore(subscribeDebugEntries, getDebugEntries, getDebugEntries)
}

export function PlayerDebugHud({
  videoRef,
  payload,
  engine,
  qualityId,
  autoResolvedId,
  estimatedBandwidth,
  netEstimateSources,
  probeReason,
  audioIndex,
  subtitleIndex,
  streamUrl,
  onClose,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  payload: PlaybackPayload | null
  engine: "direct" | "hls"
  qualityId: string
  autoResolvedId?: string | null
  estimatedBandwidth?: number
  /** Phase 4 — where the startup bandwidth estimate came from ("probe+persisted"). */
  netEstimateSources?: string | null
  probeReason: string
  audioIndex: number | null
  subtitleIndex: number | null
  streamUrl: string
  onClose: () => void
}) {
  const entries = useDebugEntries()
  const [stats, setStats] = useState({
    readyState: -1,
    networkState: -1,
    time: 0,
    bufferedEnd: 0,
    duration: 0,
    paused: true,
    seeking: false,
    error: "",
  })
  const [copied, setCopied] = useState(false)

  // 4.4 — poll only while playback is active: a 250ms interval re-rendering
  // the HUD while paused is pure waste. Pause/seek/load transitions sync once
  // directly so paused stats never go stale.
  useEffect(() => {
    const v = videoRef.current
    const sync = () => {
      if (!v) return
      setStats({
        readyState: v.readyState,
        networkState: v.networkState,
        time: v.currentTime,
        bufferedEnd: v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0,
        duration: Number.isFinite(v.duration) ? v.duration : 0,
        paused: v.paused,
        seeking: v.seeking,
        error: v.error ? `${v.error.code} ${v.error.message}` : "",
      })
    }
    const id = setInterval(() => {
      if (!v || v.paused) return
      sync()
    }, 250)
    v?.addEventListener("pause", sync)
    v?.addEventListener("seeked", sync)
    v?.addEventListener("loadedmetadata", sync)
    return () => {
      clearInterval(id)
      v?.removeEventListener("pause", sync)
      v?.removeEventListener("seeked", sync)
      v?.removeEventListener("loadedmetadata", sync)
    }
  }, [videoRef])

  const bufferAhead = Math.max(0, stats.bufferedEnd - stats.time)

  // Close on Escape (5.6) — the HUD is toggled by the "d" key, so Escape must
  // close it too; window-level listener because focus often stays elsewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const copyAll = async () => {
    const v = videoRef.current
    let videoQualityStats = ""
    if (
      v &&
      "getVideoPlaybackQuality" in v &&
      typeof (v as HTMLVideoElement & {
        getVideoPlaybackQuality?: () => {
          totalVideoFrames?: number
          droppedVideoFrames?: number
          corruptedVideoFrames?: number
        }
      }).getVideoPlaybackQuality === "function"
    ) {
      try {
        const q = (
          v as HTMLVideoElement & {
            getVideoPlaybackQuality: () => {
              totalVideoFrames?: number
              droppedVideoFrames?: number
              corruptedVideoFrames?: number
            }
          }
        ).getVideoPlaybackQuality()
        videoQualityStats = `quality: totalFrames=${q.totalVideoFrames ?? "?"} droppedFrames=${q.droppedVideoFrames ?? "?"} corruptedFrames=${q.corruptedVideoFrames ?? "?"}`
      } catch {
        /* ignore */
      }
    }

    const text = [
      `=== UmrFlix CinemaPlayer Diagnostics ===`,
      `timestamp: ${new Date().toISOString()}`,
      `engine=${engine} quality=${qualityId}${autoResolvedId ? ` (ABR → ${autoResolvedId})` : ""}`,
      `bandwidth: ${estimatedBandwidth && estimatedBandwidth > 0 ? `${(estimatedBandwidth / 1_000_000).toFixed(2)} Mbps` : "unknown"}${netEstimateSources ? ` (scan: ${netEstimateSources})` : ""}`,
      `probe: ${probeReason}`,
      `streamUrl: ${maskUrl(streamUrl)}`,
      payload
        ? `payload: container=${payload.container} vcodec=${payload.videoCodec} canDirectPlay=${payload.canDirectPlay} supportsTranscoding=${payload.supportsTranscoding} audio=${payload.audio.map((a) => `[${a.index}]${a.codec}`).join(",")} subs=${payload.subtitles.map((s) => `[${s.index}]${s.codec}${s.isImageBased ? "(img)" : ""}`).join(",")}`
        : "payload: (none)",
      `video: readyState=${READY_STATE[stats.readyState] ?? stats.readyState} networkState=${NETWORK_STATE[stats.networkState] ?? stats.networkState} time=${stats.time.toFixed(2)}s / ${stats.duration.toFixed(1)}s bufferedEnd=${stats.bufferedEnd.toFixed(2)}s (${bufferAhead.toFixed(1)}s ahead) paused=${stats.paused}${stats.error ? ` error=${stats.error}` : ""}`,
      videoQualityStats ? videoQualityStats : null,
      typeof window !== "undefined"
        ? `client: viewport=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio} touch=${window.matchMedia("(pointer: coarse)").matches} ua=${navigator.userAgent}`
        : null,
      "--- Event Log ---",
      ...entries.map(
        (e) => `${new Date(e.t).toISOString()} ${e.level.toUpperCase().padEnd(5)} [${e.tag}] ${maskUrl(e.message)}`,
      ),
    ]
      .filter(Boolean)
      .join("\n")

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Playback diagnostics"
      className="absolute left-2 top-2 z-[60] w-[min(92%,520px)] rounded-lg border border-white/15 bg-black/85 font-mono text-[11px] leading-relaxed text-green-300 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="font-bold tracking-wider text-white/90">PLAYER DEBUG</span>
        <div className="flex items-center gap-1">
          <button
            onClick={copyAll}
            aria-label="Copy debug info to clipboard"
            className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white transition-colors hover:bg-white/20"
          >
            <ClipboardCopy className="size-3" />
            {copied ? "Copied!" : "Copy Debug Info"}
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close debug"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="max-h-[55cqh] overflow-y-auto p-3 [&::-webkit-scrollbar]:w-1">
        <div className="space-y-0.5 whitespace-pre-wrap break-all">
          <p>
            <span className="text-white/50">engine       </span> {engine} · quality {qualityId}{autoResolvedId ? ` (ABR → ${autoResolvedId})` : ""}
          </p>
          <p>
            <span className="text-white/50">bandwidth    </span>{" "}
            {estimatedBandwidth && estimatedBandwidth > 0
              ? `${(estimatedBandwidth / 1_000_000).toFixed(1)} Mbps (est)${netEstimateSources ? ` · scan: ${netEstimateSources}` : ""}`
              : "measuring…"}
          </p>
          <p>
            <span className="text-white/50">probe        </span> {probeReason}
          </p>
          {payload && (
            <p>
              <span className="text-white/50">source       </span> .{payload.container} ·{" "}
              {payload.videoCodec} · audio{" "}
              {payload.audio.map((a) => `${a.codec}@${a.index}${a.index === audioIndex ? "◀" : ""}`).join(", ") || "—"} · sub{" "}
              {subtitleIndex ?? "off"}
            </p>
          )}
          <p>
            <span className="text-white/50">video        </span>{" "}
            {READY_STATE[stats.readyState] ?? "?"} · net {NETWORK_STATE[stats.networkState] ?? "?"} · t=
            {stats.time.toFixed(2)}s / {stats.duration.toFixed(1)}s
          </p>
          <p>
            <span className="text-white/50">buffer       </span> ahead {bufferAhead.toFixed(1)}s · paused=
            {String(stats.paused)} · seeking={String(stats.seeking)}
          </p>
          {stats.error && (
            <p className="text-red-400">
              <span className="text-white/50">media error  </span> {stats.error}
            </p>
          )}
          <p>
            <span className="text-white/50">stream       </span> {maskUrl(streamUrl)}
          </p>
        </div>

        <div className="mt-2 border-t border-white/10 pt-2">
          {entries.length === 0 && <p className="text-white/40">No events yet…</p>}
          {entries.slice(-24).map((e, i) => (
            <p
              key={`${e.t}-${i}`}
              className={
                e.level === "error" ? "text-red-400" : e.level === "warn" ? "text-yellow-300" : ""
              }
            >
              <span className="text-white/35">
                {new Date(e.t).toISOString().slice(11, 23)}
              </span>{" "}
              <span className="text-white/60">[{e.tag}]</span> {maskUrl(e.message)}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

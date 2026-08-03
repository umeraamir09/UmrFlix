"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type Hls from "hls.js"
import {
  QUALITY_PRESETS,
  type PlaybackPayload,
} from "@/lib/playback-types"
import { usePlayerSettings, savePlayerSettings } from "@/lib/player-settings"
import { parseVtt, type VttCue } from "@/lib/vtt"
import {
  SubtitleOverlay,
  loadSubtitleStyle,
  saveSubtitleStyle,
  type SubtitleStyle,
} from "./SubtitleOverlay"
import { PlayerControls } from "./PlayerControls"
import {
  CreditsNextEpisodePill,
  NextEpisodeOverlay,
  PlayerError,
  PlayerLoading,
  SkipSegmentButton,
  formatTimecode,
  type NextEpisodeInfo,
} from "./PlayerOverlays"
import { usePlaybackReporter, type ReporterState } from "./use-playback-reporter"
import { playerLog } from "./player-debug"
import { canBrowserPlayNatively } from "./codec-probe"
import { PlayerDebugHud } from "./PlayerDebugHud"
import { BandwidthEstimator, attachHlsBandwidthMonitor } from "./bandwidth-estimator"
import { applyStreamParams, maskUrl } from "@/lib/url-utils"
import { usePartySync } from "./use-party-sync"
import { PartyBar } from "@/components/party/PartyBar"
import type { EpisodeInfo, SeasonInfo } from "@/components/SeasonBrowser"

const TICKS_PER_SECOND = 10_000_000
const CONTROLS_HIDE_DELAY = 3_500
const NEXT_EPISODE_COUNTDOWN = 10
const WATCHED_THRESHOLD = 0.9

export type CinemaPlayerProps = {
  itemId: string
  title: string
  subtitle?: string
  poster?: string
  autoPlay?: boolean
  /** Fill the entire viewport (Netflix-style /watch page) instead of a 16:9 box. */
  fill?: boolean
  nextEpisode?: NextEpisodeInfo | null
  onNextEpisode?: () => void
  /** Series context for the in-player episode browser. */
  episodes?: EpisodeInfo[] | null
  seasons?: SeasonInfo[]
  onSelectEpisode?: (episodeId: string) => void
  onWatched?: () => void
  onBack?: () => void
  onReport?: () => void
  className?: string
  party?: { partyId: string; isOwner: boolean }
  startAtSec?: number
  onPartyItemChange?: (itemId: string) => void
  onPartyEnded?: () => void
}

export function CinemaPlayer({
  itemId,
  title,
  subtitle,
  poster,
  autoPlay = false,
  fill = false,
  nextEpisode = null,
  onNextEpisode,
  episodes = null,
  seasons = [],
  onSelectEpisode,
  onWatched,
  onBack,
  onReport,
  className = "",
  party,
  startAtSec,
  onPartyItemChange,
  onPartyEnded,
}: CinemaPlayerProps) {
  // ── Refs ──
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const seekTargetRef = useRef<number>(0) // position to restore after stream rebuild
  const watchedReportedRef = useRef(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debugAutoOpenedRef = useRef(false)
  // Scrub seek coalescing: the seek bar fires onSeek on every pointermove
  // (60Hz+ during a drag). Without throttling, a single drag floods the
  // command endpoint and trips the 20-per-10s rate limit, dropping the final
  // position and leaving the room at a stale playhead.
  const lastSeekSendAtRef = useRef(0)
  const pendingSeekRef = useRef<number | null>(null)
  const seekFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Once playback has started (or autoplay is requested) stream rebuilds keep playing
  const playIntentRef = useRef(autoPlay)
  // Tracks whether a stream has ever been attached — used to preserve the
  // playhead across stream rebuilds (quality / track / subtitle-mode changes)
  const hadStreamRef = useRef(false)

  const clientId = useMemo(() => `tab_${Math.random().toString(36).substring(2, 9)}`, [])

  const seekToFn = useCallback((t: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = t
  }, [])

  const partySync = usePartySync({
    partyId: party?.partyId,
    clientId,
    videoRef,
    seekTo: seekToFn,
    onItemChange: onPartyItemChange,
    onPartyEnded,
  })

  // Stable handle for unmount-time fire-and-forget commands; the usePartySync
  // return object is recreated every render, so keep it in a ref (updated in
  // an effect, per react-hooks/refs) instead of depending on it in effects —
  // that would flush pending state on every re-render.
  const partySyncRef = useRef(partySync)
  useEffect(() => {
    partySyncRef.current = partySync
  }, [partySync])

  useEffect(() => {
    if (typeof startAtSec === "number" && startAtSec > 0) {
      seekTargetRef.current = startAtSec
    }
  }, [startAtSec])

  // ── User preferences (navbar settings) ──
  const [playerSettings] = usePlayerSettings()
  const burnSubtitles = playerSettings.subtitleMode === "burn"

  // ── Data state ──
  const [payload, setPayload] = useState<PlaybackPayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  // ── Playback state ──
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [needsManualPlay, setNeedsManualPlay] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)

  // ── Engine / track state ──
  const [qualityId, setQualityId] = useState(() => playerSettings.qualityPreference || "auto")
  const [autoResolvedId, setAutoResolvedId] = useState<string | null>(null)
  const [estimatedBw, setEstimatedBw] = useState<number>(0)
  const estimatorRef = useRef(new BandwidthEstimator())
  const [audioIndex, setAudioIndex] = useState<number | null>(null)
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null)
  // Keyed by subtitle URL — avoids clearing state synchronously on track change
  const [cueState, setCueState] = useState<{ url: string; cues: VttCue[] } | null>(null)
  const [subStyle, setSubStyle] = useState<SubtitleStyle>(() => loadSubtitleStyle())

  // ── UI state ──
  const [endpointReady, setEndpointReady] = useState(false) // playback info settled
  const [controlsVisible, setControlsVisible] = useState(true)
  const [episodeBrowserOpen, setEpisodeBrowserOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [nextPrompt, setNextPrompt] = useState<{ secondsLeft: number } | null>(null)
  const [creditsPillDismissed, setCreditsPillDismissed] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [lastStreamUrl, setLastStreamUrl] = useState("")
  const [volume, setVolume] = useState(() => {
    if (typeof window === "undefined") return 1
    try {
      const v = window.localStorage.getItem("umrflix.volume")
      if (v !== null) return Math.min(1, Math.max(0, Number(v)))
    } catch {}
    return 1
  })
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [reportToast, setReportToast] = useState(false)

  // In party mode, show the party's authoritative playback rate
  const displayPlaybackRate = party?.partyId
    ? (partySync.partyState?.playbackRate ?? playbackRate)
    : playbackRate

  const handlePlaybackRateChange = useCallback(
    (rate: number) => {
      // In party mode, only the host can change speed
      if (party?.partyId && !partySync.isOwner) {
        return
      }
      setPlaybackRate(rate)
      if (videoRef.current) {
        videoRef.current.playbackRate = rate
      }
      if (party?.partyId) {
        partySync.sendCommand("rate", undefined, rate)
      }
    },
    [party?.partyId, partySync]
  )

  const handleReport = useCallback(() => {
    if (onReport) {
      onReport()
    } else {
      setReportToast(true)
      setTimeout(() => setReportToast(false), 3000)
    }
  }, [onReport])

  const updateSubStyle = useCallback((style: SubtitleStyle) => {
    setSubStyle(style)
    saveSubtitleStyle(style)
  }, [])

  const updateVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v))
    setVolume(clamped)
    setMuted(clamped === 0 ? true : false)
    if (videoRef.current) {
      videoRef.current.volume = clamped
      if (clamped > 0) videoRef.current.muted = false
    }
    try {
      window.localStorage.setItem("umrflix.volume", String(clamped))
    } catch {}
  }, [])

  // ── Fetch playback payload ──
  useEffect(() => {
    let cancelled = false
    setPayload(null)
    setLoadError(null)
    setCueState(null)
    setAudioIndex(null)
    setSubtitleIndex(null)
    setEndpointReady(false)
    setNextPrompt(null)
    setCreditsPillDismissed(false)
    setNeedsManualPlay(false)
    setBuffering(false)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setBuffered(0)
    watchedReportedRef.current = false
    seekTargetRef.current = 0
    hadStreamRef.current = false
    playIntentRef.current = autoPlay
    estimatorRef.current.reset()
    setAutoResolvedId(null)
    setEstimatedBw(0)

    fetch(`/api/jellyfin/playback/${itemId}`)
      .then(async (r) => {
        const data = (await r.json()) as PlaybackPayload
        if (!r.ok || data.error) throw new Error(data.error ?? "Failed to load stream")
        return data
      })
      .then((data) => {
        if (cancelled) return
        playerLog.info(
          "payload",
          `item=${data.itemId} container=${data.container} vcodec=${data.videoCodec} canDirectPlay=${data.canDirectPlay} supportsTranscoding=${data.supportsTranscoding} resume=${Math.round(data.resumeTicks / TICKS_PER_SECOND)}s | audio: ${data.audio.map((a) => `[${a.index}] ${a.codec} "${a.title}"`).join(", ") || "none"} | subs: ${data.subtitles.map((s) => `[${s.index}] ${s.codec}${s.isImageBased ? " (image)" : ""}`).join(", ") || "none"} | markers: ${data.markers.map((m) => `${m.type}@${Math.round(m.start)}s`).join(", ") || "none"}`,
        )
        setPayload(data)
        setAudioIndex(data.defaultAudioIndex)
        const defaultSub =
          data.subtitles.find((s) => s.isDefault && !s.isImageBased) ?? null
        setSubtitleIndex(defaultSub ? defaultSub.index : null)
        // Resume watching automatically — playback continues from the
        // Jellyfin-saved position without prompting.
        if (data.resumeTicks > 0) {
          seekTargetRef.current = data.resumeTicks / TICKS_PER_SECOND
        }
        setEndpointReady(true) // triggers the stream setup effect
      })
      .catch((e: Error) => {
        playerLog.error("payload", `failed to load playback info for ${itemId}:`, e)
        if (!cancelled) setLoadError(e.message)
      })

    return () => {
      cancelled = true
    }
  }, [itemId, retryKey, autoPlay])

  // ── Load subtitle cues when the selected track changes ──
  const selectedSubtitle =
    payload?.subtitles.find((s) => s.index === subtitleIndex) ?? null
  // This track is delivered by the server transcoder (burned into the frames):
  // image-based tracks are ALWAYS burned; text tracks only when the user has
  // enabled the "burn subtitles" setting. Otherwise they're swapped in real
  // time by the client-side overlay — no stream rebuild needed.
  const burnSelectedSubtitle = selectedSubtitle != null && (selectedSubtitle.isImageBased || burnSubtitles)
  const clientSideSubtitle = selectedSubtitle != null && !burnSelectedSubtitle
  const cues =
    clientSideSubtitle && selectedSubtitle && cueState?.url === selectedSubtitle.url
      ? cueState.cues
      : []

  useEffect(() => {
    if (!clientSideSubtitle || !selectedSubtitle.url) return
    const url = selectedSubtitle.url
    let cancelled = false
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => {
        if (!cancelled) setCueState({ url, cues: parseVtt(text) })
      })
      .catch(() => {
        if (!cancelled) setCueState({ url, cues: [] })
      })
    return () => {
      cancelled = true
    }
  }, [clientSideSubtitle, selectedSubtitle])

  // ── Engine selection: direct play vs transcoded HLS ──
  const quality = QUALITY_PRESETS.find((q) => q.id === qualityId) ?? (() => {
    if (payload) console.warn(`Unknown qualityId "${qualityId}" — falling back to Auto`)
    return QUALITY_PRESETS[0]
  })()

  // Probe the real browser for container+codec support — the server can
  // only gate on the file, not on what this device can decode.
  const codecProbe = useMemo(() => {
    if (!payload) return { supported: true, reason: "no payload yet" }
    if (!payload.canDirectPlay) {
      return {
        supported: false,
        reason: `server gate: canDirectPlay=false (container=${payload.container}, codec=${payload.videoCodec})`,
      }
    }
    return canBrowserPlayNatively(
      payload.container,
      payload.videoCodec,
      payload.audio.map((a) => a.codec),
    )
  }, [payload])

  const wantsTranscode =
    qualityId !== "auto" ||
    (audioIndex != null && payload != null && audioIndex !== payload.defaultAudioIndex) ||
    burnSelectedSubtitle
  const engine: "direct" | "hls" =
    payload?.canDirectPlay && codecProbe.supported && !wantsTranscode ? "direct" : "hls"

  const engineReason = !payload
    ? "awaiting payload"
    : !payload.canDirectPlay
      ? "direct play rejected by server profile"
      : !codecProbe.supported
        ? `direct play rejected by browser probe (${codecProbe.reason})`
        : wantsTranscode
          ? `transcode requested (quality=${qualityId}${audioIndex != null && audioIndex !== payload.defaultAudioIndex ? ", audio override" : ""}${burnSelectedSubtitle ? selectedSubtitle?.isImageBased ? ", image subs" : ", burned subs" : ""})`
          : "direct play"

  // Log engine decisions once they settle
  useEffect(() => {
    if (!payload) return
    playerLog.info("engine", `decision: ${engine.toUpperCase()} — ${engineReason}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, engine])

  // Single source of truth for the stream URL — ANY change to quality,
  // audio track, burned-in subtitle track or subtitle mode produces a new
  // URL string, and the setup effect below rebuilds the stream reliably
  // whenever it changes.
  const streamUrl = useMemo((): string => {
    if (!payload) return ""
    const params = new URLSearchParams()
    // When qualityId is "auto", use autoResolvedId if set, else default to "fhd" (1080p)
    const effectiveQuality =
      qualityId === "auto"
        ? (autoResolvedId
            ? QUALITY_PRESETS.find((q) => q.id === autoResolvedId)
            : QUALITY_PRESETS.find((q) => q.id === "fhd")) ?? QUALITY_PRESETS[2]
        : quality

    if (effectiveQuality.maxStreamingBitrate) {
      applyStreamParams(params, effectiveQuality)
    } else if (engine === "hls") {
      const sourceBitrate = payload.bitrate ?? 0
      const sourceW = payload.width ?? 1920
      const sourceH = payload.height ?? 1080
      applyStreamParams(params, {
        maxStreamingBitrate:
          sourceBitrate > 0
            ? Math.min(Math.round(sourceBitrate * 1.2), 120_000_000)
            : 40_000_000,
        maxWidth: Math.min(sourceW, 3840),
        maxHeight: Math.min(sourceH, 2160),
      })
    }

    const base = engine === "direct" ? payload.directUrl : payload.hlsUrl
    if (engine === "hls") {
      // OVERRIDE playSessionId to force Jellyfin to launch a NEW transcode session
      // with the requested resolution whenever quality, audio, or burn sub tracks change!
      const activeQualityKey = effectiveQuality.id !== "auto" ? effectiveQuality.id : "fhd"
      const uniquePlaySessionId = `${payload.playSessionId}_q_${activeQualityKey}_a_${audioIndex ?? "def"}_s_${burnSelectedSubtitle ? selectedSubtitle?.index : "off"}`

      const [baseUrl, existingQs] = base.split("?")
      const urlParams = new URLSearchParams(existingQs ?? "")

      urlParams.set("playSessionId", uniquePlaySessionId)
      params.forEach((val, key) => urlParams.set(key, val))

      if (audioIndex != null) urlParams.set("audioStreamIndex", String(audioIndex))
      if (burnSelectedSubtitle) {
        urlParams.set("subtitleStreamIndex", String(selectedSubtitle.index))
        urlParams.set("subtitleMethod", "Encode")
      }
      return `${baseUrl}?${urlParams.toString()}`
    }

    const qs = params.toString()
    return qs ? `${base}&${qs}` : base
  }, [payload, engine, quality, qualityId, autoResolvedId, audioIndex, burnSelectedSubtitle, selectedSubtitle])

  // ── Reporter (heartbeat → Jellyfin) ──
  const getReporterState = useCallback((): ReporterState | null => {
    const video = videoRef.current
    if (!payload || !video) return null
    return {
      itemId: payload.itemId,
      mediaSourceId: payload.mediaSourceId,
      playSessionId: payload.playSessionId,
      positionTicks: Math.round((video.currentTime || 0) * TICKS_PER_SECOND),
      isPaused: video.paused,
      isMuted: video.muted,
      volumeLevel: Math.round((video.volume ?? 1) * 100),
      playMethod: engine === "direct" ? "DirectPlay" : "Transcode",
    }
  }, [payload, engine])
  const reporter = usePlaybackReporter(getReporterState)

  // Stop reporting when leaving this item
  useEffect(() => {
    return () => reporter.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  // ── Stream setup — rebuilds whenever the resolved stream URL changes
  // (quality preset, audio track, burned-in subtitle track, subtitle mode) ──
  useEffect(() => {
    const video = videoRef.current
    if (!video || !payload || !endpointReady) return

    let cancelled = false
    const url = streamUrl
    if (!url) return
    queueMicrotask(() => setLastStreamUrl(url))
    playerLog.info("stream", `building ${engine} stream: ${maskUrl(url)}`)

    // A rebuild while a stream was already attached (quality/track/mode
    // change) must resume where the viewer was, not restart the video.
    if (hadStreamRef.current && seekTargetRef.current === 0 && video.currentTime > 0) {
      seekTargetRef.current = video.currentTime
    }
    hadStreamRef.current = true

    // ── Restore & play helpers ──
    // Position restore MUST NOT happen at MANIFEST_PARSED: with hls.js the
    // video element has no duration at that point (NaN), so the seek was
    // being silently skipped and every quality/track change restarted the
    // video from 0. Restore is attempted on every later readiness milestone
    // until it succeeds, and the seek target is only cleared once applied.
    let restored = false
    const tryRestore = () => {
      if (cancelled || restored) return
      const target = seekTargetRef.current
      if (target <= 0) return
      const dur = video.duration
      if (!Number.isFinite(dur) || dur <= 0) return
      restored = true
      seekTargetRef.current = 0
      video.currentTime = Math.min(target, Math.max(0, dur - 0.5))
      playerLog.info("stream", `restored position → ${target.toFixed(1)}s (duration ${dur.toFixed(1)}s)`)
    }

    const fail = (message: string) => {
      if (!cancelled) setLoadError(message)
    }

    const tryPlay = () => {
      if (cancelled) return
      tryRestore()
      if (playIntentRef.current) {
        playerLog.info("stream", "calling video.play()")
        video.play().catch((err) => {
          playerLog.warn("stream", `play() rejected: ${err?.message ?? err}`)
          if (!cancelled) setNeedsManualPlay(true)
        })
      } else {
        setNeedsManualPlay(true)
      }
    }

    async function setup() {
      hlsRef.current?.destroy()
      hlsRef.current = null
      const el = videoRef.current
      if (!el || cancelled) return
      el.removeAttribute("src")
      el.load()

      if (engine === "direct") {
        el.src = url
        el.addEventListener("loadedmetadata", tryPlay, { once: true })
        return
      }

      if (!payload?.supportsTranscoding) {
        playerLog.error("stream", "direct play unavailable AND transcoding unavailable")
        fail("This file can't be played: direct play unsupported and transcoding unavailable.")
        return
      }

      playerLog.info("hls", "loading hls.js runtime…")
      const { default: HlsCtor } = await import("hls.js")
      if (cancelled) return
      playerLog.info("hls", `hls.js loaded, isSupported=${HlsCtor.isSupported()} nativeHls=${el.canPlayType("application/vnd.apple.mpegurl") || "no"}`)

      if (HlsCtor.isSupported()) {
        const startPos = seekTargetRef.current > 0 ? seekTargetRef.current : -1
        const hls = new HlsCtor({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 60,
          maxBufferLength: 40,
          startPosition: startPos,
          // Jellyfin transcoders can take 30-60s to emit the first segment —
          // hls.js' 20s default frag timeout aborts the request too early and
          // the server has to restart ffmpeg for every retry (endless stall).
          manifestLoadingTimeOut: 20_000,
          manifestLoadingMaxRetry: 2,
          levelLoadingTimeOut: 20_000,
          levelLoadingMaxRetry: 4,
          fragLoadingTimeOut: 60_000,
          fragLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 2_000,
          levelLoadingRetryDelay: 1_500,
          manifestLoadingRetryDelay: 1_500,
        })
        hlsRef.current = hls
        attachHlsBandwidthMonitor(hls, HlsCtor, estimatorRef.current)
        hls.on(HlsCtor.Events.MEDIA_ATTACHED, () => playerLog.info("hls", "media attached"))
        hls.on(HlsCtor.Events.MANIFEST_PARSED, (_e, d) => {
          const levels = d.levels ?? hls.levels ?? []
          playerLog.info(
            "hls",
            `manifest parsed: ${levels.length} level(s) — ${levels
              .map(
                (l, i) =>
                  `[${i}] ${l.width || "?"}x${l.height || "?"}@${((l.bitrate || 0) / 1_000_000).toFixed(1)}Mbps`,
              )
              .join(", ")}`,
          )

          if (levels.length > 0) {
            const targetQuality =
              qualityId === "auto" && autoResolvedId
                ? QUALITY_PRESETS.find((q) => q.id === autoResolvedId) ?? quality
                : quality

            if (qualityId === "auto" && !autoResolvedId) {
              // Auto mode with no downgrade resolved: start at top level (1080p/4K) and enable ABR (-1)
              const topIdx = levels.length - 1
              hls.startLevel = topIdx
              hls.currentLevel = -1 // ABR
              playerLog.info(
                "hls",
                `auto quality: starting at top level [${topIdx}] (${levels[topIdx]?.width}x${levels[topIdx]?.height}) with ABR enabled`,
              )
            } else if (targetQuality.maxHeight) {
              // Lock hls.js to the closest level matching or within target height
              const maxH = targetQuality.maxHeight
              let bestIdx = 0
              let bestDiff = Infinity
              for (let i = 0; i < levels.length; i++) {
                const h = levels[i].height || 0
                if (h > 0 && h <= maxH) {
                  const diff = maxH - h
                  if (diff < bestDiff) {
                    bestDiff = diff
                    bestIdx = i
                  }
                }
              }
              if (bestDiff === Infinity && levels.length > 0) {
                bestIdx = levels.length - 1
              }
              playerLog.info(
                "hls",
                `locking hls level to [${bestIdx}] (${levels[bestIdx]?.width}x${levels[bestIdx]?.height}) for quality ${qualityId} (maxHeight=${maxH})`,
              )
              hls.startLevel = bestIdx
              hls.currentLevel = bestIdx
            }
          }

          tryPlay()
        })
        hls.on(HlsCtor.Events.LEVEL_LOADED, () => tryRestore())
        let firstFragLogged = false
        let parseErrorCount = 0
        let mediaRecoveryAttempts = 0
        let networkRecoveryAttempts = 0
        hls.on(HlsCtor.Events.FRAG_BUFFERED, () => {
          parseErrorCount = 0
          if (!firstFragLogged) {
            firstFragLogged = true
            playerLog.info("hls", "first fragment buffered")
          }
          tryRestore()
        })
        hls.on(HlsCtor.Events.ERROR, (_event, data) => {
          const detail = `${data.type}/${data.details} fatal=${data.fatal}${data.url ? ` url=${maskUrl(data.url)}` : ""} reason=${data.reason ?? ""}`
          if (!data.fatal) {
            playerLog.warn("hls", detail)
            // Jellyfin returns empty 200s while the transcoder spins up or
            // after ffmpeg crashed — count the parse failures and surface a
            // clear error instead of looping forever.
            if (data.details === HlsCtor.ErrorDetails.FRAG_PARSING_ERROR) {
              parseErrorCount++
              if (parseErrorCount >= 6) {
                fail(
                  "The Jellyfin transcoder failed to produce video segments. " +
                    "The server's ffmpeg transcoding may be misconfigured or overloaded — check the Jellyfin server logs.",
                )
              }
            }
            return
          }
          playerLog.error("hls", detail)
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
            networkRecoveryAttempts++
            if (networkRecoveryAttempts > 3) {
              fail("Video segments could not be fetched — the transcoding session may have died on the server.")
              return
            }
            hls.startLoad() // recover from transient network stalls
          } else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
            mediaRecoveryAttempts++
            if (mediaRecoveryAttempts > 2) {
              fail(
                "The stream could not be decoded after multiple recovery attempts. " +
                  "The server's transcoder may have failed — check the Jellyfin server logs.",
              )
              return
            }
            hls.recoverMediaError()
          } else {
            fail("The stream failed to load. Please try again.")
          }
        })
        hls.loadSource(url)
        hls.attachMedia(el)
      } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari: native HLS
        el.src = url
        el.addEventListener("loadedmetadata", tryPlay, { once: true })
      } else if (!cancelled) {
        playerLog.error("hls", "neither MSE-hls.js nor native HLS available")
        fail("HLS playback is not supported in this browser.")
      }
    }

    void setup()

    return () => {
      // Preserve the playhead BEFORE hls.js detaches — detaching the
      // MediaSource can reset video.currentTime, which is exactly the
      // "restarts from 0" symptom on quality/track changes.
      if (video.currentTime > 0 && seekTargetRef.current === 0) {
        seekTargetRef.current = video.currentTime
      }
      cancelled = true
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, streamUrl, endpointReady])

  // Preserve volume across stream rebuilds
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume
      videoRef.current.muted = muted
    }
  }, [payload, endpointReady, engine, volume, muted])

  // ── Auto-mark watched at 90% ──
  useEffect(() => {
    if (!payload || watchedReportedRef.current) return
    const runtime = payload.runtimeTicks > 0 ? payload.runtimeTicks / TICKS_PER_SECOND : duration
    if (runtime > 0 && currentTime / runtime >= WATCHED_THRESHOLD) {
      watchedReportedRef.current = true
      fetch(`/api/jellyfin/played/${payload.itemId}`, { method: "POST" }).catch(() => {})
      onWatched?.()
    }
  }, [currentTime, duration, payload, onWatched])

  // ── Auto-mark watched once the outro of an episode is reached ──
  useEffect(() => {
    if (!payload?.series || watchedReportedRef.current) return
    const runtime = payload.runtimeTicks > 0 ? payload.runtimeTicks / TICKS_PER_SECOND : duration
    const outro = payload.markers.find((m) => m.type === "outro")
    // Only trust the marker when it sits genuinely near the end — the chapter
    // fallback can match titles like "End of Part 1" well before the credits,
    // which would otherwise mark an episode watched mid-way through.
    if (outro && currentTime >= outro.start && runtime > 0 && outro.start >= runtime * 0.85) {
      watchedReportedRef.current = true
      fetch(`/api/jellyfin/played/${payload.itemId}`, { method: "POST" }).catch(() => {})
      onWatched?.()
    }
  }, [currentTime, duration, payload, onWatched])

  // ── Controls auto-hide (while playing) ──
  useEffect(() => {
    if (!playing || episodeBrowserOpen) return
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_DELAY)
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [playing, episodeBrowserOpen])

  const pokeControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (!episodeBrowserOpen && videoRef.current && !videoRef.current.paused) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_DELAY)
    }
  }, [episodeBrowserOpen])

  // Auto-open the diagnostics HUD for party hosts after prolonged buffering —
  // they need visibility into stuck streams, but we don't want to auto-show a
  // diagnostics surface to regular viewers. Closes itself once playback resumes.
  useEffect(() => {
    if (!party?.partyId || !partySync.isOwner) return
    if (buffering) {
      const id = setTimeout(() => {
        debugAutoOpenedRef.current = true
        setDebugOpen(true)
      }, 8_000)
      return () => clearTimeout(id)
    }
    if (debugAutoOpenedRef.current) {
      debugAutoOpenedRef.current = false
      setDebugOpen(false)
    }
  }, [buffering, party?.partyId, partySync.isOwner])

  // ── Fullscreen ──
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void containerRef.current?.requestFullscreen()
    }
  }, [])

  const togglePip = useCallback(() => {
    const video = videoRef.current
    if (!video || !document.pictureInPictureEnabled) return
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture()
    } else {
      void video.requestPictureInPicture().catch(() => {})
    }
  }, [])

  // ── Playback helpers ──
  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (party?.partyId) {
      const isPaused = video.paused
      partySync.sendCommand(isPaused ? "play" : "pause", video.currentTime)
    }

    if (video.paused) {
      setNeedsManualPlay(false)
      video.play().catch(() => setNeedsManualPlay(true))
    } else {
      video.pause()
    }
  }, [party?.partyId, partySync])

  const seekTo = useCallback(
    (t: number) => {
      const video = videoRef.current
      if (!video) return
      video.currentTime = t
      if (!party?.partyId) return

      // Coalesce scrub seeks: send at most one command per 650ms, but always
      // flush the final drag position (trailing edge) so the room lands where
      // the user let go — never at a rate-limited stale position. 650ms keeps
      // a sustained drag under the 20-commands/10s rate limit with headroom.
      const now = Date.now()
      pendingSeekRef.current = t
      if (now - lastSeekSendAtRef.current >= 650) {
        lastSeekSendAtRef.current = now
        const target = pendingSeekRef.current
        pendingSeekRef.current = null
        partySync.sendCommand("seek", target)
      } else {
        if (seekFlushTimerRef.current) clearTimeout(seekFlushTimerRef.current)
        seekFlushTimerRef.current = setTimeout(() => {
          const target = pendingSeekRef.current
          if (target === null) return
          pendingSeekRef.current = null
          lastSeekSendAtRef.current = Date.now()
          partySync.sendCommand("seek", target)
        }, 650)
      }
    },
    [party?.partyId, partySync]
  )

  // Flush a pending scrub seek when leaving the page: fire-and-forget the
  // final drag position so the room isn't left at a stale playhead when the
  // player unmounts mid-drag.
  useEffect(() => {
    return () => {
      if (seekFlushTimerRef.current) {
        clearTimeout(seekFlushTimerRef.current)
        seekFlushTimerRef.current = null
      }
      const target = pendingSeekRef.current
      if (target !== null) {
        pendingSeekRef.current = null
        void partySyncRef.current.sendCommand("seek", target)
      }
    }
  }, [])

  const rebuildAtPosition = useCallback((apply: () => void) => {
    seekTargetRef.current = videoRef.current?.currentTime ?? 0
    apply()
  }, [])

  // ── Adaptive quality check (runs every 5s while playing in "auto" mode) ──
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
        rebuildAtPosition(() => setAutoResolvedId(suggestion.targetPresetId))
      }
    }, 5_000)

    return () => clearInterval(id)
  }, [playing, qualityId, engine, payload, autoResolvedId, rebuildAtPosition])

  const handleQualityChange = useCallback(
    (id: string) => {
      playerLog.info("user", `quality change → ${id}`)
      savePlayerSettings({ ...playerSettings, qualityPreference: id })
      if (id === "auto") {
        estimatorRef.current.reset()
        setAutoResolvedId(null)
      }
      rebuildAtPosition(() => setQualityId(id))
    },
    [rebuildAtPosition, playerSettings],
  )
  const handleAudioChange = useCallback(
    (index: number) => {
      playerLog.info("user", `audio track change → index ${index}`)
      rebuildAtPosition(() => setAudioIndex(index))
    },
    [rebuildAtPosition],
  )
  const handleSubtitleChange = useCallback(
    (index: number | null) => {
      // Burned-in tracks (image-based, or any track while the "burn subtitles"
      // setting is on) require a transcoded stream rebuild; text tracks in the
      // default client-side mode swap out in real time without interrupting
      // playback.
      const track = payload?.subtitles.find((s) => s.index === index)
      playerLog.info("user", `subtitle change → ${track ? `[${index}] ${track.title}` : "off"}`)
      const targetBurns = track != null && (track.isImageBased || burnSubtitles)
      if (targetBurns || burnSelectedSubtitle) {
        rebuildAtPosition(() => setSubtitleIndex(index))
      } else {
        setSubtitleIndex(index)
      }
    },
    [payload, burnSubtitles, burnSelectedSubtitle, rebuildAtPosition],
  )

  // ── Next-episode auto-play countdown ──
  useEffect(() => {
    if (!nextPrompt) return
    if (nextPrompt.secondsLeft <= 0) {
      const id = setTimeout(() => {
        setNextPrompt(null)
        onNextEpisode?.()
      }, 0)
      return () => clearTimeout(id)
    }
    const id = setTimeout(
      () => setNextPrompt((p) => (p ? { secondsLeft: p.secondsLeft - 1 } : p)),
      1_000,
    )
    return () => clearTimeout(id)
  }, [nextPrompt, onNextEpisode])

  const beginNextEpisode = useCallback(() => {
    setNextPrompt(null)
    onNextEpisode?.()
  }, [onNextEpisode])

  // ── Active skip marker ──
  const activeMarker =
    payload?.markers.find((m) => currentTime >= m.start && currentTime < m.end - 0.25) ?? null
  const showCreditsPill =
    activeMarker?.type === "outro" &&
    !!nextEpisode &&
    !creditsPillDismissed &&
    !nextPrompt

  // ── Keyboard shortcuts ──
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // The episode browser is a full-screen modal with its own focusable
    // content — let its keys (arrows, Space, Tab) operate the list, not the
    // player. It also handles Escape itself.
    if (episodeBrowserOpen) return
    const target = e.target as HTMLElement
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return
    const video = videoRef.current
    if (!video) return
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault()
        togglePlay()
        break
      case "ArrowRight":
      case "l":
        e.preventDefault()
        seekTo(Math.min(duration || video.duration, video.currentTime + 10))
        break
      case "ArrowLeft":
      case "j":
        e.preventDefault()
        seekTo(Math.max(0, video.currentTime - 10))
        break
      case "ArrowUp":
        e.preventDefault()
        updateVolume(volume + 0.1)
        break
      case "ArrowDown":
        e.preventDefault()
        updateVolume(volume - 0.1)
        break
      case "m": {
        const next = !muted
        video.muted = next
        setMuted(next)
        break
      }
      case "f":
        toggleFullscreen()
        break
      case "d":
        setDebugOpen((o) => !o)
        break
    }
    pokeControls()
  }

  const startedOrWaiting = endpointReady && !loadError
  const autoResolvedLabel = autoResolvedId
    ? QUALITY_PRESETS.find((q) => q.id === autoResolvedId)?.label
    : undefined
  const qualityLabel =
    qualityId === "auto" && autoResolvedLabel
      ? `Auto (${autoResolvedLabel})`
      : quality.label

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={pokeControls}
      onTouchStart={pokeControls}
      className={`group relative select-none overflow-hidden bg-black outline-none [container-type:inline-size] ${
        fill ? "h-dvh w-screen rounded-none" : "aspect-video w-full rounded-lg"
      } ${!controlsVisible && playing && !episodeBrowserOpen ? "cursor-none" : ""} ${className}`}
    >
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        className="size-full"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => {
          setPlaying(true)
          setNeedsManualPlay(false)
          playIntentRef.current = true
          playerLog.info("video", `play event @ ${videoRef.current?.currentTime.toFixed(2)}s`)
          reporter.start()
        }}
        onPause={() => {
          setPlaying(false)
          reporter.ping()
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0)
          playerLog.info("video", `loadedmetadata: duration=${e.currentTarget.duration.toFixed(1)}s ${e.currentTarget.videoWidth}x${e.currentTarget.videoHeight}`)
        }}
        onCanPlay={() => playerLog.info("video", "canplay")}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onProgress={(e) => {
          const v = e.currentTarget
          if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1))
        }}
        onWaiting={() => {
          setBuffering(true)
          const v = videoRef.current
          const ahead = v && v.buffered.length ? v.buffered.end(v.buffered.length - 1) - v.currentTime : 0
          playerLog.warn("video", `STALLED — waiting @ ${v?.currentTime.toFixed(2)}s, readyState=${v?.readyState}, buffer ahead=${ahead.toFixed(2)}s`)
        }}
        onStalled={() => playerLog.warn("video", "stalled event — download stopped before enough data")}
        onPlaying={() => {
          setBuffering(false)
          playerLog.info("video", `PLAYING @ ${videoRef.current?.currentTime.toFixed(2)}s`)
          reporter.ping()
        }}
        onSeeking={() => playerLog.info("video", `seeking → ${videoRef.current?.currentTime.toFixed(2)}s`)}
        onEnded={() => {
          playerLog.info("video", "ended")
          reporter.stop()
          // In a watch party only the host advances to the next item; every
          // other member holds at the end and follows the host's party:item
          // broadcast — per-tab end timers would desync the group.
          if (party?.partyId && !partySync.isOwner) return
          if (nextEpisode && onNextEpisode) {
            setNextPrompt({ secondsLeft: NEXT_EPISODE_COUNTDOWN })
          }
        }}
        onError={() => {
          const v = videoRef.current
          const mediaError = v?.error
          playerLog.error(
            "video",
            `MEDIA ERROR code=${mediaError?.code} message=${mediaError?.message || "(none)"} src=${v?.currentSrc ? maskUrl(v.currentSrc) : "(no src)"} readyState=${v?.readyState} networkState=${v?.networkState}`,
          )
          if (v?.src || hlsRef.current) {
            setLoadError("Playback error — the stream could not be loaded.")
          }
        }}
      />

      {/* Watch Party overlay bar */}
      {party?.partyId && (
        <PartyBar
          partyId={party.partyId}
          isOwner={partySync.isOwner}
          members={partySync.members}
          bufferingUsers={partySync.bufferingUsers}
        />
      )}

      {/* Custom subtitle overlay renderer */}
      <SubtitleOverlay
        cues={cues}
        currentTime={currentTime}
        style={subStyle}
        controlsVisible={controlsVisible || !playing}
      />

      {/* Loading / buffering / error */}
      {!payload && !loadError && <PlayerLoading />}
      {payload && buffering && !loadError && <PlayerLoading message="" />}
      {loadError && (
        <PlayerError message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />
      )}

      {/* Skip intro / recap / credits */}
      {activeMarker && !nextPrompt && (
        <SkipSegmentButton
          type={activeMarker.type}
          raised={showCreditsPill}
          onSkip={() => {
            seekTo(activeMarker.end + 0.3)
            pokeControls()
          }}
        />
      )}

      {/* Credits: compact "up next" prompt */}
      {showCreditsPill && nextEpisode && (
        <CreditsNextEpisodePill
          next={nextEpisode}
          onPlayNow={beginNextEpisode}
          onDismiss={() => setCreditsPillDismissed(true)}
        />
      )}

      {/* Post-roll auto-play countdown */}
      {nextPrompt && nextEpisode && (
        <NextEpisodeOverlay
          next={nextEpisode}
          countdownSeconds={nextPrompt.secondsLeft}
          onPlayNow={beginNextEpisode}
          onCancel={() => setNextPrompt(null)}
        />
      )}

      {/* Control bar */}
      {payload && startedOrWaiting && endpointReady && (
        <PlayerControls
          visible={controlsVisible || !playing || !!nextPrompt || episodeBrowserOpen}
          title={title}
          subtitle={subtitle}
          playing={playing}
          currentTime={currentTime}
          duration={duration || payload.runtimeTicks / TICKS_PER_SECOND}
          buffered={buffered}
          volume={volume}
          muted={muted}
          qualityId={qualityId}
          autoResolvedLabel={autoResolvedLabel}
          audioTracks={payload.audio}
          audioIndex={audioIndex}
          subtitleTracks={payload.subtitles}
          subtitleIndex={subtitleIndex}
          subStyle={subStyle}
          playbackRate={displayPlaybackRate}
          isFullscreen={isFullscreen}
          hasNext={!!nextEpisode && !!onNextEpisode}
          chapters={payload.chapters}
          itemId={payload.itemId}
          trickplay={payload.trickplay}
          seriesId={payload.series?.id}
          episodes={episodes}
          seasons={seasons}
          onSelectEpisode={onSelectEpisode}
          episodeBrowserOpen={episodeBrowserOpen}
          onToggleEpisodeBrowser={() => setEpisodeBrowserOpen((o) => !o)}
          onTogglePlay={togglePlay}
          onSeek={seekTo}
          onSkipBy={(d) => {
            const v = videoRef.current
            if (v) seekTo(Math.min(Math.max(0, v.currentTime + d), duration || v.duration))
          }}
          onVolumeChange={updateVolume}
          onToggleMute={() => {
            const v = videoRef.current
            const next = !muted
            if (v) v.muted = next
            setMuted(next)
          }}
          onQualityChange={handleQualityChange}
          onAudioChange={handleAudioChange}
          onSubtitleChange={handleSubtitleChange}
          onSubStyleChange={updateSubStyle}
          onPlaybackRateChange={handlePlaybackRateChange}
          onToggleFullscreen={toggleFullscreen}
          onTogglePip={togglePip}
          onNextEpisode={beginNextEpisode}
          onBack={onBack}
          onReport={handleReport}
        />
      )}

      {/* Report Toast Notification */}
      {reportToast && (
        <div className="pointer-events-none absolute top-16 left-1/2 z-50 -translate-x-1/2 rounded-md bg-white/90 px-4 py-2 text-xs font-semibold text-black shadow-lg backdrop-blur animate-in fade-in duration-200">
          Issue reported. Thank you for your feedback!
        </div>
      )}

      {/* Unblocked-autoplay resume helper text while paused at start */}
      {needsManualPlay && endpointReady && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded bg-black/70 px-3 py-1.5 text-xs font-semibold text-gray-200 backdrop-blur">
          Press play to start {qualityLabel ? `— ${qualityLabel}` : ""}
        </div>
      )}

      {/* Diagnostics HUD (toggle: d key; auto-opens on prolonged buffering) */}
      {debugOpen && (
        <PlayerDebugHud
          videoRef={videoRef}
          payload={payload}
          engine={engine}
          qualityId={qualityId}
          autoResolvedId={autoResolvedId}
          estimatedBandwidth={estimatedBw}
          probeReason={codecProbe.reason}
          audioIndex={audioIndex}
          subtitleIndex={subtitleIndex}
          streamUrl={lastStreamUrl}
          onClose={() => setDebugOpen(false)}
        />
      )}
    </div>
  )
}

export { formatTimecode }

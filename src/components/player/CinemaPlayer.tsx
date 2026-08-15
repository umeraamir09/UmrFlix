"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type Hls from "hls.js"
import {
  QUALITY_PRESETS,
  type PlaybackPayload,
} from "@/lib/playback-types"
import { usePlayerSettings, savePlayerSettings } from "@/lib/player-settings"
import { SubtitleOverlay } from "./SubtitleOverlay"
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
import { buildHlsConfig } from "./hls-config"
import { applyStreamParams, maskUrl } from "@/lib/url-utils"
import { createThrottledClock } from "@/lib/tick-throttle"
import { usePartySync } from "./use-party-sync"
import { PartyBar } from "@/components/party/PartyBar"
import type { EpisodeInfo, SeasonInfo } from "@/components/SeasonBrowser"
import { TouchControls } from "./touch/TouchControls"
import { useTouchGestures } from "./touch/use-touch-gestures"
import { useOrientationLock } from "@/hooks/use-orientation-lock"
import { useVolumeManager } from "./hooks/useVolumeManager"
import { useWatchedTracking } from "./hooks/useWatchedTracking"
import { usePlayerControls } from "./hooks/usePlayerControls"
import { useSubtitles } from "./hooks/useSubtitles"
import { useAdaptiveBitrate } from "./hooks/useAdaptiveBitrate"

const TICKS_PER_SECOND = 10_000_000
const NEXT_EPISODE_COUNTDOWN = 10

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
  const { status: orientationStatus, lockLandscape, release: releaseOrientation } = useOrientationLock()

  const hlsRef = useRef<Hls | null>(null)
  const seekTargetRef = useRef<number>(0) // position to restore after stream rebuild
  const watchedReportedRef = useRef(false)
  const debugAutoOpenedRef = useRef(false)
  // Scrub seek coalescing: the seek bar fires onSeek on every pointermove
  // (60Hz+ during a drag). Without throttling, a single drag floods the
  // command endpoint and trips the 20-per-10s rate limit, dropping the final
  // position and leaving the room at a stale playhead.
  const lastSeekSendAtRef = useRef(0)
  const pendingSeekRef = useRef<number | null>(null)
  const seekFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 4.1 — high-frequency playback clock: currentTimeRef is written on every
  // timeupdate (zero re-renders); the `currentTime` state mirror is throttled
  // to at most one update per 250ms for UI consumers (seek bar, subtitles,
  // skip markers, watched tracking).
  const currentTimeRef = useRef(0)
  const timeTickThrottleRef = useRef(createThrottledClock(250))
  // Once playback has started (or autoplay is requested) stream rebuilds keep playing
  const playIntentRef = useRef(autoPlay)
  // Tracks whether a stream has ever been attached — used to preserve the
  // playhead across stream rebuilds (quality / track / subtitle-mode changes)
  const hadStreamRef = useRef(false)
  // 1.1 — frame-capture canvas held across stream teardown/rebuild
  const frameCaptureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  // 1.1 — human-readable label for the pending stream rebuild (e.g. "720p", "Audio Track 2")
  const qualityChangeLabel = useRef<string | null>(null)

  const [clientId] = useState(() => `tab_${Math.random().toString(36).substring(2, 9)}`)

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
    // 3.5 — Number.isFinite excludes NaN (typeof NaN === "number" passes a
    // bare typeof check) so a malformed startAtSec can never seed a NaN seek.
    if (typeof startAtSec === "number" && Number.isFinite(startAtSec) && startAtSec > 0) {
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

  // ── Subtitles Hook ──
  const {
    subStyle,
    updateSubStyle,
    selectedSubtitle,
    burnSelectedSubtitle,
    cues,
  } = useSubtitles({
    payload,
    subtitleIndex,
    burnSubtitles,
  })

  // ── UI state ──
  const [endpointReady, setEndpointReady] = useState(false) // playback info settled
  const [episodeBrowserOpen, setEpisodeBrowserOpen] = useState(false)

  const [isFullscreen, setIsFullscreen] = useState(false)
  const [nextPrompt, setNextPrompt] = useState<{ secondsLeft: number } | null>(null)
  const [creditsPillDismissed, setCreditsPillDismissed] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [lastStreamUrl, setLastStreamUrl] = useState("")
  const [playbackRate, setPlaybackRate] = useState(1)
  const [reportToast, setReportToast] = useState(false)
  // 1.1 — shows "Switching to 720p…" (etc.) in the buffering overlay during a stream rebuild
  const [qualitySwitchToast, setQualitySwitchToast] = useState<string | null>(null)
  const [isTouchDevice, setIsTouchDevice] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia("(pointer: coarse)").matches
  })

  // ── Volume Hook ──
  const { volume, muted, updateVolume, toggleMute, setMuted } = useVolumeManager(videoRef)

  // ── Controls Hook ──
  const { controlsVisible, pokeControls } = usePlayerControls({
    playing,
    episodeBrowserOpen,
  })

  // ── A11y: visually-hidden live region + announcement helper (issue 5.2) ──
  const liveRegionRef = useRef<HTMLDivElement>(null)
  const announce = useCallback((message: string) => {
    if (liveRegionRef.current) liveRegionRef.current.textContent = message
  }, [])

  // 5.3 — when the controls auto-hide while focus is on a disappearing button,
  // redirect focus to the player surface (Netflix-style) instead of dropping
  // it to <body> and breaking keyboard navigation.
  useEffect(() => {
    if (controlsVisible || !playing || episodeBrowserOpen) return
    const el = containerRef.current
    const active = document.activeElement
    if (el && active instanceof Node && el.contains(active)) {
      el.focus({ preventScroll: true })
    }
  }, [controlsVisible, playing, episodeBrowserOpen])

  // 5.2 — announce playback-state transitions (playing/paused/buffering/error)
  // on actual changes only, so the live region never re-announces steady state.
  const prevA11yStateRef = useRef({ playing: false, buffering: false, error: null as string | null })
  useEffect(() => {
    const prev = prevA11yStateRef.current
    prevA11yStateRef.current = { playing, buffering, error: loadError }
    if (loadError !== prev.error) {
      if (loadError) announce(`Playback error: ${loadError}`)
      return
    }
    if (buffering && !prev.buffering) {
      announce("Buffering")
      return
    }
    if (playing && !prev.playing) {
      announce("Playing")
      return
    }
    if (prev.playing && !playing && !buffering && endpointReady) {
      announce("Paused")
    }
  }, [playing, buffering, loadError, endpointReady, announce])

  // 5.2 — announce volume/mute changes with a short trailing debounce so a
  // slider drag collapses into a single announcement.
  const volumeAnnounceInitRef = useRef(false)
  const volumeAnnounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!volumeAnnounceInitRef.current) {
      volumeAnnounceInitRef.current = true
      return
    }
    if (volumeAnnounceTimerRef.current) clearTimeout(volumeAnnounceTimerRef.current)
    volumeAnnounceTimerRef.current = setTimeout(() => {
      announce(muted ? "Muted" : `Volume ${Math.round(volume * 100)}%`)
    }, 300)
    return () => {
      if (volumeAnnounceTimerRef.current) clearTimeout(volumeAnnounceTimerRef.current)
    }
  }, [volume, muted, announce])

  // ── Watched Tracking Hook ──
  useWatchedTracking({
    payload,
    currentTime,
    duration,
    onWatched,
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(pointer: coarse)")
    const onChange = (e: MediaQueryListEvent) => setIsTouchDevice(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

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

  // ── Fetch playback payload ──
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPayload(null)
    setLoadError(null)
    setAudioIndex(null)
    setSubtitleIndex(null)
    setEndpointReady(false)
    setNextPrompt(null)
    setCreditsPillDismissed(false)
    setNeedsManualPlay(false)
    setBuffering(false)
    setPlaying(false)
    setCurrentTime(0)
    currentTimeRef.current = 0
    timeTickThrottleRef.current.reset()
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

  // ── Engine selection: direct play vs transcoded HLS ──
  const quality = QUALITY_PRESETS.find((q) => q.id === qualityId) ?? (() => {
    if (payload) console.warn(`Unknown qualityId "${qualityId}" — falling back to Auto`)
    return QUALITY_PRESETS[0]
  })()

  // 3.9 — probe only the audio codec that will actually be played. Probing
  // EVERY track rejects direct play for files with a DTS track + an AAC track
  // (or any other unsupported secondary audio) even when the supported track
  // is the one in use, forcing a pointless transcode. Non-default audio
  // selections force the HLS engine via `wantsTranscode` anyway, so only the
  // default/selected track's codec needs to pass for direct play.
  const probeAudioCodecs = useMemo(() => {
    if (!payload) return []
    const idx = audioIndex ?? payload.defaultAudioIndex
    const track = payload.audio.find((a) => a.index === idx)
    const codec = track?.codec ?? payload.audio[0]?.codec
    return codec ? [codec] : []
  }, [payload, audioIndex])

  // Probe the real browser for container+codec support — the server can
  // only gate on the file, not on what this device can decode.
  const codecProbe = useMemo(() => {
    if (!payload) return { supported: true, reason: "no payload yet" }
    if (!payload.canDirectPlay) {
      return {
        supported: false,
        reason: `server gate: canDirectPlay=false (container .${payload.container} not native HTML5 container)`,
      }
    }
    return canBrowserPlayNatively(
      payload.container,
      payload.videoCodec,
      probeAudioCodecs,
    )
  }, [payload, probeAudioCodecs])

  const wantsTranscode =
    qualityId !== "auto" ||
    (audioIndex != null && payload != null && audioIndex !== payload.defaultAudioIndex) ||
    burnSelectedSubtitle

  // HTML5 <video src="..."> direct play requires native container (MP4/WebM) + supported codecs + no overrides.
  // All Direct Stream (remuxing MKV -> HLS) and Transcode sessions use the HLS engine via HLS.js.
  const engine: "direct" | "hls" =
    payload?.canDirectPlay && codecProbe.supported && !wantsTranscode ? "direct" : "hls"

  const engineReason = !payload
    ? "awaiting payload"
    : !payload.canDirectPlay
      ? `container .${payload?.container} not HTML5 native — using HLS engine (direct stream remux or transcode)`
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
    const effectiveQuality =
      qualityId === "auto"
        ? (autoResolvedId
            ? QUALITY_PRESETS.find((q) => q.id === autoResolvedId)
            : null)
        : quality

    if (effectiveQuality?.maxStreamingBitrate) {
      applyStreamParams(params, effectiveQuality)
    } else if (engine === "hls") {
      const sourceBitrate = payload.bitrate ?? 0
      const sourceW = payload.width ?? 1920
      const sourceH = payload.height ?? 1080
      applyStreamParams(params, {
        maxStreamingBitrate:
          sourceBitrate > 0
            ? Math.min(Math.round(sourceBitrate * 1.2), 120_000_000)
            : 120_000_000,
        maxWidth: Math.min(sourceW, 3840),
        maxHeight: Math.min(sourceH, 2160),
      })
    }

    // HLS engine must not hand the decoder a codec it already rejected
    // (e.g. HEVC source on a browser whose probe failed): pin the stream to
    // H.264 so Jellyfin transcodes instead of remuxing undecodable segments.
    const sourceCodec = (payload.videoCodec ?? "").toLowerCase()
    if (
      engine === "hls" &&
      (sourceCodec === "hevc" || sourceCodec === "h265") &&
      !codecProbe.supported
    ) {
      params.set("videoCodec", "h264")
    }

    const base = engine === "direct" ? payload.directUrl : payload.hlsUrl
    if (engine === "hls") {
      // OVERRIDE playSessionId to force Jellyfin to launch a NEW transcode session
      // with the requested resolution whenever quality, audio, or burn sub tracks change!
      const activeQualityKey = effectiveQuality ? effectiveQuality.id : "auto"
      const uniquePlaySessionId = `${payload.playSessionId}_q_${activeQualityKey}_a_${audioIndex ?? "def"}_s_${burnSelectedSubtitle ? selectedSubtitle?.index : "off"}`

      const [baseUrl, existingQs] = base.split("?")
      const urlParams = new URLSearchParams(existingQs ?? "")

      urlParams.set("playSessionId", uniquePlaySessionId)
      // Jellyfin binds params case-insensitively, but the base hlsUrl carries
      // BOTH casing variants — overwrite them both so a request never carries
      // two different session ids for the same semantic parameter.
      urlParams.set("PlaySessionId", uniquePlaySessionId)
      params.forEach((val, key) => urlParams.set(key, val))

      if (audioIndex != null) {
        urlParams.set("audioStreamIndex", String(audioIndex))
        urlParams.set("AudioStreamIndex", String(audioIndex))
      }
      if (burnSelectedSubtitle && selectedSubtitle) {
        urlParams.set("subtitleStreamIndex", String(selectedSubtitle.index))
        urlParams.set("SubtitleStreamIndex", String(selectedSubtitle.index))
        urlParams.set("subtitleMethod", "Encode")
        urlParams.set("SubtitleMethod", "Encode")
      }
      return `${baseUrl}?${urlParams.toString()}`
    }

    const qs = params.toString()
    return qs ? `${base}&${qs}` : base
  }, [payload, engine, quality, qualityId, autoResolvedId, audioIndex, burnSelectedSubtitle, selectedSubtitle, codecProbe])

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
      context: party?.partyId ? "party" : undefined,
    }
  }, [payload, engine, party?.partyId])
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
    // 3.11 — track the loadedmetadata listener so it can be removed on
    // teardown: the <video> element survives stream rebuilds, so a listener
    // left behind by a previous attach would fire when the NEXT stream's
    // metadata loads and run tryPlay from a dead closure.
    let loadedMetadataHandler: (() => void) | null = null

    // 1.1 — capture the last visible frame to a canvas overlay so there's no
    // black flash while the new stream loads. The canvas is removed once the
    // new hls.js instance fires its first FRAG_BUFFERED event.
    const captureLastFrame = (): HTMLCanvasElement | null => {
      const v = videoRef.current
      if (!v || v.readyState < 2 || v.videoWidth === 0) return null
      try {
        const canvas = document.createElement("canvas")
        canvas.width = v.videoWidth
        canvas.height = v.videoHeight
        canvas.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:15;pointer-events:none;"
        canvas.getContext("2d")?.drawImage(v, 0, 0)
        return canvas
      } catch {
        // drawImage can throw if the video is cross-origin tainted; safe to ignore
        return null
      }
    }
    const removeFrameCanvas = () => {
      if (frameCaptureCanvasRef.current) {
        frameCaptureCanvasRef.current.remove()
        frameCaptureCanvasRef.current = null
      }
    }
    if (!url) return
    queueMicrotask(() => setLastStreamUrl(url))
    playerLog.info("stream", `building ${engine} stream: ${maskUrl(url)}`)

    // A rebuild while a stream was already attached (quality/track/mode
    // change) must resume where the viewer was, not restart the video.
    if (hadStreamRef.current && seekTargetRef.current === 0 && video.currentTime > 0) {
      seekTargetRef.current = video.currentTime
    }
    hadStreamRef.current = true

    // 1.1 — if this is a rebuild (not the first stream), capture the last
    // frame before teardown so the viewport doesn't go black.
    if (hadStreamRef.current && videoRef.current) {
      const canvas = captureLastFrame()
      if (canvas && containerRef.current) {
        removeFrameCanvas() // clear any stale canvas from a previous rebuild
        containerRef.current.appendChild(canvas)
        frameCaptureCanvasRef.current = canvas
      }
      // Show a specific label when the stall is intentional (rebuild)
      if (qualityChangeLabel.current) {
        setQualitySwitchToast(qualityChangeLabel.current)
      }
    }

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
        loadedMetadataHandler = () => tryPlay()
        el.addEventListener("loadedmetadata", loadedMetadataHandler, { once: true })
        return
      }

      if (!payload?.supportsTranscoding && !payload?.canDirectStream) {
        playerLog.error("stream", "direct play unavailable AND transcoding unavailable (direct stream not possible either)")
        fail("This file can't be played: direct play unsupported and transcoding unavailable.")
        return
      }
      if (!payload?.supportsTranscoding && payload?.canDirectStream) {
        playerLog.info("stream", "transcoding unavailable — using Direct Stream remux via HLS")
      }

      playerLog.info("hls", "loading hls.js runtime…")
      const { default: HlsCtor } = await import("hls.js")
      if (cancelled) return
      playerLog.info("hls", `hls.js loaded, isSupported=${HlsCtor.isSupported()} nativeHls=${el.canPlayType("application/vnd.apple.mpegurl") || "no"}`)

      if (HlsCtor.isSupported()) {
        const startPos = seekTargetRef.current > 0 ? seekTargetRef.current : -1
        const hls = new HlsCtor(
          buildHlsConfig({ startPosition: startPos, isTouchDevice }),
        )
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
              // Jellyfin HLS manifests have exactly one variant level — there is
              // nothing for hls.js's built-in ABR to switch between. Lock to
              // level 0 (the only level) instead of -1 (ABR no-op loop).
              const topIdx = levels.length - 1
              hls.startLevel = topIdx
              hls.currentLevel = 0 // single-level Jellyfin HLS — ABR (-1) is a no-op
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
            // 1.1 — new stream has real data in the buffer; remove the
            // last-frame canvas overlay and clear the quality-switch toast.
            removeFrameCanvas()
            setQualitySwitchToast(null)
            qualityChangeLabel.current = null
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
        loadedMetadataHandler = () => tryPlay()
        el.addEventListener("loadedmetadata", loadedMetadataHandler, { once: true })
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
      // 3.11 — remove the stale loadedmetadata listener so a rebuild that
      // happens before metadata loads can't leave a dead closure behind.
      if (loadedMetadataHandler) {
        video.removeEventListener("loadedmetadata", loadedMetadataHandler)
        loadedMetadataHandler = null
      }
      hlsRef.current?.destroy()
      hlsRef.current = null
      // 1.1 — clean up any stale frame-capture canvas if the effect was
      // cancelled before FRAG_BUFFERED fired (fast consecutive rebuilds).
      removeFrameCanvas()
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
    const onChange = () =>
      setIsFullscreen(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        !!document.fullscreenElement || !!(document as any).webkitFullscreenElement
      )
    document.addEventListener("fullscreenchange", onChange)
    document.addEventListener("webkitfullscreenchange", onChange)
    return () => {
      document.removeEventListener("fullscreenchange", onChange)
      document.removeEventListener("webkitfullscreenchange", onChange)
    }
  }, [])

  const toggleFullscreen = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } else if ((document as any).webkitExitFullscreen) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(document as any).webkitExitFullscreen()
        }
      } else if (isTouchDevice) {
        // lockLandscape requests fullscreen itself (then orientation.lock);
        // requesting fullscreen again here would be the duplicate request
        // and log a rejection on every toggle — so let it own the enter path.
        await lockLandscape(containerRef.current)
      } else {
        if (containerRef.current?.requestFullscreen) {
          await containerRef.current.requestFullscreen()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } else if ((videoRef.current as any)?.webkitEnterFullscreen) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(videoRef.current as any).webkitEnterFullscreen()
        }
      }
    } catch (err) {
      console.error("[CinemaPlayer] Fullscreen toggle error:", err)
    }
  }, [isTouchDevice, lockLandscape])

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
    if (isTouchDevice) {
      void lockLandscape(containerRef.current)
    }
    const video = videoRef.current
    // No stream attached yet (initial load): set play intent so playback starts as soon as stream attaches
    if (!video || !hadStreamRef.current) {
      playIntentRef.current = true
      return
    }

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
  }, [isTouchDevice, lockLandscape, party?.partyId, partySync])

  // Release orientation lock on unmount. Fullscreen is deliberately NOT
  // exited here: CinemaPlayer is keyed by the resolved item id, so episode
  // changes remount this component — bailing out of fullscreen on every
  // transition would drop mobile viewers out (and the re-lock on the fresh
  // mount is outside a user gesture). Fullscreen exits are handled by the
  // toggle button (explicit exit) and by the browser when the fullscreen
  // element is removed from the DOM on route teardown.
  useEffect(() => {
    return () => {
      void releaseOrientation()
    }
  }, [releaseOrientation])

  // Re-attempt landscape lock when playback starts (e.g. triggered on touch / user gesture)
  useEffect(() => {
    if (!playing || !isTouchDevice) return
    void lockLandscape(containerRef.current)
  }, [playing, isTouchDevice, lockLandscape])

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Only poke controls on actual mouse cursor movement (ignore touch emulated pointermove)
      if (e.pointerType === "touch") return
      pokeControls()
    },
    [pokeControls]
  )

  const seekTo = useCallback(
    (t: number) => {
      const video = videoRef.current
      if (!video) return
      video.currentTime = t
      // 4.1 — user-initiated seeks update the ref AND the throttled state
      // immediately so the seek bar / scrub preview never lags the playhead.
      currentTimeRef.current = t
      setCurrentTime(t)
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

  // ── Relative skip (±10s) — goes through seekTo so party rooms stay in sync
  // (the old touch path wrote currentTime directly and the drift loop fought it)
  const skipBy = useCallback(
    (delta: number) => {
      const video = videoRef.current
      if (!video) return
      seekTo(Math.min(Math.max(0, video.currentTime + delta), duration || video.duration || 0))
    },
    [seekTo, duration],
  )

  // ── Tap gestures (touch + mouse) on the player surface ──
  const handleSingleTap = useCallback(() => {
    pokeControls()
  }, [pokeControls])

  const handleSurfaceMouseClick = useCallback(() => {
    togglePlay()
    pokeControls()
  }, [togglePlay, pokeControls])

  const { gestureHandlers, ripple: skipRipple } = useTouchGestures({
    enabled: !episodeBrowserOpen,
    onSingleTap: handleSingleTap,
    onSkip: skipBy,
    onMouseClick: handleSurfaceMouseClick,
  })

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

  const rebuildAtPosition = useCallback((apply: () => void, label?: string) => {
    // 1.1 — store the human-readable switch label so the frame-capture
    // + toast path can display it during the buffering stall.
    qualityChangeLabel.current = label ?? null
    seekTargetRef.current = videoRef.current?.currentTime ?? 0
    apply()
  }, [])

  // ── Adaptive Bitrate Hook ──
  useAdaptiveBitrate({
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
  })

  const handleQualityChange = useCallback(
    (id: string) => {
      playerLog.info("user", `quality change → ${id}`)
      savePlayerSettings({ ...playerSettings, qualityPreference: id })
      if (id === "auto") {
        estimatorRef.current.reset()
        setAutoResolvedId(null)
      }
      const qLabel = QUALITY_PRESETS.find((q) => q.id === id)?.label ?? id
      rebuildAtPosition(() => setQualityId(id), qLabel)
      announce(`Quality changed to ${qLabel}`)
    },
    [rebuildAtPosition, playerSettings, announce],
  )
  const handleAudioChange = useCallback(
    (index: number) => {
      playerLog.info("user", `audio track change → index ${index}`)
      const audioLabel =
        payload?.audio.find((a) => a.index === index)?.title ||
        payload?.audio.find((a) => a.index === index)?.language ||
        `Audio Track ${index + 1}`
      rebuildAtPosition(() => setAudioIndex(index), audioLabel)
      announce(`Audio track changed to ${audioLabel}`)
    },
    [rebuildAtPosition, payload, announce],
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
        const subLabel = index == null ? "Subtitles Off" : track?.title || "Subtitles"
        rebuildAtPosition(() => setSubtitleIndex(index), subLabel)
      } else {
        setSubtitleIndex(index)
      }
    },
    [payload, burnSubtitles, burnSelectedSubtitle, rebuildAtPosition],
  )

  // ── Next-episode auto-play countdown ──
  // 3.4 — anchored to an absolute wall-clock end time, so background-tab
  // timer throttling (Chrome drops hidden-tab timers to 1/min after 5 min)
  // can never freeze the countdown: whenever a tick finally runs it computes
  // the true remaining time, and the episode fires on schedule even if the
  // tab was hidden the whole time.
  const countdownEndRef = useRef(0)
  useEffect(() => {
    if (!nextPrompt) {
      countdownEndRef.current = 0
      return
    }
    // Anchor the deadline once per countdown (not per re-render/tick).
    if (countdownEndRef.current === 0) {
      countdownEndRef.current = Date.now() + nextPrompt.secondsLeft * 1000
    }
    const tick = () => {
      const remaining = Math.ceil((countdownEndRef.current - Date.now()) / 1000)
      if (remaining <= 0) {
        countdownEndRef.current = 0
        setNextPrompt(null)
        onNextEpisode?.()
        return
      }
      // Keep the same object reference when the displayed value is unchanged
      // so the 250ms interval doesn't force a re-render (and effect restart)
      // four times per second.
      setNextPrompt((p) => (p && p.secondsLeft === remaining ? p : { secondsLeft: remaining }))
    }
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
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
      role="application"
      aria-label={`Video player: ${title}`}
      data-force-landscape={
        isTouchDevice &&
        (orientationStatus === "unsupported" || orientationStatus === "denied")
          ? "true"
          : undefined
      }
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerMove={handlePointerMove}
      className={`group relative select-none overflow-hidden bg-black outline-none [container-type:inline-size] ${
        fill ? "h-dvh w-full rounded-none" : "aspect-video w-full rounded-lg"
      } ${!controlsVisible && playing && !episodeBrowserOpen ? "cursor-none" : ""} ${className}`}
    >
      {/* Video Tap & Gesture Backdrop Layer */}
      <div
        className="absolute inset-0 z-10 cursor-pointer"
        {...gestureHandlers}
      />

      {/* A11y live region (issue 5.2) — announces playback state transitions */}
      <div ref={liveRegionRef} aria-live="polite" aria-atomic="true" className="sr-only" />

      <video
        ref={videoRef}
        poster={poster}
        playsInline
        aria-label={title}
        className="size-full object-contain pointer-events-none"
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
        onTimeUpdate={(e) => {
          // 4.1 — always keep the ref fresh; only mirror to state at ≤4Hz
          const t = e.currentTarget.currentTime
          currentTimeRef.current = t
          if (timeTickThrottleRef.current.update(Date.now())) {
            setCurrentTime(t)
          }
        }}
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
        touchLayout={isTouchDevice}
      />

      {/* Loading / buffering / error */}
      {!payload && !loadError && <PlayerLoading />}
      {/* 1.1 — show a specific "Switching to 720p…" label during intentional stream rebuilds
           so users know the stall is not a network error; falls back to empty for normal buffering */}
      {payload && buffering && !loadError && (
        <PlayerLoading message={qualitySwitchToast ? `Switching to ${qualitySwitchToast}…` : ""} />
      )}
      {loadError && (
        <PlayerError message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />
      )}

      {/* Skip intro / recap / credits */}
      {activeMarker && !nextPrompt && (
        <SkipSegmentButton
          type={activeMarker.type}
          raised={showCreditsPill}
          touchLayout={isTouchDevice}
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
          touchLayout={isTouchDevice}
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

      {/* Control bar — touch devices get the dedicated touch layout,
          everything else keeps the desktop chrome */}
      {payload && startedOrWaiting && endpointReady && (
        isTouchDevice ? (
          <TouchControls
            visible={controlsVisible || !playing || !!nextPrompt || episodeBrowserOpen}
            title={title}
            subtitle={subtitle}
            playing={playing}
            currentTime={currentTime}
            duration={duration || payload.runtimeTicks / TICKS_PER_SECOND}
            buffered={buffered}
            qualityId={qualityId}
            autoResolvedLabel={autoResolvedLabel}
            audioTracks={payload.audio}
            audioIndex={audioIndex}
            subtitleTracks={payload.subtitles}
            subtitleIndex={subtitleIndex}
            subStyle={subStyle}
            onSubStyleChange={updateSubStyle}
            playbackRate={displayPlaybackRate}
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
            onSkipBy={skipBy}
            onQualityChange={handleQualityChange}
            onAudioChange={handleAudioChange}
            onSubtitleChange={handleSubtitleChange}
            onPlaybackRateChange={handlePlaybackRateChange}
            onBack={onBack}
            onReport={handleReport}
            onInteract={pokeControls}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            ripple={skipRipple}
            hasParty={!!party?.partyId}
          />
        ) : (
          <PlayerControls
            isTouchDevice={isTouchDevice}
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
            onSkipBy={skipBy}
            onVolumeChange={updateVolume}
            onToggleMute={toggleMute}
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
        )
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

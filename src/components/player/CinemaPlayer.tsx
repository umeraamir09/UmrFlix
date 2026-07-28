"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type Hls from "hls.js"
import {
  QUALITY_PRESETS,
  type PlaybackPayload,
} from "@/lib/playback-types"
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
  ResumeModal,
  SkipSegmentButton,
  formatTimecode,
  type NextEpisodeInfo,
} from "./PlayerOverlays"
import { usePlaybackReporter, type ReporterState } from "./use-playback-reporter"
import { playerLog } from "./player-debug"
import { canBrowserPlayNatively } from "./codec-probe"
import { PlayerDebugHud } from "./PlayerDebugHud"
import { Play } from "lucide-react"

function maskUrl(url: string): string {
  return url.replace(/api_key=[^&]+/, "api_key=***")
}

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
  nextEpisode?: NextEpisodeInfo | null
  onNextEpisode?: () => void
  onWatched?: () => void
  onBack?: () => void
  onReport?: () => void
  className?: string
}

export function CinemaPlayer({
  itemId,
  title,
  subtitle,
  poster,
  autoPlay = false,
  nextEpisode = null,
  onNextEpisode,
  onWatched,
  onBack,
  onReport,
  className = "",
}: CinemaPlayerProps) {
  // ── Refs ──
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const seekTargetRef = useRef<number>(0) // position to restore after stream rebuild
  const watchedReportedRef = useRef(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Once playback has started (or autoplay is requested) stream rebuilds keep playing
  const playIntentRef = useRef(autoPlay)

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
  const [qualityId, setQualityId] = useState("auto")
  const [audioIndex, setAudioIndex] = useState<number | null>(null)
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null)
  // Keyed by subtitle URL — avoids clearing state synchronously on track change
  const [cueState, setCueState] = useState<{ url: string; cues: VttCue[] } | null>(null)
  const [subStyle, setSubStyle] = useState<SubtitleStyle>(() => loadSubtitleStyle())

  // ── UI state ──
  const [endpointReady, setEndpointReady] = useState(false) // resume question answered
  const [resumeSeconds, setResumeSeconds] = useState<number | null>(null) // offered resume point
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [nextPrompt, setNextPrompt] = useState<{ secondsLeft: number } | null>(null)
  const [creditsPillDismissed, setCreditsPillDismissed] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [lastStreamUrl, setLastStreamUrl] = useState("")
  const debugAutoOpenedRef = useRef(false)
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

  const handlePlaybackRateChange = useCallback((rate: number) => {
    setPlaybackRate(rate)
    if (videoRef.current) {
      videoRef.current.playbackRate = rate
    }
  }, [])

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
    // Deferred so no state is set synchronously inside the effect body
    queueMicrotask(() => {
      if (cancelled) return
      setPayload(null)
      setLoadError(null)
      setCueState(null)
      setAudioIndex(null)
      setSubtitleIndex(null)
      setEndpointReady(false)
      setResumeSeconds(null)
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
      playIntentRef.current = autoPlay
    })

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
        if (data.resumeTicks > 0) {
          setResumeSeconds(data.resumeTicks / TICKS_PER_SECOND)
        } else {
          setEndpointReady(true)
        }
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
  const cues =
    selectedSubtitle && cueState?.url === selectedSubtitle.url ? cueState.cues : []

  useEffect(() => {
    if (!selectedSubtitle || selectedSubtitle.isImageBased || !selectedSubtitle.url) return
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
  }, [selectedSubtitle])

  // ── Engine selection: direct play vs transcoded HLS ──
  const quality = QUALITY_PRESETS.find((q) => q.id === qualityId) ?? QUALITY_PRESETS[0]

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
    (selectedSubtitle?.isImageBased ?? false)
  const engine: "direct" | "hls" =
    payload?.canDirectPlay && codecProbe.supported && !wantsTranscode ? "direct" : "hls"
  const imageBasedSubIndex = selectedSubtitle?.isImageBased ? selectedSubtitle.index : null

  const engineReason = !payload
    ? "awaiting payload"
    : !payload.canDirectPlay
      ? "direct play rejected by server profile"
      : !codecProbe.supported
        ? `direct play rejected by browser probe (${codecProbe.reason})`
        : wantsTranscode
          ? `transcode requested (quality=${qualityId}${audioIndex != null && audioIndex !== payload.defaultAudioIndex ? ", audio override" : ""}${selectedSubtitle?.isImageBased ? ", image subs" : ""})`
          : "direct play"

  // Log engine decisions once they settle
  useEffect(() => {
    if (!payload) return
    queueMicrotask(() =>
      playerLog.info("engine", `decision: ${engine.toUpperCase()} — ${engineReason}`),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, engine])

  const buildStreamUrl = useCallback((): string => {
    if (!payload) return ""
    const params = new URLSearchParams()
    if (quality.maxStreamingBitrate) {
      params.set("maxStreamingBitrate", String(quality.maxStreamingBitrate))
      params.set("maxWidth", String(quality.maxWidth))
      params.set("maxHeight", String(quality.maxHeight))
    }
    const base = engine === "direct" ? payload.directUrl : payload.hlsUrl
    if (engine === "hls") {
      if (audioIndex != null) params.set("audioStreamIndex", String(audioIndex))
      // Image-based subs (PGS/VobSub) can only be burned into the transcode
      if (selectedSubtitle?.isImageBased) {
        params.set("subtitleStreamIndex", String(selectedSubtitle.index))
      }
    }
    const qs = params.toString()
    return qs ? `${base}&${qs}` : base
  }, [payload, engine, quality, audioIndex, selectedSubtitle])

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

  // ── Stream setup (runs whenever engine/track/quality selection changes) ──
  useEffect(() => {
    const video = videoRef.current
    if (!video || !payload || !endpointReady) return

    let cancelled = false
    const url = buildStreamUrl()
    queueMicrotask(() => setLastStreamUrl(url))
    playerLog.info("stream", `building ${engine} stream: ${maskUrl(url)}`)

    const restoreAndPlay = () => {
      if (cancelled) return
      const target = seekTargetRef.current
      if (target > 0 && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(target, Math.max(0, video.duration - 0.5))
        playerLog.info("stream", `restoring position → ${target.toFixed(1)}s`)
      }
      seekTargetRef.current = 0
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
        el.addEventListener("loadedmetadata", restoreAndPlay, { once: true })
        return
      }

      if (!payload?.supportsTranscoding) {
        playerLog.error("stream", "direct play unavailable AND transcoding unavailable")
        setLoadError("This file can't be played: direct play unsupported and transcoding unavailable.")
        return
      }

      playerLog.info("hls", "loading hls.js runtime…")
      const { default: HlsCtor } = await import("hls.js")
      if (cancelled) return
      playerLog.info("hls", `hls.js loaded, isSupported=${HlsCtor.isSupported()} nativeHls=${el.canPlayType("application/vnd.apple.mpegurl") || "no"}`)

      if (HlsCtor.isSupported()) {
        const hls = new HlsCtor({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 60,
          maxBufferLength: 40,
        })
        hlsRef.current = hls
        hls.on(HlsCtor.Events.MEDIA_ATTACHED, () => playerLog.info("hls", "media attached"))
        hls.on(HlsCtor.Events.MANIFEST_PARSED, (_e, d) => {
          playerLog.info("hls", `manifest parsed: ${d.levels?.length ?? 0} level(s)${d.levels?.[0] ? `, first=${d.levels[0].codecs ?? "?"} ${d.levels[0].audioCodec ?? ""}` : ""}`)
          restoreAndPlay()
        })
        let firstFragLogged = false
        hls.on(HlsCtor.Events.FRAG_BUFFERED, () => {
          if (!firstFragLogged) {
            firstFragLogged = true
            playerLog.info("hls", "first fragment buffered")
          }
        })
        hls.on(HlsCtor.Events.ERROR, (_event, data) => {
          const detail = `${data.type}/${data.details} fatal=${data.fatal}${data.url ? ` url=${maskUrl(data.url)}` : ""} reason=${data.reason ?? ""}`
          if (!data.fatal) {
            playerLog.warn("hls", detail)
            return
          }
          playerLog.error("hls", detail)
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad() // recover from transient network stalls
          } else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError()
          } else if (!cancelled) {
            setLoadError("The stream failed to load. Please try again.")
          }
        })
        hls.loadSource(url)
        hls.attachMedia(el)
      } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari: native HLS
        el.src = url
        el.addEventListener("loadedmetadata", restoreAndPlay, { once: true })
      } else if (!cancelled) {
        playerLog.error("hls", "neither MSE-hls.js nor native HLS available")
        setLoadError("HLS playback is not supported in this browser.")
      }
    }

    void setup()

    return () => {
      cancelled = true
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, engine, qualityId, audioIndex, imageBasedSubIndex, endpointReady])

  // Preserve volume across stream rebuilds
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume
      videoRef.current.muted = muted
    }
  }, [payload, endpointReady, engine, volume, muted])

  // ── Resume modal actions ──
  const answerResume = (seconds: number) => {
    playIntentRef.current = true // clicking "Resume" is a play intent
    seekTargetRef.current = seconds
    setResumeSeconds(null)
    setEndpointReady(true) // triggers the stream setup effect
  }

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

  // ── Controls auto-hide (while playing) ──
  useEffect(() => {
    if (!playing) return
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_DELAY)
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [playing])

  const pokeControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (videoRef.current && !videoRef.current.paused) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_DELAY)
    }
  }, [])

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
    if (video.paused) {
      setNeedsManualPlay(false)
      video.play().catch(() => setNeedsManualPlay(true))
    } else {
      video.pause()
    }
  }, [])

  const seekTo = useCallback((t: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = t
  }, [])

  const rebuildAtPosition = useCallback((apply: () => void) => {
    seekTargetRef.current = videoRef.current?.currentTime ?? 0
    apply()
  }, [])

  const handleQualityChange = useCallback(
    (id: string) => {
      playerLog.info("user", `quality change → ${id}`)
      rebuildAtPosition(() => setQualityId(id))
    },
    [rebuildAtPosition],
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
      // Image-based subs require a transcoded stream rebuild (burn-in);
      // text tracks are rendered by the custom overlay and need no rebuild.
      const track = payload?.subtitles.find((s) => s.index === index)
      playerLog.info("user", `subtitle change → ${track ? `[${index}] ${track.title}` : "off"}`)
      if (track?.isImageBased || selectedSubtitle?.isImageBased) {
        rebuildAtPosition(() => setSubtitleIndex(index))
      } else {
        setSubtitleIndex(index)
      }
    },
    [payload, selectedSubtitle, rebuildAtPosition],
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
    activeMarker?.type === "credits" &&
    !!nextEpisode &&
    !creditsPillDismissed &&
    !nextPrompt

  // ── Keyboard shortcuts ──
  const handleKeyDown = (e: React.KeyboardEvent) => {
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

  // Auto-open the debug HUD when playback is stuck buffering (once per session)
  useEffect(() => {
    if (!buffering || !endpointReady || loadError) return
    const id = setTimeout(() => {
      if (!debugAutoOpenedRef.current) {
        debugAutoOpenedRef.current = true
        playerLog.warn("debug", "buffering exceeded 8s — opening debug HUD (press d to toggle)")
        setDebugOpen(true)
      }
    }, 8_000)
    return () => clearTimeout(id)
  }, [buffering, endpointReady, loadError])

  const startedOrWaiting = endpointReady && !loadError
  const qualityLabel = quality.label

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={pokeControls}
      onTouchStart={pokeControls}
      className={`group relative aspect-video w-full select-none overflow-hidden rounded-lg bg-black outline-none [container-type:size] ${
        !controlsVisible && playing ? "cursor-none" : ""
      } ${className}`}
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

      {/* Resume prompt */}
      {payload && resumeSeconds !== null && !endpointReady && (
        <ResumeModal
          positionSeconds={resumeSeconds}
          onResume={() => answerResume(resumeSeconds)}
          onStartFromBeginning={() => answerResume(0)}
        />
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
          visible={controlsVisible || !playing || !!nextPrompt}
          title={title}
          subtitle={subtitle}
          playing={playing}
          currentTime={currentTime}
          duration={duration || payload.runtimeTicks / TICKS_PER_SECOND}
          buffered={buffered}
          volume={volume}
          muted={muted}
          qualityId={qualityId}
          audioTracks={payload.audio}
          audioIndex={audioIndex}
          subtitleTracks={payload.subtitles}
          subtitleIndex={subtitleIndex}
          subStyle={subStyle}
          playbackRate={playbackRate}
          isFullscreen={isFullscreen}
          hasNext={!!nextEpisode && !!onNextEpisode}
          chapters={payload.chapters}
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

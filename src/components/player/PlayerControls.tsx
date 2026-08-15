"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import {
  ArrowLeft,
  Flag,
  PictureInPicture2,
  Volume2,
  VolumeX,
} from "lucide-react"
import { formatTimecode, useRemainingTimeToggle } from "./PlayerOverlays"
import type {
  AudioTrack,
  ChapterInfo,
  SubtitleTrack,
  TrickplayInfo,
} from "@/lib/playback-types"
import { TrickplayPreview, trickplayPreviewDisplaySize, getTrickplayPreloadUrls } from "./TrickplayPreview"
import { ChapterImagePreview, chapterPreviewDisplaySize, getChapterPreloadUrls } from "./ChapterImagePreview"
import { preloadImages } from "./use-preloaded-image"
import { EpisodeBrowser } from "./EpisodeBrowser"
import { AudioSubtitlesMenu, SpeedQualityMenu } from "./player-menus"
import type { EpisodeInfo, SeasonInfo } from "@/components/SeasonBrowser"
import type { SubtitleStyle } from "./SubtitleOverlay"

import {
  IconPlay,
  IconPause,
  IconSkipBackward,
  IconSkipForward,
  IconSubtitles,
  IconSpeed,
} from "@/components/ui/icons"

// ── Seek bar with buffered display, chapter ticks, hover tooltip & scrubbing ──

export function SeekBar({
  currentTime,
  duration,
  buffered,
  chapters,
  itemId,
  trickplay,
  onSeek,
  onScrubStateChange,
}: {
  currentTime: number
  duration: number
  buffered: number
  chapters: ChapterInfo[]
  itemId: string
  trickplay: TrickplayInfo | null
  onSeek: (t: number) => void
  onScrubStateChange?: (isScrubbing: boolean) => void
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ time: number; x: number; barW: number } | null>(null)
  const [scrubTime, setScrubTime] = useState<number | null>(null)

  // 4.3 — pointermove fires 60-120x/sec during a drag; batch hover/scrub state
  // writes into a single rAF per frame instead of re-rendering per pixel, and
  // DON'T seek during the drag — the preview shows the position visually and
  // video.currentTime (plus party commands) only move on pointerdown/up.
  const pendingHoverRef = useRef<{ time: number; x: number; barW: number } | null>(null)
  const pendingScrubRef = useRef<number | null>(null)
  const scrubTimeRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  // 4.6 — preload trickplay sprite tiles (or chapter images) as soon as the
  // cursor enters the bar, so the hover bubble never pops in with a stall.
  // preloadImages shares usePreloadedImage's cache, so a completed preload
  // makes the first hover render instantly; the ref dedupes in-flight URLs.
  const preloadedTilesRef = useRef(new Set<string>())
  const preloadPreviews = () => {
    const urls = trickplay
      ? getTrickplayPreloadUrls(trickplay, itemId)
      : hasChapterImages
        ? getChapterPreloadUrls(chapters, itemId)
        : []
    const fresh = urls.filter((url) => !preloadedTilesRef.current.has(url))
    for (const url of fresh) preloadedTilesRef.current.add(url)
    if (fresh.length > 0) preloadImages(fresh)
  }

  const flushPointerMove = () => {
    rafRef.current = null
    const h = pendingHoverRef.current
    const s = pendingScrubRef.current
    pendingHoverRef.current = null
    pendingScrubRef.current = null
    if (h) setHover(h)
    if (s !== null) setScrubTime(s)
  }

  const schedulePointerMove = (h: { time: number; x: number; barW: number } | null, s: number | null) => {
    pendingHoverRef.current = h
    pendingScrubRef.current = s
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flushPointerMove)
    }
  }

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const fraction = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const shownTime = scrubTime ?? currentTime
  const playedPct = duration > 0 ? (shownTime / duration) * 100 : 0
  const bufferedPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0

  // 5.1 — role="slider" needs keyboard support: arrows nudge by ±10s (±5s with
  // Shift), Up/Down step 10% of the duration, Home/End jump to the edges.
  // Keys stopPropagation so the player surface's shortcuts never double-handle.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (duration <= 0) return
    let next: number | null = null
    switch (e.key) {
      case "ArrowRight":
        next = shownTime + (e.shiftKey ? 5 : 10)
        break
      case "ArrowLeft":
        next = shownTime - (e.shiftKey ? 5 : 10)
        break
      case "ArrowUp":
        next = shownTime + duration * 0.1
        break
      case "ArrowDown":
        next = shownTime - duration * 0.1
        break
      case "Home":
        next = 0
        break
      case "End":
        next = duration
        break
      case "PageUp":
        next = shownTime + Math.max(30, duration * 0.1)
        break
      case "PageDown":
        next = shownTime - Math.max(30, duration * 0.1)
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
    onSeek(Math.min(Math.max(0, next), duration))
  }

  // Chapter images available as fallback when trickplay is absent?
  const hasChapterImages = !trickplay && chapters.some((c) => c.imageTag)

  // Keep the preview bubble within the bar so it never clips off-screen
  const preview = trickplay
    ? trickplayPreviewDisplaySize(trickplay)
    : hasChapterImages
      ? chapterPreviewDisplaySize()
      : null
  const previewW = preview ? preview.width + 2 : 0 // + border
  const clampedHoverX =
    hover && preview && hover.barW > previewW
      ? Math.min(Math.max(hover.x, previewW / 2), hover.barW - previewW / 2)
      : (hover?.x ?? 0)

  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Seek bar"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, duration)}
      aria-valuenow={shownTime}
      aria-valuetext={formatTimecode(shownTime)}
      aria-disabled={duration <= 0}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="group/seek relative flex h-11 sm:h-6 cursor-pointer items-center touch-none select-none"
      onPointerEnter={preloadPreviews}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const t = fraction(e.clientX) * duration
        scrubTimeRef.current = t
        setScrubTime(t)
        onSeek(t) // tap-to-seek: instant jump on press
        onScrubStateChange?.(true)
      }}
      onPointerMove={(e) => {
        const rect = barRef.current?.getBoundingClientRect()
        const f =
          rect && rect.width > 0
            ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
            : 0
        const h = {
          time: f * duration,
          x: e.clientX - (rect?.left ?? 0),
          barW: rect?.width ?? 0,
        }
        if (scrubTimeRef.current !== null) {
          // 4.3 — dragging: update the preview position only; the actual seek
          // happens once on pointerup (video.currentTime + party commands).
          scrubTimeRef.current = f * duration
          schedulePointerMove(h, f * duration)
          onScrubStateChange?.(true)
        } else {
          schedulePointerMove(h, null)
        }
      }}
      onPointerUp={() => {
        // 4.3 — single seek at release with the final drag position
        const final = scrubTimeRef.current
        if (final !== null) onSeek(final)
        scrubTimeRef.current = null
        pendingScrubRef.current = null
        setScrubTime(null)
        onScrubStateChange?.(false)
      }}
      onPointerCancel={() => {
        scrubTimeRef.current = null
        pendingScrubRef.current = null
        setScrubTime(null)
        onScrubStateChange?.(false)
      }}
      onPointerLeave={() => {
        pendingHoverRef.current = null
        setHover(null)
      }}
    >
      {/* track */}
      <div className="relative h-[3px] w-full rounded-full bg-white/35 transition-[height] duration-150 group-hover/seek:h-[5px]">
        {/* buffered */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/50"
          style={{ width: `${bufferedPct}%` }}
        />
        {/* played */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${playedPct}%` }}
        />
        {/* chapter ticks */}
        {duration > 0 &&
          chapters.map((ch) => (
            <div
              key={`${ch.name}-${ch.startSeconds}`}
              className="absolute top-0 h-full w-[2px] bg-white/60"
              style={{ left: `${(ch.startSeconds / duration) * 100}%` }}
              title={ch.name}
            />
          ))}
      </div>

      {/* red circular dot handle */}
      <div
        className="pointer-events-none absolute size-4 sm:size-4.5 rounded-full bg-accent shadow-md transition-transform duration-100 group-hover/seek:scale-150 group-active/seek:scale-150"
        style={{ left: `calc(${playedPct}% - 8px)` }}
      />

      {/* hover tooltip: trickplay → chapter images → plain timecode */}
      {hover &&
        (trickplay ? (
          <div
            className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 border border-white/15 bg-black shadow-2xl"
            style={{ left: clampedHoverX }}
          >
            <TrickplayPreview trickplay={trickplay} itemId={itemId} time={hover.time} />
            <div className="py-1.5 text-center text-xs font-semibold tabular-nums text-white">
              {formatTimecode(hover.time)}
            </div>
          </div>
        ) : hasChapterImages ? (
          <div
            className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 border border-white/15 bg-black shadow-2xl"
            style={{ left: clampedHoverX }}
          >
            <ChapterImagePreview chapters={chapters} itemId={itemId} time={hover.time} />
            <div className="py-1.5 text-center text-xs font-semibold tabular-nums text-white">
              {formatTimecode(hover.time)}
            </div>
          </div>
        ) : (
          <div
            className="pointer-events-none absolute -top-9 -translate-x-1/2 rounded border border-white/10 bg-black/90 px-2.5 py-1 text-xs font-semibold tabular-nums text-white shadow-lg"
            style={{ left: hover.x }}
          >
            {formatTimecode(hover.time)}
          </div>
        ))}
    </div>
  )
}

// ── Main Control Bar ──

export function PlayerControls({
  isTouchDevice = false,
  visible,
  title,
  subtitle,
  playing,
  currentTime,
  duration,
  buffered,
  volume,
  muted,
  qualityId,
  autoResolvedLabel,
  sourceHeight,
  audioTracks,
  audioIndex,
  subtitleTracks,
  subtitleIndex,
  subStyle,
  playbackRate,
  isFullscreen,
  hasNext,
  chapters,
  itemId,
  trickplay,
  seriesId,
  episodes,
  seasons,
  onSelectEpisode,
  episodeBrowserOpen,
  onToggleEpisodeBrowser,
  onTogglePlay,
  onSeek,
  onSkipBy,
  onVolumeChange,
  onToggleMute,
  onQualityChange,
  onAudioChange,
  onSubtitleChange,
  onSubStyleChange,
  onPlaybackRateChange,
  onToggleFullscreen,
  onTogglePip,
  onNextEpisode,
  onBack,
  onReport,
}: {
  isTouchDevice?: boolean
  visible: boolean
  title: string
  subtitle?: string
  playing: boolean
  currentTime: number
  duration: number
  buffered: number
  volume: number
  muted: boolean
  qualityId: string
  autoResolvedLabel?: string
  sourceHeight?: number
  audioTracks: AudioTrack[]
  audioIndex: number | null
  subtitleTracks: SubtitleTrack[]
  subtitleIndex: number | null
  subStyle: SubtitleStyle
  playbackRate: number
  isFullscreen: boolean
  hasNext: boolean
  chapters: ChapterInfo[]
  itemId: string
  trickplay: TrickplayInfo | null
  seriesId?: string
  episodes?: EpisodeInfo[] | null
  seasons?: SeasonInfo[]
  onSelectEpisode?: (episodeId: string) => void
  episodeBrowserOpen: boolean
  onToggleEpisodeBrowser: () => void
  onTogglePlay: () => void
  onSeek: (t: number) => void
  onSkipBy: (delta: number) => void
  onVolumeChange: (v: number) => void
  onToggleMute: () => void
  onQualityChange: (id: string) => void
  onAudioChange: (index: number) => void
  onSubtitleChange: (index: number | null) => void
  onSubStyleChange: (s: SubtitleStyle) => void
  onPlaybackRateChange: (rate: number) => void
  onToggleFullscreen: () => void
  onTogglePip: () => void
  onNextEpisode?: () => void
  onBack?: () => void
  onReport?: () => void
}) {
  const [audioSubsOpen, setAudioSubsOpen] = useState(false)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [showRemaining, toggleRemainingTime] = useRemainingTimeToggle()
  const audioSubsRef = useRef<HTMLDivElement>(null)
  const speedRef = useRef<HTMLDivElement>(null)

  // Close menus when controls fade out (render-time state adjustment — see
  // react.dev "you might not need an effect")
  const [prevVisible, setPrevVisible] = useState(visible)
  if (prevVisible !== visible) {
    setPrevVisible(visible)
    if (!visible) {
      setAudioSubsOpen(false)
      setSpeedOpen(false)
    }
  }

  const isAnyMenuOpen = audioSubsOpen || speedOpen || episodeBrowserOpen || isScrubbing

  return (
    <>
      {/* Menu Backdrop Shield */}
      {(audioSubsOpen || speedOpen) && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            setAudioSubsOpen(false)
            setSpeedOpen(false)
          }}
          className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-xs pointer-events-auto animate-in fade-in duration-150"
        />
      )}

      {/* Audio & Subtitles Popover Menu */}
      {audioSubsOpen && (
        <AudioSubtitlesMenu
          audioTracks={audioTracks}
          audioIndex={audioIndex}
          onAudioChange={onAudioChange}
          subtitleTracks={subtitleTracks}
          subtitleIndex={subtitleIndex}
          onSubtitleChange={onSubtitleChange}
          subStyle={subStyle}
          onSubStyleChange={onSubStyleChange}
          onClose={() => setAudioSubsOpen(false)}
        />
      )}

      {/* Speed & Quality Popover Menu */}
      {speedOpen && (
        <SpeedQualityMenu
          qualityId={qualityId}
          autoResolvedLabel={autoResolvedLabel}
          sourceHeight={sourceHeight}
          onQualityChange={onQualityChange}
          playbackRate={playbackRate}
          onPlaybackRateChange={onPlaybackRateChange}
          onClose={() => setSpeedOpen(false)}
        />
      )}

      <div
        className={`absolute inset-0 z-40 flex flex-col justify-between pointer-events-none transition-opacity duration-300 ${
          visible || isAnyMenuOpen ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
      {/* Background gradients */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/40 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/95 via-black/60 to-transparent" />

      {/* Top Bar */}
      <div className="relative z-30 pointer-events-auto flex items-center justify-between px-6 sm:px-8 pt-6">
        <button
          onClick={onBack ?? (() => window.history.back())}
          className="flex items-center justify-center p-1 text-white/90 transition-transform hover:scale-110 hover:text-white active:scale-95"
          aria-label="Go back"
        >
          <ArrowLeft className="size-9 sm:size-10 stroke-[2.5]" />
        </button>
        <button
          onClick={onReport}
          className="flex items-center justify-center p-1 text-white/90 transition-transform hover:scale-110 hover:text-white active:scale-95"
          aria-label="Report issue"
        >
          <Flag className="size-9 sm:size-10 stroke-[2.2]" />
        </button>
      </div>

      {/* Bottom Bar */}
      <div className="relative z-30 pointer-events-auto px-6 sm:px-8 pb-6 pt-2">
        {/* Current time on the left, total duration / remaining time on the right above seekbar */}
        <div className="mb-1.5 flex items-center justify-between text-xs sm:text-sm font-medium tabular-nums text-white">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleRemainingTime()
            }}
            className="cursor-pointer transition-colors hover:text-accent active:scale-95 select-none"
            title={showRemaining ? "Click to show total duration" : "Click to show remaining time"}
          >
            {formatTimecode(currentTime)}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleRemainingTime()
            }}
            className="cursor-pointer transition-colors hover:text-accent active:scale-95 select-none"
            title={showRemaining ? "Click to show total duration" : "Click to show remaining time"}
          >
            {showRemaining
              ? `-${formatTimecode(Math.max(0, duration - currentTime))}`
              : formatTimecode(duration)}
          </button>
        </div>

        {/* Seekbar */}
        <SeekBar
          currentTime={currentTime}
          duration={duration}
          buffered={buffered}
          chapters={chapters}
          itemId={itemId}
          trickplay={trickplay}
          onSeek={onSeek}
          onScrubStateChange={setIsScrubbing}
        />

        {/* Control Buttons Row */}
        <div className="mt-2.5 sm:mt-3 flex items-center justify-between gap-2 sm:gap-4">
          {/* Left Controls */}
          <div className="flex items-center gap-2 sm:gap-6 shrink-0">
            {!isTouchDevice && (
              <>
                <button
                  onClick={onTogglePlay}
                  className="flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95"
                  aria-label={playing ? "Pause" : "Play"}
                >
                  {playing ? (
                    <IconPause className="size-8 sm:size-9 fill-white text-white" />
                  ) : (
                    <IconPlay className="size-8 sm:size-9 fill-white text-white" />
                  )}
                </button>

                <button
                  onClick={() => onSkipBy(-10)}
                  className="flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95"
                  aria-label="Skip back 10 seconds"
                >
                  <IconSkipBackward className="size-8 sm:size-9 text-white" />
                </button>

                <button
                  onClick={() => onSkipBy(10)}
                  className="flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95"
                  aria-label="Skip forward 10 seconds"
                >
                  <IconSkipForward className="size-8 sm:size-9 text-white" />
                </button>
              </>
            )}

            {/* Volume */}
            <div className="group/vol flex items-center relative">
              <button
                onClick={onToggleMute}
                className="flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95 min-h-[36px] min-w-[36px]"
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted || volume === 0 ? (
                  <VolumeX className="size-5 sm:size-7 stroke-[2.2]" />
                ) : (
                  <Volume2 className="size-5 sm:size-7 stroke-[2.2]" />
                )}
              </button>
              {typeof navigator !== "undefined" && !/iPad|iPhone|iPod/.test(navigator.userAgent) && (
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={muted ? 0 : Math.round(volume * 100)}
                  onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
                  className="w-0 opacity-0 transition-all duration-200 accent-accent h-2 group-hover/vol:ml-2.5 group-hover/vol:w-20 sm:group-hover/vol:w-24 group-hover/vol:opacity-100"
                  aria-label="Volume"
                  aria-valuetext={`${Math.round(volume * 100)} percent`}
                />
              )}
            </div>
          </div>

          {/* Center Title (+ episode subtitle) */}
          <div className="flex-1 min-w-0 text-center px-1.5">
            <span className="text-xs sm:text-base font-medium tracking-wide text-white text-center truncate block max-w-[160px] sm:max-w-xs md:max-w-md mx-auto drop-shadow-md">
              {title}
            </span>
            {subtitle && (
              <span className="mt-0.5 text-[10px] sm:text-xs font-normal tracking-wide text-gray-300 text-center truncate block max-w-[160px] sm:max-w-xs md:max-w-md mx-auto drop-shadow-md">
                {subtitle}
              </span>
            )}
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2 sm:gap-5 shrink-0 relative">
            {/* Next Episode (only when one is available) */}
            {hasNext && onNextEpisode && (
              <button
                onClick={onNextEpisode}
                className="flex items-center justify-center p-1 text-white transition-all hover:scale-110 hover:opacity-100 active:scale-95 opacity-90 min-h-[36px] min-w-[36px]"
                aria-label="Play next episode"
                title="Next Episode"
              >
                <Image
                  src="/icons/next-ep.svg"
                  alt=""
                  width={40}
                  height={40}
                  className="size-5 sm:size-7"
                />
              </button>
            )}

            {/* Episode Browser (series only; guests in a party can't switch) */}
            {seriesId && onSelectEpisode && episodes && episodes.length > 0 && (
              <button
                onClick={() => {
                  setAudioSubsOpen(false)
                  setSpeedOpen(false)
                  onToggleEpisodeBrowser()
                }}
                className={`flex items-center justify-center p-1 text-white transition-all hover:scale-110 hover:opacity-100 active:scale-95 opacity-90 min-h-[36px] min-w-[36px] ${
                  episodeBrowserOpen ? "text-accent" : ""
                }`}
                aria-label="Browse episodes"
                title="Episodes"
                aria-haspopup="dialog"
                aria-expanded={episodeBrowserOpen}
              >
                <Image
                  src="/icons/ep-browser.svg"
                  alt=""
                  width={40}
                  height={40}
                  className="size-5 sm:size-7"
                />
              </button>
            )}

            {/* Subtitles & Audio Menu */}
            <div ref={audioSubsRef} className="relative">
              <button
                onClick={() => {
                  setAudioSubsOpen((o) => !o)
                  setSpeedOpen(false)
                }}
                className={`flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95 min-h-[36px] min-w-[36px] ${
                  audioSubsOpen ? "text-accent" : ""
                }`}
                aria-label="Audio and Subtitles"
                aria-haspopup="menu"
                aria-expanded={audioSubsOpen}
              >
                <IconSubtitles className="size-5 sm:size-7" />
              </button>
            </div>

            {/* Speedometer & Quality Menu */}
            <div ref={speedRef} className="relative">
              <button
                onClick={() => {
                  setSpeedOpen((o) => !o)
                  setAudioSubsOpen(false)
                }}
                className={`flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95 min-h-[36px] min-w-[36px] ${
                  speedOpen ? "text-accent" : ""
                }`}
                aria-label="Playback Speed and Quality"
                aria-haspopup="menu"
                aria-expanded={speedOpen}
              >
                <IconSpeed className="size-5 sm:size-7" />
              </button>
            </div>

            {/* Picture-in-Picture */}
            <button
              onClick={onTogglePip}
              className="hidden sm:flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95"
              aria-label="Picture in Picture"
              title="Picture in Picture"
            >
              <PictureInPicture2 className="size-6 sm:size-7 stroke-[1.8]" />
            </button>

            {/* Fullscreen */}
            <button
              onClick={onToggleFullscreen}
              className="flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95 min-h-[36px] min-w-[36px]"
              aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? (
                <Image
                  src="/icons/minimize.svg"
                  alt=""
                  width={40}
                  height={40}
                  className="size-5 sm:size-7"
                />
              ) : (
                <Image
                  src="/icons/maximize.svg"
                  alt=""
                  width={40}
                  height={40}
                  className="size-5 sm:size-7"
                />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* In-player episode browser overlay */}
      {episodeBrowserOpen && seriesId && episodes && episodes.length > 0 && onSelectEpisode && (
        <EpisodeBrowser
          episodes={episodes}
          seasons={seasons ?? []}
          currentItemId={itemId}
          onClose={onToggleEpisodeBrowser}
          onSelect={(episodeId) => onSelectEpisode(episodeId)}
        />
      )}
    </div>
    </>
  )
}

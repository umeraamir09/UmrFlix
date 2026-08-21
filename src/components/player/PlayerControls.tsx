"use client"

import { useEffect, useRef, useState } from "react"
import { PictureInPicture2 } from "lucide-react"
import { formatTimecode, useRemainingTimeToggle, type NextEpisodeInfo } from "./PlayerOverlays"
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
import { PlayerHeader } from "./PlayerHeader"
import { NextEpisodeCard } from "./NextEpisodeCard"
import type { EpisodeInfo, SeasonInfo } from "@/components/SeasonBrowser"
import type { SubtitleStyle } from "./SubtitleOverlay"

import {
  IconPlay,
  IconPause,
  IconSkipBackward,
  IconSkipForward,
  IconSkipNext,
  IconSubtitles,
  IconSpeed,
  IconVolumeUp,
  IconVolumeMute,
  IconVideoLibrary,
  IconHelp,
  IconFullscreen,
  IconMinimize,
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

  const pendingHoverRef = useRef<{ time: number; x: number; barW: number } | null>(null)
  const pendingScrubRef = useRef<number | null>(null)
  const scrubTimeRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  const preloadedTilesRef = useRef(new Set<string>())
  const hasChapterImages = chapters.some((c) => Boolean(c.imageTag))
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
    }
    if (next !== null) {
      e.preventDefault()
      e.stopPropagation()
      const clamped = Math.max(0, Math.min(duration, next))
      onSeek(clamped)
    }
  }

  const preview = trickplay
    ? trickplayPreviewDisplaySize(trickplay)
    : hasChapterImages
      ? chapterPreviewDisplaySize()
      : null
  const previewW = preview ? preview.width + 2 : 0
  const previewLeft =
    hover && preview && hover.barW > previewW
      ? Math.min(Math.max(hover.x, previewW / 2), hover.barW - previewW / 2)
      : (hover?.x ?? 0)

  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Seek bar"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={shownTime}
      aria-valuetext={formatTimecode(shownTime)}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerEnter={preloadPreviews}
      onPointerDown={(e) => {
        e.stopPropagation()
        const target = e.currentTarget
        target.setPointerCapture(e.pointerId)
        const f = fraction(e.clientX)
        const t = f * duration
        scrubTimeRef.current = t
        setScrubTime(t)
        onSeek(t)
        onScrubStateChange?.(true)
      }}
      onPointerMove={(e) => {
        const rect = barRef.current?.getBoundingClientRect()
        if (!rect) return
        const x = e.clientX - rect.left
        const f = Math.min(1, Math.max(0, x / rect.width))
        const t = f * duration

        if (scrubTimeRef.current !== null) {
          scrubTimeRef.current = t
          schedulePointerMove({ time: t, x, barW: rect.width }, t)
        } else {
          schedulePointerMove({ time: t, x, barW: rect.width }, null)
        }
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {}
        if (scrubTimeRef.current !== null) {
          const finalTime = scrubTimeRef.current
          scrubTimeRef.current = null
          setScrubTime(null)
          onSeek(finalTime)
          onScrubStateChange?.(false)
        }
      }}
      onPointerCancel={() => {
        scrubTimeRef.current = null
        setScrubTime(null)
        setHover(null)
        onScrubStateChange?.(false)
      }}
      onPointerLeave={() => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        pendingHoverRef.current = null
        setHover(null)
      }}
      className="group/seek relative flex h-6 w-full cursor-pointer touch-none items-center outline-none select-none"
    >
      {/* Visual Track (3px height matching Penpot) */}
      <div className="relative h-[3px] w-full rounded-full bg-white/30 transition-all group-hover/seek:h-1.5 group-focus-visible/seek:ring-2 group-focus-visible/seek:ring-cyan">
        {/* Buffered */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/40"
          style={{ width: `${bufferedPct}%` }}
        />
        {/* Played (#02E7F5 Cyan) */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent bg-cyan"
          style={{ width: `${playedPct}%` }}
        />

        {/* Chapter Ticks */}
        {chapters.map((ch, idx) => {
          const pct = duration > 0 ? (ch.startSeconds / duration) * 100 : 0
          if (pct <= 0 || pct >= 100) return null
          return (
            <div
              key={idx}
              className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-black/70"
              style={{ left: `${pct}%` }}
            />
          )
        })}

        {/* Scrubber Handle Thumb (12px circular cyan handle matching Penpot) */}
        <div
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan shadow-md transition-transform duration-100 group-hover/seek:scale-125"
          style={{ left: `${playedPct}%` }}
        />
      </div>

      {/* Hover preview tooltip (Trickplay / Chapter / Timecode) */}
      {hover && (
        <div
          className="pointer-events-none absolute bottom-5 -translate-x-1/2 flex flex-col items-center gap-1.5"
          style={{ left: previewLeft }}
        >
          {trickplay ? (
            <TrickplayPreview trickplay={trickplay} itemId={itemId} time={hover.time} />
          ) : hasChapterImages ? (
            <ChapterImagePreview chapters={chapters} itemId={itemId} time={hover.time} />
          ) : null}
          <span className="rounded bg-black/90 px-2 py-1 text-xs font-semibold tabular-nums text-white shadow-lg border border-white/10">
            {formatTimecode(hover.time)}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Main Control Bar ──

export function PlayerControls({
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
  nextEpisode,
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
  nextEpisode?: NextEpisodeInfo | null
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
  const [showNextPreview, setShowNextPreview] = useState(false)
  const [showHelpTooltip, setShowHelpTooltip] = useState(false)
  const [showRemaining, toggleRemainingTime] = useRemainingTimeToggle()
  const audioSubsRef = useRef<HTMLDivElement>(null)
  const speedRef = useRef<HTMLDivElement>(null)

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
        {/* Top Header Bar (Penpot 1:1) */}
        <PlayerHeader
          title={title}
          subtitle={subtitle}
          onBack={onBack ?? (() => window.history.back())}
          onReport={onReport}
          visible={visible || isAnyMenuOpen}
        />

        {/* Bottom Transport Bar (`Player/controls` Penpot 1:1) */}
        <div className="mt-auto relative z-30 pointer-events-auto px-6 sm:px-10 pb-6 pt-2 bg-gradient-to-t from-black/95 via-black/60 to-transparent">
          {/* Progress Bar with Cyan fill and 12px thumb */}
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

          {/* Controls Row */}
          <div className="mt-3 flex items-center justify-between gap-4">
            {/* Left Controls (`Frame 19` in Penpot: Replay 10, Play/Pause, Forward 10, Volume + Time) */}
            <div className="flex items-center gap-4 sm:gap-6 shrink-0">
              <button
                type="button"
                onClick={() => onSkipBy(-10)}
                className="flex size-9 items-center justify-center text-white transition-transform hover:scale-110 active:scale-95"
                aria-label="Replay 10 seconds"
                title="Replay 10s"
              >
                <IconSkipBackward className="size-7 text-white" />
              </button>

              <button
                type="button"
                onClick={onTogglePlay}
                className="flex size-10 items-center justify-center text-white transition-transform hover:scale-110 active:scale-95"
                aria-label={playing ? "Pause" : "Play"}
                title={playing ? "Pause" : "Play"}
              >
                {playing ? (
                  <IconPause className="size-8 text-white fill-white" />
                ) : (
                  <IconPlay className="size-8 text-white fill-white" />
                )}
              </button>

              <button
                type="button"
                onClick={() => onSkipBy(10)}
                className="flex size-9 items-center justify-center text-white transition-transform hover:scale-110 active:scale-95"
                aria-label="Forward 10 seconds"
                title="Forward 10s"
              >
                <IconSkipForward className="size-7 text-white" />
              </button>

              {/* Volume + Time Indicator */}
              <div className="flex items-center gap-3">
                <div className="group/vol flex items-center relative">
                  <button
                    type="button"
                    onClick={onToggleMute}
                    className="flex size-9 items-center justify-center text-white transition-transform hover:scale-110 active:scale-95"
                    aria-label={muted ? "Unmute" : "Mute"}
                    title={muted ? "Unmute" : "Mute"}
                  >
                    {muted || volume === 0 ? (
                      <IconVolumeMute className="size-6 text-white" />
                    ) : (
                      <IconVolumeUp className="size-6 text-white" />
                    )}
                  </button>

                  {typeof navigator !== "undefined" && !/iPad|iPhone|iPod/.test(navigator.userAgent) && (
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={muted ? 0 : Math.round(volume * 100)}
                      onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
                      className="w-0 opacity-0 transition-all duration-200 accent-cyan h-1.5 group-hover/vol:ml-2 group-hover/vol:w-20 sm:group-hover/vol:w-24 group-hover/vol:opacity-100 cursor-pointer"
                      aria-label="Volume slider"
                      aria-valuetext={`${Math.round(volume * 100)} percent`}
                    />
                  )}
                </div>

                {/* Time Indicator (`10:00 / 52:20` formatted as 16px text in Penpot) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleRemainingTime()
                  }}
                  className="cursor-pointer text-sm sm:text-base font-normal tabular-nums text-white transition-colors hover:text-cyan active:scale-95 select-none"
                  title={showRemaining ? "Click to show total duration" : "Click to show remaining time"}
                >
                  <span>{formatTimecode(currentTime)}</span>
                  <span className="text-white/60 mx-1">/</span>
                  <span>
                    {showRemaining
                      ? `-${formatTimecode(Math.max(0, duration - currentTime))}`
                      : formatTimecode(duration)}
                  </span>
                </button>
              </div>
            </div>

            {/* Right Controls (`Frame 20` in Penpot: Help, Skip Next, Episodes, Subtitles, Fullscreen) */}
            <div className="flex items-center gap-3 sm:gap-6 shrink-0 relative">
              {/* Help Button (Penpot `Player/Button/help`) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowHelpTooltip(!showHelpTooltip)}
                  onMouseEnter={() => setShowHelpTooltip(true)}
                  onMouseLeave={() => setShowHelpTooltip(false)}
                  className="flex size-9 items-center justify-center text-white/90 hover:text-white transition-transform hover:scale-110 active:scale-95"
                  aria-label="Help and shortcuts"
                  title="Help & Shortcuts"
                >
                  <IconHelp className="size-6 text-white" />
                </button>
                {showHelpTooltip && (
                  <div className="absolute bottom-12 right-0 w-48 rounded-lg bg-black/90 p-3 text-xs text-white shadow-xl border border-white/10 backdrop-blur-md">
                    <p className="font-bold text-cyan mb-1">Shortcuts</p>
                    <p>Space: Play / Pause</p>
                    <p>← / →: Skip 10s</p>
                    <p>↑ / ↓: Volume</p>
                    <p>F: Fullscreen</p>
                    <p>M: Mute</p>
                  </div>
                )}
              </div>

              {/* Next Episode (Penpot `Player/Button/Next` with hover preview card) */}
              {(hasNext || nextEpisode) && onNextEpisode && (
                <div
                  className="relative"
                  onMouseEnter={() => setShowNextPreview(true)}
                  onMouseLeave={() => setShowNextPreview(false)}
                >
                  {showNextPreview && nextEpisode && (
                    <div className="absolute bottom-12 right-0 pointer-events-none animate-in fade-in zoom-in-95 duration-150">
                      <NextEpisodeCard next={nextEpisode} seriesTitle={title} />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={onNextEpisode}
                    className="flex size-9 items-center justify-center text-white/90 hover:text-white transition-transform hover:scale-110 active:scale-95"
                    aria-label="Play next episode"
                    title="Next Episode"
                  >
                    <IconSkipNext className="size-6 text-white" />
                  </button>
                </div>
              )}

              {/* Episodes Browser Button (Penpot `Player/Button/episodes`) */}
              {seriesId && onSelectEpisode && episodes && episodes.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setAudioSubsOpen(false)
                    setSpeedOpen(false)
                    onToggleEpisodeBrowser()
                  }}
                  className={`flex size-9 items-center justify-center text-white/90 hover:text-white transition-transform hover:scale-110 active:scale-95 ${
                    episodeBrowserOpen ? "text-cyan" : ""
                  }`}
                  aria-label="Browse episodes"
                  title="Episodes"
                  aria-haspopup="dialog"
                  aria-expanded={episodeBrowserOpen}
                >
                  <IconVideoLibrary className="size-6 text-white" />
                </button>
              )}

              {/* Subtitles & Audio Button (Penpot `Player/Button/subtitles`) */}
              <div ref={audioSubsRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setAudioSubsOpen((o) => !o)
                    setSpeedOpen(false)
                  }}
                  className={`flex size-9 items-center justify-center text-white/90 hover:text-white transition-transform hover:scale-110 active:scale-95 ${
                    audioSubsOpen ? "text-cyan" : ""
                  }`}
                  aria-label="Audio and Subtitles"
                  title="Audio & Subtitles"
                  aria-haspopup="dialog"
                  aria-expanded={audioSubsOpen}
                >
                  <IconSubtitles className="size-6 text-white" />
                </button>
              </div>

              {/* Speed & Quality Button */}
              <div ref={speedRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setSpeedOpen((o) => !o)
                    setAudioSubsOpen(false)
                  }}
                  className={`flex size-9 items-center justify-center text-white/90 hover:text-white transition-transform hover:scale-110 active:scale-95 ${
                    speedOpen ? "text-cyan" : ""
                  }`}
                  aria-label="Playback Speed and Quality"
                  title="Playback Speed & Quality"
                  aria-haspopup="menu"
                  aria-expanded={speedOpen}
                >
                  <IconSpeed className="size-6 text-white" />
                </button>
              </div>

              {/* Picture-in-Picture */}
              <button
                type="button"
                onClick={onTogglePip}
                className="hidden sm:flex size-9 items-center justify-center text-white/90 hover:text-white transition-transform hover:scale-110 active:scale-95"
                aria-label="Picture in Picture"
                title="Picture in Picture"
              >
                <PictureInPicture2 className="size-6 stroke-[1.8] text-white" />
              </button>

              {/* Fullscreen Button (Penpot `Player/Button/expand`) */}
              <button
                type="button"
                onClick={onToggleFullscreen}
                className="flex size-9 items-center justify-center text-white/90 hover:text-white transition-transform hover:scale-110 active:scale-95"
                aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                title={isFullscreen ? "Exit Fullscreen (F)" : "Fullscreen (F)"}
              >
                {isFullscreen ? (
                  <IconMinimize className="size-6 text-white" />
                ) : (
                  <IconFullscreen className="size-6 text-white" />
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

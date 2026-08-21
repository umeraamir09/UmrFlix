"use client"

import { useEffect, useRef, useState } from "react"
import { formatTimecode, useRemainingTimeToggle } from "../PlayerOverlays"
import type {
  AudioTrack,
  ChapterInfo,
  SubtitleTrack,
  TrickplayInfo,
} from "@/lib/playback-types"
import { SeekBar } from "../PlayerControls"
import { AudioSubtitlesMenu, SpeedQualityMenu } from "../player-menus"
import { EpisodeBrowser } from "../EpisodeBrowser"
import { PlayerHeader } from "../PlayerHeader"
import type { EpisodeInfo, SeasonInfo } from "@/components/SeasonBrowser"
import type { SubtitleStyle } from "../SubtitleOverlay"
import type { SkipRipple } from "./use-touch-gestures"
import {
  IconBrightness,
  IconPause,
  IconPlay,
  IconSkipBackward,
  IconSkipForward,
  IconSpeed,
  IconSubtitles,
  IconVideoLibrary,
} from "@/components/ui/icons"

// Safe-area aware paddings (env() with fallback so non-notch devices still get spacing)
const PAD_L = "pl-[max(1.5rem,env(safe-area-inset-left,0px))]"
const PAD_R = "pr-[max(1.5rem,env(safe-area-inset-right,0px))]"
const PAD_B = "pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
const EDGE_L = "left-[max(1.5rem,env(safe-area-inset-left,0px))]"

const BRIGHTNESS_KEY = "umrflix.brightness"
const BRIGHTNESS_MIN = 0.2

function loadBrightness(): number {
  if (typeof window === "undefined") return 1
  try {
    const v = window.localStorage.getItem(BRIGHTNESS_KEY)
    if (v !== null) {
      const n = Number(v)
      if (Number.isFinite(n)) return Math.min(1, Math.max(BRIGHTNESS_MIN, n))
    }
  } catch {}
  return 1
}

// ── Double-tap skip feedback (side wedge + accumulated seconds) ──

function SkipRippleOverlay({ ripple }: { ripple: NonNullable<SkipRipple> }) {
  return (
    <div
      className={`pointer-events-none absolute inset-y-0 z-[36] flex w-1/3 items-center justify-center bg-white/10 text-white animate-in fade-in zoom-in-95 duration-150 ${
        ripple.side === "left" ? "left-0 rounded-r-full" : "right-0 rounded-l-full"
      }`}
    >
      <div className="flex flex-col items-center gap-1 font-black text-sm uppercase tracking-wider drop-shadow-md">
        {ripple.side === "left" ? (
          <IconSkipBackward className="size-9 text-white" />
        ) : (
          <IconSkipForward className="size-9 text-white" />
        )}
        <span>
          {ripple.side === "left" ? "-" : "+"}
          {10 * ripple.count}s
        </span>
      </div>
    </div>
  )
}

// ── Left-edge brightness rail ──

function BrightnessRail({
  value,
  onChange,
  onDragStateChange,
}: {
  value: number
  onChange: (v: number) => void
  onDragStateChange: (dragging: boolean) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const fillPct = ((value - BRIGHTNESS_MIN) / (1 - BRIGHTNESS_MIN)) * 100

  const setFromClientY = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.height === 0) return
    const frac = 1 - (clientY - rect.top) / rect.height
    onChange(Math.min(1, Math.max(BRIGHTNESS_MIN, frac)))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.05
    let next: number | null = null
    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        next = value + step
        break
      case "ArrowDown":
      case "ArrowLeft":
        next = value - step
        break
      case "PageUp":
        next = value + 0.2
        break
      case "PageDown":
        next = value - 0.2
        break
      case "Home":
        next = BRIGHTNESS_MIN
        break
      case "End":
        next = 1
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
    onChange(Math.min(1, Math.max(BRIGHTNESS_MIN, next)))
  }

  return (
    <div
      className={`pointer-events-auto absolute ${EDGE_L} top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-2 px-2 py-1 drop-shadow-[0_16px_48px_rgba(0,16,61,0.48)]`}
    >
      <IconBrightness className="size-6 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]" />
      <div
        ref={trackRef}
        role="slider"
        aria-label="Brightness"
        aria-orientation="vertical"
        aria-valuemin={Math.round(BRIGHTNESS_MIN * 100)}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={`${Math.round(value * 100)} percent`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="relative flex h-32 w-7 touch-none items-center justify-center cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-cyan rounded"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          onDragStateChange(true)
          setFromClientY(e.clientY)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromClientY(e.clientY)
        }}
        onPointerUp={() => onDragStateChange(false)}
        onPointerCancel={() => onDragStateChange(false)}
      >
        {/* track */}
        <div className="relative h-full w-1.5 rounded-full bg-white/30">
          <div
            className="absolute inset-x-0 bottom-0 rounded-full bg-cyan"
            style={{ height: `${fillPct}%` }}
          />
          {/* thumb */}
          <div
            className="absolute left-1/2 size-3.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-cyan shadow-md"
            style={{ bottom: `${fillPct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Touch controls overlay ──

export function TouchControls({
  visible,
  title,
  subtitle,
  playing,
  currentTime,
  duration,
  buffered,
  qualityId,
  autoResolvedLabel,
  sourceHeight,
  audioTracks,
  audioIndex,
  subtitleTracks,
  subtitleIndex,
  subStyle,
  onSubStyleChange,
  playbackRate,
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
  onQualityChange,
  onAudioChange,
  onSubtitleChange,
  onPlaybackRateChange,
  onBack,
  onReport,
  onInteract,
  ripple,
}: {
  visible: boolean
  title: string
  subtitle?: string
  playing: boolean
  currentTime: number
  duration: number
  buffered: number
  qualityId: string
  autoResolvedLabel?: string
  sourceHeight?: number
  audioTracks: AudioTrack[]
  audioIndex: number | null
  subtitleTracks: SubtitleTrack[]
  subtitleIndex: number | null
  subStyle: SubtitleStyle
  onSubStyleChange: (s: SubtitleStyle) => void
  playbackRate: number
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
  onQualityChange: (id: string) => void
  onAudioChange: (index: number) => void
  onSubtitleChange: (index: number | null) => void
  onPlaybackRateChange: (rate: number) => void
  onBack?: () => void
  onReport?: () => void
  onInteract: () => void
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  ripple: SkipRipple
  hasParty?: boolean
}) {
  const [audioSubsOpen, setAudioSubsOpen] = useState(false)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [showRemaining, toggleRemainingTime] = useRemainingTimeToggle()
  const [brightness, setBrightnessState] = useState(loadBrightness)
  const [brightnessDragging, setBrightnessDragging] = useState(false)

  const brightnessRef = useRef(brightness)
  useEffect(() => {
    brightnessRef.current = brightness
  }, [brightness])

  const setBrightness = (v: number) => {
    const clamped = Math.min(1, Math.max(BRIGHTNESS_MIN, v))
    setBrightnessState(clamped)
    if (!brightnessDragging) {
      try {
        window.localStorage.setItem(BRIGHTNESS_KEY, String(clamped))
      } catch {}
    }
  }

  const prevDraggingRef = useRef(brightnessDragging)
  useEffect(() => {
    if (prevDraggingRef.current && !brightnessDragging) {
      try {
        window.localStorage.setItem(BRIGHTNESS_KEY, String(brightnessRef.current))
      } catch {}
    }
    prevDraggingRef.current = brightnessDragging
  }, [brightnessDragging])

  const isAnyMenuOpen =
    audioSubsOpen || speedOpen || episodeBrowserOpen || isScrubbing || brightnessDragging
  const show = visible || isAnyMenuOpen
  const pe = show ? "pointer-events-auto" : "pointer-events-none"

  const [prevShow, setPrevShow] = useState(show)
  if (prevShow !== show) {
    setPrevShow(show)
    if (!show) {
      setAudioSubsOpen(false)
      setSpeedOpen(false)
    }
  }

  return (
    <>
      {/* Brightness dim — above video & subtitles, below controls */}
      {brightness < 1 && (
        <div
          className="pointer-events-none absolute inset-0 z-[35] bg-black"
          style={{ opacity: 1 - brightness }}
        />
      )}

      {/* Double-tap skip feedback */}
      {ripple && <SkipRippleOverlay ripple={ripple} />}

      {/* Fullscreen Mobile Audio & Subtitles Menu */}
      {audioSubsOpen && (
        <AudioSubtitlesMenu
          sheet
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

      {/* Fullscreen Mobile Speed & Quality Menu */}
      {speedOpen && (
        <SpeedQualityMenu
          sheet
          qualityId={qualityId}
          autoResolvedLabel={autoResolvedLabel}
          sourceHeight={sourceHeight}
          onQualityChange={onQualityChange}
          playbackRate={playbackRate}
          onPlaybackRateChange={onPlaybackRateChange}
          onClose={() => setSpeedOpen(false)}
        />
      )}

      {/* Main overlay chrome */}
      <div
        className={`absolute inset-0 z-40 flex flex-col justify-between pointer-events-none transition-opacity duration-300 ${
          show ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
        {/* Top Header Bar with Back button and Title/Subtitle */}
        <PlayerHeader
          title={title}
          subtitle={subtitle}
          onBack={onBack ?? (() => window.history.back())}
          onReport={onReport}
          visible={show}
        />

        {/* Center transport: −10s / play-pause / +10s */}
        <div className="relative z-30 flex flex-1 items-center justify-evenly px-6">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSkipBy(-10)
              onInteract()
            }}
            className={`${pe} flex size-14 items-center justify-center text-white transition-transform hover:scale-110 active:scale-90`}
            aria-label="Skip back 10 seconds"
          >
            <IconSkipBackward className="size-10 text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onTogglePlay()
              onInteract()
            }}
            className={`${pe} flex size-18 items-center justify-center text-white transition-transform hover:scale-110 active:scale-90`}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <IconPause className="size-14 fill-white text-white drop-shadow-[4px_4px_16px_rgba(0,0,0,0.87)]" />
            ) : (
              <IconPlay className="ml-1 size-14 fill-white text-white drop-shadow-[4px_4px_16px_rgba(0,0,0,0.87)]" />
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSkipBy(10)
              onInteract()
            }}
            className={`${pe} flex size-14 items-center justify-center text-white transition-transform hover:scale-110 active:scale-90`}
            aria-label="Skip forward 10 seconds"
          >
            <IconSkipForward className="size-10 text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]" />
          </button>
        </div>

        {/* Brightness rail (left edge) */}
        {show && (
          <BrightnessRail
            value={brightness}
            onChange={setBrightness}
            onDragStateChange={setBrightnessDragging}
          />
        )}

        {/* Bottom stack: seek bar + timecode + icon-only action row */}
        <div className={`mt-auto relative z-30 ${pe} ${PAD_L} ${PAD_R} ${PAD_B} pt-2 bg-gradient-to-t from-black/95 via-black/60 to-transparent`}>
          <div className="flex items-center gap-3 w-full mb-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleRemainingTime()
                onInteract()
              }}
              className="shrink-0 text-xs font-semibold tabular-nums text-white/90 active:text-cyan transition-colors select-none cursor-pointer"
              title={showRemaining ? "Tap to show total duration" : "Tap to show remaining time"}
            >
              {formatTimecode(currentTime)}
            </button>

            <div className="flex-1 min-w-0">
              <SeekBar
                currentTime={currentTime}
                duration={duration}
                buffered={buffered}
                chapters={chapters}
                itemId={itemId}
                trickplay={trickplay}
                onSeek={onSeek}
                onScrubStateChange={(scrubbing) => {
                  setIsScrubbing(scrubbing)
                  if (!scrubbing) onInteract()
                }}
              />
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleRemainingTime()
                onInteract()
              }}
              className="shrink-0 text-xs font-semibold tabular-nums text-white/90 active:text-cyan transition-colors select-none cursor-pointer"
              title={showRemaining ? "Tap to show total duration" : "Tap to show remaining time"}
            >
              {showRemaining
                ? `-${formatTimecode(Math.max(0, duration - currentTime))}`
                : formatTimecode(duration)}
            </button>
          </div>

          {/* Mobile Icon-only Action Row (Clean, uncluttered, no redundant fullscreen button) */}
          <div className="mt-1 flex items-center justify-center gap-6 sm:gap-8 w-full py-1">
            {/* Speed & Quality Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setSpeedOpen((o) => !o)
                setAudioSubsOpen(false)
                onInteract()
              }}
              className={`flex size-11 items-center justify-center rounded-full transition-all active:scale-95 ${
                speedOpen
                  ? "bg-cyan text-black shadow-lg"
                  : "bg-white/10 text-white hover:bg-white/20"
              }`}
              aria-label="Playback speed and video quality"
              title="Speed & Quality"
              aria-expanded={speedOpen}
            >
              <IconSpeed className="size-6" />
            </button>

            {/* Audio & Subtitles Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setAudioSubsOpen((o) => !o)
                setSpeedOpen(false)
                onInteract()
              }}
              className={`flex size-11 items-center justify-center rounded-full transition-all active:scale-95 ${
                audioSubsOpen
                  ? "bg-cyan text-black shadow-lg"
                  : "bg-white/10 text-white hover:bg-white/20"
              }`}
              aria-label="Audio and subtitles"
              title="Audio & Subtitles"
              aria-expanded={audioSubsOpen}
            >
              <IconSubtitles className="size-6" />
            </button>

            {/* Episode Browser Button (when TV series) */}
            {seriesId && onSelectEpisode && episodes && episodes.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setAudioSubsOpen(false)
                  setSpeedOpen(false)
                  onToggleEpisodeBrowser()
                }}
                className={`flex size-11 items-center justify-center rounded-full transition-all active:scale-95 ${
                  episodeBrowserOpen
                    ? "bg-cyan text-black shadow-lg"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
                aria-label="Browse episodes"
                title="Episodes"
                aria-expanded={episodeBrowserOpen}
              >
                <IconVideoLibrary className="size-6" />
              </button>
            )}
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
    </>
  )
}

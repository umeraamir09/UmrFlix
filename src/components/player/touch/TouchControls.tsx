"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { ArrowLeft, Maximize, Minimize } from "lucide-react"
import { formatTimecode } from "../PlayerOverlays"
import type {
  AudioTrack,
  ChapterInfo,
  SubtitleTrack,
  TrickplayInfo,
} from "@/lib/playback-types"
import { SeekBar } from "../PlayerControls"
import { AudioSubtitlesMenu, SpeedQualityMenu } from "../player-menus"
import { EpisodeBrowser } from "../EpisodeBrowser"
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
} from "@/components/ui/icons"

// Safe-area aware paddings (env() with fallback so non-notch devices still get spacing)
const PAD_L = "pl-[max(1.5rem,env(safe-area-inset-left,0px))]"
const PAD_R = "pr-[max(1.5rem,env(safe-area-inset-right,0px))]"
const PAD_T = "pt-[max(1rem,env(safe-area-inset-top,0px))]"
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

// ── Left-edge brightness rail (Figma "brightness control") ──

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

  return (
    <div
      className={`pointer-events-auto absolute ${EDGE_L} top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-2 px-2 py-1 drop-shadow-[0_16px_48px_rgba(0,16,61,0.48)]`}
    >
      <IconBrightness className="size-6 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]" />
      <div
        ref={trackRef}
        className="relative flex h-32 w-7 touch-none items-center justify-center"
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
            className="absolute inset-x-0 bottom-0 rounded-full bg-white"
            style={{ height: `${fillPct}%` }}
          />
          {/* thumb */}
          <div
            className="absolute left-1/2 size-3.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow-md"
            style={{ bottom: `${fillPct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Bottom action-row button (icon + label, per Figma bottom row) ──

function ActionButton({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex items-center justify-center gap-1.5 rounded-full px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium tracking-tight transition-colors hover:bg-white/10 active:bg-white/20 shrink-0 ${
        active ? "text-accent" : "text-white/95"
      }`}
    >
      {icon}
      <span className="whitespace-nowrap font-medium">{label}</span>
    </button>
  )
}

// ── Touch controls overlay (Figma: "video player (landscape)") ──

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
  onReport: _onReport,
  onInteract,
  isFullscreen = false,
  onToggleFullscreen,
  ripple,
  hasParty = false,
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
  /** Re-arms the auto-hide timer (transport presses, scrub release, etc.). */
  onInteract: () => void
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  ripple: SkipRipple
  /** True in watch-party rooms — the PartyBar occupies the top-right corner,
   * so the touch chrome shifts down to stay clear of it. */
  hasParty?: boolean
}) {
  const [audioSubsOpen, setAudioSubsOpen] = useState(false)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
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
  // Islands only receive touches while visible — otherwise invisible controls
  // would swallow taps that should toggle the overlay (no hover-poke on touch).
  const pe = show ? "pointer-events-auto" : "pointer-events-none"

  // Close menus when the overlay fades out (render-time state adjustment — see
  // react.dev "you might not need an effect")
  const [prevShow, setPrevShow] = useState(show)
  if (prevShow !== show) {
    setPrevShow(show)
    if (!show) {
      setAudioSubsOpen(false)
      setSpeedOpen(false)
    }
  }

  const speedLabel = `Speed (${playbackRate === 1 ? "1x" : `${playbackRate}x`})`

  return (
    <>
      {/* Brightness dim — above the video & subtitles, below all controls */}
      {brightness < 1 && (
        <div
          className="pointer-events-none absolute inset-0 z-[35] bg-black"
          style={{ opacity: 1 - brightness }}
        />
      )}

      {/* Double-tap skip feedback */}
      {ripple && <SkipRippleOverlay ripple={ripple} />}

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

      {/* Audio & Subtitles menu (forced bottom-sheet on touch) */}
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
        />
      )}

      {/* Speed & Quality menu (forced bottom-sheet on touch) */}
      {speedOpen && (
        <SpeedQualityMenu
          sheet
          qualityId={qualityId}
          autoResolvedLabel={autoResolvedLabel}
          onQualityChange={onQualityChange}
          playbackRate={playbackRate}
          onPlaybackRateChange={onPlaybackRateChange}
        />
      )}

      {/* Main overlay chrome */}
      <div
        className={`absolute inset-0 z-40 flex flex-col pointer-events-none transition-opacity duration-300 ${
          show ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Background gradients */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/80 via-black/40 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/95 via-black/60 to-transparent" />

        {/* Centered title (Figma: "S0:E0 “Episode Name”" top-center) */}
        <div className={`pointer-events-none absolute inset-x-0 top-0 z-20 ${PAD_T}`}>
          <div className={`mx-auto max-w-[62%] text-center ${hasParty ? "mt-12" : "mt-1"}`}>
            <div className="truncate text-sm font-medium tracking-[-0.01em] text-white drop-shadow-md">
              {subtitle ?? title}
            </div>
            {subtitle && (
              <div className="mt-0.5 truncate text-xs font-light text-gray-300 drop-shadow-md">
                {title}
              </div>
            )}
          </div>
        </div>

        {/* Top bar: Back arrow button (top-left), title (center) */}
        <div
          className={`relative z-30 ${pe} flex items-center justify-between ${PAD_L} ${PAD_R} ${PAD_T} ${hasParty ? "mt-12" : ""}`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              ;(onBack ?? (() => window.history.back()))()
            }}
            className="flex size-10 items-center justify-center rounded-full bg-[#292929]/85 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-105 active:scale-95"
            aria-label="Go back"
          >
            <ArrowLeft className="size-5 stroke-[2.5]" />
          </button>
          <span className="size-10" />
        </div>

        {/* Center transport: −10s / play-pause / +10s spread across the middle */}
        <div className="relative z-30 flex flex-1 items-center justify-evenly px-[8cqw]">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSkipBy(-10)
              onInteract()
            }}
            className={`${pe} flex size-14 items-center justify-center text-white transition-transform hover:scale-110 active:scale-90`}
            aria-label="Skip back 10 seconds"
          >
            <IconSkipBackward className="size-9 text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              onTogglePlay()
              onInteract()
            }}
            className={`${pe} flex size-16 items-center justify-center text-white transition-transform hover:scale-110 active:scale-90`}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <IconPause className="size-11 fill-white text-white drop-shadow-[4px_4px_16px_rgba(0,0,0,0.87)]" />
            ) : (
              <IconPlay className="ml-1 size-11 fill-white text-white drop-shadow-[4px_4px_16px_rgba(0,0,0,0.87)]" />
            )}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              onSkipBy(10)
              onInteract()
            }}
            className={`${pe} flex size-14 items-center justify-center text-white transition-transform hover:scale-110 active:scale-90`}
            aria-label="Skip forward 10 seconds"
          >
            <IconSkipForward className="size-9 text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]" />
          </button>
        </div>

        {/* Brightness rail (left edge) — only mounted while shown so it can
            never swallow gestures meant for the overlay toggle */}
        {show && (
          <BrightnessRail
            value={brightness}
            onChange={setBrightness}
            onDragStateChange={setBrightnessDragging}
          />
        )}

        {/* Bottom stack: seek bar + timecode (Figma single-row) → action row */}
        <div className={`relative z-30 ${pe} ${PAD_L} ${PAD_R} ${PAD_B} pt-2`}>
          <div className="flex items-center gap-2.5 sm:gap-3 w-full">
            <span className="shrink-0 text-xs font-semibold tabular-nums text-white/90">
              {formatTimecode(currentTime)}
            </span>
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
            <span className="shrink-0 text-xs font-semibold tabular-nums text-white/90">
              {formatTimecode(duration)}
            </span>
          </div>

          {/* Action row (Figma: Speed (1x) · Lock · Episodes · Audio & Subtitles) */}
          <div className="mt-2.5 flex items-center justify-between w-full px-1 sm:px-4">
            <ActionButton
              icon={<IconSpeed className="size-5 shrink-0" />}
              label={speedLabel}
              active={speedOpen}
              onClick={() => {
                setSpeedOpen((o) => !o)
                setAudioSubsOpen(false)
                onInteract()
              }}
            />
            <ActionButton
              icon={<IconSubtitles className="size-5 shrink-0" />}
              label="Audio & Subtitles"
              active={audioSubsOpen}
              onClick={() => {
                setAudioSubsOpen((o) => !o)
                setSpeedOpen(false)
                onInteract()
              }}
            />
            {seriesId && onSelectEpisode && episodes && episodes.length > 0 && (
              <ActionButton
                icon={
                  <Image
                    src="/icons/ep-browser.svg"
                    alt=""
                    width={40}
                    height={40}
                    className="size-5 shrink-0"
                  />
                }
                label="Episodes"
                active={episodeBrowserOpen}
                onClick={() => {
                  setAudioSubsOpen(false)
                  setSpeedOpen(false)
                  onToggleEpisodeBrowser()
                }}
              />
            )}
            <ActionButton
              icon={
                isFullscreen ? (
                  <Minimize className="size-5 shrink-0" />
                ) : (
                  <Maximize className="size-5 shrink-0" />
                )
              }
              label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              active={isFullscreen}
              onClick={() => {
                setAudioSubsOpen(false)
                setSpeedOpen(false)
                onToggleFullscreen?.()
                onInteract()
              }}
            />
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

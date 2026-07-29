"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  Flag,
  PictureInPicture2,
  SkipForward,
  Type,
  Volume2,
  VolumeX,
} from "lucide-react"
import { formatTimecode } from "./PlayerOverlays"
import {
  QUALITY_PRESETS,
  type AudioTrack,
  type ChapterInfo,
  type SubtitleTrack,
} from "@/lib/playback-types"
import type { SubtitleShadowStyle, SubtitleStyle } from "./SubtitleOverlay"

import {
  IconPlay,
  IconPause,
  IconSkipBackward,
  IconSkipForward,
  IconSubtitles,
  IconSpeed,
  IconFullscreen,
} from "@/components/ui/icons"

// ── Seek bar with buffered display, chapter ticks, hover tooltip & scrubbing ──

function SeekBar({
  currentTime,
  duration,
  buffered,
  chapters,
  onSeek,
}: {
  currentTime: number
  duration: number
  buffered: number
  chapters: ChapterInfo[]
  onSeek: (t: number) => void
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ time: number; x: number } | null>(null)
  const [scrubTime, setScrubTime] = useState<number | null>(null)

  const fraction = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const shownTime = scrubTime ?? currentTime
  const playedPct = duration > 0 ? (shownTime / duration) * 100 : 0
  const bufferedPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0

  return (
    <div
      ref={barRef}
      className="group/seek relative flex h-6 cursor-pointer items-center touch-none select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const t = fraction(e.clientX) * duration
        setScrubTime(t)
        onSeek(t)
      }}
      onPointerMove={(e) => {
        const f = fraction(e.clientX)
        setHover({
          time: f * duration,
          x: e.clientX - (barRef.current?.getBoundingClientRect().left ?? 0),
        })
        if (scrubTime !== null) {
          const t = f * duration
          setScrubTime(t)
          onSeek(t)
        }
      }}
      onPointerUp={() => setScrubTime(null)}
      onPointerCancel={() => setScrubTime(null)}
      onPointerLeave={() => setHover(null)}
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
        className="pointer-events-none absolute size-4 sm:size-4.5 rounded-full bg-accent shadow-md transition-transform duration-100 group-hover/seek:scale-125"
        style={{ left: `calc(${playedPct}% - 8px)` }}
      />

      {/* hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute -top-9 -translate-x-1/2 rounded border border-white/10 bg-black/90 px-2.5 py-1 text-xs font-semibold tabular-nums text-white shadow-lg"
          style={{ left: hover.x }}
        >
          {formatTimecode(hover.time)}
        </div>
      )}
    </div>
  )
}

// ── Menu Helpers ──

function MenuRow({
  label,
  value,
  selected,
  onClick,
}: {
  label: string
  value?: string
  selected?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between gap-6 rounded-none px-4 py-3 text-left text-base font-medium transition-colors hover:bg-white/10 active:bg-white/15"
    >
      <span className={selected ? "font-bold text-white" : "text-gray-200"}>{label}</span>
      {selected ? (
        <Check className="size-5 shrink-0 text-accent" />
      ) : value ? (
        <span className="shrink-0 text-sm text-gray-400 font-normal">{value}</span>
      ) : null}
    </button>
  )
}

function MenuHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="flex w-full items-center gap-2 border-b border-white/15 px-4 py-3 text-xs font-bold uppercase tracking-widest text-gray-400 transition-colors hover:text-white"
    >
      <ChevronLeft className="size-5" />
      {title}
    </button>
  )
}

// ── Audio & Subtitles Popover Menu ──

type AudioSubSection = "root" | "audio" | "subtitles" | "substyle"

function AudioSubtitlesMenu({
  audioTracks,
  audioIndex,
  onAudioChange,
  subtitleTracks,
  subtitleIndex,
  onSubtitleChange,
  subStyle,
  onSubStyleChange,
}: {
  audioTracks: AudioTrack[]
  audioIndex: number | null
  onAudioChange: (index: number) => void
  subtitleTracks: SubtitleTrack[]
  subtitleIndex: number | null
  onSubtitleChange: (index: number | null) => void
  subStyle: SubtitleStyle
  onSubStyleChange: (s: SubtitleStyle) => void
}) {
  const [section, setSection] = useState<AudioSubSection>("root")

  const audioLabel = audioTracks.find((a) => a.index === audioIndex)?.title ?? "Default"
  const subLabel =
    subtitleIndex === null
      ? "Off"
      : (subtitleTracks.find((s) => s.index === subtitleIndex)?.title ?? "On")

  return (
    <div className="absolute bottom-16 right-0 z-50 max-h-[75vh] w-80 sm:w-96 overflow-y-auto rounded-none border border-white/15 bg-black p-2 shadow-2xl backdrop-blur-xl">
      {section === "root" && (
        <>
          <div className="px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-gray-400">
            Audio & Subtitles
          </div>
          {audioTracks.length > 0 && (
            <MenuRow label="Audio Track" value={audioLabel} onClick={() => setSection("audio")} />
          )}
          <MenuRow label="Subtitles" value={subLabel} onClick={() => setSection("subtitles")} />
          <MenuRow label="Subtitle Style" onClick={() => setSection("substyle")} />
        </>
      )}

      {section === "audio" && (
        <>
          <MenuHeader title="Audio Track" onBack={() => setSection("root")} />
          {audioTracks.map((track) => (
            <MenuRow
              key={track.index}
              label={track.title}
              value={track.channels ? `${track.channels}.ch` : undefined}
              selected={audioIndex === track.index}
              onClick={() => onAudioChange(track.index)}
            />
          ))}
        </>
      )}

      {section === "subtitles" && (
        <>
          <MenuHeader title="Subtitles" onBack={() => setSection("root")} />
          <MenuRow
            label="Off"
            selected={subtitleIndex === null}
            onClick={() => onSubtitleChange(null)}
          />
          {subtitleTracks.map((track) => (
            <MenuRow
              key={track.index}
              label={track.isImageBased ? `${track.title} (burned in)` : track.title}
              value={track.language}
              selected={subtitleIndex === track.index}
              onClick={() => onSubtitleChange(track.index)}
            />
          ))}
        </>
      )}

      {section === "substyle" && (
        <>
          <MenuHeader title="Subtitle Style" onBack={() => setSection("root")} />
          {/* font size */}
          <div className="px-4 pt-3 text-xs font-bold uppercase tracking-widest text-gray-400">
            Size
          </div>
          <div className="flex gap-2 px-3 py-2">
            {[
              { id: 0.7, label: "Small" },
              { id: 1, label: "Medium" },
              { id: 1.4, label: "Large" },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => onSubStyleChange({ ...subStyle, size: opt.id })}
                className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                  subStyle.size === opt.id
                    ? "bg-accent text-white"
                    : "bg-white/10 text-gray-200 hover:bg-white/15"
                }`}
              >
                <Type className="mx-auto mb-1 size-4" />
                {opt.label}
              </button>
            ))}
          </div>

          {/* colour */}
          <div className="px-4 pt-2 text-xs font-bold uppercase tracking-widest text-gray-400">
            Colour
          </div>
          <div className="flex gap-2 px-3 py-2">
            {[
              { id: "#ffffff", label: "White" },
              { id: "#fde047", label: "Yellow" },
              { id: "#86efac", label: "Green" },
              { id: "#93c5fd", label: "Blue" },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => onSubStyleChange({ ...subStyle, color: opt.id })}
                className={`flex-1 rounded-lg px-2 py-2.5 text-sm font-semibold transition-colors ${
                  subStyle.color === opt.id
                    ? "bg-accent text-white"
                    : "bg-white/10 text-gray-200 hover:bg-white/15"
                }`}
              >
                <span
                  className="mx-auto mb-1 block size-4 rounded-full border border-white/40"
                  style={{ backgroundColor: opt.id }}
                />
                {opt.label}
              </button>
            ))}
          </div>

          {/* background opacity */}
          <div className="px-4 pt-2 text-xs font-bold uppercase tracking-widest text-gray-400">
            Background — {Math.round(subStyle.bgOpacity * 100)}%
          </div>
          <div className="px-4 py-2">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(subStyle.bgOpacity * 100)}
              onChange={(e) =>
                onSubStyleChange({ ...subStyle, bgOpacity: Number(e.target.value) / 100 })
              }
              className="w-full accent-accent h-2"
            />
          </div>

          {/* text shadow / drop shadow */}
          <div className="px-4 pt-2 text-xs font-bold uppercase tracking-widest text-gray-400">
            Text Edge / Shadow
          </div>
          <div className="grid grid-cols-3 gap-1.5 px-3 py-2">
            {[
              { id: "uniform", label: "Uniform" },
              { id: "drop-shadow", label: "Drop" },
              { id: "raised", label: "Raised" },
              { id: "depressed", label: "Depressed" },
              { id: "none", label: "None" },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() =>
                  onSubStyleChange({
                    ...subStyle,
                    shadowStyle: opt.id as SubtitleShadowStyle,
                  })
                }
                className={`rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors ${
                  (subStyle.shadowStyle ?? "uniform") === opt.id
                    ? "bg-accent text-white"
                    : "bg-white/10 text-gray-200 hover:bg-white/15"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Speed & Quality Popover Menu ──

type SpeedQualitySection = "root" | "speed" | "quality"

const SPEED_OPTIONS = [
  { label: "0.5x", value: 0.5 },
  { label: "0.75x", value: 0.75 },
  { label: "1.0x (Normal)", value: 1.0 },
  { label: "1.25x", value: 1.25 },
  { label: "1.5x", value: 1.5 },
  { label: "2.0x", value: 2.0 },
]

function SpeedQualityMenu({
  qualityId,
  onQualityChange,
  playbackRate,
  onPlaybackRateChange,
}: {
  qualityId: string
  onQualityChange: (id: string) => void
  playbackRate: number
  onPlaybackRateChange: (rate: number) => void
}) {
  const [section, setSection] = useState<SpeedQualitySection>("root")

  const qualityLabel = QUALITY_PRESETS.find((q) => q.id === qualityId)?.label ?? "Auto"
  const speedLabel = playbackRate === 1 ? "Normal" : `${playbackRate}x`

  return (
    <div className="absolute bottom-16 right-0 z-50 max-h-[75vh] w-72 sm:w-80 overflow-y-auto rounded-none border border-white/15 bg-black p-2 shadow-2xl backdrop-blur-xl">
      {section === "root" && (
        <>
          <div className="px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-gray-400">
            Playback & Quality
          </div>
          <MenuRow
            label="Playback Speed"
            value={speedLabel}
            onClick={() => setSection("speed")}
          />
          <MenuRow label="Video Quality" value={qualityLabel} onClick={() => setSection("quality")} />
        </>
      )}

      {section === "speed" && (
        <>
          <MenuHeader title="Playback Speed" onBack={() => setSection("root")} />
          {SPEED_OPTIONS.map((opt) => (
            <MenuRow
              key={opt.value}
              label={opt.label}
              selected={playbackRate === opt.value}
              onClick={() => onPlaybackRateChange(opt.value)}
            />
          ))}
        </>
      )}

      {section === "quality" && (
        <>
          <MenuHeader title="Video Quality" onBack={() => setSection("root")} />
          {QUALITY_PRESETS.map((q) => (
            <MenuRow
              key={q.id}
              label={q.label}
              selected={qualityId === q.id}
              onClick={() => onQualityChange(q.id)}
            />
          ))}
          <p className="px-4 py-2.5 text-xs leading-relaxed text-gray-400">
            Qualities other than Auto are transcoded on demand.
          </p>
        </>
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
  audioTracks,
  audioIndex,
  subtitleTracks,
  subtitleIndex,
  subStyle,
  playbackRate,
  isFullscreen,
  hasNext,
  chapters,
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
  audioTracks: AudioTrack[]
  audioIndex: number | null
  subtitleTracks: SubtitleTrack[]
  subtitleIndex: number | null
  subStyle: SubtitleStyle
  playbackRate: number
  isFullscreen: boolean
  hasNext: boolean
  chapters: ChapterInfo[]
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
  const audioSubsRef = useRef<HTMLDivElement>(null)
  const speedRef = useRef<HTMLDivElement>(null)

  // Close menus on click outside
  useEffect(() => {
    if (!audioSubsOpen && !speedOpen) return
    const close = (e: MouseEvent) => {
      if (
        audioSubsRef.current &&
        !audioSubsRef.current.contains(e.target as Node)
      ) {
        setAudioSubsOpen(false)
      }
      if (speedRef.current && !speedRef.current.contains(e.target as Node)) {
        setSpeedOpen(false)
      }
    }
    window.addEventListener("mousedown", close)
    return () => window.removeEventListener("mousedown", close)
  }, [audioSubsOpen, speedOpen])

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

  return (
    <div
      className={`absolute inset-0 z-20 flex flex-col justify-between transition-opacity duration-300 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      {/* Background gradients */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/40 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/95 via-black/60 to-transparent" />

      {/* Top Bar */}
      <div className="relative z-30 flex items-center justify-between px-6 sm:px-8 pt-6">
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
      <div className="relative z-30 px-6 sm:px-8 pb-6 pt-2">
        {/* Total duration above seekbar on the right */}
        <div className="mb-1.5 flex justify-end text-sm font-medium tabular-nums text-white">
          {formatTimecode(duration)}
        </div>

        {/* Seekbar */}
        <SeekBar
          currentTime={currentTime}
          duration={duration}
          buffered={buffered}
          chapters={chapters}
          onSeek={onSeek}
        />

        {/* Control Buttons Row */}
        <div className="mt-3 flex items-center justify-between gap-3">
          {/* Left Controls */}
          <div className="flex items-center gap-5 sm:gap-7 shrink-0">
            <button
              onClick={onTogglePlay}
              className="flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <IconPause className="size-9 sm:size-10 fill-white text-white" />
              ) : (
                <IconPlay className="size-9 sm:size-10 fill-white text-white" />
              )}
            </button>

            <button
              onClick={() => onSkipBy(-10)}
              className="flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95"
              aria-label="Skip back 10 seconds"
            >
              <IconSkipBackward className="size-9 sm:size-10 text-white" />
            </button>

            <button
              onClick={() => onSkipBy(10)}
              className="flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95"
              aria-label="Skip forward 10 seconds"
            >
              <IconSkipForward className="size-9 sm:size-10 text-white" />
            </button>

            {/* Volume */}
            <div className="group/vol flex items-center relative">
              <button
                onClick={onToggleMute}
                className="flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95"
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted || volume === 0 ? (
                  <VolumeX className="size-9 sm:size-10 stroke-[2.2]" />
                ) : (
                  <Volume2 className="size-9 sm:size-10 stroke-[2.2]" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={muted ? 0 : Math.round(volume * 100)}
                onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
                className="w-0 opacity-0 transition-all duration-200 accent-accent h-2 group-hover/vol:ml-2.5 group-hover/vol:w-20 sm:group-hover/vol:w-24 group-hover/vol:opacity-100"
                aria-label="Volume"
              />
            </div>
          </div>

          {/* Center Title (+ episode subtitle) */}
          <div className="flex-1 min-w-0 text-center px-2">
            <span className="text-sm sm:text-base font-normal tracking-wide text-white text-center truncate block max-w-[220px] sm:max-w-xs md:max-w-md mx-auto drop-shadow-md">
              {title}
            </span>
            {subtitle && (
              <span className="mt-0.5 text-[11px] sm:text-xs font-medium tracking-wide text-gray-300 text-center truncate block max-w-[220px] sm:max-w-xs md:max-w-md mx-auto drop-shadow-md">
                {subtitle}
              </span>
            )}
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-5 sm:gap-7 shrink-0 relative">
            {/* Next Episode (only when one is available) */}
            {hasNext && onNextEpisode && (
              <button
                onClick={onNextEpisode}
                className="flex items-center gap-2 rounded-none border border-white/20 bg-black/50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white backdrop-blur transition-all hover:border-accent hover:bg-accent active:scale-95"
                aria-label="Play next episode"
                title="Next Episode"
              >
                <span className="hidden sm:inline">Next Episode</span>
                <SkipForward className="size-4" />
              </button>
            )}

            {/* Subtitles & Audio Menu */}
            <div ref={audioSubsRef} className="relative">
              <button
                onClick={() => {
                  setAudioSubsOpen((o) => !o)
                  setSpeedOpen(false)
                }}
                className={`flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95 ${
                  audioSubsOpen ? "text-accent" : ""
                }`}
                aria-label="Audio and Subtitles"
              >
                <IconSubtitles className="size-9 sm:size-10" />
              </button>
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
                />
              )}
            </div>

            {/* Speedometer & Quality Menu */}
            <div ref={speedRef} className="relative">
              <button
                onClick={() => {
                  setSpeedOpen((o) => !o)
                  setAudioSubsOpen(false)
                }}
                className={`flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95 ${
                  speedOpen ? "text-accent" : ""
                }`}
                aria-label="Playback Speed and Quality"
              >
                <IconSpeed className="size-9 sm:size-10" />
              </button>
              {speedOpen && (
                <SpeedQualityMenu
                  qualityId={qualityId}
                  onQualityChange={onQualityChange}
                  playbackRate={playbackRate}
                  onPlaybackRateChange={onPlaybackRateChange}
                />
              )}
            </div>

            {/* Picture-in-Picture */}
            <button
              onClick={onTogglePip}
              className="hidden sm:flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95"
              aria-label="Picture in Picture"
              title="Picture in Picture"
            >
              <PictureInPicture2 className="size-8 sm:size-9 stroke-[1.8]" />
            </button>

            {/* Fullscreen */}
            <button
              onClick={onToggleFullscreen}
              className="flex items-center justify-center p-1 text-white transition-transform hover:scale-110 active:scale-95"
              aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              <IconFullscreen className="size-9 sm:size-10" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

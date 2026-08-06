"use client"

import { useState } from "react"
import { Check, ChevronLeft, Type } from "lucide-react"
import {
  QUALITY_PRESETS,
  type AudioTrack,
  type SubtitleTrack,
} from "@/lib/playback-types"
import type { SubtitleShadowStyle, SubtitleStyle } from "./SubtitleOverlay"

// ── Menu Helpers ──

export function MenuRow({
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

export function MenuHeader({ title, onBack }: { title: string; onBack: () => void }) {
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

export function AudioSubtitlesMenu({
  audioTracks,
  audioIndex,
  onAudioChange,
  subtitleTracks,
  subtitleIndex,
  onSubtitleChange,
  subStyle,
  onSubStyleChange,
  sheet = false,
}: {
  audioTracks: AudioTrack[]
  audioIndex: number | null
  onAudioChange: (index: number) => void
  subtitleTracks: SubtitleTrack[]
  subtitleIndex: number | null
  onSubtitleChange: (index: number | null) => void
  subStyle: SubtitleStyle
  onSubStyleChange: (s: SubtitleStyle) => void
  /** Force the mobile bottom-sheet layout (used by the touch controls even on
   * landscape-width screens where sm: would anchor the menu desktop-style). */
  sheet?: boolean
}) {
  const [section, setSection] = useState<AudioSubSection>("root")

  const audioLabel = audioTracks.find((a) => a.index === audioIndex)?.title ?? "Default"
  const subLabel =
    subtitleIndex === null
      ? "Off"
      : (subtitleTracks.find((s) => s.index === subtitleIndex)?.title ?? "On")

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`${
        sheet
          ? "fixed left-1/2 -translate-x-1/2 bottom-6 w-[calc(100vw-2rem)] max-w-sm"
          : "fixed sm:absolute left-1/2 sm:left-auto -translate-x-1/2 sm:translate-x-0 bottom-20 sm:bottom-16 sm:right-0 w-[calc(100vw-2rem)] max-w-sm sm:w-96"
      } z-[100] pointer-events-auto max-h-[75vh] overflow-y-auto rounded-lg sm:rounded-[4px] border border-white/20 bg-[#16181f]/98 p-3 shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150`}
    >
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

export function SpeedQualityMenu({
  qualityId,
  autoResolvedLabel,
  onQualityChange,
  playbackRate,
  onPlaybackRateChange,
  sheet = false,
}: {
  qualityId: string
  autoResolvedLabel?: string
  onQualityChange: (id: string) => void
  playbackRate: number
  onPlaybackRateChange: (rate: number) => void
  /** Force the mobile bottom-sheet layout (used by the touch controls even on
   * landscape-width screens where sm: would anchor the menu desktop-style). */
  sheet?: boolean
}) {
  const [section, setSection] = useState<SpeedQualitySection>("root")

  const baseLabel = QUALITY_PRESETS.find((q) => q.id === qualityId)?.label ?? "Auto"
  const qualityLabel =
    qualityId === "auto" && autoResolvedLabel
      ? `Auto (${autoResolvedLabel})`
      : baseLabel
  const speedLabel = playbackRate === 1 ? "Normal" : `${playbackRate}x`

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`${
        sheet
          ? "fixed left-1/2 -translate-x-1/2 bottom-6 w-[calc(100vw-2rem)] max-w-xs"
          : "fixed sm:absolute left-1/2 sm:left-auto -translate-x-1/2 sm:translate-x-0 bottom-20 sm:bottom-16 sm:right-0 w-[calc(100vw-2rem)] max-w-xs sm:w-80"
      } z-[100] pointer-events-auto max-h-[75vh] overflow-y-auto rounded-lg sm:rounded-[4px] border border-white/20 bg-[#16181f]/98 p-3 shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150`}
    >
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

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronLeft, Type, Sliders } from "lucide-react"
import { IconClose, IconDoneBlack, IconArrowBackIos } from "@/components/ui/icons"
import {
  QUALITY_PRESETS,
  type AudioTrack,
  type QualityPreset,
  type SubtitleTrack,
} from "@/lib/playback-types"
import type { SubtitleShadowStyle, SubtitleStyle } from "./SubtitleOverlay"
import { useFocusTrap } from "@/hooks/useFocusTrap"

// ── Menu Helpers ──

export function MenuRow({
  label,
  value,
  selected,
  onClick,
  role,
  optionId,
  className = "",
}: {
  label: string
  value?: string
  selected?: boolean
  onClick: () => void
  /** Render as a listbox option (div) instead of a button. */
  role?: "option"
  /** Required when role="option": stable id for aria-activedescendant. */
  optionId?: string
  className?: string
}) {
  const content = (
    <>
      <span className={selected ? "font-bold text-white" : "text-penpot-text-medium"}>{label}</span>
      {selected ? (
        <Check className="size-5 shrink-0 text-cyan" />
      ) : value ? (
        <span className="shrink-0 text-sm text-penpot-text-subtle font-normal">{value}</span>
      ) : null}
    </>
  )

  if (role === "option") {
    return (
      <div
        id={optionId}
        role="option"
        aria-selected={selected ?? false}
        onClick={onClick}
        className={`flex w-full cursor-pointer items-center justify-between gap-6 rounded-none px-4 py-3 text-left text-base font-medium transition-colors hover:bg-white/10 active:bg-white/15 ${className}`}
      >
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-6 rounded-none px-4 py-3 text-left text-base font-medium transition-colors hover:bg-white/10 active:bg-white/15 ${className}`}
    >
      {content}
    </button>
  )
}

export function MenuHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex w-full items-center gap-2 border-b border-white/15 px-4 py-3 text-xs font-bold uppercase tracking-widest text-penpot-text-subtle transition-colors hover:text-white"
    >
      <ChevronLeft className="size-5" />
      {title}
    </button>
  )
}

// ── Listbox (ARIA APG pattern) for single-selection option lists ──
export function SelectionList({
  id,
  label,
  options,
  selectedIndex,
  onSelect,
}: {
  id: string
  label: string
  options: { key: string; label: string; value?: string; selected: boolean }[]
  selectedIndex: number
  onSelect: (optionIndex: number) => void
}) {
  const [cursor, setCursor] = useState(() => Math.max(0, selectedIndex))
  const [prevSelectedIndex, setPrevSelectedIndex] = useState(selectedIndex)
  // The cursor ring is a KEYBOARD affordance (focus-visible heuristic). Cursor
  // starts on the selected row, so rendering the ring unconditionally paints a
  // permanent cyan outline over the selection highlight the moment the menu
  // opens — a broken-looking double highlight. Only show it once the user
  // actually navigates with keys; hide it on pointer interaction and blur.
  const [keyboardNav, setKeyboardNav] = useState(false)

  if (selectedIndex !== prevSelectedIndex) {
    setPrevSelectedIndex(selectedIndex)
    setCursor(Math.max(0, selectedIndex))
  }

  const move = (next: number) => {
    if (options.length === 0) return
    setKeyboardNav(true)
    const clamped = ((next % options.length) + options.length) % options.length
    setCursor(clamped)
    const el = document.getElementById(`${id}-opt-${clamped}`)
    if (typeof el?.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        move(cursor + 1)
        break
      case "ArrowUp":
        e.preventDefault()
        move(cursor - 1)
        break
      case "Home":
        e.preventDefault()
        move(0)
        break
      case "End":
        e.preventDefault()
        move(options.length - 1)
        break
      case "Enter":
      case " ":
        e.preventDefault()
        onSelect(cursor)
        break
    }
  }

  return (
    <div
      role="listbox"
      aria-label={label}
      aria-activedescendant={`${id}-opt-${cursor}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onFocus={() => setCursor(Math.max(0, selectedIndex))}
      onBlur={() => setKeyboardNav(false)}
      className="outline-none"
    >
      {options.map((opt, idx) => (
        <div
          key={opt.key}
          id={`${id}-opt-${idx}`}
          role="option"
          aria-selected={opt.selected}
          onClick={() => {
            setCursor(idx)
            setKeyboardNav(false)
            onSelect(idx)
          }}
          className={`flex w-full cursor-pointer items-center justify-between gap-4 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
            opt.selected
              ? "font-bold text-white bg-white/10"
              : "text-penpot-text-medium hover:bg-white/5 hover:text-white"
          } ${idx === cursor && keyboardNav ? "ring-1 ring-inset ring-cyan/50" : ""}`}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {opt.selected ? (
              <IconDoneBlack className="size-4 shrink-0 text-cyan" />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <span className="truncate">{opt.label}</span>
          </div>
          {opt.value && (
            <span className="shrink-0 text-xs text-penpot-text-subtle font-normal">
              {opt.value}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Audio Track Label Helper (Issue 6.8) ──
export function formatAudioTrackLabel(
  track: AudioTrack & { displayTitle?: string },
  index?: number,
): string {
  if (track.title && track.title.trim().length > 0) return track.title.trim()
  if (track.displayTitle && track.displayTitle.trim().length > 0) {
    return track.displayTitle.trim()
  }
  if (track.language && track.language.trim().length > 0) {
    const lang = track.language.trim()
    return track.channels ? `${lang} (${track.channels}ch)` : lang
  }
  return index != null ? `Audio Track ${index + 1}` : `Track ${track.index}`
}

// ── Subtitle Styling Form ──
function SubtitleStylePanel({
  subStyle,
  onSubStyleChange,
}: {
  subStyle: SubtitleStyle
  onSubStyleChange: (s: SubtitleStyle) => void
}) {
  return (
    <div className="flex flex-col gap-4 p-2 text-left">
      {/* font size */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-penpot-text-subtle mb-2">
          Size
        </div>
        <div className="flex gap-2">
          {[
            { id: 0.7, label: "Small" },
            { id: 1, label: "Medium" },
            { id: 1.4, label: "Large" },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSubStyleChange({ ...subStyle, size: opt.id })}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                subStyle.size === opt.id
                  ? "bg-cyan text-black"
                  : "bg-white/10 text-penpot-text-medium hover:bg-white/15"
              }`}
            >
              <Type className="mx-auto mb-1 size-4" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* colour */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-penpot-text-subtle mb-2">
          Colour
        </div>
        <div className="flex gap-2">
          {[
            { id: "#ffffff", label: "White" },
            { id: "#fde047", label: "Yellow" },
            { id: "#86efac", label: "Green" },
            { id: "#93c5fd", label: "Blue" },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSubStyleChange({ ...subStyle, color: opt.id })}
              className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${
                subStyle.color === opt.id
                  ? "bg-cyan text-black"
                  : "bg-white/10 text-penpot-text-medium hover:bg-white/15"
              }`}
            >
              <span
                className="mx-auto mb-1 block size-3.5 rounded-full border border-white/40"
                style={{ backgroundColor: opt.id }}
              />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* background opacity */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-penpot-text-subtle mb-1">
          Background Opacity — {Math.round(subStyle.bgOpacity * 100)}%
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(subStyle.bgOpacity * 100)}
          onChange={(e) =>
            onSubStyleChange({ ...subStyle, bgOpacity: Number(e.target.value) / 100 })
          }
          className="w-full accent-cyan h-2 cursor-pointer"
        />
      </div>

      {/* text shadow / drop shadow */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-penpot-text-subtle mb-2">
          Text Edge / Shadow
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { id: "uniform", label: "Uniform" },
            { id: "drop-shadow", label: "Drop" },
            { id: "raised", label: "Raised" },
            { id: "depressed", label: "Depressed" },
            { id: "none", label: "None" },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() =>
                onSubStyleChange({
                  ...subStyle,
                  shadowStyle: opt.id as SubtitleShadowStyle,
                })
              }
              className={`rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors ${
                (subStyle.shadowStyle ?? "uniform") === opt.id
                  ? "bg-cyan text-black"
                  : "bg-white/10 text-penpot-text-medium hover:bg-white/15"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Audio & Subtitles Popover / Fullscreen Menu ──

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
  onClose,
}: {
  audioTracks: AudioTrack[]
  audioIndex: number | null
  onAudioChange: (index: number) => void
  subtitleTracks: SubtitleTrack[]
  subtitleIndex: number | null
  onSubtitleChange: (index: number | null) => void
  subStyle: SubtitleStyle
  onSubStyleChange: (s: SubtitleStyle) => void
  sheet?: boolean
  onClose: () => void
}) {
  const [showStyle, setShowStyle] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useFocusTrap({ containerRef: menuRef, onClose })

  const subtitleOptions = [
    { key: "off", label: "Off", selected: subtitleIndex === null },
    ...subtitleTracks.map((track) => ({
      key: String(track.index),
      label: track.isImageBased ? `${track.title} (burned in)` : track.title,
      value: track.language,
      selected: subtitleIndex === track.index,
    })),
  ]
  const subtitleSelectedIndex =
    subtitleIndex === null ? 0 : subtitleTracks.findIndex((t) => t.index === subtitleIndex) + 1

  const audioOptions = audioTracks.map((track, idx) => ({
    key: String(track.index),
    label: formatAudioTrackLabel(track, idx),
    value: track.channels ? `${track.channels}ch` : undefined,
    selected: audioIndex === track.index,
  }))
  const audioSelectedIndex = Math.max(0, audioTracks.findIndex((t) => t.index === audioIndex))

  // Mobile full-screen presentation
  if (sheet) {
    return (
      <div
        ref={menuRef}
        role="dialog"
        aria-modal="true"
        aria-label="Audio and subtitles settings"
        data-testid="subtitles-popover"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="fixed inset-0 z-[100] flex flex-col bg-[#101116] text-white p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4 pt-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95"
            >
              <IconArrowBackIos className="size-5 -translate-x-0.5" />
            </button>
            <h2 className="text-xl font-bold">Audio & Subtitles</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowStyle(!showStyle)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${
              showStyle ? "bg-cyan text-black" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            <Sliders className="size-3.5" />
            Style
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 py-4 space-y-6">
          {showStyle ? (
            <SubtitleStylePanel subStyle={subStyle} onSubStyleChange={onSubStyleChange} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Audio */}
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-penpot-text-subtle mb-3">
                  Audio Track
                </h3>
                {audioTracks.length > 0 ? (
                  <SelectionList
                    id="mobile-audio"
                    label="Audio tracks"
                    options={audioOptions}
                    selectedIndex={audioSelectedIndex}
                    onSelect={(idx) => onAudioChange(audioTracks[idx].index)}
                  />
                ) : (
                  <p className="text-sm text-penpot-text-subtle">Default Audio</p>
                )}
              </div>

              {/* Subtitles */}
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-penpot-text-subtle mb-3">
                  Subtitles
                </h3>
                <SelectionList
                  id="mobile-subs"
                  label="Subtitles"
                  options={subtitleOptions}
                  selectedIndex={subtitleSelectedIndex}
                  onSelect={(idx) =>
                    onSubtitleChange(idx === 0 ? null : subtitleTracks[idx - 1].index)
                  }
                />
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Desktop 2-column Penpot Card (`Subtitles/CardOptions`)
  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="Audio and subtitles menu"
      data-testid="subtitles-popover"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="fixed sm:absolute left-1/2 sm:left-auto -translate-x-1/2 sm:translate-x-0 bottom-[max(5rem,env(safe-area-inset-bottom,5rem))] sm:bottom-16 sm:right-0 z-[100] pointer-events-auto w-[calc(100vw-2rem)] sm:w-[589px] max-h-[85vh] overflow-y-auto rounded-lg border border-white/15 bg-[#101116]/95 p-5 shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white">Audio & Subtitles</span>
          <button
            type="button"
            onClick={() => setShowStyle(!showStyle)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
              showStyle ? "bg-cyan text-black" : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
            }`}
          >
            <Sliders className="size-3.5" />
            {showStyle ? "Tracks" : "Style"}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="flex size-7 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white transition-colors"
        >
          <IconClose className="size-4" />
        </button>
      </div>

      {showStyle ? (
        <SubtitleStylePanel subStyle={subStyle} onSubStyleChange={onSubStyleChange} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Audio Column */}
          <div className="flex flex-col">
            <h3 className="px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-penpot-text-subtle">
              Audio
            </h3>
            <div className="max-h-60 overflow-y-auto pr-1">
              {audioTracks.length > 0 ? (
                <SelectionList
                  id="desk-audio"
                  label="Audio tracks"
                  options={audioOptions}
                  selectedIndex={audioSelectedIndex}
                  onSelect={(idx) => onAudioChange(audioTracks[idx].index)}
                />
              ) : (
                <p className="px-3 py-2 text-sm text-penpot-text-subtle">Default</p>
              )}
            </div>
          </div>

          {/* Subtitles Column */}
          <div className="flex flex-col">
            <h3 className="px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-penpot-text-subtle">
              Subtitles
            </h3>
            <div className="max-h-60 overflow-y-auto pr-1">
              <SelectionList
                id="desk-subs"
                label="Subtitles"
                options={subtitleOptions}
                selectedIndex={subtitleSelectedIndex}
                onSelect={(idx) =>
                  onSubtitleChange(idx === 0 ? null : subtitleTracks[idx - 1].index)
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Speed & Quality Popover / Fullscreen Menu ──

type SpeedQualitySection = "root" | "speed" | "quality"

const SPEED_OPTIONS = [
  { label: "0.5x", value: 0.5 },
  { label: "0.75x", value: 0.75 },
  { label: "1.0x (Normal)", value: 1.0 },
  { label: "1.25x", value: 1.25 },
  { label: "1.5x", value: 1.5 },
  { label: "2.0x", value: 2.0 },
]

export function getAvailableQualityPresets(sourceHeight?: number): QualityPreset[] {
  if (!sourceHeight || sourceHeight <= 0) return QUALITY_PRESETS
  return QUALITY_PRESETS.filter((preset) => {
    if (preset.id === "auto" || !preset.maxHeight) return true
    return preset.maxHeight <= sourceHeight + 40
  })
}

export function SpeedQualityMenu({
  qualityId,
  autoResolvedLabel,
  sourceHeight,
  onQualityChange,
  playbackRate,
  onPlaybackRateChange,
  sheet = false,
  onClose,
}: {
  qualityId: string
  autoResolvedLabel?: string
  sourceHeight?: number
  onQualityChange: (id: string) => void
  playbackRate: number
  onPlaybackRateChange: (rate: number) => void
  sheet?: boolean
  onClose: () => void
}) {
  const [section, setSection] = useState<SpeedQualitySection>("root")
  const menuRef = useRef<HTMLDivElement>(null)
  useFocusTrap({ containerRef: menuRef, onClose })

  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const listbox = menu.querySelector<HTMLElement>('[role="listbox"]')
    const target = listbox ?? menu.querySelector<HTMLElement>("button")
    target?.focus()
  }, [section])

  const availableQualities = useMemo(
    () => getAvailableQualityPresets(sourceHeight),
    [sourceHeight],
  )

  const baseLabel = availableQualities.find((q) => q.id === qualityId)?.label ?? "Auto"
  const qualityLabel =
    qualityId === "auto" && autoResolvedLabel ? `Auto (${autoResolvedLabel})` : baseLabel
  const speedLabel = playbackRate === 1 ? "Normal" : `${playbackRate}x`

  // Mobile full-screen presentation
  if (sheet) {
    return (
      <div
        ref={menuRef}
        role="dialog"
        aria-modal="true"
        aria-label="Playback speed and quality settings"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="fixed inset-0 z-[100] flex flex-col bg-[#101116] text-white p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4 pt-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95"
            >
              <IconArrowBackIos className="size-5 -translate-x-0.5" />
            </button>
            <h2 className="text-xl font-bold">Playback & Quality</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <IconClose className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 py-4 space-y-6">
          {/* Speed */}
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-penpot-text-subtle mb-3">
              Playback Speed
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onPlaybackRateChange(opt.value)}
                  className={`rounded-lg py-3 text-center text-sm font-bold transition-all ${
                    playbackRate === opt.value
                      ? "bg-cyan text-black shadow-lg"
                      : "bg-white/10 text-white hover:bg-white/15"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quality */}
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-penpot-text-subtle mb-3">
              Video Quality
            </h3>
            <SelectionList
              id="mob-quality"
              label="Video quality"
              options={availableQualities.map((q) => ({
                key: q.id,
                label: q.label,
                selected: qualityId === q.id,
              }))}
              selectedIndex={Math.max(0, availableQualities.findIndex((q) => q.id === qualityId))}
              onSelect={(idx) => onQualityChange(availableQualities[idx].id)}
            />
            <p className="mt-3 text-xs leading-relaxed text-penpot-text-subtle">
              Qualities other than Auto are transcoded on demand.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Desktop Popover Menu
  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="Playback speed and quality menu"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="fixed sm:absolute left-1/2 sm:left-auto -translate-x-1/2 sm:translate-x-0 bottom-[max(5rem,env(safe-area-inset-bottom,5rem))] sm:bottom-16 sm:right-0 z-[100] pointer-events-auto w-[calc(100vw-2rem)] max-w-xs sm:w-80 max-h-[75vh] overflow-y-auto rounded-lg border border-white/15 bg-[#101116]/95 p-3 shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150"
    >
      {section === "root" && (
        <>
          <div className="px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-penpot-text-subtle">
            Playback & Quality
          </div>
          <MenuRow
            label="Playback Speed"
            value={speedLabel}
            onClick={() => setSection("speed")}
          />
          <MenuRow
            label="Video Quality"
            value={qualityLabel}
            onClick={() => setSection("quality")}
          />
        </>
      )}

      {section === "speed" && (
        <>
          <MenuHeader title="Playback Speed" onBack={() => setSection("root")} />
          <SelectionList
            id="speed"
            label="Playback speed"
            options={SPEED_OPTIONS.map((opt) => ({
              key: String(opt.value),
              label: opt.label,
              selected: playbackRate === opt.value,
            }))}
            selectedIndex={Math.max(0, SPEED_OPTIONS.findIndex((o) => o.value === playbackRate))}
            onSelect={(idx) => onPlaybackRateChange(SPEED_OPTIONS[idx].value)}
          />
        </>
      )}

      {section === "quality" && (
        <>
          <MenuHeader title="Video Quality" onBack={() => setSection("root")} />
          <SelectionList
            id="quality"
            label="Video quality"
            options={availableQualities.map((q) => ({
              key: q.id,
              label: q.label,
              selected: qualityId === q.id,
            }))}
            selectedIndex={Math.max(0, availableQualities.findIndex((q) => q.id === qualityId))}
            onSelect={(idx) => onQualityChange(availableQualities[idx].id)}
          />
          <p className="px-4 py-2.5 text-xs leading-relaxed text-penpot-text-subtle">
            Qualities other than Auto are transcoded on demand.
          </p>
        </>
      )}
    </div>
  )
}

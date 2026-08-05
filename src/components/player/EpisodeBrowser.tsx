"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { ChevronDown, Play, X } from "lucide-react"
import type { EpisodeInfo, EpisodeStatus, SeasonInfo } from "@/components/SeasonBrowser"
import { formatDate } from "@/lib/utils"

const STATUS_CONFIG: Record<EpisodeStatus, { label: string; className: string } | null> = {
  in_library: null,
  downloading: {
    label: "Downloading",
    className: "border-amber-500/40 bg-amber-500/15 text-amber-400",
  },
  missing: {
    label: "Missing",
    className: "border-red-500/40 bg-red-500/15 text-red-400",
  },
  unaired: {
    label: "Unaired",
    className: "border-gray-500/40 bg-gray-500/15 text-gray-400",
  },
}

function StatusTag({ ep }: { ep: EpisodeInfo }) {
  const config = STATUS_CONFIG[ep.status]
  if (!config) return null
  return (
    <span
      className={`border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider ${config.className}`}
    >
      {ep.status === "downloading" && ep.downloadProgress != null
        ? `${Math.round(ep.downloadProgress)}%`
        : config.label}
    </span>
  )
}

/**
 * Netflix-style in-player episode browser: full-screen overlay with a season
 * dropdown and a scrollable list of episode rows (thumbnail, runtime,
 * watch-progress, overview). Selecting a playable episode switches playback.
 */
export function EpisodeBrowser({
  episodes,
  seasons,
  currentItemId,
  onClose,
  onSelect,
}: {
  episodes: EpisodeInfo[]
  seasons: SeasonInfo[]
  currentItemId: string
  onClose: () => void
  onSelect: (episodeId: string) => void
}) {
  const currentSeason = useMemo(() => {
    const current = episodes.find((e) => e.id === currentItemId)
    if (current) return current.seasonNumber
    return seasons[0]?.seasonNumber ?? episodes[0]?.seasonNumber ?? 0
  }, [episodes, seasons, currentItemId])

  const [lastSeason, setLastSeason] = useState<number>(currentSeason)
  const [selectedSeason, setSelectedSeason] = useState<number>(currentSeason)
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false)
  const seasonMenuRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Sync the active season when the current episode changes (render-time
  // adjustment — see react.dev "you might not need an effect")
  if (lastSeason !== currentSeason) {
    setLastSeason(currentSeason)
    setSelectedSeason(currentSeason)
    setSeasonMenuOpen(false)
  }

  // Move focus into the dialog, trap Tab within it, and close on Escape
  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== "Tab") return
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // Close the season dropdown on outside click
  useEffect(() => {
    if (!seasonMenuOpen) return
    const close = (e: MouseEvent) => {
      if (seasonMenuRef.current && !seasonMenuRef.current.contains(e.target as Node)) {
        setSeasonMenuOpen(false)
      }
    }
    window.addEventListener("mousedown", close)
    return () => window.removeEventListener("mousedown", close)
  }, [seasonMenuOpen])

  const seasonList: SeasonInfo[] = useMemo(() => {
    if (seasons.length > 0) return seasons
    const map = new Map<number, SeasonInfo>()
    for (const ep of episodes) {
      const s = ep.seasonNumber
      if (!map.has(s)) {
        map.set(s, { id: s, name: `Season ${s}`, seasonNumber: s, episodeCount: 0, imageUrl: null })
      }
      map.get(s)!.episodeCount++
    }
    return [...map.values()].sort((a, b) => a.seasonNumber - b.seasonNumber)
  }, [seasons, episodes])

  const seasonEpisodes = useMemo(
    () =>
      episodes
        .filter((e) => e.seasonNumber === selectedSeason)
        .sort((a, b) => a.episodeNumber - b.episodeNumber),
    [episodes, selectedSeason],
  )

  const activeSeason = seasonList.find((s) => s.seasonNumber === selectedSeason)
  const activeSeasonLabel = activeSeason?.name ?? `Season ${selectedSeason}`

  return (
    <>
      {/* Backdrop overlay for closing */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs z-[65] animate-in fade-in duration-150"
        onClick={onClose}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Episode browser"
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 sm:top-0 sm:right-0 sm:left-auto w-full sm:w-[480px] max-h-[85vh] sm:max-h-full rounded-t-2xl sm:rounded-none z-[70] flex flex-col bg-black/95 border-t sm:border-t-0 sm:border-l border-white/15 shadow-2xl backdrop-blur-xl pt-safe pb-safe animate-in fade-in slide-in-from-bottom-4 sm:slide-in-from-right-4 duration-200"
      >
        {/* Mobile top grab handle indicator */}
        <div className="w-12 h-1 bg-white/25 rounded-full mx-auto mt-2.5 sm:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-8 pt-3 sm:pt-8 pb-2">
        <div>
          <h2 className="text-base sm:text-2xl font-black uppercase tracking-tight text-white">Episodes</h2>
          <p className="mt-0.5 text-[10px] sm:text-xs font-semibold uppercase tracking-widest text-gray-500">
            {activeSeasonLabel} · {seasonEpisodes.length} Episodes
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex min-h-[40px] min-w-[40px] items-center justify-center p-1 text-gray-300 transition-colors hover:text-white"
          aria-label="Close episode browser"
        >
          <X className="size-5 sm:size-8" />
        </button>
      </div>

      {/* Season selector */}
      <div className="px-4 sm:px-8 pb-3">
        <div ref={seasonMenuRef} className="relative inline-block">
          <button
            onClick={() => setSeasonMenuOpen((o) => !o)}
            className="flex min-h-[44px] items-center gap-2 border border-white/20 bg-white/10 px-4 py-2.5 text-xs sm:text-sm font-bold uppercase tracking-wider text-white transition-colors hover:bg-white/15"
          >
            {activeSeasonLabel}
            <ChevronDown
              className={`size-4 transition-transform duration-200 ${seasonMenuOpen ? "rotate-180" : ""}`}
            />
          </button>
          {seasonMenuOpen && (
            <div className="absolute left-0 top-full z-10 mt-2 w-72 border border-white/15 bg-[#181a20] shadow-2xl">
              {seasonList.map((s) => {
                const isSelected = s.seasonNumber === selectedSeason
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelectedSeason(s.seasonNumber)
                      setSeasonMenuOpen(false)
                    }}
                    className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? "bg-accent/15 font-bold text-accent"
                        : "text-gray-300 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <span className="text-sm uppercase tracking-wider">{s.name}</span>
                    <span className="text-xs text-gray-500">{s.episodeCount || 0} Episodes</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Episode list */}
      <div className="flex-1 overflow-y-auto overflow-touch px-6 sm:px-8 pb-12 pb-safe">
        {seasonEpisodes.length === 0 ? (
          <p className="border border-dashed border-white/20 p-10 text-center text-sm text-gray-500">
            No episodes available for this season.
          </p>
        ) : (
          <div className="max-w-4xl">
            {seasonEpisodes.map((ep) => {
              const isCurrent = ep.id === currentItemId
              const playable = ep.status === "in_library"
              return (
                <button
                  key={ep.id}
                  disabled={!playable}
                  onClick={() => playable && onSelect(ep.id)}
                  className={`group flex w-full items-start gap-4 border-b border-white/10 py-4 text-left transition-colors ${
                    playable ? "hover:bg-white/5" : "cursor-default"
                  }`}
                >
                  {/* Thumbnail */}
                  <div
                    className={`relative aspect-video w-36 shrink-0 overflow-hidden border sm:w-52 ${
                      isCurrent ? "border-accent" : "border-white/15"
                    } ${!playable ? "opacity-60" : ""}`}
                  >
                    <Image
                      src={ep.thumbUrl}
                      alt={ep.title}
                      fill
                      sizes="(max-width: 640px) 144px, 208px"
                      className="object-cover"
                      unoptimized
                    />
                    {playable && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        <Play className="size-7 fill-white text-white sm:size-8" />
                      </div>
                    )}
                    {ep.playedPercentage > 0 && !ep.played && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
                        <div
                          className="h-full bg-accent"
                          style={{ width: `${Math.min(100, ep.playedPercentage)}%` }}
                        />
                      </div>
                    )}
                    {ep.runtimeMinutes != null && ep.runtimeMinutes > 0 && (
                      <span className="absolute bottom-1 right-1 bg-black/85 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {ep.runtimeMinutes}m
                      </span>
                    )}
                  </div>

                  {/* Metadata */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`text-xs font-bold ${isCurrent ? "text-accent" : "text-gray-500"}`}>
                        E{ep.episodeNumber}
                      </span>
                      <h3
                        className={`text-sm sm:text-base leading-snug line-clamp-1 ${
                          isCurrent ? "text-accent" : "text-white"
                        }`}
                      >
                        {ep.title}
                      </h3>
                      {isCurrent && (
                        <span className="border border-accent/40 bg-accent/20 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-accent">
                          Watching
                        </span>
                      )}
                      <StatusTag ep={ep} />
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                      {ep.airDate && <span>{formatDate(ep.airDate)}</span>}
                      {ep.played && <span className="font-semibold text-gray-400">Watched</span>}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-400">
                      {ep.overview || "No overview available for this episode."}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
    </>
  )
}

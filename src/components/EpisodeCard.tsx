"use client"

import { useState, useRef, useEffect, KeyboardEvent } from "react"
import Image from "next/image"
import { MoreVertical, CheckCircle2, Download, Loader2 } from "lucide-react"
import { IconPlay } from "@/components/ui/icons"
import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { EpisodeInfo, EpisodeStatus } from "@/components/SeasonBrowser"

export interface EpisodeCardProps {
  episode: EpisodeInfo
  showName?: string
  isSelected?: boolean
  onPlay?: (episode: EpisodeInfo) => void
  onTogglePlayed?: (episode: EpisodeInfo) => void
  onRequestEpisode?: (episode: EpisodeInfo) => void
  onDeleteEpisode?: (episode: EpisodeInfo) => void
  onSelect?: (episode: EpisodeInfo) => void
  isAdmin?: boolean
  isShowInSonarr?: boolean
  actionLoading?: boolean
  className?: string
}

function renderStatusBadge(status: EpisodeStatus, downloadProgress?: number) {
  switch (status) {
    case "in_library":
      return (
        <span className="inline-flex items-center gap-1 bg-emerald-500/90 text-white backdrop-blur-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-[2px] shadow">
          <CheckCircle2 className="size-2.5" /> In Library
        </span>
      )
    case "downloading":
      return (
        <span className="inline-flex items-center gap-1 bg-amber-500/90 text-black backdrop-blur-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-[2px] shadow">
          <Download className="size-2.5 animate-pulse" />
          {downloadProgress != null ? `${Math.round(downloadProgress)}%` : "Downloading"}
        </span>
      )
    case "unaired":
      return (
        <span className="inline-flex items-center bg-black/80 text-penpot-text-medium backdrop-blur-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-[2px] shadow">
          Unaired
        </span>
      )
    default:
      return null
  }
}

export function EpisodeCard({
  episode,
  showName,
  isSelected = false,
  onPlay,
  onTogglePlayed,
  onRequestEpisode,
  onDeleteEpisode,
  onSelect,
  isAdmin = false,
  isShowInSonarr = true,
  actionLoading = false,
  className,
}: EpisodeCardProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const playable = episode.status === "in_library" && Boolean(episode.jellyfinItemId)

  // Close context dropdown menu on outside click
  useEffect(() => {
    if (!isMenuOpen) return
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false)
      }
    }
    document.addEventListener("click", handleClickOutside)
    return () => document.removeEventListener("click", handleClickOutside)
  }, [isMenuOpen])

  const handleCardClick = () => {
    onSelect?.(episode)
    if (playable && onPlay) {
      onPlay(episode)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      handleCardClick()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative flex flex-row items-stretch w-full min-h-[112px] sm:min-h-[128px] max-h-[140px]",
        "bg-white/[0.07] hover:bg-white/[0.12] border border-white/5 hover:border-penpot-primary-400/40 rounded-lg transition-all duration-200 shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-penpot-bg",
        isSelected && "ring-2 ring-white ring-offset-4 ring-offset-penpot-bg bg-white/[0.14] border-white/20",
        playable ? "cursor-pointer" : "cursor-default",
        className
      )}
    >
      {/* ── Left Thumbnail Cover (Penpot 221px width) ── */}
      <div className="relative w-36 sm:w-48 md:w-52 lg:w-56 self-stretch min-h-[112px] sm:min-h-[128px] shrink-0 overflow-hidden rounded-l-lg bg-penpot-surface flex items-center justify-center">
        <Image
          src={episode.thumbUrl}
          alt={showName ? `${showName} - ${episode.title}` : episode.title}
          fill
          sizes="(max-width: 640px) 144px, (max-width: 1024px) 192px, 224px"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          unoptimized
        />

        {/* Dark vignette overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Top-left Status badge */}
        {episode.status !== "missing" && (
          <div className="absolute top-2 left-2 z-10">
            {renderStatusBadge(episode.status, episode.downloadProgress)}
          </div>
        )}

        {/* Play Overlay Icon (Penpot circular play button) */}
        {playable && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="size-9 sm:size-10 rounded-full bg-white/90 group-hover:bg-white text-penpot-neutral-600 flex items-center justify-center shadow-2xl transition-transform duration-200 group-hover:scale-110">
              <IconPlay className="size-4 fill-penpot-neutral-600 ml-0.5" />
            </div>
          </div>
        )}

        {/* Progress Bar (Bottom of cover) */}
        {episode.playedPercentage > 0 && !episode.played && (
          <div className="absolute inset-x-0 bottom-0 z-10 h-1 bg-black/60">
            <div
              className="h-full bg-penpot-primary-400"
              style={{ width: `${Math.min(100, episode.playedPercentage)}%` }}
            />
          </div>
        )}
      </div>

      {/* ── Right Information Stack (Penpot Information) ── */}
      <div className="flex-1 min-w-0 p-3 sm:p-4 flex flex-col justify-between h-full space-y-1.5">
        {/* Title & Runtime Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-xs sm:text-sm md:text-base font-bold text-white truncate leading-snug group-hover:text-penpot-link transition-colors">
              {episode.episodeNumber}. {episode.title}
            </h4>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {episode.runtimeMinutes != null && episode.runtimeMinutes > 0 && (
              <span className="text-xs sm:text-[13px] font-medium text-penpot-text-medium">
                {episode.runtimeMinutes} min
              </span>
            )}

            {/* Context Dropdown Menu Trigger */}
            <div className="relative" ref={menuRef} onClick={(e) => e.stopPropagation()}>
              <Tooltip content="Options" side="left">
                <button
                  type="button"
                  onClick={() => setIsMenuOpen((prev) => !prev)}
                  aria-label="Episode options"
                  className="size-7 flex items-center justify-center rounded-full hover:bg-white/10 text-penpot-text-subtle hover:text-white transition-colors cursor-pointer"
                >
                  <MoreVertical className="size-3.5" />
                </button>
              </Tooltip>

              {/* Context Dropdown Menu */}
              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-penpot-surface border border-penpot-border rounded-[4px] shadow-2xl py-1 divide-y divide-penpot-border/40 animate-in fade-in-0 zoom-in-95 duration-150">
                  {actionLoading ? (
                    <div className="px-3.5 py-2 text-xs text-penpot-text-medium flex items-center gap-2">
                      <Loader2 className="size-3.5 animate-spin text-penpot-primary-300" />
                      <span>Processing...</span>
                    </div>
                  ) : (
                    <>
                      {playable && onTogglePlayed && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsMenuOpen(false)
                            onTogglePlayed(episode)
                          }}
                          className="w-full text-left px-3.5 py-2 text-xs font-semibold text-penpot-text-high hover:bg-white/10 transition-colors"
                        >
                          {episode.played ? "Mark Unplayed" : "Mark Played"}
                        </button>
                      )}

                      {!playable && onRequestEpisode && (
                        <button
                          type="button"
                          disabled={!isShowInSonarr}
                          onClick={() => {
                            setIsMenuOpen(false)
                            onRequestEpisode(episode)
                          }}
                          className={cn(
                            "w-full text-left px-3.5 py-2 text-xs font-semibold transition-colors",
                            isShowInSonarr
                              ? "text-penpot-primary-100 hover:bg-penpot-primary-500/20"
                              : "text-penpot-disabled cursor-not-allowed"
                          )}
                        >
                          Request Episode
                        </button>
                      )}

                      {playable && isAdmin && onDeleteEpisode && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsMenuOpen(false)
                            onDeleteEpisode(episode)
                          }}
                          className="w-full text-left px-3.5 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          Delete Episode
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Overview Description (Penpot #description.i) */}
        <p className="text-xs sm:text-[13px] text-penpot-text-medium line-clamp-2 leading-relaxed font-normal">
          {episode.overview || "No overview available for this episode."}
        </p>

        {/* Subtle subtext row */}
        {episode.airDate && (
          <p className="text-[11px] text-penpot-text-subtle">
            Aired: {episode.airDate}
          </p>
        )}
      </div>
    </div>
  )
}

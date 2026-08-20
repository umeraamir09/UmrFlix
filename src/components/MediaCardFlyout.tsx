"use client"

import React, { useEffect, useState, useRef } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { BookmarkButton } from "@/components/BookmarkButton"
import { AvailabilityBadge } from "@/components/AvailabilityBadge"
import { Tooltip } from "@/components/ui/tooltip"
import { IconPlay, IconGroup, IconTv, IconMovie, IconAdd, IconInfo } from "@/components/ui/icons"
import { ChevronDown, Check, Loader2, MoreVertical, Trash2 } from "lucide-react"
import { getImageUrl, formatYear, formatRuntime } from "@/lib/utils"
import { RequestModal } from "@/components/RequestModal"
import type { AvailabilityResult } from "@/app/api/availability/route"

const fetcher = (url: string) => fetch(url).then((r) => r.json())
const FLYOUT_EXIT_MS = 120

function isGenuinelyNew(item: MediaCardFlyoutItem): boolean {
  if (item.badge === "new" || (typeof item.badge === "object" && item.badge?.type === "new")) {
    return true
  }
  const dateStr = item.release_date || item.first_air_date
  if (!dateStr) return false
  const releaseTime = new Date(dateStr).getTime()
  if (isNaN(releaseTime)) return false
  const now = Date.now()
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000
  const diff = now - releaseTime
  return diff >= -14 * 24 * 60 * 60 * 1000 && diff <= ninetyDaysMs
}

export interface MediaCardFlyoutItem {
  id: number
  title?: string
  name?: string
  overview?: string
  backdrop_path?: string | null
  poster_path?: string | null
  media_type?: string
  release_date?: string
  first_air_date?: string
  vote_average?: number
  runtime?: number
  numberOfSeasons?: number
  // Continue watching fields
  jellyfinItemId?: string
  jellyfinImageUrl?: string
  episodeTitle?: string
  episodeNumber?: string
  progressPercent?: number
  timeLeft?: string
  isNextUp?: boolean
  // Badges
  badge?: string | { type: "new" | "airing" | "popular" | "top10" | "liked"; label: string }
  airingLabel?: string
  ranking?: number
}

export interface MediaCardFlyoutProps {
  item: MediaCardFlyoutItem
  rect: { top: number; left: number; width: number; height: number }
  open: boolean
  onExited?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onMarkWatched?: () => void
  onDelete?: () => void
  marking?: boolean
  isWatched?: boolean
  availabilityState?: AvailabilityResult
  mediaType: "movie" | "tv"
  cardVariant?: "default" | "large"
}

export function MediaCardFlyout({
  item,
  rect,
  open,
  onExited,
  onMouseEnter,
  onMouseLeave,
  onMarkWatched,
  onDelete,
  marking = false,
  isWatched = false,
  availabilityState,
  mediaType,
  cardVariant = "default",
}: MediaCardFlyoutProps) {
  const router = useRouter()
  const [entered, setEntered] = useState(false)
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    let timer = 0
    if (open) {
      raf = requestAnimationFrame(() => setEntered(true))
    } else {
      raf = requestAnimationFrame(() => {
        setEntered(false)
        setIsMenuOpen(false)
      })
      timer = window.setTimeout(() => onExited?.(), FLYOUT_EXIT_MS)
    }
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [open, onExited])

  // Close dropdown menu on outside click or Escape
  useEffect(() => {
    if (!isMenuOpen) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (menuRef.current && !menuRef.current.contains(target)) {
        setIsMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMenuOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("touchstart", handleClickOutside, { passive: true })
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("touchstart", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isMenuOpen])

  // Fetch extra TMDB details for runtime / number of seasons if not already known
  const { data: tmdbDetail } = useSWR<{
    runtime?: number
    number_of_seasons?: number
    genres?: { id: number; name: string }[]
  }>(
    open && item.id ? `/api/tmdb/${mediaType}/${item.id}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 300_000 }
  )

  const isAvailable = Boolean(item.jellyfinItemId) || availabilityState?.status === "in_library"
  const isNew = isGenuinelyNew(item)

  const title = item.title ?? item.name ?? "Untitled"
  const dateStr = item.release_date ?? item.first_air_date ?? ""
  const year = formatYear(dateStr)

  const runtimeMin = item.runtime ?? tmdbDetail?.runtime
  const seasonsCount = item.numberOfSeasons ?? tmdbDetail?.number_of_seasons

  const runtimeOrSeasonText =
    mediaType === "tv"
      ? seasonsCount
        ? `${seasonsCount} ${seasonsCount === 1 ? "Season" : "Seasons"}`
        : "Series"
      : runtimeMin
      ? formatRuntime(runtimeMin)
      : ""

  const playHref = item.jellyfinItemId
    ? `/watch?id=${item.jellyfinItemId}`
    : `/watch?tmdb=${item.id}&type=${mediaType}`

  const detailHref = `/${mediaType}/${item.id}`

  const backdropUrl = item.jellyfinImageUrl
    ? getImageUrl(item.jellyfinImageUrl, "w780")
    : item.backdrop_path
    ? getImageUrl(item.backdrop_path, "w780")
    : item.poster_path
    ? getImageUrl(item.poster_path, "w780")
    : "/placeholder-poster.svg"

  const displayEpisodeInfo = item.episodeNumber
    ? `${item.episodeNumber}${item.episodeTitle ? ` • ${item.episodeTitle}` : ""}`
    : item.episodeTitle || ""

  const isLarge = cardVariant === "large"
  const FLYOUT_WIDTH = isLarge ? 345 : 385
  const left = Math.max(12, Math.min(rect.left - (FLYOUT_WIDTH - rect.width) / 2, window.innerWidth - FLYOUT_WIDTH - 12))
  const top = Math.max(12, isLarge ? rect.top - 20 : rect.top - 16)

  const posterUrl = item.poster_path
    ? getImageUrl(item.poster_path, "w780")
    : backdropUrl

  // FLIP transform mapping back to base card bounding box
  const baseCx = rect.left + rect.width / 2
  const expandCx = left + FLYOUT_WIDTH / 2
  const coverTransform = `translate3d(${baseCx - expandCx}px, ${rect.top - top}px, 0) scale(${rect.width / FLYOUT_WIDTH})`

  return (
    <div
      data-testid="movie-modal"
      className="fixed z-[100] select-none"
      style={{ top, left, width: FLYOUT_WIDTH }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={() => {
        if (showRequestModal || isMenuOpen) return
        onMouseLeave?.()
      }}
    >
      <div
        className={`flex flex-col overflow-hidden rounded-[8px] border border-penpot-border bg-penpot-bg shadow-[0_15px_45px_rgba(0,0,0,0.9)] transition-all ${
          entered ? "duration-[220ms] opacity-100" : "duration-[120ms] opacity-0"
        }`}
        style={{
          transform: entered ? "translate3d(0px, 0px, 0px) scale(1)" : coverTransform,
          transformOrigin: "top center",
          transitionTimingFunction: entered
            ? "cubic-bezier(0.16, 1, 0.3, 1)"
            : "cubic-bezier(0.4, 0, 1, 1)",
        }}
      >
        {isLarge ? (
          /* ── Large Vertical Modal (card/movie/largeModal: 300x471) ── */
          <div className="relative aspect-[300/471] w-full overflow-hidden bg-penpot-surface flex flex-col justify-end">
            <Link href={isAvailable ? playHref : detailHref} className="absolute inset-0 z-0 cursor-pointer block">
              <Image
                src={posterUrl}
                alt={title}
                fill
                priority
                sizes="300px"
                className="object-cover"
                unoptimized={posterUrl.startsWith("/api/")}
              />
            </Link>

            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-penpot-bg via-penpot-bg/85 to-transparent pointer-events-none" />

            {/* Top Left / Right Badges */}
            <div className="absolute top-3 inset-x-3 z-10 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-1.5">
                {item.ranking ? (
                  <div className="size-8 rounded-full bg-penpot-primary-300/90 backdrop-blur-sm border border-white/30 text-white font-bold text-xs flex items-center justify-center shadow-md">
                    #{item.ranking}
                  </div>
                ) : isNew ? (
                  <span className="bg-[#abfab3] text-[#00710b] font-bold text-[11px] px-2 py-0.5 rounded-[4px] uppercase tracking-wider shadow-sm">
                    NEW
                  </span>
                ) : null}
              </div>

              <div>
                {availabilityState?.status === "in_library" && (
                  <AvailabilityBadge state={availabilityState} />
                )}
              </div>
            </div>

            {/* Content Area */}
            <div
              className={`p-4 space-y-3.5 relative z-10 transition-opacity ${
                entered ? "opacity-100 duration-150" : "opacity-0 duration-75"
              }`}
            >
              {/* Action Buttons Row */}
              <div className="flex items-center gap-3">
                {/* 1. Play or Request */}
                {isAvailable ? (
                  <Tooltip content="Play" side="top">
                    <Link
                      href={playHref}
                      aria-label={`Play ${title}`}
                      className="size-10 min-h-[40px] min-w-[40px] rounded-full bg-white hover:bg-penpot-neutral-200 active:bg-penpot-neutral-300 text-penpot-bg flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                    >
                      <IconPlay className="size-4 fill-penpot-bg text-penpot-bg ml-0.5" />
                    </Link>
                  </Tooltip>
                ) : (
                  <Tooltip content="Request" side="top">
                    <button
                      type="button"
                      aria-label={`Request ${title}`}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setShowRequestModal(true)
                      }}
                      className="size-10 min-h-[40px] min-w-[40px] rounded-full bg-white hover:bg-penpot-neutral-200 active:bg-penpot-neutral-300 text-penpot-bg flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                    >
                      <IconAdd className="size-5 text-penpot-bg" />
                    </button>
                  </Tooltip>
                )}

                {/* 2. Watch Party Button */}
                {isAvailable && (
                  <Tooltip content="Watch Party" side="top">
                    <button
                      type="button"
                      aria-label="Start Watch Party"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        router.push(`/watch?party=create&tmdb=${item.id}&type=${mediaType}`)
                      }}
                      className="size-10 min-h-[40px] min-w-[40px] rounded-full border-2 border-white/80 bg-black/20 hover:bg-white/20 active:bg-white/30 text-white flex items-center justify-center backdrop-blur-sm shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                    >
                      <IconGroup className="size-4 text-white" />
                    </button>
                  </Tooltip>
                )}

                {/* 3. Bookmark Button */}
                <Tooltip content="Add to My List" side="top">
                  <BookmarkButton
                    itemId={item.jellyfinItemId || String(item.id)}
                    tmdbId={item.id}
                    jellyfinId={item.jellyfinItemId}
                    mediaType={mediaType}
                    title={title}
                    posterPath={item.poster_path}
                    overview={item.overview}
                    releaseYear={year}
                    variant="circle-sm"
                  />
                </Tooltip>

                {/* Optional Mark Watched Button */}
                {onMarkWatched && (
                  <Tooltip content={isWatched ? "Mark Unwatched" : "Mark Watched"} side="top">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onMarkWatched()
                      }}
                      disabled={marking}
                      aria-label="Toggle Watched"
                      className="size-10 min-h-[40px] min-w-[40px] rounded-full border-2 border-white/80 bg-black/20 hover:bg-white/20 active:bg-white/30 text-white flex items-center justify-center backdrop-blur-sm shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      {marking ? (
                        <Loader2 className="size-4 animate-spin text-white" />
                      ) : (
                        <Check className={`size-4 stroke-[2.5] ${isWatched ? "text-penpot-primary-100" : "text-white"}`} />
                      )}
                    </button>
                  </Tooltip>
                )}

                {/* Options / Delete Dropdown Menu */}
                {onDelete && (
                  <div className="relative" ref={menuRef} onClick={(e) => e.stopPropagation()}>
                    <Tooltip content="Options" side="top">
                      <button
                        type="button"
                        aria-label={`Options for ${title}`}
                        aria-expanded={isMenuOpen}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setIsMenuOpen((prev) => !prev)
                        }}
                        className={`size-10 min-h-[40px] min-w-[40px] rounded-full border-2 border-white/80 bg-black/20 hover:bg-white/20 active:bg-white/30 text-white flex items-center justify-center backdrop-blur-sm shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0 ${
                          isMenuOpen ? "bg-white/30 border-white text-white scale-105" : ""
                        }`}
                      >
                        <MoreVertical className="size-4 text-white" />
                      </button>
                    </Tooltip>

                    {/* Dropdown Menu Popover */}
                    {isMenuOpen && (
                      <div
                        className="absolute left-0 bottom-full mb-2 z-50 w-44 rounded-md bg-penpot-neutral-700/98 border border-penpot-border p-1 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 flex flex-col gap-1 select-none"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setIsMenuOpen(false)
                            onDelete()
                          }}
                          className="w-full min-h-9 flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/15 active:bg-red-500/25 rounded transition-colors text-left cursor-pointer"
                        >
                          <Trash2 className="size-3.5 text-red-400 shrink-0" />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. More Info Button */}
                <Tooltip content="More Info" side="top" className="ml-auto">
                  <Link
                    href={detailHref}
                    aria-label={`More info about ${title}`}
                    className="ml-auto size-10 min-h-[40px] min-w-[40px] rounded-full border-2 border-white/80 bg-black/20 hover:bg-white/20 active:bg-white/30 text-white flex items-center justify-center backdrop-blur-sm shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                  >
                    <IconInfo className="size-5 text-white" />
                  </Link>
                </Tooltip>
              </div>

              {/* Specifications Line */}
              <div className="flex items-center gap-2 pt-0.5">
                {mediaType === "tv" ? (
                  <IconTv className="size-4 text-white shrink-0" />
                ) : (
                  <IconMovie className="size-4 text-white shrink-0" />
                )}

                <span className="text-[10px] font-bold text-white border border-white/40 px-1.5 py-0.5 rounded-[2px]">
                  14+
                </span>
                <span className="text-[10px] font-bold text-white border border-white/40 px-1.5 py-0.5 rounded-[2px]">
                  AD
                </span>
                <span className="text-[10px] font-bold text-white border border-white/40 px-1.5 py-0.5 rounded-[2px]">
                  CC
                </span>

                <span className="text-xs font-bold text-white truncate ml-0.5">
                  {[year, runtimeOrSeasonText].filter(Boolean).join(" • ")}
                </span>
              </div>

              {/* Synopsis Description */}
              <p className="text-xs text-[#c8c9cb] line-clamp-3 leading-relaxed font-normal">
                {item.overview || "No synopsis available for this title."}
              </p>
            </div>
          </div>
        ) : (
          /* ── Standard 16:9 Horizontal Modal ── */
          <>
            {/* 1. Top Cover Backdrop Header (16:9 375x211 height) */}
            <div className="relative aspect-video w-full overflow-hidden bg-penpot-surface">
              <Link href={isAvailable ? playHref : detailHref} className="absolute inset-0 z-0 cursor-pointer block">
                <Image
                  src={backdropUrl}
                  alt={title}
                  fill
                  priority
                  sizes="375px"
                  className="object-cover transition-transform duration-300"
                  unoptimized={backdropUrl.startsWith("/api/")}
                />
              </Link>

              {/* Bottom Fade Gradient into Penpot Background */}
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-penpot-bg via-penpot-bg/30 to-transparent" />

              {/* Top Left / Right Badges */}
              <div className="absolute top-2.5 inset-x-2.5 z-10 flex items-center justify-between pointer-events-none">
                {/* Left: Ranking or "NEW" badge */}
                <div className="flex items-center gap-1.5">
                  {item.ranking ? (
                    <div className="size-8 rounded-full bg-penpot-primary-300/90 backdrop-blur-sm border border-white/30 text-white font-bold text-xs flex items-center justify-center shadow-md">
                      #{item.ranking}
                    </div>
                  ) : isNew ? (
                    <span className="bg-[#abfab3] text-[#00710b] font-bold text-[11px] px-2 py-0.5 rounded-[4px] uppercase tracking-wider shadow-sm">
                      NEW
                    </span>
                  ) : null}
                </div>

                {/* Right: Availability or Episode info badge */}
                <div className="flex items-center gap-1.5">
                  {item.timeLeft && (
                    <span className="bg-black/70 backdrop-blur-sm text-penpot-text-high text-[11px] px-2 py-0.5 rounded-[4px] font-medium">
                      {item.timeLeft}
                    </span>
                  )}
                  {availabilityState?.status === "in_library" && (
                    <AvailabilityBadge state={availabilityState} />
                  )}
                </div>
              </div>

              {/* Bottom Episode Tag & Cyan Progress Bar (for Continue Watching) */}
              {item.progressPercent !== undefined && !item.isNextUp && (
                <div className="absolute bottom-0 inset-x-0 z-10">
                  <div className="h-[5px] w-full bg-white/50 overflow-hidden">
                    <div
                      className="h-full bg-penpot-primary-100 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, item.progressPercent))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 2. Content & Action Controls Area */}
            <div
              className={`p-4 space-y-3 bg-penpot-bg transition-opacity ${
                entered ? "opacity-100 duration-150" : "opacity-0 duration-75"
              }`}
            >
              {/* Action Buttons Row */}
              <div className="flex items-center gap-3">
                {/* 1. Play or Request */}
                {isAvailable ? (
                  <Tooltip content="Play" side="top">
                    <Link
                      href={playHref}
                      aria-label={`Play ${title}`}
                      className="size-10 min-h-[40px] min-w-[40px] rounded-full bg-white hover:bg-penpot-neutral-200 active:bg-penpot-neutral-300 text-penpot-bg flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                    >
                      <IconPlay className="size-4 fill-penpot-bg text-penpot-bg ml-0.5" />
                    </Link>
                  </Tooltip>
                ) : (
                  <Tooltip content="Request" side="top">
                    <button
                      type="button"
                      aria-label={`Request ${title}`}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setShowRequestModal(true)
                      }}
                      className="size-10 min-h-[40px] min-w-[40px] rounded-full bg-white hover:bg-penpot-neutral-200 active:bg-penpot-neutral-300 text-penpot-bg flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                    >
                      <IconAdd className="size-5 text-penpot-bg" />
                    </button>
                  </Tooltip>
                )}

                {/* 2. Watch Party Button */}
                {isAvailable && (
                  <Tooltip content="Watch Party" side="top">
                    <button
                      type="button"
                      aria-label="Start Watch Party"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        router.push(`/watch?party=create&tmdb=${item.id}&type=${mediaType}`)
                      }}
                      className="size-10 min-h-[40px] min-w-[40px] rounded-full border-2 border-white/80 bg-black/20 hover:bg-white/20 active:bg-white/30 text-white flex items-center justify-center backdrop-blur-sm shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                    >
                      <IconGroup className="size-4 text-white" />
                    </button>
                  </Tooltip>
                )}

                {/* 3. Bookmark / My List Button */}
                <Tooltip content="Add to My List" side="top">
                  <BookmarkButton
                    itemId={item.jellyfinItemId || String(item.id)}
                    tmdbId={item.id}
                    jellyfinId={item.jellyfinItemId}
                    mediaType={mediaType}
                    title={title}
                    posterPath={item.poster_path}
                    overview={item.overview}
                    releaseYear={year}
                    variant="circle-sm"
                  />
                </Tooltip>

                {/* Optional Mark Watched Button */}
                {onMarkWatched && (
                  <Tooltip content={isWatched ? "Mark Unwatched" : "Mark Watched"} side="top">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onMarkWatched()
                      }}
                      disabled={marking}
                      aria-label="Toggle Watched"
                      className="size-10 min-h-[40px] min-w-[40px] rounded-full border-2 border-white/80 bg-black/20 hover:bg-white/20 active:bg-white/30 text-white flex items-center justify-center backdrop-blur-sm shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      {marking ? (
                        <Loader2 className="size-4 animate-spin text-white" />
                      ) : (
                        <Check className={`size-4 stroke-[2.5] ${isWatched ? "text-penpot-primary-100" : "text-white"}`} />
                      )}
                    </button>
                  </Tooltip>
                )}

                {/* Options / Delete Dropdown Menu */}
                {onDelete && (
                  <div className="relative" ref={menuRef} onClick={(e) => e.stopPropagation()}>
                    <Tooltip content="Options" side="top">
                      <button
                        type="button"
                        aria-label={`Options for ${title}`}
                        aria-expanded={isMenuOpen}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setIsMenuOpen((prev) => !prev)
                        }}
                        className={`size-10 min-h-[40px] min-w-[40px] rounded-full border-2 border-white/80 bg-black/20 hover:bg-white/20 active:bg-white/30 text-white flex items-center justify-center backdrop-blur-sm shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0 ${
                          isMenuOpen ? "bg-white/30 border-white text-white scale-105" : ""
                        }`}
                      >
                        <MoreVertical className="size-4 text-white" />
                      </button>
                    </Tooltip>

                    {/* Dropdown Menu Popover */}
                    {isMenuOpen && (
                      <div
                        className="absolute left-0 bottom-full mb-2 z-50 w-44 rounded-md bg-penpot-neutral-700/98 border border-penpot-border p-1 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 flex flex-col gap-1 select-none"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setIsMenuOpen(false)
                            onDelete()
                          }}
                          className="w-full min-h-9 flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/15 active:bg-red-500/25 rounded transition-colors text-left cursor-pointer"
                        >
                          <Trash2 className="size-3.5 text-red-400 shrink-0" />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. More Details Button */}
                <Tooltip content="More Info" side="top" className="ml-auto">
                  <Link
                    href={detailHref}
                    aria-label={`More info about ${title}`}
                    className="ml-auto size-10 min-h-[40px] min-w-[40px] rounded-full border-2 border-white/80 bg-black/20 hover:bg-white/20 active:bg-white/30 text-white flex items-center justify-center backdrop-blur-sm shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                  >
                    <ChevronDown className="size-5 text-white stroke-[2.5]" />
                  </Link>
                </Tooltip>
              </div>

              {/* Specifications / Metadata Line */}
              <div className="flex items-center gap-2 pt-1">
                {mediaType === "tv" ? (
                  <IconTv className="size-4 text-penpot-text-high shrink-0" />
                ) : (
                  <IconMovie className="size-4 text-penpot-text-high shrink-0" />
                )}

                <span className="text-sm font-medium text-penpot-text-high">
                  {[year, runtimeOrSeasonText].filter(Boolean).join(" • ")}
                </span>

                <span className="ml-auto flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-penpot-text-medium border border-penpot-border px-1.5 py-0.5 rounded-[3px] uppercase">
                    4K
                  </span>
                  <span className="text-[10px] font-bold text-penpot-text-medium border border-penpot-border px-1.5 py-0.5 rounded-[3px] uppercase">
                    HDR
                  </span>
                  <span className="text-[10px] font-bold text-penpot-text-medium border border-penpot-border px-1.5 py-0.5 rounded-[3px] uppercase">
                    5.1
                  </span>
                </span>
              </div>

              {/* Episode Info (Continue watching specific) */}
              {displayEpisodeInfo && (
                <p className="text-xs font-semibold text-penpot-primary-100 line-clamp-1">
                  {displayEpisodeInfo}
                </p>
              )}

              {/* Synopsis Description */}
              <p className="text-xs text-penpot-text-medium line-clamp-3 leading-relaxed font-normal pt-0.5">
                {item.overview || "No synopsis available for this title."}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Direct Request Modal */}
      {showRequestModal && (
        <RequestModal
          tmdbId={item.id}
          title={title}
          type={mediaType}
          year={year ? Number(year) : undefined}
          posterPath={item.poster_path}
          backdropPath={item.backdrop_path}
          seasonsCount={seasonsCount}
          onClose={() => setShowRequestModal(false)}
          onSuccess={() => setShowRequestModal(false)}
        />
      )}
    </div>
  )
}

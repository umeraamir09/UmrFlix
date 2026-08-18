"use client"

import Link from "next/link"
import Image from "next/image"
import { useRef } from "react"
import { Check, Loader2 } from "lucide-react"

export interface ContinueWatchingItem {
  id: number
  title: string
  episodeTitle?: string
  episodeNumber?: string
  overview?: string
  backdrop_path: string | null
  media_type: "movie" | "tv"
  progressPercent: number
  timeLeft?: string
  jellyfinItemId?: string
  jellyfinImageUrl?: string
  jellyfinLogoUrl?: string
  isNextUp?: boolean
}

/** Shared hrefs/labels used by both the base card and the hover flyout. */
export function getContinueWatchingMedia(item: ContinueWatchingItem) {
  const playHref = item.jellyfinItemId
    ? `/watch?id=${item.jellyfinItemId}`
    : item.id
    ? `/${item.media_type}/${item.id}`
    : "#"

  const detailHref = item.id ? `/${item.media_type}/${item.id}` : playHref

  const backdropUrl = item.jellyfinImageUrl
    ? item.jellyfinImageUrl
    : item.backdrop_path
    ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}`
    : "/placeholder-poster.svg"

  const logoUrl = item.jellyfinLogoUrl || null

  const displayEpisodeInfo = item.episodeNumber
    ? `${item.episodeNumber}${item.episodeTitle ? ` - ${item.episodeTitle}` : ""}`
    : item.episodeTitle || ""

  return { playHref, detailHref, backdropUrl, logoUrl, displayEpisodeInfo }
}

export function ContinueWatchingCard({
  item,
  onHoverEnter,
  onHoverLeave,
  onMarkWatched,
  marking,
  dimmed,
  disabled = false,
}: {
  item: ContinueWatchingItem
  onHoverEnter?: (el: HTMLElement) => void
  onHoverLeave?: () => void
  onMarkWatched?: () => void
  /** Shows the in-flight spinner while the mark-as-watched request is pending. */
  marking?: boolean
  /** Fades the base card out while the (portaled) flyout takes over its exact position. */
  dimmed?: boolean
  disabled?: boolean
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const { playHref, backdropUrl, displayEpisodeInfo } = getContinueWatchingMedia(item)

  // Hover flyout only makes sense on devices with a real pointer
  const hoverCapable = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches

  return (
    <div
      ref={cardRef}
      data-testid="movie-card"
      className={`group relative block w-full shrink-0 transition-all duration-300 ease-out ${
        disabled
          ? "cursor-default opacity-40 pointer-events-none"
          : "cursor-pointer opacity-100"
      } ${dimmed ? "opacity-0" : ""}`}
      onMouseEnter={() => {
        if (!disabled && hoverCapable() && cardRef.current) onHoverEnter?.(cardRef.current)
      }}
      onMouseLeave={() => {
        if (!disabled && hoverCapable()) onHoverLeave?.()
      }}
    >
      {/* ── Base Penpot Continue Watching Card (card/movie/watching) ── */}
      <div className="relative aspect-[240/136] w-full overflow-hidden rounded-[8px] bg-penpot-surface border border-penpot-border shadow-md transition-transform duration-200 group-hover:scale-[1.03] group-hover:border-penpot-primary-300/50">
        <Link
          href={playHref}
          aria-label={`Play ${item.title}`}
          className="absolute inset-0 z-0 cursor-pointer block"
        >
          <Image
            src={backdropUrl}
            alt={item.title}
            fill
            sizes="(max-width: 640px) 320px, (max-width: 1024px) 400px, 500px"
            className="object-cover transition-transform duration-300"
            unoptimized={backdropUrl.startsWith("/api/")}
          />

          {/* Bottom Gradient Overlay (overlay) */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent pointer-events-none" />

          {/* Top Badges */}
          <div className="absolute top-2.5 inset-x-2.5 z-10 flex items-center justify-between pointer-events-none">
            {/* NEXT UP Badge */}
            {item.isNextUp && (
              <div className="rounded-[4px] bg-penpot-primary-300 px-2 py-0.5 text-[10px] font-bold text-white shadow uppercase tracking-wider">
                Next Up
              </div>
            )}

            {/* Time Remaining Badge */}
            {item.timeLeft && !item.isNextUp && (
              <div className="ml-auto rounded-[4px] bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                {item.timeLeft}
              </div>
            )}
          </div>

          {/* Title and Episode Details (Details) */}
          <div className="absolute bottom-4.5 left-3 right-11 z-10 space-y-0.5 pointer-events-none">
            <h4 className="text-sm font-bold text-white leading-tight truncate">
              {item.title}
            </h4>
            {displayEpisodeInfo && (
              <p className="text-xs font-medium text-penpot-text-medium truncate">
                {displayEpisodeInfo}
              </p>
            )}
          </div>

          {/* Progress Bar (Penpot progress: height 5px, track bg-white/50, fill #02E7F5 cyan, inset-x-3 bottom-2) */}
          {!item.isNextUp && (
            <div className="absolute bottom-2 inset-x-3 z-10 h-[5px] rounded-full bg-white/50 overflow-hidden pointer-events-none">
              <div
                className="h-full bg-penpot-primary-100 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, item.progressPercent))}%` }}
              />
            </div>
          )}
        </Link>

        {/* Mark Watched Button */}
        {item.jellyfinItemId && (
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onMarkWatched?.()
            }}
            disabled={marking}
            title="Mark as watched"
            aria-label={`Mark ${item.title} as watched`}
            className="absolute bottom-3.5 right-2.5 z-20 flex size-7 items-center justify-center rounded-full text-white transition-all hover:scale-110 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <div className="flex size-7 items-center justify-center rounded-full border border-white/30 bg-black/60 backdrop-blur-sm hover:bg-black/80">
              {marking ? (
                <Loader2 className="size-3.5 animate-spin text-white" />
              ) : (
                <Check className="size-3.5 stroke-[2.5] text-white" />
              )}
            </div>
          </button>
        )}
      </div>
    </div>
  )
}

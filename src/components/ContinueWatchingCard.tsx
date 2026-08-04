"use client"

import Link from "next/link"
import Image from "next/image"
import { useRef } from "react"

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
      ? `https://image.tmdb.org/t/p/w500${item.backdrop_path}`
      : "https://image.tmdb.org/t/p/w500/muth4OYamv31pG2LX2jU2u2vY1n.jpg"

  const displayEpisodeInfo = item.episodeNumber
    ? `${item.episodeNumber}${item.episodeTitle ? ` - ${item.episodeTitle}` : ""}`
    : item.episodeTitle || ""

  return { playHref, detailHref, backdropUrl, displayEpisodeInfo }
}

export function ContinueWatchingCard({
  item,
  onHoverEnter,
  onHoverLeave,
  dimmed,
}: {
  item: ContinueWatchingItem
  onHoverEnter?: (el: HTMLElement) => void
  onHoverLeave?: () => void
  /** Fades the base card out while the (portaled) flyout takes over its exact position. */
  dimmed?: boolean
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
      className={`group relative block w-full shrink-0 transition-opacity duration-10 ease-out ${
        dimmed ? "opacity-0" : "opacity-100"
      }`}
      onMouseEnter={() => {
        if (hoverCapable() && cardRef.current) onHoverEnter?.(cardRef.current)
      }}
      onMouseLeave={() => {
        if (hoverCapable()) onHoverLeave?.()
      }}
    >
      {/* ── Base Compact Card (Normal View) ── */}
      <Link href={playHref} className="flex flex-col w-full cursor-pointer">
        {/* 16:9 Thumbnail Image */}
        <div className="relative aspect-video w-full overflow-hidden rounded-[4px] bg-[#181818] border border-[#262626] shadow-md transition-all duration-10">
          <Image
            src={backdropUrl}
            alt={item.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover transition-transform duration-10"
            unoptimized
          />

          {/* NEXT UP Badge (Top-Left) */}
          {item.isNextUp && (
            <div className="absolute top-2 left-2 z-10 rounded-[3px] bg-[#E50914] px-2 py-0.5 text-[10px] font-bold text-white shadow uppercase tracking-wide">
              Next Up
            </div>
          )}

          {/* Time Remaining Badge (Top-Right) */}
          {item.timeLeft && !item.isNextUp && (
            <div className="absolute top-2 right-2 z-10 rounded-[3px] bg-black/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
              {item.timeLeft}
            </div>
          )}
        </div>

        {/* Standalone Progress Bar Below Thumbnail */}
        {!item.isNextUp && (
          <div className="mt-2 w-[85%] mx-auto h-[3px] bg-[#414141] rounded-full overflow-hidden flex">
            <div
              className="h-full bg-[#E50914] rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, item.progressPercent))}%` }}
            />
          </div>
        )}

        {/* Base Info Line Below Progress Bar */}
        {/* <div className="mt-1.5 space-y-0.5 px-0.5">
          <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-1 group-hover:text-[#E50914] transition-colors">
            {item.title}
          </h3>
          {displayEpisodeInfo ? (
            <p className="text-[11px] font-medium text-[#B3B3B3] line-clamp-1">
              {displayEpisodeInfo}
            </p>
          ) : (
            <p className="text-[10px] font-medium text-[#808080]">Sub | Dub</p>
          )}
        </div> */}
      </Link>
    </div>
  )
}

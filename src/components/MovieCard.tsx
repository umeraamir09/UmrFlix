"use client"

import Link from "next/link"
import Image from "next/image"
import { getImageUrl } from "@/lib/utils"
import { AvailabilityBadge } from "@/components/AvailabilityBadge"
import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import { MediaCardFlyout } from "@/components/MediaCardFlyout"
import type { AvailabilityResult } from "@/app/api/availability/route"

export type MovieCardItem = {
  id: number
  title?: string
  name?: string
  poster_path?: string | null
  backdrop_path?: string | null
  release_date?: string
  first_air_date?: string
  vote_average?: number
  overview?: string
  media_type?: string
  runtime?: number
  numberOfSeasons?: number
  jellyfinItemId?: string
  // Server-computed availability
  availabilityStatus?: {
    status: string
    progress?: number
    jellyfinItemId?: string
  }
  // Smart badges
  badge?: string | { type: "new" | "airing" | "popular" | "top10" | "liked"; label: string }
  airingLabel?: string
  ranking?: number
}

function Badge({ label, variant }: { label: string; variant?: "new" | "airing" | "popular" | "top10" | "liked" }) {
  const colors = {
    new: "bg-[#abfab3] text-[#00710b]",
    airing: "bg-penpot-primary-300 text-white",
    popular: "bg-amber-500 text-white",
    top10: "bg-penpot-primary-300 text-white",
    liked: "bg-penpot-primary-400 text-white",
  }
  const colorClass = colors[variant || "new"]

  return (
    <span className={`${colorClass} text-[10px] font-bold px-2 py-0.5 rounded-[4px] uppercase tracking-wider shadow-sm`}>
      {label}
    </span>
  )
}

export function MovieCard({
  item,
  type,
  availabilityState,
  onDelete,
  onMarkWatched,
  isWatched = false,
  disabled = false,
  ranking,
  horizontalPosterPath,
  onHoverEnter,
  onHoverLeave,
  dimmed = false,
  cardVariant = "default",
}: {
  item: MovieCardItem
  type: "movie" | "tv"
  availabilityState?: AvailabilityResult
  onDelete?: (item: MovieCardItem, type: "movie" | "tv") => void
  onMarkWatched?: (item: MovieCardItem, type: "movie" | "tv") => void
  isWatched?: boolean
  disabled?: boolean
  ranking?: number
  horizontalPosterPath?: string | null
  onHoverEnter?: (el: HTMLElement) => void
  onHoverLeave?: () => void
  dimmed?: boolean
  cardVariant?: "default" | "large"
}) {
  const href = type === "movie" ? `/movie/${item.id}` : `/tv/${item.id}`
  const title = item.title ?? item.name ?? "Unknown Title"

  const isLarge = cardVariant === "large"

  // Vertical poster URL (for mobile cards & desktop large cards)
  const posterPath = item.poster_path || horizontalPosterPath || item.backdrop_path
  const posterUrl = getImageUrl(posterPath, "w780")

  // Horizontal backdrop URL (for desktop default 16:9 cards)
  const backdropPath = horizontalPosterPath || item.backdrop_path || item.poster_path
  const backdropUrl = getImageUrl(backdropPath, "w780")

  const cardRef = useRef<HTMLDivElement>(null)
  const cardRank = ranking ?? item.ranking

  // Standalone hover flyout state when no parent row manager is attached
  const [standaloneFlyout, setStandaloneFlyout] = useState(false)
  const [standaloneRect, setStandaloneRect] = useState<DOMRect | null>(null)
  const standaloneTimerRef = useRef<number | null>(null)

  const hoverCapable = () =>
    typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches

  const handleMouseEnter = () => {
    if (!hoverCapable() || disabled) return
    if (onHoverEnter && cardRef.current) {
      onHoverEnter(cardRef.current)
      return
    }
    // Standalone fallback
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      setStandaloneRect(rect)
      setStandaloneFlyout(true)
    }
  }

  const handleMouseLeave = () => {
    if (!hoverCapable() || disabled) return
    if (onHoverLeave) {
      onHoverLeave()
      return
    }
    if (standaloneTimerRef.current !== null) {
      window.clearTimeout(standaloneTimerRef.current)
      standaloneTimerRef.current = null
    }
    setStandaloneFlyout(false)
  }

  useEffect(() => {
    if (!standaloneFlyout) return
    const onWindowScroll = () => {
      if (standaloneTimerRef.current !== null) {
        window.clearTimeout(standaloneTimerRef.current)
        standaloneTimerRef.current = null
      }
      setStandaloneFlyout(false)
    }
    window.addEventListener("scroll", onWindowScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onWindowScroll)
    }
  }, [standaloneFlyout])

  useEffect(() => {
    return () => {
      if (standaloneTimerRef.current !== null) {
        window.clearTimeout(standaloneTimerRef.current)
      }
    }
  }, [])

  return (
    <>
      <div
        ref={cardRef}
        data-testid="movie-card"
        className={`group relative block w-full shrink-0 transition-all duration-300 ${
          disabled
            ? "cursor-pointer md:cursor-default opacity-100 md:opacity-40 pointer-events-auto md:pointer-events-none"
            : "cursor-pointer opacity-100"
        } ${dimmed ? "opacity-0" : ""}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* ── Card Container (Vertical 2:3 on mobile, 16:9 or Large on desktop) ── */}
        <Link
          href={href}
          aria-label={title}
          className={`block relative ${
            isLarge
              ? "aspect-[240/361]"
              : "aspect-[240/361] md:aspect-[240/136]"
          } w-full overflow-hidden rounded-[8px] bg-penpot-surface shadow-md transition-transform duration-200 group-hover:scale-[1.03] group-hover:border-penpot-primary-300/50 ${
            disabled ? "md:pointer-events-none" : ""
          }`}
        >
          {/* Mobile Image: Vertical poster */}
          <Image
            src={posterUrl}
            alt={title}
            fill
            sizes="(max-width: 768px) 180px, 320px"
            unoptimized={posterUrl.startsWith("/api/")}
            className={`${isLarge ? "block" : "block md:hidden"} object-cover transition-transform duration-300`}
          />

          {/* Desktop Image: Horizontal backdrop (only for default non-large cards) */}
          {!isLarge && (
            <Image
              src={backdropUrl}
              alt={title}
              fill
              sizes="(max-width: 1024px) 400px, 500px"
              unoptimized={backdropUrl.startsWith("/api/")}
              className="hidden md:block object-cover transition-transform duration-300"
            />
          )}

          {/* Top-10 Ranking Badge (Penpot card/movie/top) */}
          {cardRank ? (
            <div className="absolute top-2.5 right-2.5 z-10 size-[35px] rounded-full bg-penpot-primary-300/80 backdrop-blur-sm border border-white/30 text-white font-bold text-sm flex items-center justify-center shadow-lg">
              #{cardRank}
            </div>
          ) : null}

          {/* Badges Overlay (Airing / New / In Library) */}
          <div className="absolute inset-x-2 top-2 z-10 flex items-center justify-between pointer-events-none">
            {/* Left Badges */}
            <div className="flex items-center gap-1">
              {item.airingLabel ? (
                <Badge label={item.airingLabel} variant="airing" />
              ) : typeof item.badge === "string" ? (
                <Badge label={item.badge} variant="new" />
              ) : item.badge ? (
                <Badge label={item.badge.label} variant={item.badge.type} />
              ) : null}
            </div>

            {/* Right: Availability Badge */}
            {!cardRank && availabilityState?.status === "in_library" && (
              <AvailabilityBadge state={availabilityState} />
            )}
          </div>
        </Link>
      </div>

      {/* Standalone Fallback Portal Flyout */}
      {!onHoverEnter && standaloneFlyout && standaloneRect && typeof document !== "undefined" && (
        createPortal(
          <MediaCardFlyout
            item={{
              ...item,
              backdrop_path: isLarge ? posterPath : backdropPath,
              ranking: cardRank,
              jellyfinItemId: item.jellyfinItemId || availabilityState?.jellyfinItemId,
            }}
            rect={standaloneRect}
            open={standaloneFlyout}
            mediaType={type}
            cardVariant={cardVariant}
            availabilityState={availabilityState}
            onExited={() => {
              setStandaloneFlyout(false)
              setStandaloneRect(null)
            }}
            onMouseEnter={() => {
              if (standaloneTimerRef.current !== null) {
                window.clearTimeout(standaloneTimerRef.current)
              }
              setStandaloneFlyout(true)
            }}
            onMouseLeave={handleMouseLeave}
            onMarkWatched={onMarkWatched ? () => onMarkWatched(item, type) : undefined}
            onDelete={onDelete ? () => onDelete(item, type) : undefined}
            isWatched={isWatched}
          />,
          document.body
        )
      )}
    </>
  )
}

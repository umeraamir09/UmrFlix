"use client"

import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { getImageUrl, formatYear, formatRating } from "@/lib/utils"
import { AvailabilityBadge } from "@/components/AvailabilityBadge"
import { BookmarkButton } from "@/components/BookmarkButton"
import { useState, useRef, useEffect, type ElementType } from "react"
import { Star, Trash2, Check, CheckCheck, MoreVertical } from "lucide-react"
import { IconPlay, IconAdd } from "@/components/ui/icons"
import type { AvailabilityResult } from "@/app/api/availability/route"

export type MovieCardItem = {
  id: number
  title?: string
  name?: string
  poster_path?: string | null
  release_date?: string
  first_air_date?: string
  vote_average?: number
  overview?: string
  media_type?: string
  // Server-computed availability (e.g. the genre "Available Now" row).
  // When present the client skips its own availability round-trip.
  availabilityStatus?: {
    status: string
    progress?: number
    jellyfinItemId?: string
  }
  // Smart badges
  badge?: string | { type: "new" | "airing" | "popular" | "top10" | "liked"; label: string }
  airingLabel?: string // e.g., "New Episode Friday"
}

function Badge({ label, variant }: { label: string; variant?: "new" | "airing" | "popular" | "top10" | "liked" }) {
  const colors = {
    new: "bg-green-600 text-white",
    airing: "bg-blue-600 text-white",
    popular: "bg-orange-500 text-white",
    top10: "bg-red-600 text-white",
    liked: "bg-amber-500 text-white",
  }
  const colorClass = colors[variant || "new"]
  
  return (
    <span className={`${colorClass} text-[10px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wide`}>
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
}: {
  item: MovieCardItem
  type: "movie" | "tv"
  availabilityState?: AvailabilityResult
  onDelete?: (item: MovieCardItem, type: "movie" | "tv") => void
  onMarkWatched?: (item: MovieCardItem, type: "movie" | "tv") => void
  isWatched?: boolean
  disabled?: boolean
}) {
  const href = type === "movie" ? `/movie/${item.id}` : `/tv/${item.id}`
  const router = useRouter()
  const title = item.title ?? item.name ?? "Unknown Title"
  const dateStr = item.release_date ?? item.first_air_date ?? ""
  const year = formatYear(dateStr)
  const posterUrl = getImageUrl(item.poster_path, "w342")
  const Wrapper = (disabled ? "div" : Link) as ElementType

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [menuOpen])

  const hasMenuItems = !disabled || Boolean(onDelete)

  return (
    <Wrapper
      href={href}
      className={`group relative block w-full flex-shrink-0${disabled ? " cursor-default" : ""}`}
    >
      {/* Poster Image Container */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[4px] bg-grey-850 shadow-md border border-grey-750">
        <Image
          src={posterUrl}
          alt={title}
          fill
          sizes="(max-width: 640px) 175px, (max-width: 1024px) 220px, 275px"
          unoptimized={posterUrl.startsWith("/api/")}
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />


        {/* Top Badges (Visible when not hovering) */}
        <div className="absolute inset-x-2 top-2 z-10 flex items-center justify-end gap-1 pointer-events-none group-hover:opacity-0 transition-opacity">
          {/* Availability Badge */}
          {availabilityState?.status === "in_library" && (
            <AvailabilityBadge state={availabilityState} />
          )}
          
          {/* Airing Badge (TVMaze) */}
          {item.airingLabel && (
            <Badge label={item.airingLabel} variant="airing" />
          )}
          
          {/* Smart Badges */}
          {typeof item.badge === "string" ? (
            <Badge label={item.badge} variant="new" />
          ) : item.badge ? (
            <Badge label={item.badge.label} variant={item.badge.type} />
          ) : null}
        </div>
      </div>

      {/* Sub-Card Title & Metadata Line (Visible when NOT hovering) */}
      <div className="mt-2 space-y-0.5 px-0.5 group-hover:opacity-0 transition-opacity duration-200">
        <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-1 group-hover:text-accent transition-colors">
          {title}
        </h3>
        <p className="text-[11px] font-medium text-grey-200 flex items-center gap-1.5">
          <span>Sub | Dub</span>
          {year && <span>• {year}</span>}
        </p>
      </div>

      {/* Netflix-Style Full Hover Overlay (Expands over full card height) */}
      <div className="absolute inset-0 z-20 bg-grey-850/95 p-3 sm:p-3.5 flex flex-col justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200 border border-grey-600 rounded-[4px] shadow-2xl pointer-events-none group-hover:pointer-events-auto">
        <div className="space-y-1.5 overflow-hidden">
          {/* Title */}
          <h3 className="text-sm sm:text-lg font-bold text-white leading-tight line-clamp-2">
            {title}
          </h3>

          {/* Rating & Metadata */}
          <div className="flex items-center gap-2 text-[15px] font-bold text-amber-400">
            {item.vote_average ? (
              <div className="flex items-center gap-1">
                <span>{formatRating(item.vote_average)}</span>
                <Star className="size-4 fill-amber-400 text-amber-400" />
              </div>
            ) : null}
            <span className="text-[15px] text-gray-400 font-medium">
              {year ? `• ${year}` : ""}
            </span>
          </div>

          {/* Synopsis Overview */}
          <p className="text-[15px] text-gray-300 leading-relaxed line-clamp-5 sm:line-clamp-7 font-normal pt-1">
            {item.overview || "No overview available for this title."}
          </p>
        </div>

        {/* Bottom Action Bar */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-1">
            {!disabled && (
              <button
                type="button"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center p-2 text-accent hover:scale-110 transition-transform cursor-pointer"
                title="Watch Now"
                aria-label="Watch Now"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  router.push(`/watch?tmdb=${item.id}&type=${type}`)
                }}
              >
                <IconPlay className="size-5 fill-accent text-accent" />
              </button>
            )}
            {onMarkWatched && (
              <button
                type="button"
                className={`flex min-h-[44px] min-w-[44px] items-center justify-center p-2 hover:scale-110 transition-transform cursor-pointer ${
                  isWatched ? "text-red-500 hover:text-red-400" : "text-white hover:text-accent"
                }`}
                title={
                  type === "tv"
                    ? isWatched
                      ? "Mark all episodes as unwatched"
                      : "Mark all episodes as watched"
                    : isWatched
                      ? "Mark as unwatched"
                      : "Mark as watched"
                }
                aria-label="Toggle watched status"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onMarkWatched(item, type)
                }}
              >
                {type === "tv" ? <CheckCheck className="size-5" /> : <Check className="size-5" />}
              </button>
            )}
          </div>

          {hasMenuItems && (
            <div className="relative ml-auto" ref={menuRef}>
              <button
                type="button"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center p-2 text-gray-300 hover:text-white hover:scale-110 transition-transform cursor-pointer"
                title="More options"
                aria-label="More options"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenuOpen((prev) => !prev)
                }}
              >
                <MoreVertical className="size-5" />
              </button>

              {menuOpen && (
                <div
                  className="absolute bottom-full right-0 mb-1 z-30 w-48 rounded-md bg-grey-900 border border-grey-700 shadow-xl p-1 flex flex-col gap-0.5"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                >
                  {!disabled && (
                    <>
                      <BookmarkButton
                        itemId={availabilityState?.jellyfinItemId || String(item.id)}
                        tmdbId={item.id}
                        jellyfinId={availabilityState?.jellyfinItemId}
                        mediaType={type}
                        title={title}
                        posterPath={item.poster_path}
                        overview={item.overview}
                        releaseYear={year}
                        variant="menu-item"
                      />
                      <button
                        type="button"
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-gray-200 hover:text-white hover:bg-white/10 rounded transition-colors text-left cursor-pointer"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setMenuOpen(false)
                          router.push(href)
                        }}
                      >
                        <IconAdd className="size-4 text-accent" />
                        <span>Request / Add to Library</span>
                      </button>
                    </>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors text-left cursor-pointer"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setMenuOpen(false)
                        onDelete(item, type)
                      }}
                    >
                      <Trash2 className="size-4 text-red-500" />
                      <span>Delete from Library</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  )
}

"use client"

import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { getImageUrl, formatYear, formatRating } from "@/lib/utils"
import { AvailabilityBadge } from "@/components/AvailabilityBadge"
import { BookmarkButton } from "@/components/BookmarkButton"
import { Star, Bookmark } from "lucide-react"
import { IconPlay, IconDownloadNav, IconAdd } from "@/components/ui/icons"
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
}: {
  item: MovieCardItem
  type: "movie" | "tv"
  availabilityState?: AvailabilityResult
}) {
  const href = type === "movie" ? `/movie/${item.id}` : `/tv/${item.id}`
  const router = useRouter()
  const title = item.title ?? item.name ?? "Unknown Title"
  const dateStr = item.release_date ?? item.first_air_date ?? ""
  const year = formatYear(dateStr)
  const posterUrl = getImageUrl(item.poster_path, "w500")

  return (
    <Link href={href} className="group relative block w-full flex-shrink-0">
      {/* Poster Image Container */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-none bg-card shadow-md">
        <Image
          src={posterUrl}
          alt={title}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
          className="object-cover"
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
        <p className="text-[11px] font-medium text-gray-400 flex items-center gap-1.5">
          <span>Sub | Dub</span>
          {year && <span>• {year}</span>}
        </p>
      </div>

      {/* Crunchyroll-Style Full Hover Overlay (Expands over full card height) */}
      <div className="absolute inset-0 z-20 bg-surface/95 p-3 sm:p-3.5 flex flex-col justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200 border border-border shadow-2xl pointer-events-none group-hover:pointer-events-auto">
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

        {/* Bottom Action Bar (Crunchyroll Orange/Accent Icons) */}
        <div className="flex items-center gap-3 pt-2">
          <button
            className="text-accent hover:scale-110 transition-transform cursor-pointer"
            title="Watch Now"
            aria-label="Watch Now"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              // The watch page resolves availability (and, for series, picks
              // the next episode) before starting playback.
              router.push(`/watch?tmdb=${item.id}&type=${type}`)
            }}
          >
            <IconPlay className="size-5 fill-accent text-accent" />
          </button>
          <BookmarkButton
            itemId={availabilityState?.jellyfinItemId || String(item.id)}
            tmdbId={item.id}
            jellyfinId={availabilityState?.jellyfinItemId}
            mediaType={type}
            title={title}
            posterPath={item.poster_path}
            overview={item.overview}
            releaseYear={year}
            variant="icon"
            className="!p-1.5 border-none bg-transparent hover:bg-white/10"
          />
          <div className="text-accent hover:scale-110 transition-transform cursor-pointer" title="Add to Library">
            <IconAdd className="size-5" />
          </div>
        </div>
      </div>
    </Link>
  )
}

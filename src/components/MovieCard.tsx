"use client"

import Link from "next/link"
import Image from "next/image"
import { getImageUrl, formatYear, formatRating } from "@/lib/utils"
import { AvailabilityBadge } from "@/components/AvailabilityBadge"
import { Star, Play, Bookmark, Plus } from "lucide-react"
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
  const title = item.title ?? item.name ?? "Unknown Title"
  const dateStr = item.release_date ?? item.first_air_date ?? ""
  const year = formatYear(dateStr)
  const posterUrl = getImageUrl(item.poster_path, "w500")

  return (
    <Link href={href} className="group relative block w-full flex-shrink-0">
      {/* Poster Image Container */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-none bg-[#1a1c23] shadow-md">
        <Image
          src={posterUrl}
          alt={title}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
          className="object-cover"
        />

        {/* Top Badges (Visible when not hovering) */}
        <div className="absolute inset-x-2 top-2 z-10 flex items-center justify-between gap-1 pointer-events-none group-hover:opacity-0 transition-opacity">


          {availabilityState?.status === "in_library" && <AvailabilityBadge state={availabilityState} />}
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
      <div className="absolute inset-0 z-20 bg-[#141519]/95 p-3 sm:p-3.5 flex flex-col justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200 border border-[#282c37] shadow-2xl pointer-events-none group-hover:pointer-events-auto">
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
          <div className="text-accent hover:scale-110 transition-transform cursor-pointer" title="Watch Now">
            <Play className="size-5 fill-accent text-accent" />
          </div>
          <div className="text-accent hover:scale-110 transition-transform cursor-pointer" title="Bookmark">
            <Bookmark className="size-5" />
          </div>
          <div className="text-accent hover:scale-110 transition-transform cursor-pointer" title="Add to Library">
            <Plus className="size-5" />
          </div>
        </div>
      </div>
    </Link>
  )
}

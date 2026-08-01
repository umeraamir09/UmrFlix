"use client"

import Link from "next/link"
import Image from "next/image"
import { useState } from "react"
import { IconPlay } from "@/components/ui/icons"
import { Check, Loader2 } from "lucide-react"

export interface ContinueWatchingItem {
  id: number
  title: string
  episodeTitle?: string
  episodeNumber?: string
  backdrop_path: string | null
  media_type: "movie" | "tv"
  progressPercent: number
  timeLeft?: string
  jellyfinItemId?: string
  jellyfinImageUrl?: string
}

export function ContinueWatchingCard({
  item,
  onMarkWatched,
}: {
  item: ContinueWatchingItem
  onMarkWatched?: (jellyfinItemId: string) => void
}) {
  const [marking, setMarking] = useState(false)

  const handleMarkWatched = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!item.jellyfinItemId || marking) return
    setMarking(true)
    try {
      const res = await fetch(`/api/jellyfin/played/${item.jellyfinItemId}`, { method: "POST" })
      if (!res.ok) throw new Error(`Mark watched failed: HTTP ${res.status}`)
      onMarkWatched?.(item.jellyfinItemId)
    } catch {
      setMarking(false)
    }
  }

  // Resume items carry the exact Jellyfin movie/episode id — go straight to
  // the fullscreen player; fall back to the detail page when unknown.
  const href = item.jellyfinItemId
    ? `/watch?id=${item.jellyfinItemId}`
    : item.id
      ? `/${item.media_type}/${item.id}`
      : "#"
  const backdropUrl = item.jellyfinImageUrl
    ? item.jellyfinImageUrl
    : item.backdrop_path
      ? `https://image.tmdb.org/t/p/w500${item.backdrop_path}`
      : "https://image.tmdb.org/t/p/w500/muth4OYamv31pG2LX2jU2u2vY1n.jpg"

  return (
    <Link href={href} className="group block w-full flex-shrink-0">
      {/* 16:9 Widescreen Image Container */}
      <div className="relative aspect-video w-full overflow-hidden rounded-none bg-card border border-border/60 shadow-md group-hover:border-accent transition-all duration-300">
        <Image
          src={backdropUrl}
          alt={item.title}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
          unoptimized
        />

        {/* Time Remaining Badge (Crunchyroll Style) */}
        {item.timeLeft && (
          <div className="absolute top-2 right-2 z-10 rounded-none bg-black/80 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur">
            {item.timeLeft}
          </div>
        )}

        {/* Play Overlay Button */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="flex size-10 items-center justify-center rounded-none bg-accent text-white shadow-lg transition-transform duration-200 group-hover:scale-110">
            <IconPlay className="size-5 fill-white ml-0.5" />
          </div>
        </div>

        {/* Bottom Red Progress Bar */}
        <div className="absolute bottom-0 inset-x-0 h-1.5 bg-gray-800">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Math.min(100, Math.max(0, item.progressPercent))}%` }}
          />
        </div>
      </div>

      {/* Item Metadata */}
      <div className="mt-2 space-y-0.5">
        <div className="flex items-center justify-between gap-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 line-clamp-1">
            {item.title}
          </p>
          {item.jellyfinItemId && (
            <button
              onClick={handleMarkWatched}
              disabled={marking}
              title="Mark as watched"
              className="p-1 text-gray-400 transition-colors hover:text-accent disabled:opacity-50"
            >
              {marking ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
            </button>
          )}
        </div>
        <h4 className="text-xs font-bold text-white line-clamp-1 group-hover:text-accent transition-colors">
          {item.episodeNumber ? `${item.episodeNumber} - ` : ""}{item.episodeTitle || item.title}
        </h4>
        <p className="text-[10px] font-medium text-gray-400">Sub | Dub</p>
      </div>
    </Link>
  )
}

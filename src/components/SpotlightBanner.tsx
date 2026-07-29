"use client"

import Image from "next/image"
import Link from "next/link"
import { Check } from "lucide-react"
import { IconPlay, IconDownloadNav } from "@/components/ui/icons"
import { useState } from "react"

export interface SpotlightItem {
  id: number
  title: string
  overview: string
  backdrop_path: string | null
  media_type: "movie" | "tv"
  tagline?: string
}

export function SpotlightBanner({ item }: { item: SpotlightItem }) {
  const [bookmarked, setBookmarked] = useState(false)
  const backdropUrl = item.backdrop_path
    ? `https://image.tmdb.org/t/p/original${item.backdrop_path}`
    : "https://image.tmdb.org/t/p/original/muth4OYamv31pG2LX2jU2u2vY1n.jpg"

  return (
    <div className="relative w-full aspect-[21/9] min-h-[360px] max-h-[500px] overflow-hidden rounded-none border border-border/80 shadow-2xl bg-card">
      <Image
        src={backdropUrl}
        alt={item.title}
        fill
        priority
        className="object-cover object-top opacity-60"
        unoptimized
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />

      <div className="absolute inset-0 p-6 sm:p-10 flex flex-col justify-end max-w-2xl z-10">
        <div className="space-y-3">
          <span className="inline-block rounded-none bg-accent/90 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-white backdrop-blur">
            SPOTLIGHT
          </span>

          <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-tight text-white drop-shadow-md">
            {item.title}
          </h2>

          <p className="text-xs sm:text-sm text-gray-300 line-clamp-3 leading-relaxed">
            {item.overview}
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href={`/watch?tmdb=${item.id}&type=${item.media_type}`}
              className="flex items-center gap-2 rounded-none bg-accent px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg hover:bg-accent-hover transition-all hover:scale-105 active:scale-95"
            >
              <IconPlay className="size-4 fill-white" />
              START WATCHING
            </Link>

            <button
              onClick={() => setBookmarked(!bookmarked)}
              className={`flex items-center gap-2 rounded-none border px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all hover:scale-105 active:scale-95 ${
                bookmarked
                  ? "border-accent bg-accent/20 text-accent"
                  : "border-gray-500 bg-transparent text-white hover:border-white hover:bg-white/10"
              }`}
            >
              {bookmarked ? (
                <>
                  <Check className="size-3.5 text-accent" />
                  IN WATCHLIST
                </>
              ) : (
                <>
                  <IconDownloadNav className="size-3.5" />
                  ADD TO WATCHLIST
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

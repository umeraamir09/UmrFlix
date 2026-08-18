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
    ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
    : "https://image.tmdb.org/t/p/w1280/muth4OYamv31pG2LX2jU2u2vY1n.jpg"

  return (
    <div className="relative w-full aspect-[21/9] min-h-[340px] max-h-[480px] overflow-hidden rounded-[8px] border border-penpot-border shadow-2xl bg-penpot-surface">
      <Image
        src={backdropUrl}
        alt={item.title}
        fill
        priority
        className="object-cover object-top opacity-70"
        unoptimized
      />
      <div className="absolute inset-0 bg-gradient-to-t from-penpot-bg via-penpot-bg/70 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-penpot-bg via-penpot-bg/50 to-transparent" />

      <div className="absolute inset-0 p-6 sm:p-10 flex flex-col justify-end max-w-2xl z-10">
        <div className="space-y-3">
          <span className="inline-block rounded-[4px] bg-penpot-primary-300 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur">
            SPOTLIGHT
          </span>

          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white drop-shadow-md">
            {item.title}
          </h2>

          <p className="text-xs sm:text-sm text-penpot-text-medium line-clamp-3 leading-relaxed font-normal">
            {item.overview}
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href={`/watch?tmdb=${item.id}&type=${item.media_type}`}
              className="flex items-center gap-2 rounded-[4px] bg-penpot-primary-300 hover:bg-penpot-primary-400 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg transition-all hover:scale-105 active:scale-95 cursor-pointer"
            >
              <IconPlay className="size-4 fill-white" />
              START WATCHING
            </Link>

            <button
              onClick={() => setBookmarked(!bookmarked)}
              className={`flex items-center gap-2 rounded-[4px] border px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all hover:scale-105 active:scale-95 cursor-pointer ${
                bookmarked
                  ? "border-penpot-primary-300 bg-penpot-primary-500/30 text-white"
                  : "border-penpot-border bg-penpot-surface hover:bg-penpot-neutral-500 text-white"
              }`}
            >
              {bookmarked ? (
                <>
                  <Check className="size-3.5 text-penpot-primary-100" />
                  IN WATCHLIST
                </>
              ) : (
                <>
                  <IconDownloadNav className="size-3.5 text-white" />
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

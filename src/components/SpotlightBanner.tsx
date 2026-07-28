"use client"

import Image from "next/image"
import Link from "next/link"
import { Play, Bookmark, Check } from "lucide-react"
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
    <div className="relative my-10 w-full overflow-hidden rounded-xl border border-[#282c37] bg-[#141519] shadow-2xl">
      <div className="grid grid-cols-1 md:grid-cols-12 min-h-[320px]">
        {/* Left Side: Widescreen Image Banner */}
        <div className="relative md:col-span-7 h-56 sm:h-72 md:h-full min-h-[220px] overflow-hidden">
          <Image
            src={backdropUrl}
            alt={item.title}
            fill
            className="object-cover object-center transition-transform duration-500 hover:scale-105"
            unoptimized
          />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#141519]/30 to-[#141519] hidden md:block" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#141519] via-transparent to-transparent md:hidden" />
        </div>

        {/* Right Side: Title, Synopsis, CTAs */}
        <div className="relative md:col-span-5 flex flex-col justify-center p-6 sm:p-8 space-y-3.5 z-10">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">
            <span className="text-accent font-extrabold">FEATURED SPOTLIGHT</span>
            <span>• Sub | Dub</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black uppercase text-white tracking-tight leading-tight">
            {item.title}
          </h2>

          <p className="text-xs sm:text-sm text-gray-300 line-clamp-3 leading-relaxed">
            {item.overview}
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href={`/${item.media_type}/${item.id}`}
              className="flex items-center gap-2 rounded bg-accent px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg hover:bg-accent-hover transition-all hover:scale-105 active:scale-95"
            >
              <Play className="size-4 fill-white" />
              START WATCHING
            </Link>

            <button
              onClick={() => setBookmarked(!bookmarked)}
              className={`flex items-center gap-2 rounded border px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all hover:scale-105 active:scale-95 ${
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
                  <Bookmark className="size-3.5" />
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

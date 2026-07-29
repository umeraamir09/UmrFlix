"use client"

import Link from "next/link"
import { useRef } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

export interface GenreFilterBarProps {
  genres: { name: string; id?: number; slug?: string }[]
  activeGenre?: string
  mediaType: "movie" | "tv"
}

export function GenreFilterBar({ genres, mediaType }: GenreFilterBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = 300
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      })
    }
  }

  return (
    <div className="relative my-6 group/genre">
      <div className="flex items-center gap-2 relative">
        <button
          onClick={() => scroll("left")}
          className="shrink-0 p-2 rounded-none bg-surface border border-border text-gray-400 hover:text-white hover:bg-surface-hover transition-colors hidden sm:flex items-center justify-center z-10"
          aria-label="Scroll genres left"
        >
          <ChevronLeft className="size-4" />
        </button>

        <div
          ref={scrollRef}
          className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 scroll-smooth w-full"
        >
          <Link
            href={`/search?type=${mediaType}`}
            className="shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-wider bg-accent text-white hover:bg-accent/80 transition-colors shadow-md rounded-none"
          >
            All {mediaType === "movie" ? "Movies" : "TV Shows"}
          </Link>

          {genres.map((genre) => (
            <Link
              key={genre.name}
              href={`/search?type=${mediaType}&genre=${encodeURIComponent(genre.name)}`}
              className="shrink-0 px-4 py-2 text-xs font-semibold tracking-wide bg-surface border border-border text-gray-300 hover:text-white hover:bg-surface-hover hover:border-border-subtle transition-all duration-150 rounded-none"
            >
              {genre.name}
            </Link>
          ))}
        </div>

        <button
          onClick={() => scroll("right")}
          className="shrink-0 p-2 rounded-none bg-surface border border-border text-gray-400 hover:text-white hover:bg-surface-hover transition-colors hidden sm:flex items-center justify-center z-10"
          aria-label="Scroll genres right"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  )
}

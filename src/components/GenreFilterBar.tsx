"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useRef } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"

export interface GenreFilterBarProps {
  genres: { name: string; id?: number; slug?: string }[]
  activeGenre?: string
  mediaType: "movie" | "tv"
  basePath?: string
}

export function GenreFilterBar({ genres, mediaType, activeGenre, basePath }: GenreFilterBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchParams = useSearchParams()

  const currentGenre = activeGenre ?? (searchParams ? searchParams.get("genre") ?? undefined : undefined)
  const path = basePath || (mediaType === "movie" ? "/movie" : "/tvshows")

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = 300
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      })
    }
  }

  const isAllActive = !currentGenre

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
            href={path}
            className={`shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-150 rounded-none border ${
              isAllActive
                ? "bg-accent text-white border-accent shadow-md"
                : "bg-surface border-border text-gray-300 hover:text-white hover:bg-surface-hover hover:border-border-subtle"
            }`}
          >
            All {mediaType === "movie" ? "Movies" : "TV Shows"}
          </Link>

          {genres.map((genre) => {
            const isActive = currentGenre
              ? currentGenre.toLowerCase() === genre.name.toLowerCase() ||
                currentGenre === String(genre.id)
              : false

            return (
              <Link
                key={genre.name}
                href={isActive ? path : `${path}?genre=${encodeURIComponent(genre.name)}`}
                className={`shrink-0 px-4 py-2 text-xs font-semibold tracking-wide border transition-all duration-150 rounded-none flex items-center gap-1.5 ${
                  isActive
                    ? "bg-accent text-white border-accent font-bold shadow-md"
                    : "bg-surface border-border text-gray-300 hover:text-white hover:bg-surface-hover hover:border-border-subtle"
                }`}
              >
                <span>{genre.name}</span>
                {isActive && <X className="size-3 text-white/80 hover:text-white" />}
              </Link>
            )
          })}
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


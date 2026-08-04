"use client"

import Link from "next/link"
import { useRef } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { GENRE_CATALOG } from "@/lib/genres"

/**
 * Netflix-style horizontally scrollable pill bar for jumping between the
 * dedicated genre pages at /genre/<slug>. Reuses the scroll/arrow pattern
 * from GenreFilterBar.
 */
export function GenreSwitcher({ activeSlug }: { activeSlug?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({
        left: direction === "left" ? -300 : 300,
        behavior: "smooth",
      })
    }
  }

  return (
    <div className="relative my-6 group/genre">
      <div className="flex items-center gap-2 relative">
        <button
          onClick={() => scroll("left")}
          className="shrink-0 p-2 rounded-[4px] bg-[#181818] border border-[#333333] text-[#B3B3B3] hover:text-white hover:bg-[#262626] transition-colors hidden sm:flex items-center justify-center z-10 cursor-pointer"
          aria-label="Scroll genres left"
        >
          <ChevronLeft className="size-4" />
        </button>

        <div
          ref={scrollRef}
          className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 scroll-smooth w-full"
        >
          {GENRE_CATALOG.map((genre) => {
            const isActive = genre.slug === activeSlug
            return (
              <Link
                key={genre.slug}
                href={`/genre/${genre.slug}`}
                className={`shrink-0 px-4 py-2 text-xs font-semibold transition-all duration-150 rounded-[4px] border ${
                  isActive
                    ? "bg-[#E50914] text-white border-[#E50914] shadow-md"
                    : "bg-[#181818] border-[#333333] text-[#B3B3B3] hover:text-white hover:bg-[#262626]"
                }`}
              >
                {genre.name}
              </Link>
            )
          })}
        </div>

        <button
          onClick={() => scroll("right")}
          className="shrink-0 p-2 rounded-[4px] bg-[#181818] border border-[#333333] text-[#B3B3B3] hover:text-white hover:bg-[#262626] transition-colors hidden sm:flex items-center justify-center z-10 cursor-pointer"
          aria-label="Scroll genres right"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  )
}

"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import Image from "next/image"
import { ChevronLeft, ChevronRight, User } from "lucide-react"
import { getImageUrl } from "@/lib/utils"
import type { TmdbCastMember } from "@/lib/tmdb"

export function CastCarousel({ cast }: { cast: TmdbCastMember[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  const checkScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
      setCanScrollLeft(scrollLeft > 10)
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10)
    }
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    checkScroll()
    el.addEventListener("scroll", checkScroll, { passive: true })
    window.addEventListener("resize", checkScroll)
    return () => {
      el.removeEventListener("scroll", checkScroll)
      window.removeEventListener("resize", checkScroll)
    }
  }, [checkScroll, cast])

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth * 0.75
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      })
    }
  }

  if (!cast || cast.length === 0) return null

  return (
    <div className="space-y-3 group/cast">
      {/* Header Title */}
      {/* <div className="border-b border-border pb-3">
        <h2 className="text-lg font-black uppercase tracking-wider text-white flex items-center gap-2">
          <User className="size-5 text-accent" /> TOP CAST
        </h2>
      </div> */}

      {/* Row Breakout Container with Overlay Arrow Navigation */}
      <div className="relative group/track py-5">
        {/* Left Navigation Arrow */}
        {canScrollLeft && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 z-30 flex items-center justify-start transition-opacity duration-200">
            <button
              onClick={() => scroll("left")}
              className="rounded-full p-2.5 text-white shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer focus:outline-none"
              aria-label="Scroll left"
            >
              <ChevronLeft className="size-5 stroke-[2.5]" />
            </button>
          </div>
        )}

        {/* Right Navigation Arrow */}
        {canScrollRight && (
          <div className="absolute right-0 top-1/2 -translate-y-1/2 z-30 flex items-center justify-end transition-opacity duration-200">
            <button
              onClick={() => scroll("right")}
              className="rounded-full p-2.5 text-white shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer focus:outline-none"
              aria-label="Scroll right"
            >
              <ChevronRight className="size-5 stroke-[2.5]" />
            </button>
          </div>
        )}

        {/* Cast Track */}
        <div
          ref={scrollRef}
          className="flex items-start gap-5 overflow-x-auto no-scrollbar py-2 px-1 scroll-smooth"
        >
          {cast.map((actor) => (
            <div
              key={actor.id}
              className="flex flex-col items-center shrink-0 w-24 sm:w-28 text-center group cursor-pointer"
            >
              <div className="relative size-20 sm:size-24 rounded-full overflow-hidden border-2 border-border/80 group-hover:border-accent group-hover:scale-105 transition-all duration-300 shadow-md bg-card">
                {actor.profile_path ? (
                  <Image
                    src={getImageUrl(actor.profile_path, "w185")}
                    alt={actor.name}
                    fill
                    sizes="(max-width: 640px) 80px, 96px"
                    className="object-cover"
                  />
                ) : (
                  <div className="size-full flex items-center justify-center text-gray-600 bg-surface">
                    <User className="size-8" />
                  </div>
                )}
              </div>
              <p className="text-xs font-bold text-white line-clamp-1 mt-2.5 group-hover:text-accent transition-colors">
                {actor.name}
              </p>
              <p className="text-[10px] text-gray-400 line-clamp-1 font-medium mt-0.5">
                {actor.character}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

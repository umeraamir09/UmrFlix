"use client"

import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import useSWR from "swr"
import { MovieCard, MovieCardItem } from "@/components/MovieCard"
import { useBatchAvailability } from "@/lib/use-availability"
import { filterDisplayableContent } from "@/lib/catalog"
import type { AvailabilityResult } from "@/app/api/availability/route"
import { ChevronLeft, ChevronRight } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function MovieRow({
  title,
  subtitle,
  type,
  endpoint,
  customItems,
}: {
  title: string
  subtitle?: string
  type: "movie" | "tv"
  endpoint?: string
  customItems?: MovieCardItem[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  const defaultEndpoint = `/api/tmdb/trending/${type}/week`
  const targetEndpoint = endpoint || defaultEndpoint

  const { data, error, isLoading } = useSWR(
    customItems ? null : targetEndpoint,
    fetcher
  )

  const rawItems: MovieCardItem[] = customItems || (data?.results ?? [])
  const items: MovieCardItem[] = useMemo(
    () => filterDisplayableContent(rawItems),
    [rawItems]
  )

  const getItemType = (item: MovieCardItem): "movie" | "tv" =>
    item.media_type === "tv" || item.media_type === "movie" ? item.media_type : type

  // Items that already carry a server-computed availabilityStatus (genre
  // "Available Now" row) skip the client-side availability round-trip.
  const availabilityRefs = items
    .filter((item) => !item.availabilityStatus)
    .map((item) => ({
      tmdbId: item.id,
      type: getItemType(item),
    }))

  const { availabilityMap } = useBatchAvailability(availabilityRefs)

  const availabilityFor = (item: MovieCardItem, itemType: "movie" | "tv"): AvailabilityResult | undefined =>
    (item.availabilityStatus as AvailabilityResult | undefined) ?? availabilityMap[`${itemType}-${item.id}`]

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
  }, [checkScroll, items])

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth * 0.75
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      })
    }
  }

  return (
    <section className="relative my-8 space-y-3 group/row">
      {/* Header & Subtitle (Stays aligned with left container padding) */}
      <div className="flex items-end justify-between px-1">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-gray-400 font-medium mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Row Carousel Breakout Container (Extends horizontally off right edge of viewport) */}
      <div className="relative w-[calc(100%+(100vw-100%)/2)] overflow-visible">
        {/* Left Navigation Button */}
        <div
          className={`absolute left-0 top-0 bottom-0 z-30 pointer-events-none flex items-center justify-start pl-1 sm:pl-2 transition-opacity duration-300 ${
            canScrollLeft ? "opacity-100" : "opacity-0"
          }`}
        >
          <button
            onClick={() => scroll("left")}
            className="pointer-events-auto rounded-none bg-surface/90 hover:bg-accent border border-border hover:border-accent p-2.5 sm:p-3 text-white shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 group-hover/row:opacity-100 hidden sm:block focus:outline-none"
            aria-label="Scroll left"
          >
            <ChevronLeft className="size-5 sm:size-6 stroke-[2.5]" />
          </button>
        </div>

        {/* Right Navigation Button */}
        <div
          className={`absolute right-0 top-0 bottom-0 z-30 pointer-events-none flex items-center justify-end pr-2 sm:pr-4 transition-opacity duration-300 ${
            canScrollRight ? "opacity-100" : "opacity-0"
          }`}
        >
          <button
            onClick={() => scroll("right")}
            className="pointer-events-auto rounded-none bg-surface/90 hover:bg-accent border border-border hover:border-accent p-2.5 sm:p-3 text-white shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 group-hover/row:opacity-100 hidden sm:block focus:outline-none"
            aria-label="Scroll right"
          >
            <ChevronRight className="size-5 sm:size-6 stroke-[2.5]" />
          </button>
        </div>

        {/* Scrollable Cards Track */}
        <div
          ref={scrollRef}
          className="grid grid-flow-col auto-cols-[175px] sm:auto-cols-[220px] md:auto-cols-[255px] lg:auto-cols-[275px] gap-4 sm:gap-5 md:gap-6 overflow-x-auto no-scrollbar py-3 px-1 scroll-smooth pr-12 sm:pr-16 md:pr-24"
        >
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-2 animate-shimmer rounded-md aspect-[2/3] w-full" />
              ))
            : error
            ? <p className="text-xs text-gray-500 py-4">Unable to load media catalog</p>
            : items.map((item) => {
                const itemType = getItemType(item)
                return (
                  <MovieCard
                    key={item.id}
                    item={item}
                    type={itemType}
                    availabilityState={availabilityFor(item, itemType)}
                  />
                )
              })}
        </div>
      </div>
    </section>
  )
}


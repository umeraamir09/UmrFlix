"use client"

import { useRef } from "react"
import useSWR from "swr"
import { MovieCard, MovieCardItem } from "@/components/MovieCard"
import { useBatchAvailability } from "@/lib/use-availability"
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

  const defaultEndpoint = `/api/tmdb/trending/${type}/week`
  const targetEndpoint = endpoint || defaultEndpoint

  const { data, error, isLoading } = useSWR(
    customItems ? null : targetEndpoint,
    fetcher
  )

  const items: MovieCardItem[] = customItems || (data?.results ?? [])

  const availabilityRefs = items.map((item) => ({
    tmdbId: item.id,
    type,
  }))

  const { availabilityMap } = useBatchAvailability(availabilityRefs)

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
      {/* Header & Subtitle */}
      <div className="flex items-end justify-between px-1">
        <div>
          <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-gray-400 font-medium mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Row Carousel Container */}
      <div className="relative">
        {/* Navigation Buttons */}
        <button
          onClick={() => scroll("left")}
          className="absolute -left-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-[#141519]/90 border border-[#282c37] p-2 text-white shadow-xl opacity-0 transition-opacity hover:bg-accent hover:border-accent group-hover/row:opacity-100 hidden sm:block"
          aria-label="Scroll left"
        >
          <ChevronLeft className="size-5" />
        </button>

        <button
          onClick={() => scroll("right")}
          className="absolute -right-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-[#141519]/90 border border-[#282c37] p-2 text-white shadow-xl opacity-0 transition-opacity hover:bg-accent hover:border-accent group-hover/row:opacity-100 hidden sm:block"
          aria-label="Scroll right"
        >
          <ChevronRight className="size-5" />
        </button>

        {/* Scrollable Items */}
        <div
          ref={scrollRef}
          className="grid grid-flow-col auto-cols-[190px] sm:auto-cols-[240px] md:auto-cols-[285px] gap-6 overflow-x-auto no-scrollbar py-2 px-1"
        >
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-2 animate-shimmer rounded-md aspect-[2/3] w-full" />
              ))
            : error
            ? <p className="text-xs text-gray-500 py-4">Unable to load media catalog</p>
            : items.map((item) => (
                <MovieCard
                  key={item.id}
                  item={item}
                  type={type}
                  availabilityState={availabilityMap[`${type}-${item.id}`]}
                />
              ))}
        </div>
      </div>
    </section>
  )
}

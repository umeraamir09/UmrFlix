"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { ContinueWatchingCard, ContinueWatchingItem } from "./ContinueWatchingCard"
import { ChevronLeft, ChevronRight } from "lucide-react"

type ApiContinueWatchingItem = {
  jellyfinItemId: string
  title: string
  episodeTitle?: string
  episodeNumber?: string
  imageUrl: string
  mediaType: "movie" | "tv"
  progressPercent: number
  timeLeft?: string
  providerIds: Record<string, string>
  isNextUp?: boolean
}
export function ContinueWatchingSection() {
  const [items, setItems] = useState<ContinueWatchingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/jellyfin/continue-watching")
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: { items: ApiContinueWatchingItem[] } = await res.json()

        const mapped: ContinueWatchingItem[] = data.items.map((item) => ({
          id: Number(item.providerIds.Tmdb) || 0,
          title: item.title,
          episodeTitle: item.episodeTitle,
          episodeNumber: item.episodeNumber,
          backdrop_path: null, // We use jellyfinImageUrl instead
          media_type: item.mediaType,
          progressPercent: item.progressPercent,
          timeLeft: item.timeLeft,
          jellyfinItemId: item.jellyfinItemId,
          jellyfinImageUrl: item.imageUrl,
          isNextUp: item.isNextUp,
        }))

        setItems(mapped)
      } catch (err) {
        console.error("Failed to fetch continue watching:", err)
        setItems([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleMarkWatched = (jellyfinItemId: string) => {
    setItems((prev) => prev.filter((item) => item.jellyfinItemId !== jellyfinItemId))
  }

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

  // Don't render anything if there's nothing to continue or still loading
  if (loading) {
    return (
      <section className="relative my-8 space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
            Continue Watching
          </h2>
        </div>
        <div className="relative w-[calc(100%+(100vw-100%)/2)] overflow-hidden">
          <div className="grid grid-flow-col auto-cols-[240px] sm:auto-cols-[280px] md:auto-cols-[320px] lg:auto-cols-[360px] gap-4 sm:gap-5 md:gap-6 overflow-x-hidden py-3 px-1">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="space-y-2 shrink-0">
                <div className="aspect-video w-full rounded-none bg-card animate-pulse border border-border/40" />
                <div className="space-y-1.5 pt-1">
                  <div className="h-3 w-1/2 bg-card animate-pulse" />
                  <div className="h-3.5 w-3/4 bg-card animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    )
  }

  // If no items, hide the section entirely
  if (items.length === 0) {
    return null
  }

  // Mobile (< sm) keeps the single-column list. Desktop always renders the
  // horizontal scrolling carousel track, which is a plain row when items
  // fit and scrolls once they exceed the visible width.
  const carousel = viewportWidth >= 640

  return (
    <section className="relative my-8 space-y-3 group/row">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
          Continue Watching
        </h2>
        <span className="text-xs font-bold uppercase tracking-wider text-accent hover:underline cursor-pointer">
          VIEW HISTORY &gt;
        </span>
      </div>

      {carousel ? (
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
            className="grid grid-flow-col auto-cols-[240px] sm:auto-cols-[280px] md:auto-cols-[320px] lg:auto-cols-[360px] gap-4 sm:gap-5 md:gap-6 overflow-x-auto no-scrollbar py-3 px-1 scroll-smooth pr-12 sm:pr-16 md:pr-24"
          >
            {items.map((item) => (
              <ContinueWatchingCard
                key={item.jellyfinItemId ?? item.id}
                item={item}
                onMarkWatched={handleMarkWatched}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:gap-4">
          {items.map((item) => (
            <ContinueWatchingCard
              key={item.jellyfinItemId ?? item.id}
              item={item}
              onMarkWatched={handleMarkWatched}
            />
          ))}
        </div>
      )}
    </section>
  )
}

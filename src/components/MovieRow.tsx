"use client"

import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import useSWR from "swr"
import { MovieCard, MovieCardItem } from "@/components/MovieCard"
import { MediaCardFlyout } from "@/components/MediaCardFlyout"
import { useBatchAvailability } from "@/lib/use-availability"
import { useBatchHorizontalPosters } from "@/lib/use-horizontal-posters"
import { filterDisplayableContent } from "@/lib/catalog"
import type { AvailabilityResult } from "@/app/api/availability/route"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { MoleculeBullets } from "@/components/ui/bullets"

const fetcher = (url: string) => fetch(url).then((r) => r.json())
const HOVER_CLOSE_DELAY_MS = 80

export function MovieRow({
  title,
  subtitle,
  type,
  endpoint,
  customItems,
  rowKey,
  isTop10 = false,
  cardVariant = "default",
}: {
  title: string
  subtitle?: string
  type: "movie" | "tv"
  endpoint?: string
  customItems?: MovieCardItem[]
  rowKey?: string
  isTop10?: boolean
  cardVariant?: "default" | "large"
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)
  const [activePageIndex, setActivePageIndex] = useState(0)

  const defaultEndpoint = `/api/tmdb/trending/${type}/week`
  const targetEndpoint = endpoint || defaultEndpoint

  const { data, error, isLoading, mutate } = useSWR(
    customItems ? null : targetEndpoint,
    fetcher
  )

  const items: MovieCardItem[] = useMemo(() => {
    const rawItems: MovieCardItem[] = customItems || (data?.results ?? [])
    return filterDisplayableContent(rawItems)
  }, [customItems, data])

  const getItemType = useCallback(
    (item: MovieCardItem): "movie" | "tv" =>
      item.media_type === "tv" || item.media_type === "movie" ? item.media_type : type,
    [type]
  )

  const itemRefs = useMemo(
    () => items.map((item) => ({ id: item.id, type: getItemType(item) })),
    [items, getItemType]
  )

  const availabilityRefs = useMemo(
    () =>
      items
        .filter((item) => !item.availabilityStatus)
        .map((item) => ({
          tmdbId: item.id,
          type: getItemType(item),
        })),
    [items, getItemType]
  )

  const { availabilityMap } = useBatchAvailability(availabilityRefs)
  const { posterMap } = useBatchHorizontalPosters(itemRefs)

  const availabilityFor = (item: MovieCardItem, itemType: "movie" | "tv"): AvailabilityResult | undefined =>
    (item.availabilityStatus as AvailabilityResult | undefined) ?? availabilityMap[`${itemType}-${item.id}`]

  const horizontalPosterFor = (item: MovieCardItem, itemType: "movie" | "tv"): string | null | undefined =>
    posterMap[`${itemType}-${item.id}`]

  // ── Hover Flyout State ──
  const [flyout, setFlyout] = useState<{ item: MovieCardItem; rect: DOMRect; rank?: number } | null>(null)
  const [open, setOpen] = useState(false)
  const anchorElRef = useRef<HTMLElement | null>(null)
  const enterTimerRef = useRef<number | null>(null)
  const leaveTimerRef = useRef<number | null>(null)
  const pendingRef = useRef<{ item: MovieCardItem; el: HTMLElement; rank?: number } | null>(null)

  const clearEnterTimer = () => {
    if (enterTimerRef.current !== null) {
      window.clearTimeout(enterTimerRef.current)
      enterTimerRef.current = null
    }
  }
  const clearLeaveTimer = () => {
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
  }

  const handleHoverEnter = useCallback(
    (item: MovieCardItem, el: HTMLElement, rank?: number) => {
      clearLeaveTimer()
      clearEnterTimer()
      anchorElRef.current = el
      setFlyout({ item, rect: el.getBoundingClientRect(), rank })
      setOpen(true)
    },
    []
  )

  const handleHoverLeave = useCallback(() => {
    clearEnterTimer()
    clearLeaveTimer()
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null
      pendingRef.current = null
      anchorElRef.current = null
      setOpen(false)
    }, HOVER_CLOSE_DELAY_MS)
  }, [])

  const handleFlyoutExited = useCallback(() => {
    setFlyout(null)
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending && pending.el.isConnected) {
      setFlyout({ item: pending.item, rect: pending.el.getBoundingClientRect(), rank: pending.rank })
      setOpen(true)
    }
  }, [])

  const [visibleItemIds, setVisibleItemIds] = useState<Set<number>>(() => new Set())

  const checkScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
      setCanScrollLeft(scrollLeft > 10)
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10)

      // Calculate active page bullet (4 pages max)
      const maxScroll = scrollWidth - clientWidth
      if (maxScroll > 0) {
        const ratio = scrollLeft / maxScroll
        const page = Math.min(3, Math.floor(ratio * 4))
        setActivePageIndex(page)
      }
    }
  }, [])

  const updateVisibleCards = useCallback(() => {
    // On mobile (< 768px), horizontal touch swiping is fluid without chevron bounds
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setVisibleItemIds(new Set())
      return
    }

    const container = scrollRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    // Give safe buffer inside container edges so partially cut-off edge cards near chevrons are out of view
    const leftBound = containerRect.left + 15
    const rightBound = containerRect.right - 55 // Leave room for right chevron scroll button

    const cardElements = container.querySelectorAll<HTMLElement>("[data-card-id]")
    const newVisible = new Set<number>()

    cardElements.forEach((el) => {
      const id = Number(el.getAttribute("data-card-id"))
      if (!id) return
      const rect = el.getBoundingClientRect()
      const visibleWidth = Math.min(rect.right, rightBound) - Math.max(rect.left, leftBound)
      if (visibleWidth / rect.width >= 0.75) {
        newVisible.add(id)
      }
    })

    setVisibleItemIds(newVisible)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    checkScroll()
    updateVisibleCards()

    const onScrollOrResize = () => {
      checkScroll()
      updateVisibleCards()
      clearEnterTimer()
      if (open) {
        setOpen(false)
      }
    }

    el.addEventListener("scroll", onScrollOrResize, { passive: true })
    window.addEventListener("resize", onScrollOrResize)
    return () => {
      el.removeEventListener("scroll", onScrollOrResize)
      window.removeEventListener("resize", onScrollOrResize)
    }
  }, [checkScroll, updateVisibleCards, items, open])

  // Dismiss flyout immediately on window scroll so page browsing is never blocked or out of sync
  useEffect(() => {
    if (!open) return
    const onWindowScroll = () => {
      clearEnterTimer()
      setOpen(false)
    }
    window.addEventListener("scroll", onWindowScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onWindowScroll)
    }
  }, [open])

  useEffect(() => {
    return () => {
      clearEnterTimer()
      clearLeaveTimer()
    }
  }, [])

  const scroll = (direction: "left" | "right") => {
    clearEnterTimer()
    if (open) setOpen(false)
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth * 0.75
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      })
    }
  }

  const handleCardClick = useCallback(() => {
    if (rowKey) {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/discovery/impression",
          new Blob([JSON.stringify({ rowCategoryKey: rowKey, clicked: true })], { type: "application/json" })
        )
      } else {
        void fetch("/api/discovery/impression", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowCategoryKey: rowKey, clicked: true }),
        }).catch(() => {})
      }
    }
  }, [rowKey])

  return (
    <section className="relative my-8 space-y-3 group/row">
      {/* ── Header with Title & Penpot Pagination Bullets (Frame 45 / Frame 46) ── */}
      <div className="flex items-end justify-between px-1">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-penpot-text-medium font-medium mt-0.5">{subtitle}</p>
          )}
        </div>

        {/* Pagination Bullets (molecule/bullets/4) */}
        <div className="hidden sm:flex items-center pb-1 pointer-events-none">
          <MoleculeBullets total={4} activeIndex={activePageIndex} />
        </div>
      </div>

      {/* ── Row Carousel Container (RowContent) ── */}
      <div className="relative w-full overflow-visible">
        {/* Left Navigation Button */}
        <div
          className={`absolute -left-2 sm:-left-4 top-0 bottom-0 z-30 pointer-events-none flex items-center justify-start transition-opacity duration-300 ${
            canScrollLeft ? "opacity-100" : "opacity-0"
          }`}
        >
          <button
            onClick={() => scroll("left")}
            className="pointer-events-auto rounded-[4px] bg-penpot-surface/90 hover:bg-penpot-primary-300 border border-penpot-border hover:border-penpot-primary-300 p-2.5 sm:p-3 text-white shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 group-hover/row:opacity-100 hidden sm:block focus:outline-none cursor-pointer"
            aria-label="Scroll left"
          >
            <ChevronLeft className="size-5 sm:size-6 stroke-[2.5]" />
          </button>
        </div>

        {/* Right Navigation Button */}
        <div
          className={`absolute -right-2 sm:-right-4 top-0 bottom-0 z-30 pointer-events-none flex items-center justify-end transition-opacity duration-300 ${
            canScrollRight ? "opacity-100" : "opacity-0"
          }`}
        >
          <button
            onClick={() => scroll("right")}
            className="pointer-events-auto rounded-[4px] bg-penpot-surface/90 hover:bg-penpot-primary-300 border border-penpot-border hover:border-penpot-primary-300 p-2.5 sm:p-3 text-white shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 group-hover/row:opacity-100 hidden sm:block focus:outline-none cursor-pointer"
            aria-label="Scroll right"
          >
            <ChevronRight className="size-5 sm:size-6 stroke-[2.5]" />
          </button>
        </div>

        {/* Scrollable Track with responsive gap */}
        <div
          ref={scrollRef}
          className={`grid grid-flow-col ${
            cardVariant === "large"
              ? "auto-cols-[130px] sm:auto-cols-[165px] md:auto-cols-[250px] lg:auto-cols-[285px] xl:auto-cols-[305px] 3xl:auto-cols-[330px]"
              : "auto-cols-[130px] sm:auto-cols-[165px] md:auto-cols-[340px] lg:auto-cols-[375px] 3xl:auto-cols-[410px]"
          } gap-3.5 sm:gap-4 md:gap-5 overflow-x-auto no-scrollbar py-3 px-1 scroll-smooth`}
        >
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className={`${
                    cardVariant === "large"
                      ? "aspect-[240/361]"
                      : "aspect-[240/361] md:aspect-[240/136]"
                  } w-full rounded-[8px] bg-penpot-surface/60 border border-penpot-border/40 animate-pulse`}
                />
              ))
            : error
            ? (
                <div className="flex items-center gap-3 py-4 px-2">
                  <p className="text-xs text-penpot-text-medium">Unable to load media catalog</p>
                  <button
                    onClick={() => mutate()}
                    className="rounded-[4px] border border-penpot-border bg-penpot-surface px-2.5 py-1 text-xs font-medium text-white hover:bg-penpot-neutral-500 active:scale-95 transition-all cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )
            : items.map((item, index) => {
                const itemType = getItemType(item)
                const rank = isTop10 || item.ranking ? (item.ranking ?? index + 1) : undefined
                const horizontalPoster = horizontalPosterFor(item, itemType)
                const isOutOfView = visibleItemIds.size > 0 && !visibleItemIds.has(item.id)
                return (
                  <div
                    key={item.id}
                    data-card-id={item.id}
                    onClick={handleCardClick}
                    className="h-full"
                  >
                    <MovieCard
                      item={item}
                      type={itemType}
                      ranking={rank}
                      cardVariant={cardVariant}
                      horizontalPosterPath={horizontalPoster}
                      availabilityState={availabilityFor(item, itemType)}
                      onHoverEnter={(el) => handleHoverEnter(item, el, rank)}
                      onHoverLeave={handleHoverLeave}
                      dimmed={open && flyout?.item.id === item.id}
                      disabled={isOutOfView}
                    />
                  </div>
                )
              })}
        </div>
      </div>

      {/* ── Portaled Hover Flyout Modal ── */}
      {flyout && typeof document !== "undefined" &&
        createPortal(
          <MediaCardFlyout
            key={flyout.item.id}
            item={{
              ...flyout.item,
              backdrop_path: horizontalPosterFor(flyout.item, getItemType(flyout.item)) || flyout.item.backdrop_path,
              ranking: flyout.rank,
            }}
            rect={flyout.rect}
            open={open}
            mediaType={getItemType(flyout.item)}
            cardVariant={cardVariant}
            availabilityState={availabilityFor(flyout.item, getItemType(flyout.item))}
            onExited={handleFlyoutExited}
            onMouseEnter={() => {
              clearLeaveTimer()
              clearEnterTimer()
              pendingRef.current = null
              setOpen(true)
            }}
            onMouseLeave={handleHoverLeave}
          />,
          document.body
        )}
    </section>
  )
}

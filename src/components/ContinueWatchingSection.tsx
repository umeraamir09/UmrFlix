"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import useSWR from "swr"
import {
  ContinueWatchingCard,
  ContinueWatchingItem,
} from "./ContinueWatchingCard"
import { MediaCardFlyout } from "@/components/MediaCardFlyout"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { MoleculeBullets } from "@/components/ui/bullets"

type ApiContinueWatchingItem = {
  jellyfinItemId: string
  title: string
  episodeTitle?: string
  episodeNumber?: string
  overview?: string
  imageUrl: string
  logoUrl?: string
  mediaType: "movie" | "tv"
  progressPercent: number
  timeLeft?: string
  providerIds: Record<string, string>
  isNextUp?: boolean
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())
const HOVER_CLOSE_DELAY_MS = 80

export function ContinueWatchingSection() {
  const [items, setItems] = useState<ContinueWatchingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)
  const [activePageIndex, setActivePageIndex] = useState(0)

  // ── Hover Flyout State ──
  const [flyout, setFlyout] = useState<{ item: ContinueWatchingItem; rect: DOMRect } | null>(null)
  const [open, setOpen] = useState(false)
  const anchorElRef = useRef<HTMLElement | null>(null)
  const enterTimerRef = useRef<number | null>(null)
  const leaveTimerRef = useRef<number | null>(null)
  const pendingRef = useRef<{ item: ContinueWatchingItem; el: HTMLElement } | null>(null)

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
    (item: ContinueWatchingItem, el: HTMLElement) => {
      clearLeaveTimer()
      clearEnterTimer()
      anchorElRef.current = el
      setFlyout({ item, rect: el.getBoundingClientRect() })
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
      setFlyout({ item: pending.item, rect: pending.el.getBoundingClientRect() })
      setOpen(true)
    }
  }, [])

  const { data: authData } = useSWR<{ authenticated?: boolean; user?: { username?: string } }>(
    "/api/auth/me",
    fetcher,
    { revalidateOnFocus: false }
  )
  const username = authData?.user?.username
  const headingText = username ? `Continue Watching for ${username}` : "Continue Watching"

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
          overview: item.overview,
          backdrop_path: null,
          media_type: item.mediaType,
          progressPercent: item.progressPercent,
          timeLeft: item.timeLeft,
          jellyfinItemId: item.jellyfinItemId,
          jellyfinImageUrl: item.imageUrl,
          jellyfinLogoUrl: item.logoUrl,
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

  const markWatched = async (item: ContinueWatchingItem) => {
    if (!item.jellyfinItemId || markingId) return
    setMarkingId(item.jellyfinItemId)
    try {
      const res = await fetch(`/api/jellyfin/played/${item.jellyfinItemId}`, { method: "POST" })
      if (!res.ok) throw new Error(`Mark watched failed: HTTP ${res.status}`)
      setItems((prev) => prev.filter((i) => i.jellyfinItemId !== item.jellyfinItemId))
      setFlyout((prev) => (prev && prev.item.jellyfinItemId === item.jellyfinItemId ? null : prev))
      setOpen(false)
    } catch {
      // Keep item on error
    } finally {
      setMarkingId(null)
    }
  }

  const [visibleItemKeys, setVisibleItemKeys] = useState<Set<string>>(() => new Set())

  const checkScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
      setCanScrollLeft(scrollLeft > 10)
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10)

      const maxScroll = scrollWidth - clientWidth
      if (maxScroll > 0) {
        const ratio = scrollLeft / maxScroll
        setActivePageIndex(ratio > 0.5 ? 1 : 0)
      }
    }
  }, [])

  const updateVisibleCards = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const leftBound = containerRect.left + 15
    const rightBound = containerRect.right - 55 // Space for right chevron

    const cardElements = container.querySelectorAll<HTMLElement>("[data-watching-key]")
    const newVisible = new Set<string>()

    cardElements.forEach((el) => {
      const key = el.getAttribute("data-watching-key")
      if (!key) return
      const rect = el.getBoundingClientRect()
      const visibleWidth = Math.min(rect.right, rightBound) - Math.max(rect.left, leftBound)
      if (visibleWidth / rect.width >= 0.75) {
        newVisible.add(key)
      }
    })

    setVisibleItemKeys(newVisible)
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

  // ── Penpot Skeleton Loader (carousel/horizontal/movies-watching) ──
  if (loading) {
    return (
      <section className="relative my-8 space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            {headingText}
          </h2>
        </div>
        <div className="relative w-[calc(100%+(100vw-100%)/2)] overflow-hidden">
          <div className="grid grid-flow-col auto-cols-[270px] sm:auto-cols-[290px] md:auto-cols-[320px] lg:auto-cols-[350px] gap-5 overflow-x-hidden py-3 px-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[240/136] w-full rounded-[8px] bg-penpot-surface/60 border border-penpot-border/40 animate-pulse"
              />
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (items.length === 0) {
    return null
  }

  const carousel = viewportWidth >= 640

  return (
    <section className="relative my-8 space-y-3 group/row">
      {/* ── Header with 2-bullet pagination (molecule/bullets/2) ── */}
      <div className="flex items-end justify-between px-1">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          {headingText}
        </h2>

        {/* Bullets (molecule/bullets/2) */}
        <div className="hidden sm:flex items-center pb-1 pointer-events-none">
          <MoleculeBullets total={2} activeIndex={activePageIndex} />
        </div>
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
              className="pointer-events-auto rounded-[4px] bg-penpot-surface/90 hover:bg-penpot-primary-300 border border-penpot-border hover:border-penpot-primary-300 p-2.5 sm:p-3 text-white shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 group-hover/row:opacity-100 hidden sm:block focus:outline-none cursor-pointer"
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
              className="pointer-events-auto rounded-[4px] bg-penpot-surface/90 hover:bg-penpot-primary-300 border border-penpot-border hover:border-penpot-primary-300 p-2.5 sm:p-3 text-white shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 group-hover/row:opacity-100 hidden sm:block focus:outline-none cursor-pointer"
              aria-label="Scroll right"
            >
              <ChevronRight className="size-5 sm:size-6 stroke-[2.5]" />
            </button>
          </div>

          {/* Scrollable Track (20px gap) */}
          <div
            ref={scrollRef}
            className="grid grid-flow-col auto-cols-[280px] sm:auto-cols-[310px] md:auto-cols-[340px] lg:auto-cols-[375px] gap-5 overflow-x-auto no-scrollbar py-3 px-1 scroll-smooth pr-12 sm:pr-16 md:pr-24"
          >
            {items.map((item) => {
              const itemKey = item.jellyfinItemId ?? String(item.id)
              const isOutOfView = visibleItemKeys.size > 0 && !visibleItemKeys.has(itemKey)
              return (
                <div key={itemKey} data-watching-key={itemKey} className="h-full">
                  <ContinueWatchingCard
                    item={item}
                    onHoverEnter={(el) => handleHoverEnter(item, el)}
                    onHoverLeave={handleHoverLeave}
                    onMarkWatched={() => markWatched(item)}
                    marking={markingId === item.jellyfinItemId}
                    dimmed={open && flyout?.item === item}
                    disabled={isOutOfView}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {items.map((item) => (
            <ContinueWatchingCard
              key={item.jellyfinItemId ?? item.id}
              item={item}
              onHoverEnter={(el) => handleHoverEnter(item, el)}
              onHoverLeave={handleHoverLeave}
              onMarkWatched={() => markWatched(item)}
              marking={markingId === item.jellyfinItemId}
              dimmed={open && flyout?.item === item}
            />
          ))}
        </div>
      )}

      {/* ── Portaled Hover Flyout Modal ── */}
      {flyout && typeof document !== "undefined" &&
        createPortal(
          <MediaCardFlyout
            key={flyout.item.jellyfinItemId ?? flyout.item.id}
            item={{
              ...flyout.item,
              media_type: flyout.item.media_type,
            }}
            rect={flyout.rect}
            open={open}
            mediaType={flyout.item.media_type}
            onExited={handleFlyoutExited}
            onMarkWatched={() => markWatched(flyout.item)}
            marking={markingId === flyout.item.jellyfinItemId}
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

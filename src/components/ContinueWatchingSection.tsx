"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import Image from "next/image"
import useSWR from "swr"
import {
  ContinueWatchingCard,
  ContinueWatchingItem,
  getContinueWatchingMedia,
} from "./ContinueWatchingCard"
import { IconPlay } from "@/components/ui/icons"
import { Check, Loader2, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"

type ApiContinueWatchingItem = {
  jellyfinItemId: string
  title: string
  episodeTitle?: string
  episodeNumber?: string
  overview?: string
  imageUrl: string
  mediaType: "movie" | "tv"
  progressPercent: number
  timeLeft?: string
  providerIds: Record<string, string>
  isNextUp?: boolean
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const HOVER_OPEN_DELAY_MS = 0
const HOVER_CLOSE_DELAY_MS = 0
/** Must match the exit transform duration + delay on the flyout (exit uses duration-200). */
const FLYOUT_EXIT_MS = 100

export function ContinueWatchingSection() {
  const [items, setItems] = useState<ContinueWatchingItem[]>([])
  const [loading, setLoading] = useState(true)
  /** jellyfinItemId currently being marked as watched (shared by base card + flyout). */
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  // ── Hover flyout state ──
  // `flyout` = mounted content (kept alive through the exit animation),
  // `open`   = visible/target state (false plays the exit, then unmounts)
  const [flyout, setFlyout] = useState<{ item: ContinueWatchingItem; rect: DOMRect } | null>(null)
  const [open, setOpen] = useState(false)
  const anchorElRef = useRef<HTMLElement | null>(null)
  const enterTimerRef = useRef<number | null>(null)
  const leaveTimerRef = useRef<number | null>(null)
  /** Next card to open once the current flyout finishes its exit animation (card-to-card switch). */
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

  const closeHover = useCallback(() => {
    clearEnterTimer()
    clearLeaveTimer()
    pendingRef.current = null
    anchorElRef.current = null
    setOpen(false)
  }, [])

  const handleHoverEnter = useCallback(
    (item: ContinueWatchingItem, el: HTMLElement) => {
      clearLeaveTimer()
      clearEnterTimer()
      anchorElRef.current = el
      if (flyout) {
        if (flyout.item === item) {
          // Same card (incl. re-hovering mid-exit): stay/reopen, no restart
          pendingRef.current = null
          setOpen(true)
        } else {
          // Different card: close the current flyout with its animation first;
          // the new card mounts & grows in handleFlyoutExited — never teleports.
          pendingRef.current = { item, el }
          setOpen(false)
        }
        return
      }
      enterTimerRef.current = window.setTimeout(() => {
        enterTimerRef.current = null
        setFlyout({ item, rect: el.getBoundingClientRect() })
        setOpen(true)
      }, HOVER_OPEN_DELAY_MS)
    },
    [flyout]
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

  // Unmount only after the flyout's exit transition has fully played.
  // If the cursor already moved to another card, open that one next (with its own grow animation).
  const handleFlyoutExited = useCallback(() => {
    setFlyout(null)
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending && pending.el.isConnected) {
      setFlyout({ item: pending.item, rect: pending.el.getBoundingClientRect() })
      setOpen(true)
    }
  }, [])

  // Fetch logged-in user to show "Continue Watching for [Name]"
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
      setFlyout((prev) =>
        prev && prev.item.jellyfinItemId === item.jellyfinItemId ? null : prev
      )
      setOpen(false)
    } catch {
      // Keep the item so the user can retry.
    } finally {
      setMarkingId(null)
    }
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

  // While the flyout is open, keep it glued to its anchor card:
  // re-measure on any scroll (capture catches the row's own horizontal scroller) or resize.
  useEffect(() => {
    if (!open) return
    let raf = 0
    const update = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const anchor = anchorElRef.current
        if (!anchor) return
        setFlyout((prev) => (prev ? { ...prev, rect: anchor.getBoundingClientRect() } : prev))
      })
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeHover()
    }
    window.addEventListener("scroll", update, { capture: true, passive: true })
    window.addEventListener("resize", update, { passive: true })
    window.addEventListener("keydown", onKeyDown)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [open, closeHover])

  // Clear pending hover timers on unmount
  useEffect(() => {
    return () => {
      clearEnterTimer()
      clearLeaveTimer()
    }
  }, [])

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth * 0.75
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      })
    }
  }

  // Redesigned Loading Skeleton (Matching user's Image 3 & 4)
  if (loading) {
    return (
      <section className="relative my-8 space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            {headingText}
          </h2>
        </div>
        <div className="relative w-[calc(100%+(100vw-100%)/2)] overflow-hidden">
          <div className="grid grid-flow-col auto-cols-[240px] sm:auto-cols-[280px] md:auto-cols-[320px] lg:auto-cols-[360px] gap-4 sm:gap-5 md:gap-6 overflow-x-hidden py-3 px-1">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex flex-col shrink-0">
                {/* 16:9 Skeleton Card */}
                <div className="aspect-video w-full rounded-[4px] bg-grey-700 animate-pulse border border-grey-600/40" />
                {/* Standalone Progress Bar Skeleton Below Card (Matching Image 3 & 4) */}
                <div className="mt-2 w-[85%] mx-auto h-[3px] bg-grey-400 rounded-full overflow-hidden flex">
                  <div className="h-full bg-accent w-[60%] rounded-full animate-pulse" />
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

  const carousel = viewportWidth >= 640

  return (
    <section className="relative my-8 space-y-3 group/row">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          {headingText}
        </h2>
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
              className="pointer-events-auto rounded-[4px] bg-grey-900/90 hover:bg-accent border border-grey-600 hover:border-accent p-2.5 sm:p-3 text-white shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 group-hover/row:opacity-100 hidden sm:block focus:outline-none cursor-pointer"
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
              className="pointer-events-auto rounded-[4px] bg-grey-900/90 hover:bg-accent border border-grey-600 hover:border-accent p-2.5 sm:p-3 text-white shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 group-hover/row:opacity-100 hidden sm:block focus:outline-none cursor-pointer"
              aria-label="Scroll right"
            >
              <ChevronRight className="size-5 sm:size-6 stroke-[2.5]" />
            </button>
          </div>

          {/* Scrollable Cards Track — pure in-flow content, so overflow-x-auto can never gain vertical scroll */}
          <div
            ref={scrollRef}
            className="grid grid-flow-col auto-cols-[240px] sm:auto-cols-[280px] md:auto-cols-[320px] lg:auto-cols-[360px] gap-4 sm:gap-5 md:gap-6 overflow-x-auto no-scrollbar py-3 px-1 scroll-smooth pr-12 sm:pr-16 md:pr-24"
          >
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
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:gap-4">
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

      {/* ── Expanded Hover Flyout (portaled to <body>: no clipping, no internal scroll, any content height) ── */}
      {flyout &&
        createPortal(
          // key: switching cards remounts the flyout, so the new card always
          // plays its own grow animation instead of inheriting the old one's state
          <ContinueWatchingFlyout
            key={flyout.item.jellyfinItemId ?? flyout.item.id}
            item={flyout.item}
            rect={flyout.rect}
            open={open}
            onExited={handleFlyoutExited}
            onMarkWatched={() => markWatched(flyout.item)}
            marking={markingId === flyout.item.jellyfinItemId}
            onMouseEnter={() => {
              clearLeaveTimer()
              clearEnterTimer()
              // Re-entering the flyout itself (even mid-exit) keeps/open it
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

/**
 * Expanded hover card. Rendered once via portal, anchored to the hovered base card's rect.
 *
 * Smoothness comes from a FLIP takeover instead of a plain fade:
 * - On open it first paints with a transform that makes it EXACTLY overlap the base card
 *   (translate + scale computed from base rect → expanded rect), then transitions to identity,
 *   so it reads as the card itself growing. The base card crossfades out underneath.
 * - On close it plays the same motion in reverse and only unmounts after the transition,
 *   so it never snaps away abruptly.
 */
function ContinueWatchingFlyout({
  item,
  rect,
  open,
  onExited,
  onMarkWatched,
  marking,
  onMouseEnter,
  onMouseLeave,
}: {
  item: ContinueWatchingItem
  rect: { top: number; left: number; width: number }
  open: boolean
  onExited?: () => void
  onMarkWatched?: () => void
  /** True while the mark-as-watched request for this item is pending. */
  marking?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  const [entered, setEntered] = useState(false)

  // Enter: paint one frame in the "covering" transform, then flip to identity.
  // Exit: play the reverse transform, then tell the parent to unmount us.
  useEffect(() => {
    let raf1 = 0
    let raf2 = 0
    let timer = 0
    if (open) {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setEntered(true))
      })
    } else {
      raf1 = requestAnimationFrame(() => setEntered(false))
      timer = window.setTimeout(() => onExited?.(), FLYOUT_EXIT_MS)
    }
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.clearTimeout(timer)
    }
  }, [open, onExited])

  const { playHref, detailHref, backdropUrl, displayEpisodeInfo } = getContinueWatchingMedia(item)

  // Expanded geometry: 12px beyond the base card on every side, clamped inside the viewport
  const EXPAND = 12
  const width = rect.width + EXPAND * 2
  const maxLeft = Math.max(8, window.innerWidth - width - 8)
  const left = Math.max(8, Math.min(rect.left - EXPAND, maxLeft))
  const top = rect.top - EXPAND

  // FLIP: transform that maps the expanded card back onto the base card exactly
  const baseCx = rect.left + rect.width / 2
  const expandCx = left + width / 2
  const coverTransform = `translate3d(${baseCx - expandCx}px, ${rect.top - top}px, 0) scale(${
    rect.width / width
  })`

  return (
    <div
      className="fixed z-[100]"
      style={{ top, left, width }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className={`flex flex-col overflow-hidden rounded-[6px] border border-grey-600 bg-grey-900 shadow-[0_20px_50px_rgba(0,0,0,0.9)] transition-transform ${
          entered ? "duration-[250ms]" : "duration-200"
        }`}
        style={{
          transform: entered ? "translate3d(0px, 0px, 0px) scale(1)" : coverTransform,
          transformOrigin: "top center",
          transitionTimingFunction: entered
            ? "cubic-bezier(0.16, 1, 0.3, 1)" // easeOutExpo — settles gently
            : "cubic-bezier(0.4, 0, 1, 1)", // ease-in — picks up speed leaving
        }}
      >
        {/* 16:9 Thumbnail Header */}
        <div className="relative aspect-video w-full overflow-hidden bg-grey-850">
          <Image
            src={backdropUrl}
            alt={item.title}
            fill
            priority
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 320px"
            className="object-cover"
            unoptimized
          />

          {/* NEXT UP Badge */}
          {item.isNextUp && (
            <div className="absolute top-2 left-2 z-10 rounded-[3px] bg-accent px-2 py-0.5 text-[10px] font-bold text-white shadow uppercase tracking-wide">
              Next Up
            </div>
          )}

          {/* Time Remaining Badge */}
          {item.timeLeft && !item.isNextUp && (
            <div className="absolute top-2 right-2 z-10 rounded-[3px] bg-black/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
              {item.timeLeft}
            </div>
          )}

          {/* Bottom Embedded Red Progress Bar */}
          {!item.isNextUp && (
            <div className="absolute bottom-0 inset-x-0 h-1 bg-grey-400">
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.min(100, Math.max(0, item.progressPercent))}%` }}
              />
            </div>
          )}
        </div>

        {/* Expanded Card Body — fades in after the growth starts, out before the shrink ends */}
        <div
          className={`p-3.5 space-y-3 bg-grey-900 transition-opacity ${
            entered ? "opacity-100 duration-150 delay-75 ease-out" : "opacity-0 duration-100 ease-in"
          }`}
        >
          {/* Action Buttons Row */}
          <div className="flex items-center gap-2.5">
            {/* Play Button */}
            <Link
              href={playHref}
              className="flex size-9 items-center justify-center rounded-full bg-white text-black hover:bg-grey-10 active:bg-grey-20 transition-all shadow-md active:scale-95 cursor-pointer"
              title={item.media_type === "tv" ? "Play Episode" : "Play"}
            >
              <IconPlay className="size-4 fill-black text-black ml-0.5" />
            </Link>

            {/* Mark Watched Button */}
            {item.jellyfinItemId && (
              <button
                onClick={onMarkWatched}
                disabled={marking}
                title="Mark as watched"
                className="flex size-9 items-center justify-center rounded-full bg-grey-750 border border-grey-400 hover:border-white text-white transition-all cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {marking ? (
                  <Loader2 className="size-4 animate-spin text-grey-100" />
                ) : (
                  <Check className="size-4 stroke-[2.5]" />
                )}
              </button>
            )}

            {/* Details Chevron Button */}
            <Link
              href={detailHref}
              className="ml-auto flex size-9 items-center justify-center rounded-full bg-grey-750 border border-grey-400 hover:border-white text-white transition-all active:scale-95 cursor-pointer"
              title="More Details"
            >
              <ChevronDown className="size-4" />
            </Link>
          </div>

          {/* Title, Season No., Episode No. & Episode Name */}
          <div className="space-y-0.5">
            <h4 className="text-sm font-bold text-white leading-tight line-clamp-1">
              {item.title}
            </h4>
            {displayEpisodeInfo && (
              <p className="text-xs font-semibold text-accent line-clamp-1">
                {displayEpisodeInfo}
              </p>
            )}
          </div>

          {/* Overview & Synopsis Paragraph */}
          <p className="text-xs text-grey-100 line-clamp-3 leading-relaxed font-normal">
            {item.overview || "This is the overview and synopsis of that particular episode"}
          </p>
        </div>
      </div>
    </div>
  )
}

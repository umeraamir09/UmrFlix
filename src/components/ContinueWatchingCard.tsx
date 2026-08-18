"use client"

import Link from "next/link"
import Image from "next/image"
import { useRef, useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { Check, Loader2, MoreVertical, Info } from "lucide-react"

export interface ContinueWatchingItem {
  id: number
  title: string
  episodeTitle?: string
  episodeNumber?: string
  overview?: string
  backdrop_path: string | null
  poster_path?: string | null
  media_type: "movie" | "tv"
  progressPercent: number
  timeLeft?: string
  jellyfinItemId?: string
  jellyfinImageUrl?: string
  jellyfinPrimaryUrl?: string
  jellyfinLogoUrl?: string
  isNextUp?: boolean
}

/** Shared hrefs/labels used by both the base card and the hover flyout. */
export function getContinueWatchingMedia(item: ContinueWatchingItem) {
  const playHref = item.jellyfinItemId
    ? `/watch?id=${item.jellyfinItemId}`
    : item.id
    ? `/${item.media_type}/${item.id}`
    : "#"

  const detailHref = item.id ? `/${item.media_type}/${item.id}` : playHref

  // PREFER TMDB official poster first so mobile 2:3 vertical cards match normal catalog cards
  const posterUrl = item.poster_path
    ? (item.poster_path.startsWith("http") ? item.poster_path : `https://image.tmdb.org/t/p/w780${item.poster_path}`)
    : (item.jellyfinPrimaryUrl ||
       (item.backdrop_path
         ? (item.backdrop_path.startsWith("http") ? item.backdrop_path : `https://image.tmdb.org/t/p/w780${item.backdrop_path}`)
         : item.jellyfinImageUrl || "/placeholder-poster.svg"))

  // PREFER TMDB 16:9 English backdrop first on desktop
  const backdropUrl = item.backdrop_path
    ? (item.backdrop_path.startsWith("http") ? item.backdrop_path : `https://image.tmdb.org/t/p/w780${item.backdrop_path}`)
    : (item.jellyfinImageUrl || posterUrl)

  const logoUrl = item.jellyfinLogoUrl || null

  const displayEpisodeInfo = item.episodeNumber
    ? `${item.episodeNumber}${item.episodeTitle ? ` - ${item.episodeTitle}` : ""}`
    : item.episodeTitle || ""

  return { playHref, detailHref, posterUrl, backdropUrl, logoUrl, displayEpisodeInfo }
}

export function ContinueWatchingCard({
  item,
  onHoverEnter,
  onHoverLeave,
  onMarkWatched,
  marking,
  dimmed,
  disabled = false,
}: {
  item: ContinueWatchingItem
  onHoverEnter?: (el: HTMLElement) => void
  onHoverLeave?: () => void
  onMarkWatched?: () => void
  /** Shows the in-flight spinner while the mark-as-watched request is pending. */
  marking?: boolean
  /** Fades the base card out while the (portaled) flyout takes over its exact position. */
  dimmed?: boolean
  disabled?: boolean
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null)
  const { playHref, detailHref, posterUrl, backdropUrl, displayEpisodeInfo } = getContinueWatchingMedia(item)

  // Toggle mobile popover menu with viewport-clamped positioning
  const handleToggleMobileMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (mobileMenuOpen) {
      setMobileMenuOpen(false)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const menuWidth = 176
    const menuHeight = 92

    // Clamp horizontally within viewport (8px safe margin)
    let left = rect.right - menuWidth
    if (left < 8) left = 8
    if (typeof window !== "undefined" && left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8)
    }

    // Position vertically above the button by default, or below if near viewport top
    let top = rect.top - menuHeight - 6
    if (top < 10) {
      top = rect.bottom + 6
    }

    setMenuCoords({ top, left })
    setMobileMenuOpen(true)
  }

  // Close mobile popover menu on outside click, scroll, resize or escape key
  useEffect(() => {
    if (!mobileMenuOpen) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setMobileMenuOpen(false)
      }
    }
    const handleClose = () => setMobileMenuOpen(false)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false)
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("touchstart", handleClickOutside, { passive: true })
    window.addEventListener("scroll", handleClose, { passive: true })
    window.addEventListener("resize", handleClose)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("touchstart", handleClickOutside)
      window.removeEventListener("scroll", handleClose)
      window.removeEventListener("resize", handleClose)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [mobileMenuOpen])

  // Hover flyout only makes sense on devices with a real pointer
  const hoverCapable = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches

  return (
    <div
      ref={cardRef}
      data-testid="movie-card"
      className={`group relative block w-full shrink-0 transition-all duration-300 ease-out ${
        disabled
          ? "cursor-pointer md:cursor-default opacity-100 md:opacity-40 pointer-events-auto md:pointer-events-none"
          : "cursor-pointer opacity-100"
      } ${dimmed ? "opacity-0" : ""}`}
      onMouseEnter={() => {
        if (!disabled && hoverCapable() && cardRef.current) onHoverEnter?.(cardRef.current)
      }}
      onMouseLeave={() => {
        if (!disabled && hoverCapable()) onHoverLeave?.()
      }}
    >
      {/* ── Base Continue Watching Card (Vertical 2:3 on mobile, 16:9 on desktop) ── */}
      <div className="relative aspect-[240/361] md:aspect-[240/136] w-full overflow-hidden rounded-[8px] bg-penpot-surface border border-penpot-border shadow-md transition-transform duration-200 group-hover:scale-[1.03] group-hover:border-penpot-primary-300/50">
        <Link
          href={playHref}
          aria-label={`Play ${item.title}`}
          className={`absolute inset-0 z-0 cursor-pointer block touch-manipulation ${disabled ? "md:pointer-events-none" : ""}`}
        >
          {/* Mobile Image: Vertical poster */}
          <Image
            src={posterUrl}
            alt={item.title}
            fill
            sizes="(max-width: 768px) 180px, 320px"
            className="block md:hidden object-cover transition-transform duration-300"
            unoptimized={posterUrl.startsWith("/api/")}
          />

          {/* Desktop Image: Horizontal backdrop */}
          <Image
            src={backdropUrl}
            alt={item.title}
            fill
            sizes="(max-width: 1024px) 400px, 500px"
            className="hidden md:block object-cover transition-transform duration-300"
            unoptimized={backdropUrl.startsWith("/api/")}
          />

          {/* Bottom Gradient Overlay (overlay) */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent pointer-events-none" />

          {/* Top Badges */}
          <div className="absolute top-2 sm:top-2.5 inset-x-2 sm:inset-x-2.5 z-10 flex items-center justify-between pointer-events-none">
            {/* NEXT UP Badge */}
            {item.isNextUp && (
              <div className="rounded-[4px] bg-penpot-primary-300 px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-bold text-white shadow uppercase tracking-wider">
                Next Up
              </div>
            )}

            {/* Time Remaining Badge */}
            {item.timeLeft && !item.isNextUp && (
              <div className="ml-auto rounded-[4px] bg-black/70 px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-medium text-white backdrop-blur-sm">
                {item.timeLeft}
              </div>
            )}
          </div>

          {/* Title and Episode Details (Details) */}
          <div className="absolute bottom-3.5 sm:bottom-4.5 left-2.5 sm:left-3 right-9 sm:right-11 z-10 space-y-0.5 pointer-events-none">
            <h4 className="text-xs sm:text-sm font-bold text-white leading-tight truncate">
              {item.title}
            </h4>
            {displayEpisodeInfo && (
              <p className="text-[10px] sm:text-xs font-medium text-penpot-text-medium truncate">
                {displayEpisodeInfo}
              </p>
            )}
          </div>

          {/* Progress Bar (Penpot progress: height 4-5px, track bg-white/50, fill #02E7F5 cyan, inset-x-2.5 bottom-1.5) */}
          {!item.isNextUp && (
            <div className="absolute bottom-1.5 sm:bottom-2 inset-x-2 sm:inset-x-3 z-10 h-1 sm:h-[5px] rounded-full bg-white/50 overflow-hidden pointer-events-none">
              <div
                className="h-full bg-penpot-primary-100 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, item.progressPercent))}%` }}
              />
            </div>
          )}
        </Link>

        {/* ── Mobile Vertical Ellipsis Menu Trigger ── */}
        <div ref={menuRef} className="md:hidden absolute bottom-2 right-1 z-20">
          <button
            type="button"
            onClick={handleToggleMobileMenu}
            aria-label={`Options for ${item.title}`}
            aria-expanded={mobileMenuOpen}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-white/90 active:text-white transition-all active:scale-95 cursor-pointer touch-manipulation select-none"
          >
            <div className="flex size-7 items-center justify-center rounded-full border border-white/20 bg-black/60 backdrop-blur-md shadow-md">
              <MoreVertical className="size-3.5 text-white" />
            </div>
          </button>
        </div>

        {/* ── Desktop Hover Direct Mark Watched Button (Visible ONLY on Hover) ── */}
        {item.jellyfinItemId && (
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onMarkWatched?.()
            }}
            disabled={marking}
            title="Mark as watched"
            aria-label={`Mark ${item.title} as watched`}
            className="hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity duration-200 absolute bottom-3.5 right-2.5 z-20 size-7 items-center justify-center rounded-full text-white hover:scale-110 active:scale-95 disabled:opacity-50 cursor-pointer select-none"
          >
            <div className="flex size-7 items-center justify-center rounded-full border border-white/30 bg-black/60 backdrop-blur-sm hover:bg-black/80">
              {marking ? (
                <Loader2 className="size-3.5 animate-spin text-white" />
              ) : (
                <Check className="size-3.5 stroke-[2.5] text-white" />
              )}
            </div>
          </button>
        )}
      </div>

      {/* ── Unclipped Mobile Menu Popover (Portaled to document.body) ── */}
      {mobileMenuOpen && menuCoords && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          style={{ top: `${menuCoords.top}px`, left: `${menuCoords.left}px` }}
          className="fixed z-[9999] w-44 rounded-md bg-penpot-neutral-700/98 border border-penpot-border p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 flex flex-col gap-1 overscroll-contain"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mark as Watched Option */}
          {item.jellyfinItemId && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMobileMenuOpen(false)
                onMarkWatched?.()
              }}
              disabled={marking}
              className="w-full min-h-10 flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-white hover:bg-penpot-surface active:bg-penpot-surface rounded transition-colors text-left touch-manipulation select-none cursor-pointer"
            >
              {marking ? (
                <Loader2 className="size-4 animate-spin text-penpot-primary-100" />
              ) : (
                <Check className="size-4 text-penpot-primary-100 stroke-[2.5]" />
              )}
              <span>Mark as Watched</span>
            </button>
          )}

          {/* View Details Option */}
          <Link
            href={detailHref}
            onClick={() => setMobileMenuOpen(false)}
            className="w-full min-h-10 flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-penpot-text-medium hover:text-white hover:bg-penpot-surface active:bg-penpot-surface rounded transition-colors text-left touch-manipulation select-none cursor-pointer"
          >
            <Info className="size-4 text-penpot-text-subtle" />
            <span>View Details</span>
          </Link>
        </div>,
        document.body
      )}
    </div>
  )
}

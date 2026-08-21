"use client"

import { useState, useEffect, useCallback } from "react"
import Image from "next/image"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Play, Plus, Info, Loader2, Clock } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { RequestModal } from "@/components/RequestModal"
import { useAvailability } from "@/lib/use-availability"
import { useToast } from "@/components/Toast"

export interface BillboardItem {
  id: number
  title: string
  overview: string
  backdrop_path: string | null
  poster_path: string | null
  media_type: "movie" | "tv"
  genres?: string[]
  vote_average?: number
  release_date?: string
  inLibrary?: boolean
  jellyfinItemId?: string
  logo_path?: string | null
}

export function HeroBillboard({ items }: { items: BillboardItem[] }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [direction, setDirection] = useState<"next" | "prev">("next")
  const [requestTargetItem, setRequestTargetItem] = useState<BillboardItem | null>(null)
  const { toast } = useToast()

  const activeItem = items[currentIndex] || items[0]

  // Live availability lookup for active item
  const { availability, refresh: refreshAvailability } = useAvailability(
    activeItem ? { tmdbId: activeItem.id, type: activeItem.media_type } : null
  )

  const nextSlide = useCallback(() => {
    setDirection("next")
    setCurrentIndex((prev) => (prev + 1) % items.length)
  }, [items.length])

  const prevSlide = useCallback(() => {
    setDirection("prev")
    setCurrentIndex((prev) => (prev - 1 + items.length) % items.length)
  }, [items.length])

  const handleIndicatorClick = (idx: number) => {
    if (idx === currentIndex) return
    setDirection(idx > currentIndex ? "next" : "prev")
    setCurrentIndex(idx)
  }

  // Auto-advance slides every 8s, paused while a request modal is open
  useEffect(() => {
    if (items.length <= 1 || requestTargetItem !== null) return
    const timer = setInterval(() => {
      nextSlide()
    }, 8000)
    return () => clearInterval(timer)
  }, [items.length, nextSlide, requestTargetItem])

  if (!activeItem) return null

  const backdropUrl = activeItem.backdrop_path
    ? `https://image.tmdb.org/t/p/w1280${activeItem.backdrop_path}`
    : "https://image.tmdb.org/t/p/w1280/muth4OYamv31pG2LX2jU2u2vY1n.jpg"

  const title = activeItem.title || "Featured Title"

  const playItemId =
    (availability?.status === "in_library" && availability.jellyfinItemId)
      ? availability.jellyfinItemId
      : (activeItem.inLibrary && activeItem.jellyfinItemId)
        ? activeItem.jellyfinItemId
        : null

  const isAvailable = Boolean(playItemId)

  const detailsUrl = `/${activeItem.media_type}/${activeItem.id}`

  const handleRequestSuccess = () => {
    if (requestTargetItem) {
      toast(`${requestTargetItem.title} request submitted successfully!`, "success")
    }
    setRequestTargetItem(null)
    refreshAvailability()
  }

  return (
    <div
      data-testid="hero-billboard"
      className="relative w-full h-[75dvh] min-h-[520px] sm:h-[80dvh] sm:min-h-[640px] md:h-[88dvh] md:min-h-[750px] lg:h-[980px] overflow-hidden bg-penpot-bg group"
    >
      {/* Background Image with Swiping & Subtle Zoom Animation */}
      <div className="absolute inset-0 overflow-hidden">
        <Image
          key={`${currentIndex}-${direction}`}
          src={backdropUrl}
          alt={title}
          fill
          priority
          sizes="100vw"
          className={`object-cover object-center ${
            direction === "next" ? "animate-backdrop-right" : "animate-backdrop-left"
          }`}
        />

        {/* Penpot Dark Vignette Gradients */}
        {/* Bottom vertical fade into penpot background */}
        <div className="absolute inset-0 bg-gradient-to-t from-penpot-bg via-penpot-bg/80 to-transparent" />
        {/* Left directional dark fade for high text readability */}
        <div className="absolute inset-0 bg-gradient-to-r from-penpot-bg via-penpot-bg/75 to-transparent w-full md:w-3/4" />
        {/* Top shadow gradient for navbar header separation */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/30 to-transparent h-28 sm:h-36 pointer-events-none" />
      </div>

      {/* Hero Content Container with Swiping Text Animation */}
      <div className="relative z-10 mx-auto flex h-full max-w-[1600px] items-center px-4 sm:px-6 md:px-10 lg:px-14 pb-28 sm:pb-36 md:pb-44">
        <div
          key={`${currentIndex}-${direction}`}
          className={`w-full max-w-2xl md:max-w-3xl space-y-4 sm:space-y-6 pt-12 ${
            direction === "next" ? "animate-slide-in-right" : "animate-slide-in-left"
          }`}
        >
          {/* Title Logo Image or Fallback Title Text */}
          {activeItem.logo_path ? (
            <div className="relative h-20 sm:h-28 md:h-36 lg:h-44 w-64 sm:w-80 md:w-[440px] lg:w-[480px] my-2 drop-shadow-2xl">
              <Image
                src={activeItem.logo_path}
                alt={title}
                fill
                sizes="(max-width: 768px) 320px, 480px"
                className="object-contain object-left drop-shadow-2xl"
              />
            </div>
          ) : (
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-black uppercase tracking-tight text-penpot-text-high leading-tight drop-shadow-lg font-sans">
              {title}
            </h1>
          )}

          {/* Synopsis */}
          <p className="text-sm sm:text-base md:text-[18px] lg:text-[20px] text-penpot-text-high font-normal leading-relaxed max-w-2xl line-clamp-3 md:line-clamp-4 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
            {activeItem.overview}
          </p>

          {/* Action CTAs: Reusable Penpot Button components */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-3.5 pt-2 w-full sm:w-auto">
            {isAvailable ? (
              <Link
                data-testid="hero-action"
                href={
                  playItemId
                    ? `/watch?id=${playItemId}${activeItem.media_type === "tv" ? "&type=tv" : ""}`
                    : detailsUrl
                }
                className={buttonVariants({ variant: "play", size: "md", className: "w-full sm:w-auto" })}
              >
                <Play className="size-4.5 fill-current mr-2" />
                Play
              </Link>
            ) : availability?.status === "downloading" ? (
              <Button
                data-testid="hero-action"
                variant="muted"
                size="md"
                disabled
                className="w-full sm:w-auto"
              >
                <Loader2 className="size-4.5 animate-spin mr-2 text-penpot-primary-100" />
                Downloading {availability.progress ? `${Math.round(availability.progress)}%` : ""}
              </Button>
            ) : availability?.status === "pending" ? (
              <Button
                data-testid="hero-action"
                variant="muted"
                size="md"
                disabled
                className="w-full sm:w-auto border-amber-500/40 bg-amber-950/40 text-amber-300"
              >
                <Clock className="size-4.5 text-amber-400 animate-pulse mr-2" />
                Pending Approval
              </Button>
            ) : availability?.status === "in_radarr" || availability?.status === "in_sonarr" ? (
              <Button
                data-testid="hero-action"
                variant="muted"
                size="md"
                disabled
                className="w-full sm:w-auto"
              >
                <Loader2 className="size-4.5 animate-spin mr-2 text-penpot-neutral-200" />
                Requested
              </Button>
            ) : (
              <Button
                data-testid="hero-action"
                variant="request"
                size="md"
                onClick={() => setRequestTargetItem(activeItem)}
                className="w-full sm:w-auto"
              >
                <Plus className="size-4.5 stroke-[3] mr-2" />
                Request
              </Button>
            )}

            {/* More Information Button (redirects to details page) */}
            <Link
              href={detailsUrl}
              className={buttonVariants({ variant: "moreInfo", size: "md", className: "w-full sm:w-auto" })}
            >
              <Info className="size-4.5 mr-2" />
              More Information
            </Link>
          </div>
        </div>
      </div>

      {/* Slider Prev / Next Arrows */}
      {items.length > 1 && (
        <>
          <button
            onClick={prevSlide}
            className="absolute left-4 sm:left-6 top-1/2 -translate-y-1/2 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-[4px] bg-penpot-neutral-700/70 border border-penpot-border/60 p-3 text-white opacity-0 transition-all hover:bg-penpot-primary-400 hover:border-penpot-primary-300 backdrop-blur-md group-hover:opacity-100 z-30 cursor-pointer"
            aria-label="Previous Slide"
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            onClick={nextSlide}
            className="absolute right-4 sm:right-6 top-1/2 -translate-y-1/2 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-[4px] bg-penpot-neutral-700/70 border border-penpot-border/60 p-3 text-white opacity-0 transition-all hover:bg-penpot-primary-400 hover:border-penpot-primary-300 backdrop-blur-md group-hover:opacity-100 z-30 cursor-pointer"
            aria-label="Next Slide"
          >
            <ChevronRight className="size-6" />
          </button>

          {/* Bottom Slide Indicators / Bullets */}
          <div className="absolute bottom-28 sm:bottom-36 md:bottom-40 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
            {items.map((_, idx) => (
              <button
                key={idx}
                onClick={() => handleIndicatorClick(idx)}
                className={`h-1.5 rounded-full transition-all ${
                  idx === currentIndex
                    ? "w-8 bg-penpot-primary-400"
                    : "w-2 bg-penpot-neutral-400/50 hover:bg-penpot-neutral-200"
                }`}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>
        </>
      )}

      {/* Modals */}
      {requestTargetItem && (
        <RequestModal
          tmdbId={requestTargetItem.id}
          title={requestTargetItem.title}
          type={requestTargetItem.media_type}
          posterPath={requestTargetItem.poster_path}
          backdropPath={requestTargetItem.backdrop_path}
          onClose={() => setRequestTargetItem(null)}
          onSuccess={handleRequestSuccess}
        />
      )}
    </div>
  )
}

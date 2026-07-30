"use client"

import { useState, useEffect, useCallback } from "react"
import Image from "next/image"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Info, Check } from "lucide-react"
import { IconPlay, IconDownloadNav } from "@/components/ui/icons"
import { BookmarkButton } from "@/components/BookmarkButton"

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
  const [isBookmarked, setIsBookmarked] = useState(false)

  const activeItem = items[currentIndex] || items[0]

  const nextSlide = useCallback(() => {
    setDirection("next")
    setCurrentIndex((prev) => (prev + 1) % items.length)
  }, [items.length])

  const prevSlide = () => {
    setDirection("prev")
    setCurrentIndex((prev) => (prev - 1 + items.length) % items.length)
  }

  const handleIndicatorClick = (idx: number) => {
    if (idx === currentIndex) return
    setDirection(idx > currentIndex ? "next" : "prev")
    setCurrentIndex(idx)
  }

  useEffect(() => {
    if (items.length <= 1) return
    const timer = setInterval(() => {
      nextSlide()
    }, 8000)
    return () => clearInterval(timer)
  }, [items.length, nextSlide])

  if (!activeItem) return null

  const backdropUrl = activeItem.backdrop_path
    ? `https://image.tmdb.org/t/p/original${activeItem.backdrop_path}`
    : "https://image.tmdb.org/t/p/original/muth4OYamv31pG2LX2jU2u2vY1n.jpg"

  const title = activeItem.title || "Featured Title"

  return (
    <div className="relative w-full h-[75vh] min-h-[600px] sm:h-[80vh] sm:min-h-[680px] md:h-[85vh] md:min-h-[750px] overflow-hidden bg-background group">
      {/* Background Image with Swiping & Scale Animation */}
      <div className="absolute inset-0 overflow-hidden">
        <Image
          key={`${currentIndex}-${direction}`}
          src={backdropUrl}
          alt={title}
          fill
          priority
          className={`object-cover object-center ${
            direction === "next" ? "animate-backdrop-right" : "animate-backdrop-left"
          }`}
        />

        {/* Dark Vignette Gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent w-full md:w-3/4" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-transparent to-transparent h-24" />
      </div>

      {/* Hero Content Container with Swiping Text Animation */}
      <div className="relative z-10 mx-auto flex h-full max-w-[1600px] items-center px-4 sm:px-6 md:px-8 pb-32 sm:pb-44 md:pb-52">
        <div
          key={`${currentIndex}-${direction}`}
          className={`max-w-2xl space-y-4 pt-12 ${
            direction === "next" ? "animate-slide-in-right" : "animate-slide-in-left"
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-accent">
            <span className="bg-accent/20 px-2 py-0.5 border border-accent/40">TRENDING NOW</span>
            <span className="text-gray-400 font-medium">• SUB | DUB</span>
          </div>

          {/* Title Logo Image or Fallback Title Text */}
          {activeItem.logo_path ? (
            <div className="relative h-20 sm:h-28 md:h-36 w-64 sm:w-80 md:w-[440px] my-2 drop-shadow-2xl">
              <Image
                src={activeItem.logo_path}
                alt={title}
                fill
                className="object-contain object-left drop-shadow-xl"
              />

            </div>
          ) : (
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-black uppercase tracking-tight text-white leading-tight drop-shadow-lg">
              {title}
            </h1>
          )}

          {/* Synopsis */}
          <p className="text-xs sm:text-sm md:text-base text-gray-300 line-clamp-3 max-w-xl font-normal leading-relaxed drop-shadow">
            {activeItem.overview}
          </p>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href={
                // In library → straight to the fullscreen player; otherwise
                // the detail page (where the title can be requested).
                activeItem.inLibrary && activeItem.jellyfinItemId
                  ? `/watch?id=${activeItem.jellyfinItemId}${activeItem.media_type === "tv" ? "&type=tv" : ""}`
                  : `/${activeItem.media_type}/${activeItem.id}`
              }
              className="flex items-center gap-2 rounded-none bg-accent px-6 py-3 text-xs sm:text-sm font-bold uppercase tracking-wider text-white shadow-xl hover:bg-accent-hover transition-all active:scale-95"
            >
              <IconPlay className="size-4 fill-white" />
              {activeItem.inLibrary ? "WATCH NOW" : "EXPLORE & REQUEST"}
            </Link>

            <BookmarkButton
              itemId={activeItem.jellyfinItemId || String(activeItem.id)}
              title={activeItem.title}
            />
          </div>
        </div>
      </div>

      {/* Slider Prev / Next Arrows */}
      {items.length > 1 && (
        <>
          <button
            onClick={prevSlide}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-none bg-black/50 p-2.5 text-white opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 z-30"
            aria-label="Previous Slide"
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            onClick={nextSlide}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-none bg-black/50 p-2.5 text-white opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 z-30"
            aria-label="Next Slide"
          >
            <ChevronRight className="size-6" />
          </button>

          {/* Bottom Slide Indicators (positioned above the overlapping row) */}
          <div className="absolute bottom-32 sm:bottom-40 md:bottom-48 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
            {items.map((_, idx) => (
              <button
                key={idx}
                onClick={() => handleIndicatorClick(idx)}
                className={`h-1.5 rounded-none transition-all ${
                  idx === currentIndex
                    ? "w-8 bg-accent"
                    : "w-2 bg-gray-600 hover:bg-gray-400"
                }`}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

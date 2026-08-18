"use client"

import { useEffect, useMemo } from "react"
import { IconClose, IconPlay } from "@/components/ui/icons"
import { cn } from "@/lib/utils"

export interface TrailerVideoItem {
  id?: string
  key?: string
  name?: string
  site?: string
  type?: string
  official?: boolean
}

export interface TrailerModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  videos?: TrailerVideoItem[]
  videoKey?: string
}

export function TrailerModal({
  isOpen,
  onClose,
  title,
  videos,
  videoKey: directVideoKey,
}: TrailerModalProps) {
  // Find the best official YouTube trailer or teaser
  const activeVideo = useMemo(() => {
    if (directVideoKey) {
      return { key: directVideoKey, name: `${title} Trailer` }
    }

    if (!videos || videos.length === 0) return null

    const ytVideos = videos.filter((v) => v.site === "YouTube" && Boolean(v.key))
    if (ytVideos.length === 0) return null

    // Priority 1: Official Trailer
    const officialTrailer = ytVideos.find((v) => v.type === "Trailer" && v.official)
    if (officialTrailer) return officialTrailer

    // Priority 2: Any Trailer
    const anyTrailer = ytVideos.find((v) => v.type === "Trailer")
    if (anyTrailer) return anyTrailer

    // Priority 3: Teaser / Clip
    const teaser = ytVideos.find((v) => v.type === "Teaser" || v.type === "Clip")
    if (teaser) return teaser

    // Fallback: First YouTube video
    return ytVideos[0]
  }, [directVideoKey, videos, title])

  // Escape key listener & body scroll lock
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = originalOverflow
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trailer-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 md:p-8 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 overscroll-contain"
      onClick={onClose}
    >
      <div
        className={cn(
          "relative w-full max-w-4xl bg-penpot-bg border border-penpot-border/80 rounded-lg shadow-2xl overflow-hidden overscroll-contain",
          "animate-in zoom-in-95 fade-in duration-200"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-penpot-border/60 bg-penpot-surface/40">
          <div className="flex items-center gap-2.5 min-w-0 pr-4">
            <span className="flex items-center justify-center size-7 rounded-full bg-penpot-primary-400 text-white shrink-0">
              <IconPlay className="size-3.5 fill-white" />
            </span>
            <div className="min-w-0">
              <h3 id="trailer-modal-title" className="text-sm sm:text-base font-bold text-white truncate">
                {activeVideo?.name || `${title} — Official Trailer`}
              </h3>
              <p className="text-[11px] text-penpot-text-medium truncate">{title}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close trailer dialog"
            className="flex items-center justify-center size-9 min-h-11 min-w-11 sm:size-9 rounded-full bg-black/30 hover:bg-white/20 active:bg-white/30 text-white border border-white/20 transition-all cursor-pointer shrink-0 touch-manipulation select-none"
          >
            <IconClose className="size-4" />
          </button>
        </div>

        {/* Video Player Frame */}
        <div className="relative aspect-video w-full bg-black flex items-center justify-center">
          {activeVideo?.key ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${activeVideo.key}?autoplay=1&rel=0&modestbranding=1`}
              title={`${title} Trailer`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 size-full border-0"
            />
          ) : (
            <div className="p-8 text-center space-y-2">
              <p className="text-base font-bold text-white">No trailer available for this title.</p>
              <p className="text-xs text-penpot-text-subtle">
                A video preview could not be found on YouTube for {title}.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

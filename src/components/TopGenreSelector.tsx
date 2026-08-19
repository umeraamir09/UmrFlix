"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useState, useRef, useEffect } from "react"
import { ChevronDown, Check, X } from "lucide-react"

export interface TopGenreSelectorProps {
  genres: { name: string; id?: number; slug?: string }[]
  activeGenre?: string
  mediaType: "movie" | "tv"
  basePath?: string
}

export function TopGenreSelector({
  genres,
  mediaType,
  activeGenre,
  basePath,
}: TopGenreSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchParams = useSearchParams()

  const currentGenre = activeGenre ?? (searchParams ? searchParams.get("genre") ?? undefined : undefined)
  const path = basePath || (mediaType === "movie" ? "/movies" : "/tvshows")

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen])

  // Close dropdown on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown)
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen])

  const label = currentGenre ? currentGenre : "Genres"
  const isAllActive = !currentGenre

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Pill Dropdown Trigger (Penpot / Netflix Subheader Style) */}
      <button
        type="button"
        data-testid="top-genre-selector"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-1 sm:py-1.5 text-sm sm:text-base font-semibold transition-all duration-200 shadow-md backdrop-blur-md cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-penpot-secondary-200 ${
          currentGenre
            ? "border-penpot-primary-300 bg-penpot-primary-500/40 text-white shadow-penpot-primary-500/30"
            : "border-white/90 bg-black/50 hover:bg-black/70 text-white"
        }`}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <span>{label}</span>
        <ChevronDown
          className={`size-4 sm:size-5 transition-transform duration-200 text-white ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Popover */}
      {isOpen && (
        <div
          data-testid="top-genre-popover"
          className="absolute top-full left-0 mt-2.5 z-50 w-[300px] sm:w-[480px] md:w-[560px] rounded-[8px] border border-penpot-border bg-penpot-neutral-700/98 p-4 sm:p-5 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {/* Header & 'All' Reset Option */}
          <div className="flex items-center justify-between pb-3 border-b border-penpot-border/60">
            <span className="text-xs font-bold uppercase tracking-wider text-penpot-text-subtle">
              Select a Genre
            </span>
            <Link
              href={path}
              onClick={() => setIsOpen(false)}
              className={`text-xs font-bold px-3 py-1.5 rounded-[4px] transition-colors flex items-center gap-1.5 ${
                isAllActive
                  ? "bg-penpot-primary-400 text-white shadow-sm"
                  : "text-white/80 hover:text-white hover:bg-penpot-surface"
              }`}
            >
              <span>All {mediaType === "movie" ? "Movies" : "Series"}</span>
              {isAllActive && <Check className="size-3.5" />}
            </Link>
          </div>

          {/* Genre Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 sm:gap-1.5 mt-3 max-h-[60vh] overflow-y-auto no-scrollbar py-0.5">
            {genres.map((genre) => {
              const isActive = currentGenre
                ? currentGenre.toLowerCase() === genre.name.toLowerCase() ||
                  currentGenre === String(genre.id) ||
                  currentGenre === genre.slug
                : false

              return (
                <Link
                  key={genre.name}
                  href={isActive ? path : `${path}?genre=${encodeURIComponent(genre.name)}`}
                  onClick={() => setIsOpen(false)}
                  className={`px-3 py-2 rounded-[4px] text-xs sm:text-sm font-medium transition-all flex items-center justify-between ${
                    isActive
                      ? "bg-penpot-primary-400 text-white font-bold shadow-sm"
                      : "text-white/85 hover:text-penpot-secondary-200 hover:bg-penpot-surface"
                  }`}
                >
                  <span className="truncate">{genre.name}</span>
                  {isActive && <Check className="size-3.5 shrink-0 ml-1 text-white" />}
                </Link>
              )
            })}
          </div>

          {/* Quick Clear Filter if active */}
          {currentGenre && (
            <div className="pt-3 mt-3 border-t border-penpot-border/60 flex justify-end">
              <Link
                href={path}
                onClick={() => setIsOpen(false)}
                className="text-xs font-semibold text-penpot-text-medium hover:text-white flex items-center gap-1 transition-colors"
              >
                <X className="size-3.5" />
                <span>Reset to All {mediaType === "movie" ? "Movies" : "Series"}</span>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

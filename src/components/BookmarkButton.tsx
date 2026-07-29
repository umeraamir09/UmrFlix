"use client"

import { useState, useEffect, MouseEvent } from "react"
import { Bookmark, Check, Loader2 } from "lucide-react"

export type BookmarkButtonProps = {
  itemId: string
  title?: string
  initialBookmarked?: boolean
  variant?: "button" | "icon" | "pill"
  className?: string
}

export function BookmarkButton({
  itemId,
  initialBookmarked = false,
  variant = "button",
  className = "",
}: BookmarkButtonProps) {
  const [bookmarked, setBookmarked] = useState(initialBookmarked)
  const [loading, setLoading] = useState(false)

  // Check initial favorite status from server if not explicitly passed
  useEffect(() => {
    if (!itemId) return
    let active = true
    async function checkFav() {
      try {
        const res = await fetch("/api/jellyfin/favorites")
        if (res.ok) {
          const data = await res.json()
          const isFav = data.items?.some((i: { Id: string }) => i.Id === itemId)
          if (active && isFav !== undefined) {
            setBookmarked(Boolean(isFav))
          }
        }
      } catch {
        /* silent error */
      }
    }
    checkFav()
    return () => {
      active = false
    }
  }, [itemId])

  async function handleToggle(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!itemId || loading) return

    setLoading(true)
    const nextState = !bookmarked

    try {
      const res = await fetch(`/api/jellyfin/favorites/${itemId}`, {
        method: nextState ? "POST" : "DELETE",
      })

      if (res.ok) {
        setBookmarked(nextState)
      }
    } catch {
      /* silent error */
    } finally {
      setLoading(false)
    }
  }

  if (variant === "icon") {
    return (
      <button
        onClick={handleToggle}
        disabled={loading}
        title={bookmarked ? "Remove from My List" : "Add to My List"}
        className={`p-2.5 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md transition-all border border-white/10 ${className}`}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        ) : (
          <Bookmark
            className={`w-4 h-4 transition-colors ${
              bookmarked ? "fill-brand-red text-brand-red" : "text-white"
            }`}
          />
        )}
      </button>
    )
  }

  if (variant === "pill") {
    return (
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all backdrop-blur-md ${
          bookmarked
            ? "bg-brand-red/20 text-brand-red border border-brand-red/40"
            : "bg-white/10 hover:bg-white/20 text-white border border-white/10"
        } ${className}`}
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : bookmarked ? (
          <Check className="w-3.5 h-3.5 text-brand-red" />
        ) : (
          <Bookmark className="w-3.5 h-3.5" />
        )}
        <span>{bookmarked ? "In My List" : "Add to List"}</span>
      </button>
    )
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all border ${
        bookmarked
          ? "bg-brand-red/15 border-brand-red/50 text-brand-red hover:bg-brand-red/25"
          : "bg-surface-hover hover:bg-surface-hover-alt border-white/10 text-white"
      } ${className}`}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
      ) : (
        <Bookmark
          className={`w-4 h-4 ${bookmarked ? "fill-brand-red text-brand-red" : ""}`}
        />
      )}
      <span>{bookmarked ? "IN MY LIST" : "ADD TO MY LIST"}</span>
    </button>
  )
}

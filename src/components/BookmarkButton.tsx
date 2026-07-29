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
        className={`rounded-none bg-surface/90 border border-border p-2 text-white hover:border-accent hover:text-accent transition-all ${
          bookmarked ? "border-accent text-accent bg-accent/10" : ""
        } ${className}`}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin text-gray-400" />
        ) : (
          <Bookmark
            className={`size-4 transition-colors ${
              bookmarked ? "fill-accent text-accent" : "text-white"
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
        className={`flex items-center gap-1.5 rounded-none px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider transition-all border ${
          bookmarked
            ? "bg-accent/20 text-accent border-accent"
            : "bg-surface hover:bg-surface-hover text-white border-border"
        } ${className}`}
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : bookmarked ? (
          <Check className="size-3.5 text-accent" />
        ) : (
          <Bookmark className="size-3.5" />
        )}
        <span>{bookmarked ? "IN MY LIST" : "ADD TO LIST"}</span>
      </button>
    )
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`flex items-center justify-center gap-2 rounded-none border px-5 py-3 text-xs font-bold uppercase tracking-wider transition-all active:scale-95 ${
        bookmarked
          ? "border-accent bg-accent/20 text-accent hover:bg-accent/30"
          : "border-gray-500 bg-black/40 text-white hover:border-white hover:bg-black/60"
      } ${className}`}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin text-gray-400" />
      ) : (
        <Bookmark
          className={`size-4 ${bookmarked ? "fill-accent text-accent" : ""}`}
        />
      )}
      <span>{bookmarked ? "IN MY LIST" : "ADD TO MY LIST"}</span>
    </button>
  )
}

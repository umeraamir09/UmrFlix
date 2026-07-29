"use client"

import { useState, MouseEvent } from "react"
import useSWR from "swr"
import { Bookmark, Check, Loader2 } from "lucide-react"

export type BookmarkButtonProps = {
  itemId?: string
  tmdbId?: number
  tvdbId?: number
  jellyfinId?: string
  mediaType?: "movie" | "tv"
  title?: string
  posterPath?: string | null
  overview?: string
  releaseYear?: string
  initialBookmarked?: boolean
  variant?: "button" | "icon" | "pill"
  className?: string
}

type MyListItem = {
  id: string
  tmdbId?: number
  tvdbId?: number
  jellyfinId?: string
  mediaType: "movie" | "tv"
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function BookmarkButton({
  itemId,
  tmdbId,
  tvdbId,
  jellyfinId,
  mediaType = "movie",
  title,
  posterPath,
  overview,
  releaseYear,
  initialBookmarked = false,
  variant = "button",
  className = "",
}: BookmarkButtonProps) {
  const { data, mutate } = useSWR<{ items?: MyListItem[] }>(
    "/api/my-list",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    }
  )

  const [localBookmarked, setLocalBookmarked] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)

  const isFavInServer = data?.items
    ? data.items.some((i) => {
        if (tmdbId && i.tmdbId === Number(tmdbId) && (!mediaType || i.mediaType === mediaType)) return true
        if (jellyfinId && i.jellyfinId === jellyfinId) return true
        if (itemId && (i.id === itemId || i.jellyfinId === itemId || String(i.tmdbId) === itemId)) return true
        return false
      })
    : null

  const bookmarked =
    localBookmarked !== null
      ? localBookmarked
      : isFavInServer !== null
      ? isFavInServer
      : initialBookmarked

  async function handleToggle(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (loading) return

    setLoading(true)
    const nextState = !bookmarked
    setLocalBookmarked(nextState)

    try {
      if (nextState) {
        // Add to My List
        const res = await fetch("/api/my-list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: itemId,
            tmdbId,
            tvdbId,
            jellyfinId,
            mediaType,
            title: title || "Untitled Item",
            posterPath,
            overview,
            releaseYear,
          }),
        })

        if (res.ok) {
          mutate()
        } else {
          setLocalBookmarked(!nextState)
        }
      } else {
        // Remove from My List
        const params = new URLSearchParams()
        if (itemId) params.set("id", itemId)
        if (tmdbId) params.set("tmdbId", String(tmdbId))
        if (jellyfinId) params.set("jellyfinId", jellyfinId)
        if (mediaType) params.set("mediaType", mediaType)

        const res = await fetch(`/api/my-list?${params.toString()}`, {
          method: "DELETE",
        })

        if (res.ok) {
          mutate()
        } else {
          setLocalBookmarked(!nextState)
        }
      }
    } catch {
      setLocalBookmarked(!nextState)
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

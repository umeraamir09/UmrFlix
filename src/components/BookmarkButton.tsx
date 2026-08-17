"use client"

import { useState, useRef, MouseEvent } from "react"
import useSWR from "swr"
import { Bookmark, Check, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

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
  variant?: "button" | "icon" | "pill" | "menu-item"
  className?: string
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
  // Construct targeted single-item check endpoint (Issue 6)
  const checkParams = new URLSearchParams()
  if (itemId) checkParams.set("id", itemId)
  if (tmdbId) checkParams.set("tmdbId", String(tmdbId))
  if (jellyfinId) checkParams.set("jellyfinId", jellyfinId)
  if (mediaType) checkParams.set("mediaType", mediaType)

  const checkUrl = checkParams.toString() ? `/api/my-list/check?${checkParams.toString()}` : null

  const { data, mutate } = useSWR<{ bookmarked?: boolean }>(
    checkUrl,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    }
  )

  const [localBookmarked, setLocalBookmarked] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const pendingLockRef = useRef(false) // Prevent rapid click race conditions (Issue 7)

  const bookmarked =
    localBookmarked !== null
      ? localBookmarked
      : data?.bookmarked !== undefined
      ? data.bookmarked
      : initialBookmarked

  async function handleToggle(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    // Lock against rapid concurrent clicks (Issue 7)
    if (loading || pendingLockRef.current) return
    pendingLockRef.current = true
    setLoading(true)

    const currentState = bookmarked
    const nextState = !currentState
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
          mutate({ bookmarked: true }, false)
        } else {
          setLocalBookmarked(currentState)
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
          mutate({ bookmarked: false }, false)
        } else {
          setLocalBookmarked(currentState)
        }
      }
    } catch {
      setLocalBookmarked(currentState)
    } finally {
      setLoading(false)
      pendingLockRef.current = false
    }
  }

  if (variant === "menu-item") {
    return (
      <button
        onClick={handleToggle}
        disabled={loading}
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-penpot-neutral-200 hover:text-penpot-text-high hover:bg-penpot-opacity-white-10 rounded transition-colors text-left cursor-pointer",
          className
        )}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin text-penpot-neutral-300" />
        ) : (
          <Bookmark
            className={cn(
              "size-4",
              bookmarked ? "fill-penpot-primary-300 text-penpot-primary-300" : "text-penpot-neutral-200"
            )}
          />
        )}
        <span>{bookmarked ? "Remove from My List" : "Add to My List"}</span>
      </button>
    )
  }

  if (variant === "icon") {
    return (
      <button
        onClick={handleToggle}
        disabled={loading}
        title={bookmarked ? "Remove from My List" : "Add to My List"}
        className={cn(
          "rounded-[4px] bg-penpot-surface border border-penpot-border p-2 text-penpot-text-high hover:border-penpot-primary-300 hover:text-penpot-primary-100 transition-all cursor-pointer",
          bookmarked && "border-penpot-primary-300 text-penpot-primary-100 bg-penpot-primary-500/30",
          className
        )}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin text-penpot-neutral-300" />
        ) : (
          <Bookmark
            className={cn(
              "size-4 transition-colors",
              bookmarked ? "fill-penpot-primary-300 text-penpot-primary-300" : "text-penpot-text-high"
            )}
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
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-[4px] px-3 py-1.5 text-xs font-semibold transition-all shrink-0 border cursor-pointer",
          bookmarked
            ? "bg-penpot-primary-500/30 text-penpot-primary-100 border-penpot-primary-300"
            : "bg-penpot-surface hover:bg-penpot-neutral-500 text-penpot-text-high border-penpot-border",
          className
        )}
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : bookmarked ? (
          <Check className="size-3.5 text-penpot-primary-100" />
        ) : (
          <Bookmark className="size-3.5" />
        )}
        <span>{bookmarked ? "In My List" : "Add to List"}</span>
      </button>
    )
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[4px] border px-5 sm:px-6 py-3 text-sm font-semibold transition-all active:scale-[0.98] shrink-0 cursor-pointer",
        bookmarked
          ? "border-penpot-primary-300 bg-penpot-primary-500/30 text-penpot-primary-100 hover:bg-penpot-primary-500/40"
          : "border-penpot-border bg-penpot-opacity-white-10 text-penpot-text-high hover:bg-penpot-opacity-white-30 backdrop-blur-sm",
        className
      )}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin text-penpot-neutral-300" />
      ) : (
        <Bookmark
          className={cn(
            "size-4",
            bookmarked ? "fill-penpot-primary-300 text-penpot-primary-300" : "text-penpot-text-high"
          )}
        />
      )}
      <span>{bookmarked ? "In My List" : "Add to My List"}</span>
    </button>
  )
}

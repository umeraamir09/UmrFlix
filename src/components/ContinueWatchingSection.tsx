"use client"

import { useEffect, useState } from "react"
import { ContinueWatchingCard, ContinueWatchingItem } from "./ContinueWatchingCard"

type ApiContinueWatchingItem = {
  jellyfinItemId: string
  title: string
  episodeTitle?: string
  episodeNumber?: string
  imageUrl: string
  mediaType: "movie" | "tv"
  progressPercent: number
  timeLeft?: string
  providerIds: Record<string, string>
}

export function ContinueWatchingSection() {
  const [items, setItems] = useState<ContinueWatchingItem[]>([])
  const [loading, setLoading] = useState(true)

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
          backdrop_path: null, // We use jellyfinImageUrl instead
          media_type: item.mediaType,
          progressPercent: item.progressPercent,
          timeLeft: item.timeLeft,
          jellyfinItemId: item.jellyfinItemId,
          jellyfinImageUrl: item.imageUrl,
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

  // Don't render anything if there's nothing to continue or still loading
  if (loading) {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
            Continue Watching
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="aspect-video w-full rounded-md bg-[#1a1c23] animate-pulse" />
          ))}
        </div>
      </section>
    )
  }

  // If no items, hide the section entirely
  if (items.length === 0) {
    return null
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
          Continue Watching
        </h2>
        <span className="text-xs font-bold uppercase tracking-wider text-accent hover:underline cursor-pointer">
          VIEW HISTORY &gt;
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {items.map((item) => (
          <ContinueWatchingCard key={item.jellyfinItemId ?? item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

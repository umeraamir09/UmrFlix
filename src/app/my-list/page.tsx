"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Bookmark, Film, Tv, Search, CheckCircle2, Download, Clock } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { BookmarkButton } from "@/components/BookmarkButton"
import { RequestButton } from "@/components/RequestButton"
import { useBatchAvailability } from "@/lib/use-availability"
import { getImageUrl } from "@/lib/utils"
import { IconPlay } from "@/components/ui/icons"

export type MyListItem = {
  id: string
  userId: string
  tmdbId?: number
  tvdbId?: number
  jellyfinId?: string
  mediaType: "movie" | "tv"
  title: string
  posterPath?: string | null
  overview?: string
  releaseYear?: string
  addedAt: string
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export default function MyListPage() {
  const { data, error, isLoading, mutate } = useSWR<{ items: MyListItem[] }>(
    "/api/my-list",
    fetcher
  )

  const [activeTab, setActiveTab] = useState<"all" | "movie" | "tv" | "available" | "want_to_watch">("all")
  const [searchQuery, setSearchQuery] = useState("")

  const items = data?.items ?? []

  // Gather items for batch availability check
  const itemRefs = items
    .filter((item): item is MyListItem & { tmdbId: number } => typeof item.tmdbId === "number")
    .map((item) => ({ tmdbId: item.tmdbId, type: item.mediaType, tvdbId: item.tvdbId }))

  const { availabilityMap, refresh: refreshAvailability } = useBatchAvailability(itemRefs)

  const filteredItems = items.filter((item) => {
    const key = item.tmdbId ? `${item.mediaType}-${item.tmdbId}` : null
    const avail = key ? availabilityMap[key] : null
    const isAvailable = avail?.status === "in_library" || Boolean(item.jellyfinId)

    let matchesTab = true
    if (activeTab === "movie") matchesTab = item.mediaType === "movie"
    else if (activeTab === "tv") matchesTab = item.mediaType === "tv"
    else if (activeTab === "available") matchesTab = isAvailable
    else if (activeTab === "want_to_watch") matchesTab = !isAvailable

    const matchesSearch =
      !searchQuery.trim() ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase())

    return matchesTab && matchesSearch
  })

  // Count items for tab pills
  const counts = {
    all: items.length,
    movie: items.filter((i) => i.mediaType === "movie").length,
    tv: items.filter((i) => i.mediaType === "tv").length,
    available: items.filter((i) => {
      const key = i.tmdbId ? `${i.mediaType}-${i.tmdbId}` : null
      const avail = key ? availabilityMap[key] : null
      return avail?.status === "in_library" || Boolean(i.jellyfinId)
    }).length,
    want_to_watch: items.filter((i) => {
      const key = i.tmdbId ? `${i.mediaType}-${i.tmdbId}` : null
      const avail = key ? availabilityMap[key] : null
      return !(avail?.status === "in_library" || Boolean(i.jellyfinId))
    }).length,
  }

  return (
    <div className="min-h-screen bg-background text-foreground pt-24 pb-16 px-4 sm:px-6 md:px-8 max-w-[1600px] mx-auto space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-none bg-accent/20 border border-accent text-accent">
            <Bookmark className="size-6 fill-accent" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-white">My List</h1>
            <p className="text-xs text-foreground-muted mt-1">
              Your saved Jellyfin media and want-to-watch wishlist items
            </p>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Bar */}
          <div className="relative w-full sm:w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search My List..."
              className="w-full rounded-none bg-surface border border-border focus:border-accent text-xs text-white placeholder-muted py-2 pl-9 pr-3 focus:outline-none transition-colors"
            />
          </div>

          {/* Type & Availability Filter Tabs */}
          <div className="flex flex-wrap items-center bg-surface border border-border rounded-none p-1 text-xs gap-0.5">
            <button
              onClick={() => setActiveTab("all")}
              className={`rounded-none px-3 py-1.5 font-bold uppercase tracking-wider transition-all ${
                activeTab === "all"
                  ? "bg-accent text-white shadow-md"
                  : "text-foreground-muted hover:text-white"
              }`}
            >
              ALL ({counts.all})
            </button>
            <button
              onClick={() => setActiveTab("movie")}
              className={`flex items-center gap-1 rounded-none px-3 py-1.5 font-bold uppercase tracking-wider transition-all ${
                activeTab === "movie"
                  ? "bg-accent text-white shadow-md"
                  : "text-foreground-muted hover:text-white"
              }`}
            >
              <Film className="size-3.5" />
              <span>MOVIES ({counts.movie})</span>
            </button>
            <button
              onClick={() => setActiveTab("tv")}
              className={`flex items-center gap-1 rounded-none px-3 py-1.5 font-bold uppercase tracking-wider transition-all ${
                activeTab === "tv"
                  ? "bg-accent text-white shadow-md"
                  : "text-foreground-muted hover:text-white"
              }`}
            >
              <Tv className="size-3.5" />
              <span>TV SHOWS ({counts.tv})</span>
            </button>
            <button
              onClick={() => setActiveTab("available")}
              className={`flex items-center gap-1 rounded-none px-3 py-1.5 font-bold uppercase tracking-wider transition-all ${
                activeTab === "available"
                  ? "bg-accent text-white shadow-md"
                  : "text-foreground-muted hover:text-white"
              }`}
            >
              <CheckCircle2 className="size-3.5 text-emerald-400" />
              <span>READY TO WATCH ({counts.available})</span>
            </button>
            <button
              onClick={() => setActiveTab("want_to_watch")}
              className={`flex items-center gap-1 rounded-none px-3 py-1.5 font-bold uppercase tracking-wider transition-all ${
                activeTab === "want_to_watch"
                  ? "bg-accent text-white shadow-md"
                  : "text-foreground-muted hover:text-white"
              }`}
            >
              <Clock className="size-3.5 text-amber-400" />
              <span>WANT TO WATCH ({counts.want_to_watch})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] w-full rounded-none bg-surface border border-border" />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-16 text-foreground-muted space-y-2">
          <p className="text-lg font-bold uppercase text-white">Failed to load My List</p>
          <p className="text-xs text-muted">Please refresh the page or check your connection.</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-24 bg-surface border border-border rounded-none space-y-4">
          <div className="size-16 rounded-none border border-border bg-background flex items-center justify-center mx-auto text-muted">
            <Bookmark className="size-8 text-accent" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-black uppercase text-white">No items found</h3>
            <p className="text-xs text-foreground-muted max-w-sm mx-auto">
              {searchQuery
                ? `No items matching "${searchQuery}" in your list.`
                : "Explore popular movies and TV shows and click 'Add to My List' to save them here."}
            </p>
          </div>
          <Link
            href="/popular"
            className="inline-block rounded-none bg-accent text-white text-xs font-black uppercase tracking-wider px-6 py-3 hover:bg-accent-hover transition-colors shadow-lg"
          >
            BROWSE CATALOG
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
          {filteredItems.map((item) => {
            const key = item.tmdbId ? `${item.mediaType}-${item.tmdbId}` : null
            const avail = key ? availabilityMap[key] : null
            const jellyfinId = avail?.jellyfinItemId || item.jellyfinId
            const isAvailable = avail?.status === "in_library" || Boolean(jellyfinId)

            const isMovie = item.mediaType === "movie"
            const watchUrl = jellyfinId
              ? `/watch?id=${jellyfinId}&type=${item.mediaType}`
              : item.tmdbId
              ? isMovie
                ? `/movie/${item.tmdbId}`
                : `/tv/${item.tmdbId}`
              : "#"

            const posterUrl = getImageUrl(item.posterPath, "w500")

            return (
              <div key={item.id} className="group relative block w-full flex-shrink-0">
                {/* Poster Image Container matching MovieCard.tsx */}
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-none bg-card shadow-md">
                  {posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={posterUrl}
                      alt={item.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center text-muted">
                      {isMovie ? <Film className="size-8 mb-2" /> : <Tv className="size-8 mb-2" />}
                      <span className="text-xs font-bold text-gray-400 line-clamp-2">{item.title}</span>
                    </div>
                  )}

                  {/* Top Badges (Visible when not hovering, matching MovieCard.tsx) */}
                  <div className="absolute inset-x-2 top-2 z-10 flex items-center justify-between gap-1 pointer-events-none group-hover:opacity-0 transition-opacity">
                    <div>
                      {isAvailable ? (
                        <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-none uppercase tracking-wide shadow-md flex items-center gap-1">
                          <CheckCircle2 className="size-3" />
                          <span>AVAILABLE</span>
                        </span>
                      ) : avail?.status === "downloading" ? (
                        <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-none uppercase tracking-wide shadow-md flex items-center gap-1">
                          <Download className="size-3 animate-bounce" />
                          <span>DOWNLOADING</span>
                        </span>
                      ) : avail?.status === "in_radarr" || avail?.status === "in_sonarr" ? (
                        <span className="bg-purple-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-none uppercase tracking-wide shadow-md flex items-center gap-1">
                          <Clock className="size-3" />
                          <span>REQUESTED</span>
                        </span>
                      ) : (
                        <span className="bg-amber-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-none uppercase tracking-wide shadow-md flex items-center gap-1">
                          <Clock className="size-3" />
                          <span>WANT TO WATCH</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sub-Card Title & Metadata Line (Visible when NOT hovering) */}
                <div className="mt-2 space-y-0.5 px-0.5 group-hover:opacity-0 transition-opacity duration-200">
                  <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-1 group-hover:text-accent transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-[11px] font-medium text-gray-400 flex items-center gap-1.5 uppercase">
                    <span>{isMovie ? "Movie" : "TV Show"}</span>
                    {item.releaseYear && <span>• {item.releaseYear}</span>}
                  </p>
                </div>

                {/* Crunchyroll-Style Full Hover Overlay (Identical to MovieCard.tsx) */}
                <div className="absolute inset-0 z-20 bg-surface/95 p-3 sm:p-3.5 flex flex-col justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200 border border-border shadow-2xl pointer-events-none group-hover:pointer-events-auto">
                  <div className="space-y-1.5 overflow-hidden">
                    <h3 className="text-sm sm:text-lg font-bold text-white leading-tight line-clamp-2">
                      {item.title}
                    </h3>
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase">
                      <span>{isAvailable ? "Available" : avail?.status === "downloading" ? "Downloading" : avail?.status === "in_radarr" || avail?.status === "in_sonarr" ? "Requested" : "Want to Watch"}</span>
                      {item.releaseYear ? <span className="text-gray-400 font-medium">• {item.releaseYear}</span> : null}
                    </div>
                    <p className="text-[13px] sm:text-[15px] text-gray-300 leading-relaxed line-clamp-4 sm:line-clamp-6 font-normal pt-1">
                      {item.overview || "No overview available for this title."}
                    </p>
                  </div>

                  {/* Bottom Action Bar */}
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-3">
                      <Link
                        href={watchUrl}
                        className="text-accent hover:scale-110 transition-transform cursor-pointer"
                        title={isAvailable ? "Watch Now" : "View Details"}
                      >
                        <IconPlay className="size-5 fill-accent text-accent" />
                      </Link>

                      <BookmarkButton
                        itemId={item.id}
                        tmdbId={item.tmdbId}
                        jellyfinId={item.jellyfinId}
                        mediaType={item.mediaType}
                        title={item.title}
                        initialBookmarked={true}
                        variant="icon"
                        className="!p-1 border-none bg-transparent hover:bg-white/10"
                      />
                    </div>

                    {!isAvailable && item.tmdbId && (
                      <RequestButton
                        type={item.mediaType}
                        tmdbId={item.tmdbId}
                        title={item.title}
                        year={item.releaseYear ? Number(item.releaseYear) : undefined}
                        tvdbId={item.tvdbId}
                        availability={avail}
                        onStatusChange={() => {
                          refreshAvailability()
                          mutate()
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

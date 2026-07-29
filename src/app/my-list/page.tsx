"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Bookmark, Film, Tv, Search, Play, CheckCircle2 } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { BookmarkButton } from "@/components/BookmarkButton"

type FavoriteItem = {
  Id: string
  Name: string
  Type: string
  MediaType: string
  Overview?: string
  ImageTags?: Record<string, string>
  BackdropImageTags?: string[]
  UserData?: {
    Played?: boolean
    PlayedPercentage?: number
  }
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export default function MyListPage() {
  const { data, error, isLoading } = useSWR<{ items: FavoriteItem[] }>(
    "/api/jellyfin/favorites",
    fetcher
  )

  const [activeTab, setActiveTab] = useState<"all" | "movie" | "series">("all")
  const [searchQuery, setSearchQuery] = useState("")

  const items = data?.items ?? []

  const filteredItems = items.filter((item) => {
    const matchesTab =
      activeTab === "all"
        ? true
        : activeTab === "movie"
        ? item.Type.toLowerCase() === "movie"
        : item.Type.toLowerCase() === "series" || item.Type.toLowerCase() === "tv"

    const matchesSearch =
      !searchQuery.trim() ||
      item.Name.toLowerCase().includes(searchQuery.toLowerCase())

    return matchesTab && matchesSearch
  })

  return (
    <div className="min-h-screen bg-background text-foreground pt-24 pb-16 px-4 sm:px-6 md:px-8 max-w-[1600px] mx-auto space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-none bg-accent/20 border border-accent text-accent">
              <Bookmark className="size-6 fill-accent" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-white">My List</h1>
              <p className="text-xs text-foreground-muted mt-1">
                Your saved Jellyfin favorites and bookmarked media items
              </p>
            </div>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Bar */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search My List..."
              className="w-full rounded-none bg-surface border border-border focus:border-accent text-xs text-white placeholder-muted py-2 pl-9 pr-3 focus:outline-none transition-colors"
            />
          </div>

          {/* Type Filter Tabs */}
          <div className="flex items-center bg-surface border border-border rounded-none p-1 text-xs">
            <button
              onClick={() => setActiveTab("all")}
              className={`rounded-none px-3.5 py-1.5 font-bold uppercase tracking-wider transition-all ${
                activeTab === "all"
                  ? "bg-accent text-white shadow-md"
                  : "text-foreground-muted hover:text-white"
              }`}
            >
              ALL ({items.length})
            </button>
            <button
              onClick={() => setActiveTab("movie")}
              className={`flex items-center gap-1 rounded-none px-3.5 py-1.5 font-bold uppercase tracking-wider transition-all ${
                activeTab === "movie"
                  ? "bg-accent text-white shadow-md"
                  : "text-foreground-muted hover:text-white"
              }`}
            >
              <Film className="size-3.5" />
              <span>MOVIES</span>
            </button>
            <button
              onClick={() => setActiveTab("series")}
              className={`flex items-center gap-1 rounded-none px-3.5 py-1.5 font-bold uppercase tracking-wider transition-all ${
                activeTab === "series"
                  ? "bg-accent text-white shadow-md"
                  : "text-foreground-muted hover:text-white"
              }`}
            >
              <Tv className="size-3.5" />
              <span>TV SHOWS</span>
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
          <p className="text-xs text-muted">Make sure your Jellyfin server is connected and authenticated.</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-24 bg-surface border border-border rounded-none space-y-4">
          <div className="size-16 rounded-none border border-border bg-background flex items-center justify-center mx-auto text-muted">
            <Bookmark className="size-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-black uppercase text-white">Your list is empty</h3>
            <p className="text-xs text-foreground-muted max-w-sm mx-auto">
              Explore popular movies and TV shows and click "Add to My List" to save them here for quick access.
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
            const isMovie = item.Type.toLowerCase() === "movie"
            const watchUrl = isMovie ? `/watch?id=${item.Id}` : `/tv/${item.Id}`
            const imageUrl = item.ImageTags?.Primary
              ? `/api/jellyfin/image/${item.Id}?type=Primary`
              : item.BackdropImageTags?.[0]
              ? `/api/jellyfin/image/${item.Id}?type=Backdrop`
              : null

            const isPlayed = item.UserData?.Played === true

            return (
              <div
                key={item.Id}
                className="group relative bg-card border border-border rounded-none overflow-hidden shadow-md hover:border-accent hover:shadow-2xl transition-all flex flex-col"
              >
                {/* Poster Container */}
                <div className="relative aspect-[2/3] w-full bg-background overflow-hidden">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt={item.Name}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center text-muted">
                      {isMovie ? <Film className="size-8 mb-2" /> : <Tv className="size-8 mb-2" />}
                      <span className="text-xs font-bold text-gray-400 line-clamp-2">{item.Name}</span>
                    </div>
                  )}

                  {/* Watched Checkmark Badge */}
                  {isPlayed && (
                    <div className="absolute top-2 left-2 flex items-center gap-1 bg-emerald-600 border border-emerald-400 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded-none shadow-md">
                      <CheckCircle2 className="size-3" />
                      <span>WATCHED</span>
                    </div>
                  )}

                  {/* Top-right Bookmark Button */}
                  <div className="absolute top-2 right-2 z-10">
                    <BookmarkButton
                      itemId={item.Id}
                      initialBookmarked={true}
                      variant="icon"
                    />
                  </div>

                  {/* Hover Overlay with Play CTA */}
                  <Link
                    href={watchUrl}
                    className="absolute inset-0 bg-surface/90 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    <div className="size-12 rounded-none bg-accent text-white flex items-center justify-center shadow-xl transform scale-75 group-hover:scale-100 transition-transform">
                      <Play className="size-6 fill-white ml-0.5" />
                    </div>
                  </Link>
                </div>

                {/* Info Container */}
                <div className="p-3 flex flex-col flex-1 justify-between bg-surface border-t border-border">
                  <div>
                    <h3 className="text-xs font-bold text-white line-clamp-1 group-hover:text-accent transition-colors">
                      {item.Name}
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-muted mt-1 uppercase font-semibold">
                      <span>{item.Type}</span>
                    </div>
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

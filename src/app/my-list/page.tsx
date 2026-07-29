"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import Image from "next/image"
import { Bookmark, Film, Tv, Search, Trash2, Play, CheckCircle2 } from "lucide-react"
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
  const { data, error, isLoading, mutate } = useSWR<{ items: FavoriteItem[] }>(
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
    <div className="min-h-screen bg-[#0a0b0d] text-white pt-24 pb-16 px-4 sm:px-6 md:px-8 max-w-[1600px] mx-auto space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand-red/15 border border-brand-red/30 text-brand-red">
              <Bookmark className="w-6 h-6 fill-brand-red" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-white">My List</h1>
              <p className="text-xs text-gray-400 mt-1">
                Your saved Jellyfin favorites and bookmarked movies & TV shows
              </p>
            </div>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search bar */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search My List..."
              className="w-full bg-[#1b1c22] border border-white/10 focus:border-brand-red rounded-xl py-2 pl-9 pr-3 text-xs text-white placeholder-gray-500 focus:outline-none"
            />
          </div>

          {/* Type Filter Tabs */}
          <div className="flex items-center bg-[#141519] border border-white/10 rounded-xl p-1 text-xs">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === "all"
                  ? "bg-brand-red text-white font-bold shadow-md shadow-brand-red/20"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              All ({items.length})
            </button>
            <button
              onClick={() => setActiveTab("movie")}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === "movie"
                  ? "bg-brand-red text-white font-bold shadow-md shadow-brand-red/20"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Movies</span>
            </button>
            <button
              onClick={() => setActiveTab("series")}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === "series"
                  ? "bg-brand-red text-white font-bold shadow-md shadow-brand-red/20"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              <span>TV Shows</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] w-full rounded-xl bg-white/5" />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-16 text-gray-400 space-y-2">
          <p className="text-lg font-bold text-white">Failed to load My List</p>
          <p className="text-xs text-gray-500">Make sure your Jellyfin server is connected and authenticated.</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-24 bg-[#141519]/50 border border-white/5 rounded-2xl space-y-4">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto text-gray-500">
            <Bookmark className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">Your list is empty</h3>
            <p className="text-xs text-gray-400 max-w-sm mx-auto">
              Explore popular movies and TV shows and click "Add to My List" to save them here for quick access.
            </p>
          </div>
          <Link
            href="/popular"
            className="inline-block px-5 py-2.5 rounded-xl bg-brand-red text-white text-xs font-bold hover:bg-brand-red-hover transition-colors shadow-lg shadow-brand-red/20"
          >
            Browse Catalog
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
                className="group relative bg-[#141519] border border-white/10 rounded-xl overflow-hidden shadow-lg hover:border-brand-red/50 hover:shadow-2xl hover:shadow-brand-red/10 transition-all flex flex-col"
              >
                {/* Poster Container */}
                <div className="relative aspect-[2/3] w-full bg-[#1b1c22] overflow-hidden">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt={item.Name}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center text-gray-500">
                      {isMovie ? <Film className="w-8 h-8 mb-2" /> : <Tv className="w-8 h-8 mb-2" />}
                      <span className="text-xs font-semibold text-gray-400 line-clamp-2">{item.Name}</span>
                    </div>
                  )}

                  {/* Watched Checkmark Badge */}
                  {isPlayed && (
                    <div className="absolute top-2 left-2 flex items-center gap-1 bg-emerald-500/90 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-md shadow-md backdrop-blur-md">
                      <CheckCircle2 className="w-3 h-3" />
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
                    className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    <div className="w-12 h-12 rounded-full bg-brand-red text-white flex items-center justify-center shadow-xl shadow-brand-red/40 transform scale-75 group-hover:scale-100 transition-transform">
                      <Play className="w-6 h-6 fill-white ml-0.5" />
                    </div>
                  </Link>
                </div>

                {/* Info Container */}
                <div className="p-3 flex flex-col flex-1 justify-between bg-[#141519]">
                  <div>
                    <h3 className="text-xs font-bold text-white line-clamp-1 group-hover:text-brand-red transition-colors">
                      {item.Name}
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-1 uppercase font-semibold">
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

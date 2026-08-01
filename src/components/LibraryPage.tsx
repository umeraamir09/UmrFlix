"use client"

import useSWR from "swr"
import { useState, useCallback, useMemo } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { MovieCard } from "@/components/MovieCard"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/Toast"
import type { JellyfinLibraryItem } from "@/app/api/library/route"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function LibraryPage() {
  const { toast } = useToast()
  const [isScanning, setIsScanning] = useState(false)

  // Fetch current user session to determine admin status
  const { data: meData } = useSWR("/api/auth/me", fetcher)
  const isAdmin = Boolean(meData?.user?.isAdmin)

  const { data, error, isLoading, mutate } = useSWR<{
    movies: JellyfinLibraryItem[]
    series: JellyfinLibraryItem[]
    total: number
    error?: string
  }>("/api/library", fetcher)

  const movieItems = useMemo(() => data?.movies ?? [], [data?.movies])
  const seriesItems = useMemo(() => data?.series ?? [], [data?.series])

  // Re-fetch the library bypassing the server's short-TTL cache (e.g. after
  // a scan or delete so the UI reflects the change immediately).
  const refreshLibrary = useCallback(async () => {
    await mutate(async () => {
      const res = await fetch("/api/library?refresh=true")
      return res.json()
    })
  }, [mutate])

  const handleScanLibrary = useCallback(async () => {
    setIsScanning(true)
    try {
      const res = await fetch("/api/library/scan", { method: "POST" })
      if (res.ok) {
        toast("Initiated fresh Jellyfin library scan", "info")
      } else {
        toast("Failed to trigger Jellyfin scan", "error")
      }
    } catch {
      toast("Error connecting to server", "error")
    } finally {
      await refreshLibrary()
      setIsScanning(false)
    }
  }, [refreshLibrary, toast])

  const handleToggleWatched = useCallback(
    async (item: JellyfinLibraryItem) => {
      const isSeries = item.type === "tv"
      const markAsWatched = !item.played
      if (isSeries) {
        const confirmed = window.confirm(
          markAsWatched
            ? `Mark all episodes of "${item.title}" as watched in Jellyfin?`
            : `Mark all episodes of "${item.title}" as unwatched in Jellyfin?`
        )
        if (!confirmed) return
      }

      try {
        const res = await fetch(`/api/jellyfin/played/${item.jellyfinId}`, {
          method: markAsWatched ? "POST" : "DELETE",
        })
        if (res.ok) {
          toast(
            markAsWatched
              ? isSeries
                ? `Marked all episodes of "${item.title}" as watched`
                : `Marked "${item.title}" as watched`
              : `Marked "${item.title}" as unwatched`,
            "success"
          )
          await refreshLibrary()
        } else {
          toast(`Failed to update "${item.title}"`, "error")
        }
      } catch {
        toast("Error updating watched status", "error")
      }
    },
    [refreshLibrary, toast]
  )

  const handleDeleteItem = useCallback(
    async (item: JellyfinLibraryItem) => {
      const confirmed = window.confirm(
        `Are you sure you want to delete "${item.title}"?\n\nThis will permanently delete its media files from Jellyfin and remove it from ${
          item.type === "movie" ? "Radarr" : "Sonarr"
        }.`
      )
      if (!confirmed) return

      try {
        const res = await fetch("/api/library/delete", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jellyfinId: item.jellyfinId,
            type: item.type,
            tmdbId: item.tmdbId ?? undefined,
            tvdbId: item.tvdbId ?? undefined,
          }),
        })

        if (res.ok) {
          toast(`Deleted "${item.title}" from Jellyfin & ${item.type === "movie" ? "Radarr" : "Sonarr"}`, "success")
          await refreshLibrary()
        } else {
          const errData = await res.json().catch(() => ({}))
          toast(errData.error || "Failed to delete item", "error")
        }
      } catch {
        toast("Error deleting item from library", "error")
      }
    },
    [refreshLibrary, toast]
  )

  if (isLoading) {
    return (
      <div className="p-6">
        <h1 className="mb-6 text-2xl font-bold">My Library</h1>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[2/3] w-full rounded-none" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || data?.error) {
    return (
      <div className="p-6">
        <h1 className="mb-6 text-2xl font-bold">My Library</h1>
        <p className="text-muted">
          Unable to connect to Jellyfin server. Make sure Jellyfin is running.
        </p>
        {isAdmin && (
          <Button onClick={handleScanLibrary} disabled={isScanning} variant="secondary" className="mt-4">
            <RefreshCw className={`mr-1 size-4 ${isScanning ? "animate-spin text-accent" : ""}`} />
            {isScanning ? "Scanning Jellyfin..." : "Scan Library"}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="pt-20 px-6 pb-6 max-w-[1600px] mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Library</h1>
          <p className="text-sm text-muted">
            Streamable content downloaded to your Jellyfin library
          </p>
        </div>
        {isAdmin && (
          <Button onClick={handleScanLibrary} disabled={isScanning} variant="ghost" size="sm">
            <RefreshCw className={`mr-1 size-4 ${isScanning ? "animate-spin text-accent" : ""}`} />
            {isScanning ? "Scanning Jellyfin..." : "Scan Library"}
          </Button>
        )}
      </div>

      {/* Movies Section */}
      <section className="mb-8">
        <h2 className="mb-4 text-xl font-semibold">
          Movies ({movieItems.length})
        </h2>
        {movieItems.length === 0 ? (
          <p className="text-muted">
            No movies in your Jellyfin library yet. Browse trending to find something to watch!
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6">
            {movieItems.map((m) => {
              const tmdbId = m.tmdbId ?? 0
              return (
                <MovieCard
                  key={m.jellyfinId}
                  item={{
                    id: tmdbId,
                    title: m.title,
                    poster_path: m.posterUrl,
                    release_date: m.year ? String(m.year) : undefined,
                  }}
                  type="movie"
                  availabilityState={{
                    status: "in_library",
                    jellyfinItemId: m.jellyfinId,
                  }}
                  disabled={!m.tmdbId}
                  onDelete={isAdmin ? () => handleDeleteItem(m) : undefined}
                  onMarkWatched={() => handleToggleWatched(m)}
                  isWatched={m.played}
                />
              )
            })}
          </div>
        )}
      </section>

      {/* TV Shows Section */}
      <section>
        <h2 className="mb-4 text-xl font-semibold">
          TV Shows ({seriesItems.length})
        </h2>
        {seriesItems.length === 0 ? (
          <p className="text-muted">No TV shows in your Jellyfin library yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6">
            {seriesItems.map((s) => {
              const tmdbId = s.tmdbId ?? 0
              return (
                <MovieCard
                  key={s.jellyfinId}
                  item={{
                    id: tmdbId,
                    name: s.title,
                    poster_path: s.posterUrl,
                    first_air_date: s.year ? String(s.year) : undefined,
                  }}
                  type="tv"
                  availabilityState={{
                    status: "in_library",
                    jellyfinItemId: s.jellyfinId,
                  }}
                  disabled={!s.tmdbId}
                  onDelete={isAdmin ? () => handleDeleteItem(s) : undefined}
                  onMarkWatched={() => handleToggleWatched(s)}
                  isWatched={s.played}
                />
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

"use client"

import useSWR, { useSWRConfig } from "swr"
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
  const { mutate: globalMutate } = useSWRConfig()
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

  const [scanProgress, setScanProgress] = useState(0)
  const [scanStepText, setScanStepText] = useState("")

  const handleScanLibrary = useCallback(async () => {
    setIsScanning(true)
    setScanProgress(15)
    setScanStepText("Triggering Jellyfin refresh...")

    try {
      const res = await fetch("/api/library/scan", { method: "POST" })
      if (!res.ok) {
        toast("Failed to trigger Jellyfin scan", "error")
        setIsScanning(false)
        return
      }

      toast("Initiated fresh Jellyfin library scan", "info")
      setScanProgress(35)
      setScanStepText("Scanning media files...")

      // Interval steps to simulate scan progress & live fetch fresh library state
      const steps = [
        { pct: 55, text: "Re-indexing library data..." },
        { pct: 75, text: "Cross-referencing TMDB & Sonarr/Radarr..." },
        { pct: 90, text: "Updating availability status..." },
      ]

      for (const step of steps) {
        await new Promise((r) => setTimeout(r, 1200))
        setScanProgress(step.pct)
        setScanStepText(step.text)
        await refreshLibrary()
      }

      setScanProgress(100)
      setScanStepText("Scan complete!")

      // Trigger global re-validations for library, availability, discovery, jellyfin
      await globalMutate(
        (key) =>
          typeof key === "string" &&
          (key.includes("/api/library") ||
            key.includes("/api/availability") ||
            key.includes("/api/jellyfin") ||
            key.includes("/api/discovery")),
        undefined,
        { revalidate: true }
      )
      await refreshLibrary()
      toast("Jellyfin library scan complete. Library updated.", "success")
    } catch {
      toast("Error connecting to server", "error")
    } finally {
      setTimeout(() => {
        setIsScanning(false)
        setScanProgress(0)
        setScanStepText("")
      }, 800)
    }
  }, [globalMutate, refreshLibrary, toast])

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
          // Optimistically update local library SWR state so item disappears instantly
          await mutate(
            (current) => {
              if (!current) return current
              return {
                ...current,
                movies: current.movies.filter((m) => m.jellyfinId !== item.jellyfinId),
                series: current.series.filter((s) => s.jellyfinId !== item.jellyfinId),
                total: Math.max(0, current.total - 1),
              }
            },
            { revalidate: false }
          )
          // Trigger global re-validation for availability, continue watching, and catalog rows
          await globalMutate(
            (key) =>
              typeof key === "string" &&
              (key.includes("/api/library") ||
                key.includes("/api/availability") ||
                key.includes("/api/jellyfin")),
            undefined,
            { revalidate: true }
          )
          await refreshLibrary()
        } else {
          const errData = await res.json().catch(() => ({}))
          toast(errData.error || "Failed to delete item", "error")
        }
      } catch {
        toast("Error deleting item from library", "error")
      }
    },
    [globalMutate, mutate, refreshLibrary, toast]
  )

  if (isLoading) {
    return (
      <div className="pt-20 px-4 sm:px-6 md:px-8 lg:px-12 2xl:px-16 pb-12 max-w-[1600px] 2xl:max-w-[1920px] 3xl:max-w-[2300px] 4xl:max-w-[2700px] mx-auto">
        <h1 className="mb-6 text-2xl font-bold">My Library</h1>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 sm:gap-5 md:gap-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[240/361] md:aspect-[240/136] w-full rounded-[8px]" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || data?.error) {
    return (
      <div className="pt-20 px-4 sm:px-6 md:px-8 lg:px-12 2xl:px-16 pb-12 max-w-[1600px] 2xl:max-w-[1920px] 3xl:max-w-[2300px] 4xl:max-w-[2700px] mx-auto">
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
    <div className="pt-20 px-4 sm:px-6 md:px-8 lg:px-12 2xl:px-16 pb-12 max-w-[1600px] 2xl:max-w-[1920px] 3xl:max-w-[2300px] 4xl:max-w-[2700px] mx-auto">
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

      {/* Live Scan Library Progress Loader */}
      {isScanning && (
        <div className="mb-6 rounded-lg border border-accent/40 bg-grey-900/90 p-4 shadow-lg backdrop-blur-md transition-all duration-300">
          <div className="flex items-center justify-between gap-4 mb-2.5">
            <div className="flex items-center gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
                <RefreshCw className="size-4 animate-spin text-accent" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  Scanning Jellyfin Library
                  {scanStepText && <span className="text-xs font-normal text-accent">• {scanStepText}</span>}
                </h4>
                <p className="text-xs text-grey-400">
                  Refreshing media metadata and cross-referencing availability across services...
                </p>
              </div>
            </div>
            <span className="text-sm font-bold text-accent">{scanProgress}%</span>
          </div>

          {/* Animated Progress Bar */}
          <div className="h-1.5 w-full rounded-full bg-grey-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent to-red-500 transition-all duration-300 ease-out"
              style={{ width: `${scanProgress}%` }}
            />
          </div>
        </div>
      )}

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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 sm:gap-5 md:gap-6">
            {movieItems.map((m) => {
              const tmdbId = m.tmdbId ?? 0
              return (
                <MovieCard
                  key={m.jellyfinId}
                  item={{
                    id: tmdbId,
                    title: m.title,
                    overview: m.overview,
                    poster_path: m.posterUrl,
                    backdrop_path: m.backdropUrl,
                    vote_average: m.voteAverage,
                    release_date: m.year ? String(m.year) : undefined,
                    jellyfinItemId: m.jellyfinId,
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 sm:gap-5 md:gap-6">
            {seriesItems.map((s) => {
              const tmdbId = s.tmdbId ?? 0
              return (
                <MovieCard
                  key={s.jellyfinId}
                  item={{
                    id: tmdbId,
                    name: s.title,
                    overview: s.overview,
                    poster_path: s.posterUrl,
                    backdrop_path: s.backdropUrl,
                    vote_average: s.voteAverage,
                    first_air_date: s.year ? String(s.year) : undefined,
                    jellyfinItemId: s.jellyfinId,
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

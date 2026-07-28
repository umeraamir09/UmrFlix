"use client"

import useSWR from "swr"
import { useState, useEffect, useCallback } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { MovieCard } from "@/components/MovieCard"
import { useBatchAvailability } from "@/lib/use-availability"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

const fetcher = (url: string) => fetch(url).then((r) => r.json())
const tmdbIdFetcher = async (tvdbId: number): Promise<number> => {
  const res = await fetch(`/api/tmdb-id?tvdbId=${tvdbId}`)
  if (!res.ok) return tvdbId
  const data = await res.json()
  return data.tmdbId ?? tvdbId
}

export function LibraryPage() {
  const { data: movies, error: moviesError, isLoading: moviesLoading, mutate: mutateMovies } = useSWR(
    "/api/radarr/movies?refresh=true",
    fetcher
  )
  const { data: series, error: seriesError, isLoading: seriesLoading, mutate: mutateSeries } = useSWR(
    "/api/sonarr/series?refresh=true",
    fetcher
  )

  const movieItems: { tmdbId: number; title: string; year: number; hasFile: boolean; images: { coverType: string; url: string }[] }[] = movies ?? []
  const seriesItems: { tvdbId: number; title: string; year: number; images: { coverType: string; url: string }[] }[] = series ?? []

  const [tvTmdbIds, setTvTmdbIds] = useState<Record<number, number>>({})

  useEffect(() => {
    seriesItems.forEach(async (s) => {
      if (!tvTmdbIds[s.tvdbId]) {
        const tmdbId = await tmdbIdFetcher(s.tvdbId)
        setTvTmdbIds((prev) => ({ ...prev, [s.tvdbId]: tmdbId }))
      }
    })
  }, [seriesItems])

  const movieRefs = movieItems.filter(m => m.hasFile).map((m) => ({
    tmdbId: m.tmdbId,
    type: "movie" as const,
  }))

  const tvRefs = seriesItems.map((s) => ({
    tmdbId: tvTmdbIds[s.tvdbId] ?? s.tvdbId,
    type: "tv" as const,
    tvdbId: s.tvdbId,
  }))

  const { availabilityMap: movieAvailability } = useBatchAvailability(movieRefs)
  const { availabilityMap: tvAvailability } = useBatchAvailability(tvRefs)

  const isLoading = moviesLoading || seriesLoading
  const hasError = moviesError || seriesError

  const handleRefresh = useCallback(() => {
    mutateMovies()
    mutateSeries()
  }, [mutateMovies, mutateSeries])

  if (isLoading) {
    return (
      <div className="p-6">
        <h1 className="mb-6 text-2xl font-bold">My Library</h1>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[2/3] w-full rounded-lg" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (hasError) {
    return (
      <div className="p-6">
        <h1 className="mb-6 text-2xl font-bold">My Library</h1>
        <p className="text-muted">Unable to connect to Radarr or Sonarr. Make sure the services are running.</p>
        <Button onClick={handleRefresh} variant="secondary" className="mt-4">
          <RefreshCw className="mr-1 size-4" />
          Retry
        </Button>
      </div>
    )
  }

  const downloadedMovies = movieItems.filter((m: { hasFile: boolean }) => m.hasFile)
  const requestedMovies = movieItems.filter((m: { hasFile: boolean }) => !m.hasFile)

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Library</h1>
        <Button onClick={handleRefresh} variant="ghost" size="sm">
          <RefreshCw className="mr-1 size-4" />
          Refresh
        </Button>
      </div>

      <section className="mb-8">
        <h2 className="mb-4 text-xl font-semibold">
          Movies ({downloadedMovies.length + requestedMovies.length})
        </h2>
        {movieItems.length === 0 ? (
          <p className="text-muted">No movies in your library yet. Browse trending to find something to watch!</p>
        ) : (
          <div className="space-y-6">
            {downloadedMovies.length > 0 && (
              <div>
                <h3 className="mb-3 text-sm text-muted">Downloaded</h3>
                <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6">
                  {downloadedMovies.map((m: { tmdbId: number; title: string; year: number; images: { coverType: string; url: string }[] }) => (
                    <MovieCard
                      key={m.tmdbId}
                      item={{
                        id: m.tmdbId,
                        title: m.title,
                        poster_path: m.images?.find((i) => i.coverType === "poster")?.url?.replace("http://", "https://") ?? null,
                        release_date: String(m.year),
                      }}
                      type="movie"
                      availabilityState={movieAvailability[`movie-${m.tmdbId}`]}
                    />
                  ))}
                </div>
              </div>
            )}
            {requestedMovies.length > 0 && (
              <div>
                <h3 className="mb-3 text-sm text-muted">Requested</h3>
                <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6">
                  {requestedMovies.map((m: { tmdbId: number; title: string; year: number; images: { coverType: string; url: string }[] }) => (
                    <MovieCard
                      key={m.tmdbId}
                      item={{
                        id: m.tmdbId,
                        title: m.title,
                        poster_path: m.images?.find((i) => i.coverType === "poster")?.url?.replace("http://", "https://") ?? null,
                        release_date: String(m.year),
                      }}
                      type="movie"
                      availabilityState={movieAvailability[`movie-${m.tmdbId}`]}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">TV Shows ({seriesItems.length})</h2>
        {seriesItems.length === 0 ? (
          <p className="text-muted">No TV shows in your library yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6">
            {seriesItems.map((s: { tvdbId: number; title: string; year: number; images: { coverType: string; url: string }[] }) => {
              const resolvedId = tvTmdbIds[s.tvdbId] ?? s.tvdbId
              return (
                <MovieCard
                  key={s.tvdbId}
                  item={{
                    id: resolvedId,
                    name: s.title,
                    poster_path: s.images?.find((i) => i.coverType === "poster")?.url?.replace("http://", "https://") ?? null,
                    first_air_date: String(s.year),
                  }}
                  type="tv"
                  availabilityState={tvAvailability[`tv-${s.tvdbId}`]}
                />
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

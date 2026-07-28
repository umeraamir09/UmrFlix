"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import useSWR from "swr"
import Image from "next/image"
import Link from "next/link"
import { MovieCard } from "@/components/MovieCard"
import { useBatchAvailability } from "@/lib/use-availability"
import { Search, X, Film, Tv } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function SearchResults() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const genre = searchParams.get("genre") ?? ""
  const initialQuery = searchParams.get("q") ?? ""
  const [query, setQuery] = useState(initialQuery)

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "")
  }, [searchParams])

  const searchUrl = query
    ? `/api/tmdb/search?q=${encodeURIComponent(query)}`
    : genre
      ? `/api/tmdb/trending/movie/week`
      : null

  const { data: searchData, error, isLoading } = useSWR(searchUrl, fetcher)

  const rawResults: any[] = searchData?.results ?? []

  const movies = rawResults.filter((r) => r.media_type === "movie" || (!r.media_type && r.title))
  const series = rawResults.filter((r) => r.media_type === "tv" || (!r.media_type && r.name))
  const topResults = rawResults.slice(0, 3)

  const movieRefs = movies.map((i) => ({ tmdbId: i.id, type: "movie" as const }))
  const tvRefs = series.map((i) => ({ tmdbId: i.id, type: "tv" as const }))

  const { availabilityMap: movieAvailability } = useBatchAvailability(movieRefs)
  const { availabilityMap: tvAvailability } = useBatchAvailability(tvRefs)

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`)
    }
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 md:px-8 space-y-10">
      {/* Crunchyroll-Style Top Search Input Banner */}
      <div className="relative mx-auto max-w-2xl text-center pt-4">
        <form onSubmit={handleSearchSubmit} className="relative flex items-center">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search catalog..."
            className="w-full bg-transparent pb-3 pt-2 text-2xl sm:text-3xl font-bold text-white placeholder-gray-600 border-b-2 border-accent focus:outline-none transition-colors"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("")
                router.push("/search")
              }}
              className="absolute right-0 pb-3 text-gray-400 hover:text-white"
            >
              <X className="size-6" />
            </button>
          ) : (
            <Search className="absolute right-0 pb-3 size-10 text-accent" />
          )}
        </form>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 pt-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] animate-shimmer rounded-md" />
          ))}
        </div>
      ) : error ? (
        <p className="text-center text-sm text-gray-400 py-12">Search failed. Please verify connection.</p>
      ) : rawResults.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-16">
          No results found for &ldquo;{query || genre}&rdquo;. Try another search term!
        </p>
      ) : (
        <div className="space-y-12">
          {/* Section 1: Top Results (Crunchyroll Widescreen Cards) */}
          {topResults.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xl font-black uppercase text-white tracking-tight">Top Results</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {topResults.map((item) => {
                  const isTv = item.media_type === "tv" || !!item.name
                  const title = item.title || item.name || "Untitled"
                  const backdrop = item.backdrop_path
                    ? `https://image.tmdb.org/t/p/w500${item.backdrop_path}`
                    : `https://image.tmdb.org/t/p/w500${item.poster_path}`

                  return (
                    <Link
                      key={item.id}
                      href={`/${isTv ? "tv" : "movie"}/${item.id}`}
                      className="group relative overflow-hidden rounded-md border border-[#282c37] bg-[#141519] transition-all hover:border-accent shadow-md"
                    >
                      <div className="relative aspect-video w-full overflow-hidden bg-[#1a1c23]">
                        {backdrop && (
                          <Image
                            src={backdrop}
                            alt={title}
                            fill
                            className="object-cover transition-transform duration-300 group-hover:scale-105"
                            unoptimized
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-[#141519] via-transparent to-transparent" />
                      </div>
                      <div className="p-3">
                        <h3 className="text-sm font-bold text-white group-hover:text-accent transition-colors truncate">
                          {title}
                        </h3>
                        <p className="text-[11px] font-medium text-gray-400 mt-0.5">
                          Sub | Dub {isTv ? "• Series" : "• Movie"}
                        </p>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {/* Section 2: TV Series */}
          {series.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xl font-black uppercase text-white tracking-tight flex items-center gap-2">
                <Tv className="size-5 text-accent" />
                TV Shows ({series.length})
              </h2>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6">
                {series.map((item) => (
                  <MovieCard
                    key={item.id}
                    item={item}
                    type="tv"
                    availabilityState={tvAvailability[`tv-${item.id}`]}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Section 3: Movies */}
          {movies.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xl font-black uppercase text-white tracking-tight flex items-center gap-2">
                <Film className="size-5 text-accent" />
                Movies ({movies.length})
              </h2>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6">
                {movies.map((item) => (
                  <MovieCard
                    key={item.id}
                    item={item}
                    type="movie"
                    availabilityState={movieAvailability[`movie-${item.id}`]}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

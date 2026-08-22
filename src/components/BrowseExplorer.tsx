"use client"

import { useMemo, useRef, useEffect, useState } from "react"
import useSWRInfinite from "swr/infinite"
import { MovieCard, type MovieCardItem } from "@/components/MovieCard"
import { Loader2 } from "lucide-react"
import { getMovieGenres, getTvGenres, type GenreFilterItem } from "@/lib/genres"

type BrowseResponse = {
  results: MovieCardItem[]
  page: number
  totalPages: number
  totalResults: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const SORTS = [
  { value: "popularity", label: "Popularity" },
  { value: "rating", label: "Rating" },
  { value: "newest", label: "Newest" },
]

/**
 * Catalog explorer grid (audit §2.7 / R1-5): full-catalog browse surface
 * with sort + genre filters and paginated loading. This is where the
 * down-ranked long tail stays reachable — rows stay clean, the explorer
 * stays complete.
 */
export function BrowseExplorer() {
  const [mediaType, setMediaType] = useState<"movie" | "tv">("movie")
  const [genre, setGenre] = useState<string>("")
  const [sort, setSort] = useState<string>("popularity")

  const genres: GenreFilterItem[] = useMemo(
    () => (mediaType === "tv" ? getTvGenres() : getMovieGenres()),
    [mediaType]
  )

  const getKey = (pageIndex: number, previous: BrowseResponse | null): string | null => {
    if (previous && pageIndex > 0 && previous.page >= previous.totalPages) return null
    const params = new URLSearchParams({
      mediaType,
      sort,
      page: String(pageIndex + 1),
    })
    if (genre) params.set("genre", genre)
    return `/api/discovery/browse?${params.toString()}`
  }

  const { data, size, setSize, isLoading, isValidating } = useSWRInfinite<BrowseResponse>(
    getKey,
    fetcher,
    { revalidateFirstPage: false }
  )

  const items: MovieCardItem[] = useMemo(
    () => (data ?? []).flatMap((page) => page?.results ?? []),
    [data]
  )
  const lastPage = data?.[data.length - 1]
  const hasMore = !!lastPage && lastPage.page < lastPage.totalPages

  // Reset pagination when filters change.
  useEffect(() => {
    if (size !== 1) void setSize(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaType, genre, sort])

  // Infinite scroll sentinel.
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore || isLoading || isValidating) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void setSize(size + 1)
        }
      },
      { rootMargin: "600px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, isLoading, isValidating, size, setSize])

  const selectClass =
    "rounded-[4px] border border-penpot-border bg-penpot-surface px-3 py-2 text-sm text-white focus:outline-none focus:border-penpot-primary-300 cursor-pointer"

  return (
    <div className="space-y-6">
      {/* Filter / sort bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-[4px] border border-penpot-border overflow-hidden">
          {(["movie", "tv"] as const).map((mt) => (
            <button
              key={mt}
              type="button"
              onClick={() => setMediaType(mt)}
              className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                mediaType === mt
                  ? "bg-penpot-primary-300 text-white"
                  : "bg-penpot-surface text-penpot-text-medium hover:text-white"
              }`}
            >
              {mt === "movie" ? "Movies" : "Series"}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-penpot-text-medium">
          <span className="sr-only">Genre</span>
          <select
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className={selectClass}
            aria-label="Filter by genre"
          >
            <option value="">All Genres</option>
            {genres.map((g) => (
              <option key={g.slug} value={g.slug ?? ""}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-penpot-text-medium">
          <span className="sr-only">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className={selectClass}
            aria-label="Sort results"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </select>
        </label>

        {lastPage && (
          <span className="text-xs text-penpot-text-medium">
            {lastPage.totalResults.toLocaleString()} titles
          </span>
        )}
      </div>

      {/* Results grid */}
      {isLoading && items.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-4">
          {Array.from({ length: 18 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[240/361] w-full rounded-[8px] bg-penpot-surface/60 border border-penpot-border/40 animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-penpot-text-medium text-sm">
          No titles match these filters.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-4">
          {items.map((item) => (
            <MovieCard
              key={`${item.media_type ?? mediaType}-${item.id}`}
              item={item}
              type={(item.media_type as "movie" | "tv") ?? mediaType}
              cardVariant="large"
            />
          ))}
        </div>
      )}

      {/* Sentinel + explicit load-more fallback */}
      <div ref={sentinelRef} className="h-1" aria-hidden />
      {hasMore && (
        <div className="flex justify-center py-4">
          <button
            type="button"
            onClick={() => void setSize(size + 1)}
            disabled={isLoading || isValidating}
            className="flex items-center gap-2 rounded-[4px] border border-penpot-border bg-penpot-surface px-5 py-2.5 text-sm font-medium text-white hover:bg-penpot-neutral-500 active:scale-95 transition-all cursor-pointer disabled:opacity-60"
          >
            {(isLoading || isValidating) && <Loader2 className="size-4 animate-spin" />}
            Load More
          </button>
        </div>
      )}
    </div>
  )
}

"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import useSWR from "swr"
import Image from "next/image"
import Link from "next/link"
import { Search, X, ChevronRight, ChevronDown, Loader2 } from "lucide-react"
import { useBatchAvailability } from "@/lib/use-availability"
import { AvailabilityBadge } from "@/components/AvailabilityBadge"
import { getGenreByParam, getGenreIdsForMediaType } from "@/lib/genres"
import { filterDisplayableContent } from "@/lib/catalog"

const RECENT_SEARCHES_KEY = "umrflix_recent_searches"
const MAX_RECENTS = 6

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const SORT_OPTIONS = [
  { value: "popularity", label: "Popularity" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "A-Z" },
]

const TYPE_OPTIONS = [
  { value: "", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV Shows" },
]

const GENRE_PARAMS: Record<string, string> = {
  popularity: "sort_by=popularity.desc",
  newest: "sort_by=primary_release_date.desc;sort_by=first_air_date.desc",
  name: "sort_by=original_title.asc",
}

export function SearchResults() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const genre = searchParams.get("genre") ?? ""
  const type = searchParams.get("type") ?? "" // "movie" | "tv" | ""
  const filter = searchParams.get("filter") ?? "" // "popular"
  const sort = searchParams.get("sort") ?? "popularity"
  const urlQuery = searchParams.get("q") ?? ""

  const [inputValue, setInputValue] = useState(urlQuery)
  const [debouncedQuery, setDebouncedQuery] = useState(urlQuery)
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY)
      return saved ? JSON.parse(saved) : []
    } catch (e) {
      console.error("Failed to load recent searches:", e)
      return []
    }
  })
  const [showAllSeries, setShowAllSeries] = useState(false)
  const [showAllMovies, setShowAllMovies] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus input field on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  // Sync state when URL searchParams change externally (e.g., browser back/forward or clicking links)
  useEffect(() => {
    const q = searchParams.get("q") ?? ""
    setInputValue(q)
    setDebouncedQuery(q)
  }, [searchParams])

  // Real-time search content refresh while typing (debounced)
  useEffect(() => {
    const currentUrlQ = searchParams.get("q") ?? ""
    const timer = setTimeout(() => {
      setDebouncedQuery(inputValue)
      if (inputValue.trim() !== currentUrlQ.trim()) {
        const params = new URLSearchParams(searchParams.toString())
        const trimmed = inputValue.trim()
        if (trimmed) {
          params.set("q", trimmed)
        } else {
          params.delete("q")
        }
        const newUrl = params.toString() ? `/search?${params.toString()}` : "/search"
        router.replace(newUrl, { scroll: false })
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [inputValue, router, searchParams])

  // Save recent search
  const addRecentSearch = useCallback((term: string) => {
    const trimmed = term.trim()
    if (!trimmed) return
    setRecentSearches((prev) => {
      const filtered = prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())
      const updated = [trimmed.toUpperCase(), ...filtered].slice(0, MAX_RECENTS)
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
      } catch (e) {
        console.error("Failed to save recent search:", e)
      }
      return updated
    })
  }, [])

  // Remove individual recent search
  const removeRecentSearch = (e: React.MouseEvent, termToRemove: string) => {
    e.stopPropagation()
    setRecentSearches((prev) => {
      const updated = prev.filter((item) => item !== termToRemove)
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
      } catch (err) {
        console.error("Failed to save recent searches after removal:", err)
      }
      return updated
    })
  }

  // Clear all recent searches
  const clearAllRecents = () => {
    setRecentSearches([])
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY)
    } catch (e) {
      console.error("Failed to clear recent searches:", e)
    }
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = inputValue.trim()
    if (trimmed) {
      addRecentSearch(trimmed)
      setDebouncedQuery(trimmed)
      const params = new URLSearchParams(searchParams.toString())
      params.set("q", trimmed)
      router.push(`/search?${params.toString()}`)
    } else {
      router.push("/search")
    }
  }

  const handleSelectRecent = (term: string) => {
    setInputValue(term)
    setDebouncedQuery(term)
    addRecentSearch(term)
    router.push(`/search?q=${encodeURIComponent(term)}`)
  }

  const handleClear = () => {
    setInputValue("")
    setDebouncedQuery("")
    const params = new URLSearchParams(searchParams.toString())
    params.delete("q")
    const newUrl = params.toString() ? `/search?${params.toString()}` : "/search"
    router.replace(newUrl, { scroll: false })
    inputRef.current?.focus()
  }

  // Update a browse param while preserving others
  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
    }
    params.delete("q") // browsing clears text search
    router.push(`/search?${params.toString()}`)
  }

  const query = debouncedQuery
  const isBrowseMode = !query.trim()
  const genreDef = genre ? getGenreByParam(genre) : null

  // Build API URL
  const searchUrl = useMemo(() => {
    if (query) {
      return `/api/tmdb/search/multi?query=${encodeURIComponent(query)}`
    }

    // Browse mode
    const genreIds = genreDef
      ? getGenreIdsForMediaType(genreDef, type === "tv" ? "tv" : "movie")
      : []
    const genreId = genreIds.length > 0 ? genreIds.join(",") : null
    const resolveEndpoint = (): string => {
      if (filter === "popular") {
        if (type === "tv") return "/api/tmdb/tv/popular"
        if (type === "movie") return "/api/tmdb/movie/popular"
        return "/api/tmdb/trending/all/week"
      }
      const mediaType = type || "movie"
      return `/api/tmdb/discover/${mediaType}`
    }

    const endpoint = resolveEndpoint()
    const params: string[] = []

    // Sort
    const sortParam = GENRE_PARAMS[sort] || GENRE_PARAMS.popularity
    params.push(...sortParam.split(";"))

    // Genre filter
    if (genreId && !endpoint.includes("trending")) {
      params.push(`with_genres=${genreId}`)
    }

    // Released only
    const today = new Date().toISOString().split("T")[0]
    if (type === "tv") {
      params.push(`air_date.lte=${today}`)
    } else {
      params.push(`primary_release_date.lte=${today}`)
    }

    if (genreId && endpoint.includes("trending")) {
      // trending doesn't support filter params, use discover instead
      const mediaType = type || "movie"
      let url = `/api/tmdb/discover/${mediaType}?sort_by=popularity.desc&with_genres=${genreId}&primary_release_date.lte=${today}`
      if (mediaType === "tv") {
        url = `/api/tmdb/discover/tv?sort_by=popularity.desc&with_genres=${genreId}&air_date.lte=${today}`
      }
      return url
    }

    return `${endpoint}?${params.join("&")}`
  }, [query, genreDef, type, filter, sort])

  const { data: searchData, error, isLoading } = useSWR(searchUrl, fetcher)

  const rawResults: any[] = searchData?.results ?? []

  // Filter out unreleased, announced, & cinema-only items
  const results = useMemo(() => {
    let items = filterDisplayableContent(rawResults)
    if (isBrowseMode && sort === "name") {
      items = [...items].sort((a, b) => {
        const aTitle = (a.title || a.name || "").toLowerCase()
        const bTitle = (b.title || b.name || "").toLowerCase()
        return aTitle.localeCompare(bTitle)
      })
    }
    return items
  }, [rawResults, isBrowseMode, sort])

  // Batch availability check
  const itemRefs = useMemo(() => {
    return results.map((item) => {
      const isTv = item.media_type === "tv" || (!item.title && item.name)
      return {
        tmdbId: item.id,
        type: isTv ? ("tv" as const) : ("movie" as const),
      }
    })
  }, [results])

  const { availabilityMap } = useBatchAvailability(itemRefs)

  const movies = results.filter((r) => r.media_type === "movie" || (!r.media_type && r.title))
  const series = results.filter((r) => r.media_type === "tv" || (!r.media_type && r.name))
  const topResults = results.slice(0, 3)

  const visibleSeries = showAllSeries ? series : series.slice(0, 6)
  const visibleMovies = showAllMovies ? movies : movies.slice(0, 6)

  // Determine title for browse sections
  const browseTitle = filter === "popular"
    ? "Popular"
    : genre
      ? genre
      : type === "movie"
        ? "Movies"
        : type === "tv"
          ? "TV Shows"
          : "Browse"

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 md:px-8 space-y-10">
      {/* Search Bar Header */}
      <div className="relative w-full pt-2">
        <form onSubmit={handleSearchSubmit} className="relative flex items-center">
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search..."
            className={`w-full bg-transparent pb-3 pt-2 text-2xl sm:text-3xl font-medium text-white placeholder-gray-500 border-b ${inputValue ? "border-accent" : "border-border focus:border-accent"
              } focus:outline-none transition-colors pr-10`}
          />
          {isLoading && inputValue.trim() ? (
            <Loader2 className="absolute right-0 pb-3 size-6 animate-spin text-accent pointer-events-none" />
          ) : inputValue ? (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-0 pb-3 text-gray-400 hover:text-white transition-colors"
              title="Clear Search"
            >
              <X className="size-6" />
            </button>
          ) : (
            <Search className="absolute right-0 pb-3 size-6 text-gray-400 pointer-events-none" />
          )}
        </form>
      </div>

      {/* Browse Filters (type / sort / quick filters) - styled to match the existing design */}
      {isBrowseMode && (
        <div className="w-full space-y-4">
          {/* Filter Row: Type */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mr-1">Filter By</span>
            {TYPE_OPTIONS.map((opt) => {
              const active = type === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => updateParams({ type: opt.value })}
                  className={`bg-surface border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all rounded-none ${
                    active
                      ? "border-accent text-white hover:bg-card"
                      : "border-border text-gray-300 hover:bg-card hover:border-accent hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}

            <span className="hidden sm:inline-block h-4 w-px bg-separator mx-2" />

            {/* Sort Dropdown */}
            <div className="relative inline-flex">
              <select
                value={sort}
                onChange={(e) => updateParams({ sort: e.target.value })}
                className="appearance-none bg-surface border border-border hover:border-accent px-3 py-1.5 pr-8 text-xs font-bold uppercase tracking-wider text-gray-300 hover:text-white cursor-pointer transition-all rounded-none focus:outline-none"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-surface text-white">
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-gray-400" />
            </div>

            {/* Active genre chip */}
            {genre && (
              <div className="flex items-center gap-2 bg-surface border border-accent px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white rounded-none">
                <span>{genre}</span>
                <button
                  type="button"
                  onClick={() => updateParams({ genre: "" })}
                  className="text-gray-400 hover:text-white transition-colors"
                  title="Clear genre"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Dedicated Genre Page Banner */}
          {genreDef && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-surface border border-accent/40 p-4 rounded-none shadow-lg">
              <div>
                <p className="text-sm font-bold text-white">Looking for the dedicated {genreDef.name} experience?</p>
                <p className="text-xs text-foreground-muted mt-0.5">Explore curated sub-categories, personalized picks, and available library titles for {genreDef.name}.</p>
              </div>
              <Link
                href={`/genre/${genreDef.slug}`}
                className="shrink-0 inline-flex items-center gap-2 bg-accent text-white px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all hover:bg-accent/90 hover:scale-[1.02] active:scale-95"
              >
                Explore Dedicated {genreDef.name} Page →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Initial Empty View: Recent Searches */}
      {!query && !genre && !type && !filter && (
        <div className="w-full pt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">
              Recent Search Results
            </h2>
            {recentSearches.length > 0 && (
              <button
                onClick={clearAllRecents}
                className="text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-white transition-colors"
              >
                Clear Recent
              </button>
            )}
          </div>

          {recentSearches.length > 0 ? (
            <div className="flex flex-wrap gap-2.5 pt-1">
              {recentSearches.map((term) => (
                <div
                  key={term}
                  onClick={() => handleSelectRecent(term)}
                  className="group flex items-center gap-2 bg-surface hover:bg-card border border-border hover:border-accent px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-gray-300 hover:text-white cursor-pointer transition-all rounded-none"
                >
                  <span>{term}</span>
                  <button
                    type="button"
                    onClick={(e) => removeRecentSearch(e, term)}
                    className="text-gray-400 hover:text-white transition-colors p-0.5"
                    title="Remove item"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 pt-2">No recent searches yet.</p>
          )}
        </div>
      )}

      {/* Active Search / Browse Results State */}
      {(query || genre || type || filter) && (
        <>
          {isLoading ? (
            <div className="space-y-8 pt-4">
              <div className="space-y-3">
                <div className="h-6 w-32 bg-card animate-pulse rounded-none" />
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="aspect-video bg-card animate-shimmer rounded-none" />
                  ))}
                </div>
              </div>
            </div>
          ) : error ? (
            <p className="text-center text-sm text-gray-400 py-12">
              Search failed. Please verify connection.
            </p>
          ) : results.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-16">
              No results found for &ldquo;{query || genre || browseTitle}&rdquo;. Try another search term!
            </p>
          ) : (
            <div className="space-y-12 pt-2">
              {/* Top Results Section */}
              {topResults.length > 0 && (
                <section className="space-y-4">
                  <h2 className="text-base sm:text-lg font-bold uppercase tracking-wider text-white">
                    {isBrowseMode ? browseTitle : "Top Results"}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {topResults.map((item) => {
                      const isTv = item.media_type === "tv" || (!item.title && item.name)
                      const title = item.title || item.name || "Untitled"
                      const backdrop = item.backdrop_path
                        ? `https://image.tmdb.org/t/p/w500${item.backdrop_path}`
                        : item.poster_path
                          ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
                          : "/placeholder-poster.svg"

                      const availabilityKey = `${isTv ? "tv" : "movie"}-${item.id}`
                      const availability = availabilityMap[availabilityKey]

                      return (
                        <Link
                          key={item.id}
                          href={`/${isTv ? "tv" : "movie"}/${item.id}`}
                          className="group block overflow-hidden rounded-none bg-transparent relative"
                        >
                          <div className="relative aspect-video w-full overflow-hidden bg-card border border-border group-hover:border-accent transition-colors">
                            <Image
                              src={backdrop}
                              alt={title}
                              fill
                              className="object-cover transition-transform duration-300 group-hover:scale-105"
                              unoptimized
                            />
                            {/* Availability Badge */}
                            <div className="absolute top-2 right-2 z-10 pointer-events-none">
                              {availability?.status === "in_library" ? (
                                <AvailabilityBadge state={availability} />
                              ) : (
                                <div />
                              )}
                            </div>
                          </div>
                          <div className="pt-2.5">
                            <h3 className="text-sm font-bold text-white group-hover:text-accent transition-colors truncate">
                              {title}
                            </h3>
                            <p className="text-xs font-medium text-gray-400 mt-0.5">
                              Subtitled {isTv ? "• Series" : "• Movie"}
                            </p>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </section>
              )}

              {/* Series Section */}
              {series.length > 0 && (
                <section className="space-y-4">
                  <h2 className="text-base sm:text-lg font-bold uppercase tracking-wider text-white">
                    Series
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {visibleSeries.map((item) => {
                      const title = item.name || item.title || "Untitled"
                      const poster = item.poster_path
                        ? `https://image.tmdb.org/t/p/w185${item.poster_path}`
                        : "/placeholder-poster.svg"
                      const year = item.first_air_date
                        ? new Date(item.first_air_date).getFullYear()
                        : null

                      const availabilityKey = `tv-${item.id}`
                      const availability = availabilityMap[availabilityKey]

                      return (
                        <Link
                          key={item.id}
                          href={`/tv/${item.id}`}
                          className="group flex items-start gap-3.5 p-2 rounded-none hover:bg-card border border-transparent hover:border-border transition-colors relative"
                        >
                          <div className="relative h-20 w-14 flex-shrink-0 overflow-hidden bg-card border border-border">
                            <Image
                              src={poster}
                              alt={title}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                            {/* Availability Badge on poster */}
                            <div className="absolute top-1 right-1 z-10 pointer-events-none scale-90 origin-top-right">
                              {availability?.status === "in_library" ? (
                                <AvailabilityBadge state={availability} />
                              ) : (
                                <div />
                              )}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <h3 className="text-sm font-bold text-white group-hover:text-accent transition-colors truncate">
                              {title}
                            </h3>
                            <p className="text-xs font-medium text-gray-400 mt-0.5">
                              {year ? `1 Season • ${year}` : "1 Season"}
                            </p>
                            <p className="text-xs font-medium text-gray-400 mt-0.5">
                              Sub | Dub
                            </p>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                  {series.length > 6 && !showAllSeries && (
                    <button
                      onClick={() => setShowAllSeries(true)}
                      className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-white transition-colors pt-1"
                    >
                      <span>See More</span>
                      <ChevronRight className="size-4" />
                    </button>
                  )}
                </section>
              )}

              {/* Movies Section */}
              {movies.length > 0 && (
                <section className="space-y-4">
                  <h2 className="text-base sm:text-lg font-bold uppercase tracking-wider text-white">
                    Movies
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {visibleMovies.map((item) => {
                      const title = item.title || item.name || "Untitled"
                      const poster = item.poster_path
                        ? `https://image.tmdb.org/t/p/w185${item.poster_path}`
                        : "/placeholder-poster.svg"
                      const year = item.release_date
                        ? new Date(item.release_date).getFullYear()
                        : null

                      const availabilityKey = `movie-${item.id}`
                      const availability = availabilityMap[availabilityKey]

                      return (
                        <Link
                          key={item.id}
                          href={`/movie/${item.id}`}
                          className="group flex items-start gap-3.5 p-2 rounded-none hover:bg-card border border-transparent hover:border-border transition-colors relative"
                        >
                          <div className="relative h-20 w-14 flex-shrink-0 overflow-hidden bg-card border border-border">
                            <Image
                              src={poster}
                              alt={title}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                            {/* Availability Badge on poster */}
                            <div className="absolute top-1 right-1 z-10 pointer-events-none scale-90 origin-top-right">
                              {availability?.status === "in_library" ? (
                                <AvailabilityBadge state={availability} />
                              ) : (
                                <div />
                              )}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <h3 className="text-sm font-bold text-white group-hover:text-accent transition-colors truncate">
                              {title}
                            </h3>
                            <p className="text-xs font-medium text-gray-400 mt-0.5">
                              Movie {year ? `• ${year}` : ""}
                            </p>
                            <p className="text-xs font-medium text-gray-400 mt-0.5">
                              Sub | Dub
                            </p>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                  {movies.length > 6 && !showAllMovies && (
                    <button
                      onClick={() => setShowAllMovies(true)}
                      className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-white transition-colors pt-1"
                    >
                      <span>See More</span>
                      <ChevronRight className="size-4" />
                    </button>
                  )}
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

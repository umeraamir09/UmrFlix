"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import useSWR from "swr"
import Image from "next/image"
import Link from "next/link"
import { Search, X, ChevronRight, ChevronDown, Loader2 } from "lucide-react"
import { useBatchAvailability } from "@/lib/use-availability"
import { useBatchHorizontalPosters } from "@/lib/use-horizontal-posters"
import { AvailabilityBadge } from "@/components/AvailabilityBadge"
import { getGenreByParam, getGenreIdsForMediaType, getGenreDiscoverParams } from "@/lib/genres"
import { filterDisplayableContent } from "@/lib/catalog"
import { qualityFloorParams } from "@/lib/catalog-quality"
import { getImageUrl } from "@/lib/utils"

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

type SearchResultItem = {
  id: number
  title?: string
  name?: string
  overview: string
  backdrop_path: string | null
  poster_path: string | null
  vote_average: number
  release_date?: string
  first_air_date?: string
  media_type?: string
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

  const lastSyncedQueryRef = useRef(urlQuery)

  // Sync state when URL searchParams change externally (e.g., browser back/forward or clicking links)
  useEffect(() => {
    const q = searchParams.get("q") ?? ""
    // Only overwrite local input state if URL change was NOT triggered by our own typing sync
    if (q !== lastSyncedQueryRef.current) {
      lastSyncedQueryRef.current = q
      setInputValue(q)
      setDebouncedQuery(q)
    }
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
        lastSyncedQueryRef.current = trimmed
        const newUrl = params.toString() ? `/search?${params.toString()}` : "/search"
        router.replace(newUrl, { scroll: false })
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [inputValue, router, searchParams])

  // Save recent search
  const addRecentSearch = useCallback((term: string) => {
    const trimmed = term.trim()
    if (!trimmed || trimmed.length < 2) return
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

  // Record active query when user selects a search result item
  const handleResultClick = () => {
    if (inputValue.trim()) {
      addRecentSearch(inputValue)
    }
  }

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

    // Extra genre discover filters (e.g. anime -> with_origin_country=JP)
    if (genreDef) {
      const mediaTypeForParams = type === "tv" ? "tv" : "movie"
      for (const [key, value] of Object.entries(
        getGenreDiscoverParams(genreDef, mediaTypeForParams)
      )) {
        params.push(`${key}=${encodeURIComponent(value)}`)
      }
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
      // (R0-2: floors from the central config — the old 20/10-vote,
      // 1.5-popularity literals let soap/daily content through)
      const mediaType = type || "movie"
      const extras = new URLSearchParams(
        getGenreDiscoverParams(genreDef!, mediaType as "movie" | "tv")
      ).toString()
      const extrasSuffix = extras ? `&${extras}` : ""
      const browseMovie = new URLSearchParams(qualityFloorParams("browse", "movie")).toString()
      const browseTv = new URLSearchParams(qualityFloorParams("browse", "tv")).toString()
      let url = `/api/tmdb/discover/${mediaType}?sort_by=popularity.desc&${browseMovie}&with_runtime.gte=20&with_genres=${genreId}&primary_release_date.lte=${today}${extrasSuffix}`
      if (mediaType === "tv") {
        url = `/api/tmdb/discover/tv?sort_by=popularity.desc&${browseTv}&with_genres=${genreId}&air_date.lte=${today}${extrasSuffix}`
      }
      return url
    }

    return `${endpoint}?${params.join("&")}`
  }, [query, genreDef, type, filter, sort])

  const { data: searchData, error, isLoading } = useSWR(searchUrl, fetcher)

  // Auto-record query when user pauses typing for 2.5s and results are ready
  useEffect(() => {
    const term = debouncedQuery.trim()
    if (!term || term.length < 2 || isLoading) return

    const idleTimer = setTimeout(() => {
      addRecentSearch(term)
    }, 2500)

    return () => clearTimeout(idleTimer)
  }, [debouncedQuery, isLoading, addRecentSearch])

  // Filter out unreleased, announced, & cinema-only items.
  // Browse mode stays strict (no theatre-only titles); a typed query should
  // still surface movies that are currently in the theatrical window, so
  // cinema-only items are kept there.
  const results = useMemo(() => {
    const rawResults: SearchResultItem[] = searchData?.results ?? []
    let items = filterDisplayableContent(rawResults, { includeCinemas: !isBrowseMode })
    if (isBrowseMode && sort === "name") {
      items = [...items].sort((a, b) => {
        const aTitle = (a.title || a.name || "").toLowerCase()
        const bTitle = (b.title || b.name || "").toLowerCase()
        return aTitle.localeCompare(bTitle)
      })
    }
    return items
  }, [searchData, isBrowseMode, sort])

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

  const posterRefs = useMemo(() => {
    return results.map((item) => {
      const isTv = item.media_type === "tv" || (!item.title && item.name)
      return {
        id: item.id,
        type: isTv ? ("tv" as const) : ("movie" as const),
      }
    })
  }, [results])

  const { availabilityMap } = useBatchAvailability(itemRefs)
  const { posterMap } = useBatchHorizontalPosters(posterRefs)

  const getPosterUrl = useCallback(
    (item: SearchResultItem, isTv: boolean) => {
      const key = `${isTv ? "tv" : "movie"}-${item.id}`
      const horizontalPoster = posterMap[key]
      if (horizontalPoster) return getImageUrl(horizontalPoster, "w780")
      if (item.backdrop_path) return getImageUrl(item.backdrop_path, "w780")
      if (item.poster_path) return getImageUrl(item.poster_path, "w780")
      return "/placeholder-poster.svg"
    },
    [posterMap]
  )

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
    <div className="mx-auto max-w-[1600px] 2xl:max-w-[1920px] 3xl:max-w-[2300px] 4xl:max-w-[2700px] px-4 py-8 sm:px-6 md:px-8 lg:px-12 2xl:px-16 space-y-10">
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
            className={`w-full bg-transparent pb-3 pt-2 text-2xl sm:text-3xl font-medium text-white placeholder:text-penpot-text-subtle border-b ${
              inputValue ? "border-penpot-primary-300" : "border-penpot-border focus:border-penpot-primary-300"
            } focus:outline-none transition-colors pr-10`}
          />
          {isLoading && inputValue.trim() ? (
            <Loader2 className="absolute right-0 pb-3 size-6 animate-spin text-penpot-primary-200 pointer-events-none" />
          ) : inputValue ? (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-0 pb-3 text-penpot-text-medium hover:text-white transition-colors cursor-pointer"
              title="Clear Search"
            >
              <X className="size-6" />
            </button>
          ) : (
            <Search className="absolute right-0 pb-3 size-6 text-penpot-text-subtle pointer-events-none" />
          )}
        </form>
      </div>

      {/* Browse Filters (type / sort / quick filters) - styled to match the existing design */}
      {isBrowseMode && (
        <div className="w-full space-y-4">
          {/* Filter Row: Type */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[11px] font-bold text-penpot-text-medium uppercase tracking-wider mr-1">Filter By</span>
            {TYPE_OPTIONS.map((opt) => {
              const active = type === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => updateParams({ type: opt.value })}
                  className={`bg-penpot-surface border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all rounded-[4px] cursor-pointer ${
                    active
                      ? "border-penpot-primary-300 text-white bg-penpot-primary-500/30"
                      : "border-penpot-border text-penpot-text-medium hover:bg-penpot-neutral-500 hover:border-penpot-primary-300 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}

            <span className="hidden sm:inline-block h-4 w-px bg-penpot-border mx-2" />

            {/* Sort Dropdown */}
            <div className="relative inline-flex">
              <select
                value={sort}
                onChange={(e) => updateParams({ sort: e.target.value })}
                className="appearance-none bg-penpot-surface border border-penpot-border hover:border-penpot-primary-300 px-3 py-1.5 pr-8 text-xs font-bold uppercase tracking-wider text-penpot-text-medium hover:text-white cursor-pointer transition-all rounded-[4px] focus:outline-none"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-penpot-surface text-white">
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-penpot-text-medium" />
            </div>

            {/* Active genre chip */}
            {genre && (
              <div className="flex items-center gap-2 bg-penpot-surface border border-penpot-primary-300 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white rounded-[4px]">
                <span>{genre}</span>
                <button
                  type="button"
                  onClick={() => updateParams({ genre: "" })}
                  className="text-penpot-text-medium hover:text-white transition-colors cursor-pointer"
                  title="Clear genre"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Dedicated Genre Page Banner */}
          {genreDef && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-penpot-surface border border-penpot-primary-300/40 p-4 rounded-[8px] shadow-lg">
              <div>
                <p className="text-sm font-bold text-white">Looking for the dedicated {genreDef.name} experience?</p>
                <p className="text-xs text-penpot-text-medium mt-0.5">Explore curated sub-categories, personalized picks, and available library titles for {genreDef.name}.</p>
              </div>
              <Link
                href={`/genre/${genreDef.slug}`}
                className="shrink-0 inline-flex items-center gap-2 bg-penpot-primary-300 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all hover:bg-penpot-primary-400 hover:scale-[1.02] active:scale-95 rounded-[4px]"
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
                className="text-xs font-bold uppercase tracking-wider text-penpot-text-medium hover:text-white transition-colors cursor-pointer"
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
                  className="group flex items-center gap-2 bg-penpot-surface hover:bg-penpot-neutral-500 border border-penpot-border hover:border-penpot-primary-300 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-penpot-text-medium hover:text-white cursor-pointer transition-all rounded-[4px]"
                >
                  <span>{term}</span>
                  <button
                    type="button"
                    onClick={(e) => removeRecentSearch(e, term)}
                    className="text-penpot-text-medium hover:text-white transition-colors p-0.5 cursor-pointer"
                    title="Remove item"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-penpot-text-medium pt-2">No recent searches yet.</p>
          )}
        </div>
      )}

      {/* Active Search / Browse Results State */}
      {(query || genre || type || filter) && (
        <>
          {isLoading ? (
            <div className="space-y-8 pt-4">
              <div className="space-y-3">
                <div className="h-6 w-32 bg-penpot-surface/60 border border-penpot-border/40 animate-pulse rounded-[4px]" />
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="aspect-[240/136] bg-penpot-surface/60 border border-penpot-border/40 animate-pulse rounded-[8px]" />
                  ))}
                </div>
              </div>
            </div>
          ) : error ? (
            <p className="text-center text-sm text-penpot-text-medium py-12">
              Search failed. Please verify connection.
            </p>
          ) : results.length === 0 ? (
            <p className="text-center text-sm text-penpot-text-medium py-16">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-5">
                    {topResults.map((item) => {
                      const isTv = Boolean(item.media_type === "tv" || (!item.title && item.name))
                      const title = item.title || item.name || "Untitled"
                      const backdrop = getPosterUrl(item, isTv)

                      const availabilityKey = `${isTv ? "tv" : "movie"}-${item.id}`
                      const availability = availabilityMap[availabilityKey]

                      return (
                        <Link
                          key={item.id}
                          href={`/${isTv ? "tv" : "movie"}/${item.id}`}
                          onClick={handleResultClick}
                          className="group block overflow-hidden rounded-[8px] bg-transparent relative"
                        >
                          <div className="relative aspect-[240/136] w-full overflow-hidden rounded-[8px] bg-penpot-surface border border-penpot-border group-hover:border-penpot-primary-300 transition-colors">
                            <Image
                              src={backdrop}
                              alt={title}
                              fill
                              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                              className="object-cover transition-transform duration-300 group-hover:scale-105"
                              unoptimized
                            />
                            {/* Availability Badge */}
                            <div className="absolute top-2 right-2 z-10 pointer-events-none">
                              {availability?.status === "in_library" && (
                                <AvailabilityBadge state={availability} />
                              )}
                            </div>
                          </div>
                          <div className="pt-2">
                            <h3 className="text-sm font-bold text-white group-hover:text-penpot-primary-100 transition-colors truncate">
                              {title}
                            </h3>
                            <p className="text-xs font-medium text-penpot-text-medium mt-0.5">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-5">
                    {visibleSeries.map((item) => {
                      const title = item.name || item.title || "Untitled"
                      const backdrop = getPosterUrl(item, true)
                      const year = item.first_air_date
                        ? new Date(item.first_air_date).getFullYear()
                        : null

                      const availabilityKey = `tv-${item.id}`
                      const availability = availabilityMap[availabilityKey]

                      return (
                        <Link
                          key={item.id}
                          href={`/tv/${item.id}`}
                          onClick={handleResultClick}
                          className="group block overflow-hidden rounded-[8px] bg-transparent relative"
                        >
                          <div className="relative aspect-[240/136] w-full overflow-hidden rounded-[8px] bg-penpot-surface border border-penpot-border group-hover:border-penpot-primary-300 transition-colors">
                            <Image
                              src={backdrop}
                              alt={title}
                              fill
                              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                              className="object-cover transition-transform duration-300 group-hover:scale-105"
                              unoptimized
                            />
                            {/* Availability Badge on poster */}
                            <div className="absolute top-2 right-2 z-10 pointer-events-none">
                              {availability?.status === "in_library" && (
                                <AvailabilityBadge state={availability} />
                              )}
                            </div>
                          </div>
                          <div className="pt-2">
                            <h3 className="text-sm font-bold text-white group-hover:text-penpot-primary-100 transition-colors truncate">
                              {title}
                            </h3>
                            <p className="text-xs font-medium text-penpot-text-medium mt-0.5">
                              {year ? `Series • ${year}` : "Series"}
                            </p>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                  {series.length > 6 && !showAllSeries && (
                    <button
                      onClick={() => setShowAllSeries(true)}
                      className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-penpot-text-medium hover:text-white transition-colors pt-1 cursor-pointer"
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-5">
                    {visibleMovies.map((item) => {
                      const title = item.title || item.name || "Untitled"
                      const backdrop = getPosterUrl(item, false)
                      const year = item.release_date
                        ? new Date(item.release_date).getFullYear()
                        : null

                      const availabilityKey = `movie-${item.id}`
                      const availability = availabilityMap[availabilityKey]

                      return (
                        <Link
                          key={item.id}
                          href={`/movie/${item.id}`}
                          onClick={handleResultClick}
                          className="group block overflow-hidden rounded-[8px] bg-transparent relative"
                        >
                          <div className="relative aspect-[240/136] w-full overflow-hidden rounded-[8px] bg-penpot-surface border border-penpot-border group-hover:border-penpot-primary-300 transition-colors">
                            <Image
                              src={backdrop}
                              alt={title}
                              fill
                              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                              className="object-cover transition-transform duration-300 group-hover:scale-105"
                              unoptimized
                            />
                            {/* Availability Badge on poster */}
                            <div className="absolute top-2 right-2 z-10 pointer-events-none">
                              {availability?.status === "in_library" && (
                                <AvailabilityBadge state={availability} />
                              )}
                            </div>
                          </div>
                          <div className="pt-2">
                            <h3 className="text-sm font-bold text-white group-hover:text-penpot-primary-100 transition-colors truncate">
                              {title}
                            </h3>
                            <p className="text-xs font-medium text-penpot-text-medium mt-0.5">
                              {year ? `Movie • ${year}` : "Movie"}
                            </p>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                  {movies.length > 6 && !showAllMovies && (
                    <button
                      onClick={() => setShowAllMovies(true)}
                      className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-penpot-text-medium hover:text-white transition-colors pt-1 cursor-pointer"
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

import { NextRequest, NextResponse } from "next/server"
import { authenticate, getAllItems, JellyfinItem, JellyfinAuthError } from "@/lib/jellyfin"
import { setJellyfinIndex } from "@/lib/cache"
import { tmdbApiFetch } from "@/lib/tmdb-api"
import { getSession } from "@/lib/auth"

import { checkRateLimit } from "@/lib/rate-limit"
import { SingleFlight } from "@/lib/circuit-breaker"

export const dynamic = "force-dynamic"

const CACHE_TTL_MS = 30_000
const ID_CACHE_TTL_MS = 3_600_000
const BATCH_SIZE = 10

type LibraryCacheEntry = { data: string; userId: string; timestamp: number }
let libraryCache: LibraryCacheEntry | null = null

const tvdbToTmdbCache = new Map<number, { tmdbId: number | null; timestamp: number }>()

function parseProviderId(value: string | undefined | null): number | null {
  if (!value) return null
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

export interface JellyfinLibraryItem {
  jellyfinId: string
  title: string
  type: "movie" | "tv"
  tmdbId: number | null
  tvdbId: number | null
  imdbId: string | null
  year: number | null
  overview?: string
  voteAverage?: number
  posterUrl: string
  backdropUrl: string
  dateAdded?: string
  played: boolean
}

type ExtendedJellyfinItem = JellyfinItem & {
  ProductionYear?: number
  PremiereDate?: string
  DateCreated?: string
  DateLastMediaAdded?: string
}

type TmdbDetailsCacheEntry = {
  title?: string
  poster_path?: string | null
  backdrop_path?: string | null
  overview?: string
  vote_average?: number
  year?: number | null
  timestamp: number
}

const tmdbDetailsCache = new Map<string, TmdbDetailsCacheEntry>()

async function fetchTmdbMetadata(type: "movie" | "tv", tmdbId: number): Promise<TmdbDetailsCacheEntry | null> {
  const cacheKey = `${type}:${tmdbId}`
  const cached = tmdbDetailsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < ID_CACHE_TTL_MS) {
    return cached
  }

  try {
    const res = await tmdbApiFetch(
      `/3/${type}/${tmdbId}?append_to_response=images&include_image_language=en`,
      { timeoutMs: 3_500 }
    )
    if (!res.ok) return null
    const data = await res.json()

    // Find best English title treatment backdrop if available
    const englishBackdrops =
      data.images?.backdrops?.filter((b: { iso_639_1?: string }) => b.iso_639_1 === "en") || []
    const horizontalPoster =
      englishBackdrops.length > 0 ? englishBackdrops[0].file_path : data.backdrop_path

    const releaseDate = data.release_date || data.first_air_date
    const year = releaseDate ? parseInt(releaseDate.split("-")[0], 10) : undefined

    const entry: TmdbDetailsCacheEntry = {
      title: data.title || data.name,
      poster_path: data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : null,
      backdrop_path: horizontalPoster ? `https://image.tmdb.org/t/p/w780${horizontalPoster}` : null,
      overview: data.overview,
      vote_average: data.vote_average,
      year: year && !isNaN(year) ? year : null,
      timestamp: Date.now(),
    }
    tmdbDetailsCache.set(cacheKey, entry)
    return entry
  } catch {
    return null
  }
}

async function resolveTmdbIdFromTvdb(tvdbId: number): Promise<number | null> {
  const cached = tvdbToTmdbCache.get(tvdbId)
  if (cached && Date.now() - cached.timestamp < ID_CACHE_TTL_MS) {
    return cached.tmdbId
  }
  try {
    const res = await tmdbApiFetch(`/3/find/${tvdbId}?external_source=tvdb_id`, { timeoutMs: 3_000 })
    if (!res.ok) return null
    const data = await res.json()
    const tvResults = data.tv_results ?? []
    const movieResults = data.movie_results ?? []
    const resolved = tvResults.length > 0 ? tvResults[0].id : movieResults.length > 0 ? movieResults[0].id : null
    tvdbToTmdbCache.set(tvdbId, { tmdbId: resolved, timestamp: Date.now() })
    return resolved
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!checkRateLimit(`library:${session.userId}`, { windowMs: 10_000, maxRequests: 30 })) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
    }

    const refresh = request.nextUrl.searchParams.get("refresh") === "true"
    if (!refresh && libraryCache && libraryCache.userId === session.userId && Date.now() - libraryCache.timestamp < CACHE_TTL_MS) {
      return new NextResponse(libraryCache.data, {
        headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=30" },
      })
    }

    const { token, userId } = await authenticate()
    const rawItems: JellyfinItem[] = await SingleFlight.execute(`library-items:${session.userId}`, () =>
      getAllItems(token, userId)
    )

    // Update the internal Jellyfin index only on an actual refetch.
    setJellyfinIndex(rawItems)

    const movies: JellyfinLibraryItem[] = []
    const series: JellyfinLibraryItem[] = []

    const tvdbResolveQueue: { item: JellyfinLibraryItem }[] = []

    for (const rawItem of rawItems) {
      const item = rawItem as ExtendedJellyfinItem
      const type = item.Type === "Series" ? "tv" : "movie"
      const tmdbId = parseProviderId(item.ProviderIds?.Tmdb)
      const tvdbId = parseProviderId(item.ProviderIds?.Tvdb)
      const imdbId = item.ProviderIds?.Imdb ?? null

      let year: number | null = null
      if (item.ProductionYear) {
        year = item.ProductionYear
      } else if (item.PremiereDate) {
        const d = new Date(item.PremiereDate)
        if (!isNaN(d.getTime())) year = d.getFullYear()
      }

      const libItem: JellyfinLibraryItem = {
        jellyfinId: item.Id,
        title: item.Name,
        type,
        tmdbId,
        tvdbId,
        imdbId,
        year,
        posterUrl: `/api/jellyfin/image/${item.Id}?type=Primary`,
        backdropUrl: `/api/jellyfin/image/${item.Id}?type=Backdrop`,
        dateAdded: item.DateCreated || item.DateLastMediaAdded,
        played: item.UserData?.Played ?? false,
      }

      if (type === "movie") {
        movies.push(libItem)
      } else {
        series.push(libItem)
        if (!libItem.tmdbId && libItem.tvdbId) {
          tvdbResolveQueue.push({ item: libItem })
        }
      }
    }

    // Resolve all missing TMDB IDs for series server-side in bounded batches.
    // The 1h id cache keeps repeat resolutions (across the 30s route cache) cheap.
    for (let i = 0; i < tvdbResolveQueue.length; i += BATCH_SIZE) {
      const batch = tvdbResolveQueue.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async (entry) => {
          if (entry.item.tvdbId) {
            const resolved = await resolveTmdbIdFromTvdb(entry.item.tvdbId)
            if (resolved) {
              entry.item.tmdbId = resolved
            }
          }
        })
      )
    }

    // Enrich items with official TMDB metadata, posters, and backdrops
    const allItemsToEnrich = [...movies, ...series].filter((item) => item.tmdbId)
    for (let i = 0; i < allItemsToEnrich.length; i += BATCH_SIZE) {
      const batch = allItemsToEnrich.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async (item) => {
          if (!item.tmdbId) return
          const meta = await fetchTmdbMetadata(item.type, item.tmdbId)
          if (meta) {
            if (meta.title) item.title = meta.title
            if (meta.overview) item.overview = meta.overview
            if (meta.poster_path) item.posterUrl = meta.poster_path
            if (meta.backdrop_path) item.backdropUrl = meta.backdrop_path
            if (meta.vote_average != null) item.voteAverage = meta.vote_average
            if (meta.year != null && !item.year) item.year = meta.year
          }
        })
      )
    }

    const payload = JSON.stringify({ movies, series, total: movies.length + series.length })
    libraryCache = { data: payload, userId: session.userId, timestamp: Date.now() }

    return new NextResponse(payload, {
      headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=30" },
    })
  } catch (err) {
    if (err instanceof JellyfinAuthError) {
      return NextResponse.json(
        { movies: [], series: [], total: 0, error: "Jellyfin authentication expired", jellyfinAuth: "expired" },
        { status: 403 }
      )
    }
    const message = err instanceof Error ? err.message : "Failed to fetch Jellyfin library"
    console.error("Library API error:", message)
    return NextResponse.json(
      { movies: [], series: [], total: 0, error: message },
      { status: 502 }
    )
  }
}


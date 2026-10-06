import { NextRequest, NextResponse } from "next/server"
import * as radarr from "@/lib/radarr"
import * as sonarr from "@/lib/sonarr"
import { authenticate, getAllItems } from "@/lib/jellyfin"
import {
  ensureRadarrMovies,
  ensureSonarrSeries,
  ensureJellyfinIndex,
  getTmdbToTvdbMapping,
  setTmdbToTvdbMapping,
  fetchTmdbToTvdbMappingL2,
} from "@/lib/cache"
import { tmdbApiFetch } from "@/lib/tmdb-api"

import { getAllRequests, type RequestItem } from "@/lib/requests-store"

const FETCH_TIMEOUT = 5_000

type AvailabilityItem = {
  tmdbId: number
  type: "movie" | "tv"
  tvdbId?: number | null
}

export type AvailabilityResult = {
  status: "in_library" | "downloading" | "in_radarr" | "in_sonarr" | "pending" | "not_requested"
  progress?: number
  jellyfinItemId?: string
  requestedByUsername?: string
  requestedAt?: string
  requestId?: string
}

type QueueMap = Map<number, { progress: number }>

let radarrQueueCache: { map: QueueMap; timestamp: number } = { map: new Map(), timestamp: 0 }
let sonarrQueueCache: { map: QueueMap; timestamp: number } = { map: new Map(), timestamp: 0 }
const QUEUE_TTL = 15_000

async function buildRadarrQueueMap(): Promise<QueueMap> {
  if (Date.now() - radarrQueueCache.timestamp < QUEUE_TTL) return radarrQueueCache.map
  try {
    const items = await radarr.getQueue()
    const map: QueueMap = new Map()
    for (const q of items) {
      if (q.movieId) map.set(q.movieId, { progress: q.progressPercent })
    }
    radarrQueueCache = { map, timestamp: Date.now() }
    return map
  } catch {
    return radarrQueueCache.map
  }
}

async function buildSonarrQueueMap(): Promise<QueueMap> {
  if (Date.now() - sonarrQueueCache.timestamp < QUEUE_TTL) return sonarrQueueCache.map
  try {
    const items = await sonarr.getQueue()
    const map: QueueMap = new Map()
    for (const q of items) {
      if (q.seriesId) map.set(q.seriesId, { progress: q.progressPercent })
    }
    sonarrQueueCache = { map, timestamp: Date.now() }
    return map
  } catch {
    return sonarrQueueCache.map
  }
}

async function resolveTvdbId(tmdbId: number): Promise<number | null> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null
  const cached = getTmdbToTvdbMapping(tmdbId)
  if (cached !== undefined) return cached
  const cachedL2 = await fetchTmdbToTvdbMappingL2(tmdbId)
  if (cachedL2 !== null) return cachedL2

  try {
    const res = await tmdbApiFetch(`/3/tv/${tmdbId}/external_ids`, { timeoutMs: FETCH_TIMEOUT })
    if (!res.ok) return null
    const data = await res.json()
    const tvdbId: number | null = data.tvdb_id ?? null
    if (tvdbId !== null) setTmdbToTvdbMapping(tmdbId, tvdbId)
    return tvdbId
  } catch {
    return null
  }
}

function findPendingRequest(
  tmdbId: number,
  type: "movie" | "tv",
  tvdbId: number | null,
  pendingRequests: RequestItem[]
): RequestItem | undefined {
  return pendingRequests.find((r) => {
    if (r.status !== "pending") return false
    if (r.mediaType !== type) return false
    if (type === "movie") {
      return r.tmdbId === tmdbId
    } else {
      const target = tvdbId ?? tmdbId
      return r.tmdbId === tmdbId || (r.tvdbId && r.tvdbId === target) || r.tmdbId === target
    }
  })
}

export async function GET(request: NextRequest) {
  const tmdbIdParam = request.nextUrl.searchParams.get("tmdbId")
  const typeParam = request.nextUrl.searchParams.get("type")
  if (!tmdbIdParam || !typeParam) {
    return NextResponse.json({ error: "tmdbId and type are required" }, { status: 400 })
  }
  const tmdbId = Number(tmdbIdParam)
  const type = typeParam as "movie" | "tv"
  if (type !== "movie" && type !== "tv") {
    return NextResponse.json({ error: "type must be 'movie' or 'tv'" }, { status: 400 })
  }
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return NextResponse.json({ error: "tmdbId must be a positive integer" }, { status: 400 })
  }

  try {
    const [allRequests, movies, series] = await Promise.all([
      getAllRequests().catch(() => []),
      ensureRadarrMovies(() => radarr.getMovies()).catch(() => new Map<number, radarr.RadarrMovie>()),
      ensureSonarrSeries(() => sonarr.getSeries()).catch(() => new Map<number, sonarr.SonarrSeries>()),
    ])
    const [radarrQueue, sonarrQueue] = await Promise.all([
      buildRadarrQueueMap(),
      buildSonarrQueueMap(),
    ])

    let result: AvailabilityResult
    let resolvedTvdbId: number | null = null
    if (type === "movie") {
      result = checkMovieAvailability(tmdbId, movies, radarrQueue)
    } else {
      resolvedTvdbId = await resolveTvdbId(tmdbId)
      if (resolvedTvdbId === null) {
        result = { status: "not_requested" }
      } else {
        result = checkSeriesAvailability(resolvedTvdbId, series, sonarrQueue)
      }
    }

    if (result.status === "not_requested") {
      const pendingReq = findPendingRequest(tmdbId, type, resolvedTvdbId, allRequests)
      if (pendingReq) {
        result = {
          status: "pending",
          requestedByUsername: pendingReq.requestedBy.username,
          requestedAt: pendingReq.requestedAt,
          requestId: pendingReq.id,
        }
      }
    }

    // Cross-reference with the Jellyfin index. For movies this only runs
    // when Radarr already reports the file; for series Sonarr never carries
    // a hasFile flag for the show as a whole, so the index is the source of
    // truth for "in_library".
    const needsJellyfinLookup =
      (type === "movie" && result.status === "in_library" && !result.jellyfinItemId) ||
      type === "tv"
    if (needsJellyfinLookup) {
      const idx = await ensureJellyfinIndex(async () => {
        try {
          const { token, userId } = await authenticate()
          return getAllItems(token, userId)
        } catch { return [] }
      }).catch(() => new Map<string, string>())
      const key = type === "movie" ? `tmdb-${tmdbId}` : resolvedTvdbId != null ? `tvdb-${resolvedTvdbId}` : null
      const jfId = key ? idx.get(key) : undefined
      if (jfId) {
        result = { ...result, status: "in_library", jellyfinItemId: jfId }
      }
    }

    return NextResponse.json(
      { results: { [`${type}-${tmdbId}`]: result } },
      { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" } }
    )
  } catch {
    return NextResponse.json({ error: "Availability check failed" }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  let body: { items: AvailabilityItem[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.items || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 })
  }

  const results: Record<string, AvailabilityResult> = {}

  try {
    const [allRequests, radarrQueue, sonarrQueue] = await Promise.all([
      getAllRequests().catch(() => []),
      buildRadarrQueueMap(),
      buildSonarrQueueMap(),
    ])

    const [radarrMoviesResult, sonarrSeriesResult] = await Promise.allSettled([
      ensureRadarrMovies(() => radarr.getMovies()),
      ensureSonarrSeries(() => sonarr.getSeries()),
    ])
    const movies = radarrMoviesResult.status === "fulfilled" ? radarrMoviesResult.value : new Map<number, radarr.RadarrMovie>()
    const series = sonarrSeriesResult.status === "fulfilled" ? sonarrSeriesResult.value : new Map<number, sonarr.SonarrSeries>()

    const tvItems = body.items.filter((i) => i.type === "tv")
    const tvdbIds = await Promise.all(
      tvItems.map(async (item) => {
        const id = item.tvdbId ?? (await resolveTvdbId(item.tmdbId))
        return { tmdbId: item.tmdbId, tvdbId: id }
      })
    )
    const tvdbMap = new Map(tvdbIds.map((x) => [x.tmdbId, x.tvdbId]))

    let jellyfinIndex: Map<string, string> | null = null

    await Promise.all(
      body.items.map(async (item) => {
        const key = `${item.type}-${item.tmdbId}`
        try {
          let result: AvailabilityResult

          if (item.type === "movie") {
            result = checkMovieAvailability(item.tmdbId, movies, radarrQueue)
          } else {
            const resolvedTvdbId = tvdbMap.get(item.tmdbId) ?? null
            if (resolvedTvdbId === null) {
              result = { status: "not_requested" }
            } else {
              result = checkSeriesAvailability(resolvedTvdbId, series, sonarrQueue)
            }
          }

          if (result.status === "not_requested") {
            const resolvedTvdbId = item.type === "tv" ? (tvdbMap.get(item.tmdbId) ?? null) : null
            const pendingReq = findPendingRequest(item.tmdbId, item.type, resolvedTvdbId, allRequests)
            if (pendingReq) {
              result = {
                status: "pending",
                requestedByUsername: pendingReq.requestedBy.username,
                requestedAt: pendingReq.requestedAt,
                requestId: pendingReq.id,
              }
            }
          }

          if (result.status === "in_library" && !result.jellyfinItemId) {
            if (!jellyfinIndex) {
              jellyfinIndex = await ensureJellyfinIndex(async () => {
                try {
                  const { token, userId } = await authenticate()
                  return getAllItems(token, userId)
                } catch { return [] }
              }).catch(() => new Map<string, string>())
            }
            const providerKey = item.type === "movie" ? `tmdb-${item.tmdbId}` : `tvdb-${tvdbMap.get(item.tmdbId)}`
            const jfId = providerKey ? jellyfinIndex.get(providerKey) : undefined
            if (jfId) result = { ...result, jellyfinItemId: jfId }
          }

          results[key] = result
        } catch {
          results[key] = { status: "not_requested" }
        }
      })
    )

    return NextResponse.json({ results })
  } catch {
    return NextResponse.json({ results }, { status: 200 })
  }
}

function checkMovieAvailability(
  tmdbId: number,
  movies: Map<number, radarr.RadarrMovie>,
  queue: QueueMap
): AvailabilityResult {
  const movie = movies.get(tmdbId)
  if (!movie) return { status: "not_requested" }
  if (movie.hasFile) return { status: "in_library" }
  const q = queue.get(movie.id)
  if (q) return { status: "downloading", progress: q.progress }
  return { status: "in_radarr" }
}

function checkSeriesAvailability(
  tvdbId: number,
  series: Map<number, sonarr.SonarrSeries>,
  queue: QueueMap
): AvailabilityResult {
  const show = series.get(tvdbId)
  if (!show) return { status: "not_requested" }
  const q = queue.get(show.id)
  if (q) return { status: "downloading", progress: q.progress }
  return { status: "in_sonarr" }
}

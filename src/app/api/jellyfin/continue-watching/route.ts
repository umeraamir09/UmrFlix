import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import {
  getResumeItems,
  getNextUpItems,
  getItemDetail,
  buildJellyfinImageUrl,
  JellyfinAuthError,
} from "@/lib/jellyfin"
import type { JellyfinResumeItem } from "@/lib/jellyfin"
import { tmdbProxyFetch } from "@/lib/tmdb-proxy"

export const dynamic = "force-dynamic"

type CacheEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[]
  timestamp: number
}

const cwCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 20_000 // 20-second per-user cache
const ID_CACHE_TTL_MS = 3_600_000 // 1-hour cache for external metadata

type TmdbDetailsCacheEntry = {
  id: number
  title?: string
  poster_path?: string | null
  backdrop_path?: string | null
  overview?: string
  vote_average?: number
  timestamp: number
}

const tmdbDetailsCache = new Map<string, TmdbDetailsCacheEntry>()
const tvdbToTmdbCache = new Map<number, { tmdbId: number | null; timestamp: number }>()
const imdbToTmdbCache = new Map<string, { tmdbId: number | null; timestamp: number }>()
const seriesDetailsCache = new Map<string, { tmdbId: number | null; tvdbId: number | null; imdbId: string | null; timestamp: number }>()
const searchTitleCache = new Map<string, { tmdbId: number | null; timestamp: number }>()

function parseProviderId(value: string | undefined | null): number | null {
  if (!value) return null
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

async function resolveTmdbIdFromTvdb(tvdbId: number): Promise<number | null> {
  const cached = tvdbToTmdbCache.get(tvdbId)
  if (cached && Date.now() - cached.timestamp < ID_CACHE_TTL_MS) {
    return cached.tmdbId
  }
  try {
    const res = await tmdbProxyFetch(`/3/find/${tvdbId}?external_source=tvdb_id`, { timeoutMs: 3_000 })
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

async function resolveTmdbIdFromImdb(imdbId: string): Promise<number | null> {
  const cached = imdbToTmdbCache.get(imdbId)
  if (cached && Date.now() - cached.timestamp < ID_CACHE_TTL_MS) {
    return cached.tmdbId
  }
  try {
    const res = await tmdbProxyFetch(`/3/find/${imdbId}?external_source=imdb_id`, { timeoutMs: 3_000 })
    if (!res.ok) return null
    const data = await res.json()
    const tvResults = data.tv_results ?? []
    const movieResults = data.movie_results ?? []
    const resolved = tvResults.length > 0 ? tvResults[0].id : movieResults.length > 0 ? movieResults[0].id : null
    imdbToTmdbCache.set(imdbId, { tmdbId: resolved, timestamp: Date.now() })
    return resolved
  } catch {
    return null
  }
}

async function searchTmdbByTitle(type: "movie" | "tv", title: string): Promise<number | null> {
  const cacheKey = `${type}:${title.toLowerCase().trim()}`
  const cached = searchTitleCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < ID_CACHE_TTL_MS) {
    return cached.tmdbId
  }
  try {
    const endpoint = type === "tv" ? "/3/search/tv" : "/3/search/movie"
    const res = await tmdbProxyFetch(`${endpoint}?query=${encodeURIComponent(title)}`, { timeoutMs: 3_000 })
    if (!res.ok) return null
    const data = await res.json()
    const results = data.results ?? []
    const resolved = results.length > 0 ? results[0].id : null
    searchTitleCache.set(cacheKey, { tmdbId: resolved, timestamp: Date.now() })
    return resolved
  } catch {
    return null
  }
}

async function fetchTmdbMetadata(type: "movie" | "tv", tmdbId: number): Promise<TmdbDetailsCacheEntry | null> {
  const cacheKey = `${type}:${tmdbId}`
  const cached = tmdbDetailsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < ID_CACHE_TTL_MS) {
    return cached
  }

  try {
    const res = await tmdbProxyFetch(
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

    const entry: TmdbDetailsCacheEntry = {
      id: tmdbId,
      title: data.title || data.name,
      poster_path: data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : null,
      backdrop_path: horizontalPoster ? `https://image.tmdb.org/t/p/w780${horizontalPoster}` : null,
      overview: data.overview,
      vote_average: data.vote_average,
      timestamp: Date.now(),
    }
    tmdbDetailsCache.set(cacheKey, entry)
    return entry
  } catch {
    return null
  }
}

function ticksToMinutes(ticks: number): number {
  return Math.round(ticks / 10_000_000 / 60)
}

async function resolveTmdbIdForItem(item: JellyfinResumeItem): Promise<{ tmdbId: number | null; type: "movie" | "tv" }> {
  const isEpisode = item.Type === "Episode"
  const type: "movie" | "tv" = isEpisode ? "tv" : "movie"

  // 1. Direct Movie TMDB ID
  if (!isEpisode) {
    const directTmdb = parseProviderId(item.ProviderIds?.Tmdb)
    if (directTmdb) return { tmdbId: directTmdb, type }
  }

  // 2. Series lookup if episode
  if (isEpisode && item.SeriesId) {
    let seriesMeta = seriesDetailsCache.get(item.SeriesId)
    if (!seriesMeta || Date.now() - seriesMeta.timestamp > ID_CACHE_TTL_MS) {
      try {
        const seriesItem = await getItemDetail(item.SeriesId)
        seriesMeta = {
          tmdbId: parseProviderId(seriesItem?.ProviderIds?.Tmdb),
          tvdbId: parseProviderId(seriesItem?.ProviderIds?.Tvdb),
          imdbId: seriesItem?.ProviderIds?.Imdb ?? null,
          timestamp: Date.now(),
        }
        seriesDetailsCache.set(item.SeriesId, seriesMeta)
      } catch {
        seriesMeta = { tmdbId: null, tvdbId: null, imdbId: null, timestamp: Date.now() }
      }
    }

    if (seriesMeta.tmdbId) return { tmdbId: seriesMeta.tmdbId, type }
    if (seriesMeta.tvdbId) {
      const resolved = await resolveTmdbIdFromTvdb(seriesMeta.tvdbId)
      if (resolved) return { tmdbId: resolved, type }
    }
    if (seriesMeta.imdbId) {
      const resolved = await resolveTmdbIdFromImdb(seriesMeta.imdbId)
      if (resolved) return { tmdbId: resolved, type }
    }
  }

  // 3. Item's direct TVDB / IMDB fallback
  const tvdbId = parseProviderId(item.ProviderIds?.Tvdb)
  if (tvdbId) {
    const resolved = await resolveTmdbIdFromTvdb(tvdbId)
    if (resolved) return { tmdbId: resolved, type }
  }
  const imdbId = item.ProviderIds?.Imdb
  if (imdbId) {
    const resolved = await resolveTmdbIdFromImdb(imdbId)
    if (resolved) return { tmdbId: resolved, type }
  }

  // 4. Title search fallback
  const titleToSearch = isEpisode ? (item.SeriesName ?? item.Name) : item.Name
  if (titleToSearch) {
    const resolved = await searchTmdbByTitle(type, titleToSearch)
    if (resolved) return { tmdbId: resolved, type }
  }

  return { tmdbId: null, type }
}

async function mapItemWithTmdb(item: JellyfinResumeItem, isNextUp: boolean) {
  const totalTicks = item.RunTimeTicks ?? 0
  const positionTicks = item.UserData?.PlaybackPositionTicks ?? 0

  const progressPercent = isNextUp
    ? 0
    : item.UserData?.PlayedPercentage ??
      (totalTicks > 0 ? Math.round((positionTicks / totalTicks) * 100) : 0)

  const remainingTicks = Math.max(0, totalTicks - positionTicks)
  const remainingMinutes = ticksToMinutes(remainingTicks)
  const timeLeft =
    !isNextUp && remainingMinutes > 0 ? `${remainingMinutes}m left` : undefined

  const episodeNumber =
    item.Type === "Episode" && item.IndexNumber != null
      ? `S${item.ParentIndexNumber ?? 1}:E${item.IndexNumber}`
      : undefined

  const title =
    item.Type === "Episode" ? (item.SeriesName ?? item.Name) : item.Name

  const episodeTitle = item.Type === "Episode" ? item.Name : undefined
  const jellyfinImageUrl = buildJellyfinImageUrl(item, "Backdrop")
  const jellyfinPrimaryUrl = buildJellyfinImageUrl(item, "Primary")
  const logoUrl = buildJellyfinImageUrl(item, "Logo")

  // Resolve TMDB ID and metadata
  const { tmdbId, type: mediaType } = await resolveTmdbIdForItem(item)
  const tmdbMeta = tmdbId ? await fetchTmdbMetadata(mediaType, tmdbId) : null

  // Ensure high-res official TMDB poster & backdrop are preferred
  const poster_path = tmdbMeta?.poster_path || null
  const backdrop_path = tmdbMeta?.backdrop_path || null
  const primaryUrl = poster_path || jellyfinPrimaryUrl
  const imageUrl = backdrop_path || jellyfinImageUrl

  return {
    id: tmdbId || 0,
    jellyfinItemId: item.Id,
    title: tmdbMeta?.title || title,
    episodeTitle,
    episodeNumber,
    overview: tmdbMeta?.overview || item.Overview,
    poster_path,
    backdrop_path,
    imageUrl,
    primaryUrl,
    logoUrl,
    mediaType,
    progressPercent,
    timeLeft,
    providerIds: item.ProviderIds ?? {},
    isNextUp,
  }
}

export async function GET() {
  try {
    const session = await getSession()
    const userId = session?.userId ?? "anonymous"

    const now = Date.now()
    const cached = cwCache.get(userId)
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({ items: cached.items })
    }

    const [resumeItems, nextUpItems] = await Promise.all([
      getResumeItems(12),
      getNextUpItems(12),
    ])

    const seen = new Set(resumeItems.map((item) => item.Id))
    const rawList = [
      ...resumeItems.map((item) => ({ item, isNextUp: false })),
      ...nextUpItems
        .filter((item) => {
          if (seen.has(item.Id)) return false
          seen.add(item.Id)
          return true
        })
        .map((item) => ({ item, isNextUp: true })),
    ]

    // Enrich all items with TMDB metadata concurrently
    const mapped = await Promise.all(
      rawList.map(({ item, isNextUp }) => mapItemWithTmdb(item, isNextUp))
    )

    cwCache.set(userId, { items: mapped, timestamp: now })

    return NextResponse.json({ items: mapped })
  } catch (err) {
    if (err instanceof JellyfinAuthError) {
      return NextResponse.json(
        { error: "Jellyfin authentication expired", jellyfinAuth: "expired" },
        { status: 403 }
      )
    }
    console.error("Continue watching API error:", err)
    return NextResponse.json({ items: [] }, { status: 500 })
  }
}

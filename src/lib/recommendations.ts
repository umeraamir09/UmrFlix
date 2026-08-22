import { getResumeItems, getPlayedItems } from "./jellyfin"
import { tmdbFetch, type TmdbMovie, type TmdbTvShow, type TmdbPaginated, discoverMovies, discoverTv } from "./tmdb"
import { filterDisplayableContent } from "./catalog"
import { withQualityFloors } from "./catalog-quality"
import { bayesianQualityScore } from "./scoring"
import { suitabilityMultiplier } from "./content-policy"


/**
 * Recommendation System for UmrFlix
 * Generates personalized recommendations based on Jellyfin watch history
 */

export type RecommendationItem = {
  id: number
  tmdbId: number
  title: string
  name?: string
  media_type: "movie" | "tv"
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  release_date?: string
  first_air_date?: string
  vote_average: number
  vote_count: number
  popularity: number
  genre_ids: number[]
  adult?: boolean
  source: "watch_history" | "genre_match" | "trending" | "similar"
  score: number
}

/**
 * Uniform row-card shape consumed by MovieRow (customItems) across every
 * catalog surface. Keeps genre rows, recommendation rows, and detail pages
 * rendering identically.
 */
export type RowItem = {
  id: number
  title?: string
  name?: string
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  release_date?: string
  first_air_date?: string
  vote_average: number
  vote_count?: number
  popularity?: number
  media_type?: string
  /** Netflix-style affinity badge (§7.3), set by the discovery engine. */
  matchPct?: number
  availabilityStatus?: {
    status: string
    progress?: number
    jellyfinItemId?: string
  }
}

export function toRowItem(
  item: TmdbMovie | TmdbTvShow | RecommendationItem,
  mediaType: "movie" | "tv"
): RowItem {
  const title = "title" in item ? item.title : undefined
  const name = "name" in item ? item.name : undefined
  return {
    id: item.id,
    title: title || undefined,
    name: name || undefined,
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path,
    overview: item.overview,
    release_date: "release_date" in item ? item.release_date : undefined,
    first_air_date: "first_air_date" in item ? item.first_air_date : undefined,
    vote_average: item.vote_average,
    vote_count: "vote_count" in item ? (item.vote_count as number | undefined) : undefined,
    popularity: "popularity" in item ? (item.popularity as number | undefined) : undefined,
    media_type: mediaType,
  }
}

export function dedupeByTmdbId<T extends { id: number }>(items: T[]): T[] {
  const seen = new Set<number>()
  const result: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    result.push(item)
  }
  return result
}

// Cache for recommendations per user + mediaType (§5.4: the key previously
// omitted userId, serving one user's personalized recs to everyone).
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const MAX_CACHE_ENTRIES = 200
const cacheMap = new Map<string, { items: RecommendationItem[]; timestamp: number }>()

export function invalidateRecommendationCache() {
  cacheMap.clear()
}

function isCacheValid(key: string): boolean {
  const entry = cacheMap.get(key)
  if (!entry) return false
  return Date.now() - entry.timestamp < CACHE_TTL
}

function pruneCacheMap() {
  if (cacheMap.size <= MAX_CACHE_ENTRIES) return
  const overflow = cacheMap.size - MAX_CACHE_ENTRIES
  const oldest = [...cacheMap.entries()]
    .sort((a, b) => a[1].timestamp - b[1].timestamp)
    .slice(0, overflow)
  for (const [key] of oldest) cacheMap.delete(key)
}

/**
 * Get TMDB recommendations for a specific item
 */
async function getSimilarRecommendations(
  itemId: number,
  mediaType: "movie" | "tv"
): Promise<RecommendationItem[]> {
  try {
    const data = await tmdbFetch<TmdbPaginated<TmdbMovie | TmdbTvShow>>(
      `/${mediaType}/${itemId}/recommendations`
    )
    
    if (!data.results) return []
    
    return data.results.map((item, index) => ({
      id: item.id,
      tmdbId: item.id,
      title: "title" in item ? item.title! : item.name!,
      name: "name" in item ? item.name : undefined,
      media_type: mediaType,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      overview: item.overview,
      release_date: "release_date" in item ? item.release_date : undefined,
      first_air_date: "first_air_date" in item ? item.first_air_date : undefined,
      vote_average: item.vote_average,
      vote_count: item.vote_count,
      popularity: item.popularity,
      genre_ids: "genre_ids" in item ? item.genre_ids || [] : [],
      source: "similar" as const,
      score: (1 - index * 0.05) * item.vote_average,
    }))
  } catch (err) {
    console.error(`Failed to get recommendations for ${mediaType}/${itemId}:`, err)
    return []
  }
}

/**
 * Get popular items from TMDB trending
 */
async function getTrendingItems(mediaType: "movie" | "tv", page = 1): Promise<RecommendationItem[]> {
  try {
    const data = await tmdbFetch<TmdbPaginated<TmdbMovie | TmdbTvShow>>(
      `/trending/${mediaType}/week`,
      { page: String(page) }
    )
    
    if (!data.results) return []
    
    return data.results.map((item, index) => ({
      id: item.id,
      tmdbId: item.id,
      title: "title" in item ? item.title! : item.name!,
      name: "name" in item ? item.name : undefined,
      media_type: mediaType,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      overview: item.overview,
      release_date: "release_date" in item ? item.release_date : undefined,
      first_air_date: "first_air_date" in item ? item.first_air_date : undefined,
      vote_average: item.vote_average,
      vote_count: item.vote_count,
      popularity: item.popularity,
      genre_ids: "genre_ids" in item ? item.genre_ids || [] : [],
      source: "trending" as const,
      score: item.popularity + (index === 0 ? 10 : 0),
    }))
  } catch (err) {
    console.error(`Failed to get trending ${mediaType}:`, err)
    return []
  }
}

/**
 * Discover content by genre preferences
 */
async function getGenreBasedRecommendations(
  genreIds: number[],
  mediaType: "movie" | "tv",
  page = 1
): Promise<RecommendationItem[]> {
  try {
    if (genreIds.length === 0) genreIds = [28, 12] // Default to Action & Adventure

    // R0-2: central browse floors replace the 15/10-vote, 1.0-popularity
    // literals that let soap/daily content through.
    const data = mediaType === "movie"
      ? await discoverMovies(withQualityFloors({
          with_genres: genreIds.join(","),
          page: String(page),
          sort_by: "vote_average.desc",
          "with_runtime.gte": "20",
        }, "browse", "movie"))
      : await discoverTv(withQualityFloors({
          with_genres: genreIds.join(","),
          page: String(page),
          sort_by: "vote_average.desc",
        }, "browse", "tv"))
    
    if (!data.results) return []
    
    return data.results.map((item, index) => ({
      id: item.id,
      tmdbId: item.id,
      title: "title" in item ? item.title! : item.name!,
      name: "name" in item ? item.name : undefined,
      media_type: mediaType,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      overview: item.overview,
      release_date: "release_date" in item ? item.release_date : undefined,
      first_air_date: "first_air_date" in item ? item.first_air_date : undefined,
      vote_average: item.vote_average,
      vote_count: item.vote_count,
      popularity: item.popularity,
      genre_ids: "genre_ids" in item ? item.genre_ids || [] : [],
      source: "genre_match" as const,
      score: item.vote_average * 10 - index,
    }))
  } catch (err) {
    console.error(`Failed to get genre recommendations for ${mediaType}:`, err)
    return []
  }
}

/**
 * Main function to generate personalized recommendations
 * Based on user's watch history from Jellyfin
 */
export async function generateRecommendations(
  userId: string,
  options: {
    limit?: number
    mediaType?: "movie" | "tv"
    includeWatched?: boolean
  } = {}
): Promise<RecommendationItem[]> {
  const { limit = 20, mediaType, includeWatched = false } = options
  // §5.4: cache is keyed per user — personalization must never leak across
  // accounts (previously `mediaType || "all"` served one user's recs to all).
  const cacheKey = `${userId}:${mediaType || "all"}`

  // Check cache
  if (isCacheValid(cacheKey) && !includeWatched) {
    const cachedEntry = cacheMap.get(cacheKey)
    if (cachedEntry && cachedEntry.items.length > 0) {
      return cachedEntry.items.slice(0, limit)
    }
  }

  try {
    // Watch history: in-progress (resume) + genuinely completed plays (§6.3 —
    // fully-watched content is the strongest taste signal and was invisible).
    const [watchHistory, playedHistory] = await Promise.all([
      getResumeItems(20).catch(() => []),
      getPlayedItems(20).catch(() => []),
    ])
    const watchedItemIds = new Set<number>()

    for (const item of [...watchHistory, ...playedHistory]) {
      const tmdbId = item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb) : null
      if (tmdbId) watchedItemIds.add(tmdbId)
    }

    const recommendations: RecommendationItem[] = []

    // Source 1: Get recommendations based on recently watched items matching mediaType (parallelized)
    const filteredHistory = [...watchHistory, ...playedHistory].filter(item => {
      if (!mediaType) return true
      if (mediaType === "movie") return item.Type === "Movie"
      return item.Type === "Series" || item.Type === "Episode"
    })

    const seenSeeds = new Set<number>()
    const similarPromises = filteredHistory.slice(0, 5).map((item) => {
      const tmdbId = item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb) : null
      if (!tmdbId || seenSeeds.has(tmdbId)) return Promise.resolve([])
      seenSeeds.add(tmdbId)
      const itemType = item.Type === "Movie" ? "movie" : "tv"
      return getSimilarRecommendations(tmdbId, itemType)
    })

    const trendingPromises = [
      (!mediaType || mediaType === "movie") ? getTrendingItems("movie") : Promise.resolve([]),
      (!mediaType || mediaType === "tv") ? getTrendingItems("tv") : Promise.resolve([]),
    ] as const

    const [similarResults, [trendingMovies, trendingTv]] = await Promise.all([
      Promise.all(similarPromises),
      Promise.all(trendingPromises),
    ])

    for (const similar of similarResults) {
      const filtered = similar.filter(rec => !watchedItemIds.has(rec.tmdbId))
      recommendations.push(...filtered)
    }

    // Source 2: Trending content matching requested mediaType
    if (trendingMovies.length > 0) {
      recommendations.push(...trendingMovies.filter(m => !watchedItemIds.has(m.tmdbId)).slice(0, 10))
    }
    if (trendingTv.length > 0) {
      recommendations.push(...trendingTv.filter(m => !watchedItemIds.has(m.tmdbId)).slice(0, 10))
    }

    // Deduplicate
    const seenIds = new Set<number>()
    const uniqueRecommendations = recommendations.filter(rec => {
      if (mediaType && rec.media_type !== mediaType) return false
      if (seenIds.has(rec.tmdbId)) return false
      seenIds.add(rec.tmdbId)
      return true
    })

    // Score and sort (§4.4: unified Bayesian quality dialect shared with the
    // discovery engine instead of the private vote_average×4 formula)
    const scoredRecommendations = uniqueRecommendations.map(rec => {
      let score = 0
      score += bayesianQualityScore(rec.vote_count, rec.vote_average, rec.media_type ?? "movie") * 40
      score += Math.min(rec.popularity / 10, 30) // Popularity contribution
      // §1.1 demotion policy: explicit-suspect titles sink instead of being hidden.
      score *= suitabilityMultiplier({ adult: rec.adult, title: rec.title })

      // Source boost
      if (rec.source === "similar") score += 20
      else if (rec.source === "genre_match") score += 15
      else if (rec.source === "trending") score += 10

      // Recency bonus
      if (rec.release_date) {
        const releaseYear = new Date(rec.release_date).getFullYear()
        const currentYear = new Date().getFullYear()
        if (releaseYear >= currentYear - 2) score += 10
        else if (releaseYear >= currentYear - 5) score += 5
      }

      if (rec.vote_count > 1000) score += 5

      return { ...rec, score }
    })

    const sorted = scoredRecommendations.sort((a, b) => b.score - a.score)

    // Filter released & displayable quality content only
    const releasedItems = filterDisplayableContent(sorted)

    // Update cache
    if (!includeWatched) {
      pruneCacheMap()
      cacheMap.set(cacheKey, {
        items: releasedItems,
        timestamp: Date.now(),
      })
    }

    return releasedItems.slice(0, limit)
  } catch (err) {
    console.error("Failed to generate recommendations:", err)
    // Fallback to trending — §1.10: run it through the same displayability
    // pipeline so errors never surface unreleased/poster-less/junk items.
    const fallbackType = mediaType || "movie"
    const fallback = await getTrendingItems(fallbackType)
    return filterDisplayableContent(fallback).slice(0, limit)
  }
}

/**
 * Get "For You" recommendations
 */
export async function getForYouRecommendations(userId: string): Promise<RecommendationItem[]> {
  return generateRecommendations(userId, { limit: 20 })
}

/**
 * Get "Because You Watched" recommendations
 */
export async function getBecauseYouWatchedRecommendations(
  userId: string,
  itemId: number,
  mediaType: "movie" | "tv"
): Promise<RecommendationItem[]> {
  return getSimilarRecommendations(itemId, mediaType)
}

/**
 * Public accessor for TMDB similar/recommendations of a single item, shared by
 * the genre personalization engine.
 */
export async function getTmdbRecommendations(
  itemId: number,
  mediaType: "movie" | "tv"
): Promise<RecommendationItem[]> {
  return getSimilarRecommendations(itemId, mediaType)
}

/**
 * Get recommendations by genre
 */
export async function getGenreRecommendations(
  userId: string,
  genreId: number,
  mediaType: "movie" | "tv",
  limit = 20
): Promise<RecommendationItem[]> {
  const items = await getGenreBasedRecommendations([genreId], mediaType)
  const today = new Date()
  const filtered = items.filter((rec) => {
    if (rec.release_date && new Date(rec.release_date) > today) return false
    if (rec.first_air_date && new Date(rec.first_air_date) > today) return false
    return rec.poster_path !== null
  })
  return filtered.slice(0, limit)
}

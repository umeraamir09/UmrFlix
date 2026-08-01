import { getResumeItems } from "./jellyfin"
import { tmdbFetch, type TmdbMovie, type TmdbTvShow, type TmdbPaginated, discoverMovies, discoverTv } from "./tmdb"


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
  media_type?: string
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

// Cache for recommendations per mediaType
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const cacheMap = new Map<string, { items: RecommendationItem[]; timestamp: number }>()

export function invalidateRecommendationCache() {
  cacheMap.clear()
}

function isCacheValid(key: string): boolean {
  const entry = cacheMap.get(key)
  if (!entry) return false
  return Date.now() - entry.timestamp < CACHE_TTL
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
    
    const data = mediaType === "movie" 
      ? await discoverMovies({
          with_genres: genreIds.join(","),
          page: String(page),
          sort_by: "vote_average.desc",
          "vote_count.gte": "100",
        })
      : await discoverTv({
          with_genres: genreIds.join(","),
          page: String(page),
          sort_by: "vote_average.desc",
          "vote_count.gte": "100",
        })
    
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
  const cacheKey = mediaType || "all"

  // Check cache
  if (isCacheValid(cacheKey) && !includeWatched) {
    const cachedEntry = cacheMap.get(cacheKey)
    if (cachedEntry && cachedEntry.items.length > 0) {
      return cachedEntry.items.slice(0, limit)
    }
  }

  try {
    // Get user's watch history from Jellyfin
    const watchHistory = await getResumeItems(20)
    const watchedItemIds = new Set<number>()
    
    watchHistory.forEach(item => {
      const tmdbId = item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb) : null
      if (tmdbId) watchedItemIds.add(tmdbId)
    })

    const recommendations: RecommendationItem[] = []

    // Source 1: Get recommendations based on recently watched items matching mediaType
    const filteredHistory = watchHistory.filter(item => {
      if (!mediaType) return true
      if (mediaType === "movie") return item.Type === "Movie"
      return item.Type === "Series" || item.Type === "Episode"
    })

    for (const item of filteredHistory.slice(0, 5)) {
      const tmdbId = item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb) : null
      if (!tmdbId) continue
      
      const itemType = item.Type === "Movie" ? "movie" : "tv"
      const similar = await getSimilarRecommendations(tmdbId, itemType)
      const filtered = similar.filter(rec => !watchedItemIds.has(rec.tmdbId))
      recommendations.push(...filtered)
    }

    // Source 2: Trending content matching requested mediaType
    if (!mediaType || mediaType === "movie") {
      const trendingMovies = await getTrendingItems("movie")
      recommendations.push(...trendingMovies.filter(m => !watchedItemIds.has(m.tmdbId)).slice(0, 10))
    }
    if (!mediaType || mediaType === "tv") {
      const trendingTv = await getTrendingItems("tv")
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

    // Score and sort
    const scoredRecommendations = uniqueRecommendations.map(rec => {
      let score = 0
      score += rec.vote_average * 4 // Rating contribution (40%)
      score += Math.min(rec.popularity / 10, 30) // Popularity contribution (30%)
      
      // Source boost (20%)
      if (rec.source === "similar") score += 20
      else if (rec.source === "genre_match") score += 15
      else if (rec.source === "trending") score += 10
      
      // Recency bonus (10%)
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
    
    // Filter released content only
    const releasedItems = sorted.filter(rec => {
      const today = new Date()
      if (rec.release_date && new Date(rec.release_date) > today) return false
      if (rec.first_air_date && new Date(rec.first_air_date) > today) return false
      return rec.poster_path !== null
    })

    // Update cache
    if (!includeWatched) {
      cacheMap.set(cacheKey, {
        items: releasedItems,
        timestamp: Date.now(),
      })
    }

    return releasedItems.slice(0, limit)
  } catch (err) {
    console.error("Failed to generate recommendations:", err)
    // Fallback to trending
    const fallbackType = mediaType || "movie"
    const fallback = await getTrendingItems(fallbackType)
    return fallback.slice(0, limit)
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

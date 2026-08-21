import { tmdbFetch } from "@/lib/tmdb"

type CachedPoster = {
  filePath: string | null
  timestamp: number
}

const posterCache = new Map<string, CachedPoster>()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

function getCached(key: string): string | null | undefined {
  const entry = posterCache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    posterCache.delete(key)
    return undefined
  }
  return entry.filePath
}

function setCached(key: string, filePath: string | null) {
  if (posterCache.size > 5000) {
    const now = Date.now()
    for (const [k, v] of posterCache.entries()) {
      if (now - v.timestamp > CACHE_TTL_MS) posterCache.delete(k)
    }
  }
  posterCache.set(key, { filePath, timestamp: Date.now() })
}

/**
 * Fetches the highest-rated English title-treated backdrop (horizontal poster with logo) for a movie or TV show.
 */
export async function fetchEnglishHorizontalPoster(
  type: "movie" | "tv",
  id: number
): Promise<string | null> {
  if (!id || id <= 0) return null
  const key = `${type}-${id}`
  const cached = getCached(key)
  if (cached !== undefined) return cached

  try {
    const res = await tmdbFetch<{
      backdrops?: {
        file_path: string
        iso_639_1: string | null
        vote_average: number
        vote_count: number
      }[]
    }>(`/${type}/${id}/images`, { include_image_language: "en" })

    // Filter strictly to English title-treated backdrops
    const enBackdrops = (res.backdrops || []).filter((b) => b.iso_639_1 === "en")

    if (enBackdrops.length > 0) {
      // Sort by vote count descending, then vote average
      enBackdrops.sort((a, b) => {
        if (b.vote_count !== a.vote_count) {
          return b.vote_count - a.vote_count
        }
        return (b.vote_average || 0) - (a.vote_average || 0)
      })

      const topPath = enBackdrops[0]?.file_path ?? null
      setCached(key, topPath)
      return topPath
    }

    setCached(key, null)
    return null
  } catch {
    setCached(key, null)
    return null
  }
}

/**
 * Enriches a list of media items with English logo-treated backdrops on the server.
 * Replaces `backdrop_path` with the English logo backdrop if available; otherwise retains the existing backdrop.
 */
export async function enrichMediaItemsWithPosters<
  T extends { id: number; media_type?: string; backdrop_path?: string | null; title?: string; name?: string }
>(items: T[], defaultType?: "movie" | "tv"): Promise<T[]> {
  if (!Array.isArray(items) || items.length === 0) return items

  await Promise.all(
    items.map(async (item) => {
      if (!item || !item.id) return
      const mediaType: "movie" | "tv" =
        item.media_type === "tv" || item.media_type === "movie"
          ? item.media_type
          : !item.title && item.name
          ? "tv"
          : defaultType || "movie"

      const enPoster = await fetchEnglishHorizontalPoster(mediaType, item.id)
      if (enPoster) {
        item.backdrop_path = enPoster
      }
    })
  )

  return items
}
